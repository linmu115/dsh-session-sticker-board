import { describe, expect, it, vi } from "vitest";

import { createStickerWorkspace } from "../src/client/sticker-workspace.ts";
import type { SessionNoteDocument, StickerRecord } from "../src/protocol.ts";

const sticker: StickerRecord = {
  stickerId: "9bb3a80e-230d-44d1-a37c-f7b79d2bf315",
  sessionId: "session-demo",
  anchorId: "message:user-2",
  role: "user",
  quote: "完整组合",
  quoteHash: "sha256:quote",
  occurrence: 0,
  markdown: "初始说明",
  tags: ["架构"],
  color: "yellow",
};

function document(stickers: StickerRecord[] = [], revision = "sha256:empty"): SessionNoteDocument {
  return {
    protocolVersion: 1,
    type: "session-note",
    sessionId: "session-demo",
    revision,
    stickers,
  };
}

function local(initial = document()) {
  let current = { document: initial, pendingBacklinkDeletes: [] as StickerRecord[] };
  return {
    readLocalState: vi.fn(async () => current),
    saveLocalSession: vi.fn(async (request: { document: SessionNoteDocument; expectedRevision: string; enqueueBacklinkDelete?: StickerRecord }) => {
      if (request.expectedRevision !== current.document.revision) throw new Error("REVISION_CONFLICT");
      current = {
        document: { ...request.document, revision: `sha256:local-${request.document.stickers.length}-${request.document.stickers[0]?.markdown ?? "empty"}` },
        pendingBacklinkDeletes: request.enqueueBacklinkDelete === undefined
          ? current.pendingBacklinkDeletes
          : [...current.pendingBacklinkDeletes, request.enqueueBacklinkDelete],
      };
      return current;
    }),
    acknowledgeBacklinkDelete: vi.fn(async ({ stickerId }: { sessionId: string; stickerId: string }) => {
      current = { ...current, pendingBacklinkDeletes: current.pendingBacklinkDeletes.filter((record) => record.stickerId !== stickerId) };
      return current;
    }),
  };
}

function offlineBridge() {
  return {
    readSessionNote: vi.fn(async () => { throw new TypeError("offline"); }),
    saveSessionNote: vi.fn(async () => { throw new TypeError("offline"); }),
    deleteStickerBacklinks: vi.fn(async () => { throw new TypeError("offline"); }),
  };
}

describe("sticker workspace", () => {
  it("creates and edits durable local stickers while Obsidian is offline", async () => {
    const persistence = local();
    const bridge = offlineBridge();
    const workspace = createStickerWorkspace(persistence, bridge);

    await workspace.ensure("session-demo");
    await workspace.save(sticker);
    await workspace.save({ ...sticker, markdown: "离线更新", color: "green" });

    expect(workspace.list("session-demo")[0]?.record).toMatchObject({ markdown: "离线更新", color: "green" });
    expect(persistence.saveLocalSession).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(workspace.syncStatus("session-demo")).toBe("local-only"));
  });

  it("imports an existing Obsidian session note once, then treats local state as authoritative", async () => {
    const persistence = local();
    const bridge = {
      readSessionNote: vi.fn(async () => document([sticker], "sha256:vault")),
      saveSessionNote: vi.fn(async () => ({ revision: "sha256:vault-next" })),
      deleteStickerBacklinks: vi.fn(async () => ({ notesChanged: 0, linksRemoved: 0 })),
    };
    const workspace = createStickerWorkspace(persistence, bridge);

    await workspace.ensure("session-demo");
    await vi.waitFor(() => expect(workspace.list("session-demo")).toHaveLength(1));
    expect(persistence.saveLocalSession).toHaveBeenCalledOnce();
    expect(workspace.syncStatus("session-demo")).toBe("synced");
  });

  it("deletes locally even when Obsidian backlink cleanup is unavailable", async () => {
    const persistence = local(document([sticker], "sha256:local"));
    const bridge = offlineBridge();
    const workspace = createStickerWorkspace(persistence, bridge);
    await workspace.ensure("session-demo");

    await expect(workspace.remove("session-demo", sticker.stickerId)).resolves.toBeUndefined();
    expect(workspace.list("session-demo")).toHaveLength(0);
    await vi.waitFor(() => expect(bridge.deleteStickerBacklinks).toHaveBeenCalledWith(sticker));
  });

  it("drains a persisted backlink deletion after a workspace restart and reconnect", async () => {
    const persistence = local(document([sticker], "sha256:local"));
    const offline = createStickerWorkspace(persistence, offlineBridge());
    await offline.ensure("session-demo");
    await offline.remove("session-demo", sticker.stickerId);
    await vi.waitFor(async () => {
      expect((await persistence.readLocalState()).pendingBacklinkDeletes).toEqual([sticker]);
    });

    const bridge = {
      readSessionNote: vi.fn(async () => document([sticker], "sha256:vault")),
      saveSessionNote: vi.fn(async () => ({ revision: "sha256:vault-next" })),
      deleteStickerBacklinks: vi.fn(async () => ({ notesChanged: 1, linksRemoved: 1 })),
    };
    const restarted = createStickerWorkspace(persistence, bridge);
    await restarted.ensure("session-demo");
    await vi.waitFor(() => expect(persistence.acknowledgeBacklinkDelete).toHaveBeenCalledWith({
      sessionId: "session-demo",
      stickerId: sticker.stickerId,
    }));
    expect(restarted.list("session-demo")).toHaveLength(0);
  });
});
