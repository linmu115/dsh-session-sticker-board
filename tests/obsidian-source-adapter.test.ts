import { describe, expect, it, vi } from "vitest";

import { BridgeUnavailableError } from "../src/bridge/http-client.ts";
import { createObsidianSourceAdapter } from "../src/host/obsidian-source-adapter.ts";
import {
  documentHash,
  selectedTextHash,
  type ObsidianNoteReferenceSource,
  type ReferenceRefreshResultV2,
} from "../src/protocol.ts";

function source(freshness: "captured" | "refreshed" | "offline" = "captured"): ObsidianNoteReferenceSource {
  const markdown = "引用内容 ^block-1\n";
  return {
    sourceType: "obsidian-note",
    selectedText: "引用内容",
    locator: {
      vaultId: "vault-1", notePath: "note.md", blockId: "block-1", occurrence: 0,
      selectedTextHash: selectedTextHash("引用内容"),
    },
    snapshot: { markdown, documentHash: documentHash(markdown), capturedAt: 100, freshness },
  };
}

function item() {
  return {
    ...source(),
    referenceId: "reference-1",
    number: 1,
    userComment: "",
    backlinkState: "pending" as const,
  };
}

function bridge() {
  return {
    refreshReference: vi.fn<(
      referenceId: string,
      knownDocumentHash: string,
      signal?: AbortSignal,
    ) => Promise<ReferenceRefreshResultV2>>(async () => ({ kind: "unchanged", source: source() })),
    discardReference: vi.fn(async () => undefined),
    commitBacklink: vi.fn(async () => ({
      referenceId: "reference-1", commitDigest: `sha256:${"1".repeat(64)}`,
      notePath: "note.md", blockId: "dsh-ref-reference", revision: "sha256:new", writtenAt: 100,
    })),
  };
}

describe("Obsidian Host source adapter", () => {
  it("refreshes by the bridge-owned reference ID and preserves Core identity", async () => {
    const client = bridge();
    const refreshed = source("refreshed");
    client.refreshReference.mockResolvedValueOnce({ kind: "refreshed", source: refreshed });
    const adapter = createObsidianSourceAdapter(client);
    const prepared = await adapter.prepare(item(), new AbortController().signal);
    expect(client.refreshReference).toHaveBeenCalledWith("reference-1", item().snapshot.documentHash, expect.any(AbortSignal));
    expect(prepared).toEqual({ ...item(), ...refreshed });
  });

  it("uses the saved snapshot only when the bridge is offline and blocks a missing source", async () => {
    const client = bridge();
    client.refreshReference.mockResolvedValueOnce({ kind: "offline" });
    const adapter = createObsidianSourceAdapter(client);
    await expect(adapter.prepare(item(), new AbortController().signal)).resolves.toMatchObject({
      snapshot: { freshness: "offline" },
    });
    client.refreshReference.mockResolvedValueOnce({ kind: "blocked", reason: "block-missing" });
    await expect(adapter.prepare(item(), new AbortController().signal)).rejects.toMatchObject({ code: "source-missing" });
  });

  it("does not mistake a local protocol TypeError for an offline bridge", async () => {
    const client = bridge();
    client.refreshReference.mockRejectedValueOnce(new BridgeUnavailableError("offline"));
    const adapter = createObsidianSourceAdapter(client);
    await expect(adapter.prepare(item(), new AbortController().signal)).resolves.toMatchObject({
      snapshot: { freshness: "offline" },
    });

    client.refreshReference.mockRejectedValueOnce(new TypeError("invalid response"));
    await expect(adapter.prepare(item(), new AbortController().signal)).rejects.toMatchObject({
      code: "online-refresh-failed",
    });
  });

  it("discards pending captures and commits the real user-message backlink identity", async () => {
    const client = bridge();
    const adapter = createObsidianSourceAdapter(client);
    await adapter.discardPending?.(item());
    expect(client.discardReference).toHaveBeenCalledWith("reference-1");
    const binding = {
      profileId: "web", sessionId: "session-1", setId: "set-1", referenceId: "reference-1",
      userMessageId: "user-1", userAnchorId: "user-1", userTextHash: `sha256:${"2".repeat(64)}`, item: item(),
    };
    await adapter.commitBacklink?.(binding);
    expect(client.commitBacklink).toHaveBeenCalledWith({
      annotationProtocolVersion: 2,
      type: "backlink-commit",
      referenceId: "reference-1",
      setId: "set-1",
      profileId: "web",
      sessionId: "session-1",
      userMessageId: "user-1",
      userAnchorId: "user-1",
      userTextHash: `sha256:${"2".repeat(64)}`,
    });
  });
});
