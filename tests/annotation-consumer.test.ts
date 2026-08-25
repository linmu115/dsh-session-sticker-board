import { describe, expect, it, vi } from "vitest";

import { consumeObsidianReferenceCapture } from "../src/client/annotation-consumer.ts";
import { BridgeHttpError } from "../src/bridge/http-client.ts";
import {
  documentHash,
  selectedTextHash,
  type ObsidianReferenceCaptureV2,
  type ReferenceClaimV2,
} from "../src/protocol.ts";

function capture(overrides: Partial<ObsidianReferenceCaptureV2> = {}): ObsidianReferenceCaptureV2 {
  const markdown = "# 标题\n\n引用内容 ^block-1\n";
  return {
    annotationProtocolVersion: 2,
    type: "reference-capture",
    actionId: "action-1",
    referenceId: "reference-1",
    source: {
      sourceType: "obsidian-note",
      selectedText: "引用内容",
      locator: {
        vaultId: "vault-1",
        notePath: "Notes/source.md",
        blockId: "block-1",
        occurrence: 0,
        selectedTextHash: selectedTextHash("引用内容"),
      },
      snapshot: {
        markdown,
        documentHash: documentHash(markdown),
        capturedAt: 100,
        freshness: "captured",
      },
    },
    ...overrides,
  };
}

function core(created = true) {
  return {
    addReference: vi.fn(async () => ({ setId: "set-1", referenceId: "reference-1", created })),
    discardPendingOperation: vi.fn(async () => undefined),
  };
}

function bridge() {
  return { claimReference: vi.fn(async (_actionId: string, _claim: ReferenceClaimV2) => undefined) };
}

describe("Obsidian reference capture consumer", () => {
  it("persists the unchanged v2 source in Core before claiming the bridge action", async () => {
    const order: string[] = [];
    const annotationCore = core();
    annotationCore.addReference.mockImplementation(async () => {
      order.push("core");
      return { setId: "set-1", referenceId: "reference-1", created: true };
    });
    const bridgeClient = bridge();
    bridgeClient.claimReference.mockImplementation(async () => { order.push("claim"); });
    const input = capture();

    await expect(consumeObsidianReferenceCapture({
      capture: input,
      sessionId: "session-1",
      profileId: "web",
      annotationCore,
      bridge: bridgeClient,
    })).resolves.toMatchObject({ setId: "set-1", referenceId: "reference-1" });

    expect(order).toEqual(["core", "claim"]);
    expect(annotationCore.addReference).toHaveBeenCalledWith("session-1", input.source, {
      operationId: "action-1",
      referenceId: "reference-1",
    });
    expect(bridgeClient.claimReference).toHaveBeenCalledWith("action-1", {
      annotationProtocolVersion: 2,
      type: "reference-claim",
      referenceId: "reference-1",
      profileId: "web",
      sessionId: "session-1",
      setId: "set-1",
    });
  });

  it("leaves the bridge action pending when Core is missing or persistence fails", async () => {
    const bridgeClient = bridge();
    await expect(consumeObsidianReferenceCapture({
      capture: capture(), sessionId: "session-1", profileId: "web", annotationCore: undefined, bridge: bridgeClient,
    })).rejects.toThrow(/annotation core/i);
    const annotationCore = core();
    annotationCore.addReference.mockRejectedValueOnce(new Error("host persistence failed"));
    await expect(consumeObsidianReferenceCapture({
      capture: capture(), sessionId: "session-1", profileId: "web", annotationCore, bridge: bridgeClient,
    })).rejects.toThrow("host persistence failed");
    expect(bridgeClient.claimReference).not.toHaveBeenCalled();
  });

  it("redelivers an already-persisted capture idempotently and then claims it", async () => {
    const annotationCore = core(false);
    const bridgeClient = bridge();
    await consumeObsidianReferenceCapture({
      capture: capture(), sessionId: "session-1", profileId: "web", annotationCore, bridge: bridgeClient,
    });
    expect(annotationCore.addReference).toHaveBeenCalledOnce();
    expect(bridgeClient.claimReference).toHaveBeenCalledOnce();
  });

  it("removes a losing local add when another target already claimed the capture", async () => {
    const annotationCore = core();
    const bridgeClient = bridge();
    bridgeClient.claimReference.mockRejectedValueOnce(
      new BridgeHttpError(409, "idempotency-conflict", "Reference was claimed by another target"),
    );
    await expect(consumeObsidianReferenceCapture({
      capture: capture(), sessionId: "session-loser", profileId: "web", annotationCore, bridge: bridgeClient,
    })).rejects.toMatchObject({ code: "idempotency-conflict" });
    expect(annotationCore.discardPendingOperation).toHaveBeenCalledWith("session-loser", "action-1");
  });
});
