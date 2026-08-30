import { describe, expect, it, vi } from "vitest";

import { createBridgeActionProcessor } from "../src/client/bridge-polling.ts";
import { documentHash, selectedTextHash, type DeepLinkAction, type ObsidianReferenceCaptureV2, type ReferenceDeleteRequestV2 } from "../src/protocol.ts";

const capture: ObsidianReferenceCaptureV2 = {
  annotationProtocolVersion: 2,
  type: "reference-capture",
  actionId: "capture-action",
  referenceId: "reference-1",
  source: {
    sourceType: "obsidian-note",
    selectedText: "引用",
    locator: {
      vaultId: "vault-1", notePath: "note.md", blockId: "block-1", occurrence: 0,
      selectedTextHash: selectedTextHash("引用"),
    },
    snapshot: {
      markdown: "引用 ^block-1\n", documentHash: documentHash("引用 ^block-1\n"),
      capturedAt: 100, freshness: "captured",
    },
  },
};
const deepLink: DeepLinkAction = {
  protocolVersion: 1,
  type: "deep-link",
  actionId: "6f09f1be-5dc1-48e4-ac08-e3c05d70ac01",
  sessionId: "session-1",
  anchorId: "user-1",
};
const deletion: ReferenceDeleteRequestV2 = {
  annotationProtocolVersion: 2,
  type: "reference-delete-request",
  actionId: "delete-action",
  referenceId: "reference-1",
  profileId: "web",
  sessionId: "session-1",
  setId: "set-1",
  requestedAt: 100,
};

describe("bridge action processor", () => {
  it("keeps a failed capture behind the cursor while processing an unrelated deep link", async () => {
    const acknowledgeDeepLink = vi.fn(async () => undefined);
    const acknowledgeAction = vi.fn(async () => undefined);
    let captureAttempts = 0;
    const processor = createBridgeActionProcessor({ acknowledgeDeepLink, acknowledgeAction }, async (message) => {
      if (message.type === "reference-capture") return ++captureAttempts > 1;
      return true;
    });
    await expect(processor.process({
      cursor: 2,
      actions: [{ cursor: 1, message: capture }, { cursor: 2, message: deepLink }],
    })).resolves.toEqual({ applied: 1, failed: 1, cursor: 0 });
    expect(acknowledgeDeepLink).toHaveBeenCalledWith(deepLink.actionId);
    await expect(processor.process({ cursor: 2, actions: [{ cursor: 1, message: capture }] }))
      .resolves.toEqual({ applied: 1, failed: 0, cursor: 2 });
  });

  it("acknowledges a completed bidirectional deletion action", async () => {
    const acknowledgeDeepLink = vi.fn(async () => undefined);
    const acknowledgeAction = vi.fn(async () => undefined);
    const processor = createBridgeActionProcessor({ acknowledgeDeepLink, acknowledgeAction }, async () => true);
    await processor.process({ cursor: 1, actions: [{ cursor: 1, message: deletion }] });
    expect(acknowledgeAction).toHaveBeenCalledWith("delete-action");
    expect(acknowledgeDeepLink).not.toHaveBeenCalled();
  });

  it("consumes stale navigation and applies only the latest non-deleted target", async () => {
    const acknowledgeDeepLink = vi.fn(async (_actionId: string) => undefined);
    const acknowledgeAction = vi.fn(async (_actionId: string) => undefined);
    const apply = vi.fn(async (
      _message: DeepLinkAction | ObsidianReferenceCaptureV2 | ReferenceDeleteRequestV2,
    ) => true);
    const processor = createBridgeActionProcessor({ acknowledgeDeepLink, acknowledgeAction }, apply);
    const deletedLink = { ...deepLink, actionId: "deleted-link", referenceId: deletion.referenceId };
    const staleLink = { ...deepLink, actionId: "stale-link", anchorId: "user-2" };
    const latestLink = { ...deepLink, actionId: "latest-link", anchorId: "user-3" };

    await expect(processor.process({ cursor: 4, actions: [
      { cursor: 1, message: deletedLink },
      { cursor: 2, message: deletion },
      { cursor: 3, message: staleLink },
      { cursor: 4, message: latestLink },
    ] })).resolves.toEqual({ applied: 4, failed: 0, cursor: 4 });

    expect(apply.mock.calls.map(([message]) => message.actionId)).toEqual([
      deletion.actionId,
      latestLink.actionId,
    ]);
    expect(acknowledgeDeepLink.mock.calls.map(([actionId]) => actionId)).toEqual([
      deletedLink.actionId,
      staleLink.actionId,
      latestLink.actionId,
    ]);
  });

  it("replays low cursors when the Obsidian Bridge queue instance changes", async () => {
    const acknowledgeDeepLink = vi.fn(async () => undefined);
    const acknowledgeAction = vi.fn(async () => undefined);
    const apply = vi.fn(async () => true);
    const processor = createBridgeActionProcessor({ acknowledgeDeepLink, acknowledgeAction }, apply);

    await processor.process({ queueId: "bridge-before-reload", cursor: 2, actions: [
      { cursor: 1, message: deepLink },
      { cursor: 2, message: { ...deepLink, actionId: "before-reload-2" } },
    ] });
    expect(processor.cursor).toBe(2);

    await expect(processor.process({
      queueId: "bridge-after-reload",
      cursor: 1,
      actions: [],
    })).resolves.toEqual({ applied: 0, failed: 0, cursor: 0 });

    await expect(processor.process({
      queueId: "bridge-after-reload",
      cursor: 1,
      actions: [{ cursor: 1, message: deletion }],
    })).resolves.toEqual({ applied: 1, failed: 0, cursor: 1 });
    expect(apply).toHaveBeenCalledWith(deletion);
    expect(acknowledgeAction).toHaveBeenCalledWith(deletion.actionId);
  });

  it("reports action application errors instead of swallowing them", async () => {
    const failure = new Error("Core deletion failed");
    const onApplyError = vi.fn();
    const processor = createBridgeActionProcessor(
      { acknowledgeDeepLink: vi.fn(), acknowledgeAction: vi.fn() },
      async () => { throw failure; },
      onApplyError,
    );
    await expect(processor.process({ cursor: 1, actions: [{ cursor: 1, message: deletion }] }))
      .resolves.toEqual({ applied: 0, failed: 1, cursor: 0 });
    expect(onApplyError).toHaveBeenCalledWith(failure, deletion);
  });
});
