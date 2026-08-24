import { describe, expect, it, vi } from "vitest";

import { createBridgeActionProcessor } from "../src/client/bridge-polling.ts";
import { documentHash, selectedTextHash, type DeepLinkAction, type ObsidianReferenceCaptureV2 } from "../src/protocol.ts";

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

describe("bridge action processor", () => {
  it("keeps a failed capture behind the cursor while processing an unrelated deep link", async () => {
    const acknowledgeDeepLink = vi.fn(async () => undefined);
    let captureAttempts = 0;
    const processor = createBridgeActionProcessor({ acknowledgeDeepLink }, async (message) => {
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
});
