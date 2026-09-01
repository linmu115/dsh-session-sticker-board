import { describe, expect, it, vi } from "vitest";

import { createBridgeActionProcessor, startBridgePolling } from "../src/client/bridge-polling.ts";
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
  it("advances locally past sibling-adapter actions without acknowledging them globally", async () => {
    const acknowledgeDeepLink = vi.fn(async () => undefined);
    const acknowledgeAction = vi.fn(async () => undefined);
    const apply = vi.fn(async () => true);
    const processor = createBridgeActionProcessor(
      { acknowledgeDeepLink, acknowledgeAction },
      apply,
      undefined,
      (message) => message.type === "deep-link" && message.setId === undefined && message.quoteHash !== undefined,
    );
    const referenceLink = { ...deepLink, setId: "set-1", referenceId: "reference-1" };
    await expect(processor.process({ cursor: 2, actions: [
      { cursor: 1, message: capture },
      { cursor: 2, message: referenceLink },
    ] })).resolves.toEqual({ applied: 0, failed: 0, cursor: 2 });
    expect(apply).not.toHaveBeenCalled();
    expect(acknowledgeDeepLink).not.toHaveBeenCalled();
    expect(acknowledgeAction).not.toHaveBeenCalled();
  });

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

  it("acknowledges a one-shot deep link only after its target surface takes over", async () => {
    const order: string[] = [];
    const failure = new Error("annotation surface unavailable");
    const acknowledgeDeepLink = vi.fn(async () => { order.push("ack"); });
    const apply = vi.fn(async () => {
      order.push("apply");
      throw failure;
    });
    const onApplyError = vi.fn();
    const processor = createBridgeActionProcessor(
      { acknowledgeDeepLink, acknowledgeAction: vi.fn() },
      apply,
      onApplyError,
    );
    const page = { cursor: 1, actions: [{ cursor: 1, message: deepLink }] };

    await expect(processor.process(page)).resolves.toEqual({ applied: 0, failed: 1, cursor: 1 });
    expect(order).toEqual(["apply", "ack"]);
    expect(onApplyError).toHaveBeenCalledWith(failure, deepLink);

    await expect(processor.process(page)).resolves.toEqual({ applied: 0, failed: 0, cursor: 1 });
    expect(acknowledgeDeepLink).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("retries a failed acknowledgement without reopening the target session", async () => {
    let ackAttempts = 0;
    const acknowledgeDeepLink = vi.fn(async () => {
      if (++ackAttempts === 1) throw new Error("temporary bridge failure");
    });
    const apply = vi.fn(async () => true);
    const processor = createBridgeActionProcessor(
      { acknowledgeDeepLink, acknowledgeAction: vi.fn() },
      apply,
    );
    const page = { cursor: 1, actions: [{ cursor: 1, message: deepLink }] };

    await expect(processor.process(page)).resolves.toMatchObject({ applied: 0, failed: 1, cursor: 0 });
    await expect(processor.process(page)).resolves.toEqual({ applied: 1, failed: 0, cursor: 1 });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(acknowledgeDeepLink).toHaveBeenCalledTimes(2);
  });

  it("polls immediately when an Obsidian Web Viewer becomes visible", async () => {
    let state: DocumentVisibilityState = "hidden";
    let visibilityListener = (): void => undefined;
    let scheduledDelay = 0;
    let cancelCount = 0;
    const nextActions = vi.fn(async () => ({ queueId: "bridge-1", cursor: 0, actions: [] }));
    const handle = startBridgePolling({
      nextActions,
      acknowledgeDeepLink: vi.fn(),
      acknowledgeAction: vi.fn(),
    }, async () => true, {
      visibilityState: () => state,
      subscribeVisibility: (listener) => {
        visibilityListener = listener;
        return () => undefined;
      },
      schedule: (_callback, delay) => {
        scheduledDelay = delay;
        return () => { cancelCount += 1; };
      },
    });

    await handle.firstCycle;
    expect(nextActions).toHaveBeenCalledTimes(1);
    expect(scheduledDelay).toBe(3_000);

    state = "visible";
    visibilityListener();
    await vi.waitFor(() => expect(nextActions).toHaveBeenCalledTimes(2));
    expect(cancelCount).toBe(1);
    handle.stop();
  });
});
