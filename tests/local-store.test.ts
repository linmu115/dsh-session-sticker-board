import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { StickerLocalStore, defaultStickerStorageDirectory } from "../src/host/local-store.ts";
import type { StickerRecord } from "../src/protocol.ts";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const sticker: StickerRecord = {
  stickerId: "9bb3a80e-230d-44d1-a37c-f7b79d2bf315",
  sessionId: "session-demo",
  anchorId: "message:user-2",
  role: "user",
  quote: "完整组合",
  quoteHash: "sha256:quote",
  occurrence: 0,
  markdown: "本地贴纸",
  tags: [],
  color: "yellow",
};

describe("StickerLocalStore", () => {
  it("uses the active DSH_HOME and persists a session independently from Obsidian", async () => {
    expect(defaultStickerStorageDirectory({ DSH_HOME: "D:/launcher-alpha2" }, "C:/user"))
      .toBe(join("D:/launcher-alpha2", "plugin-data", "dsh-session-sticker-board"));
    const root = await mkdtemp(join(tmpdir(), "dsh-stickers-"));
    roots.push(root);
    const store = new StickerLocalStore(root);
    const empty = await store.read("session-demo");
    const saved = await store.save({
      expectedRevision: empty.document.revision,
      document: { ...empty.document, stickers: [sticker] },
    });
    expect(saved.document.revision).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect((await store.read("session-demo")).document.stickers).toEqual([sticker]);
    const files = await import("node:fs/promises").then((fs) => fs.readdir(join(root, "sessions")));
    expect(files).toHaveLength(1);
    expect(JSON.parse(await readFile(join(root, "sessions", files[0]!), "utf8"))).toMatchObject({ document: { sessionId: "session-demo" } });
  });

  it("fences conflicting local writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-stickers-"));
    roots.push(root);
    const store = new StickerLocalStore(root);
    const empty = await store.read("session-demo");
    await store.save({ expectedRevision: empty.document.revision, document: { ...empty.document, stickers: [sticker] } });
    await expect(store.save({ expectedRevision: empty.document.revision, document: { ...empty.document, stickers: [] } }))
      .rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("persists and acknowledges offline backlink deletion work", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-stickers-"));
    roots.push(root);
    const store = new StickerLocalStore(root);
    const empty = await store.read("session-demo");
    const deleted = await store.save({
      expectedRevision: empty.document.revision,
      document: empty.document,
      enqueueBacklinkDelete: sticker,
    });
    expect(deleted.pendingBacklinkDeletes).toEqual([sticker]);
    expect((await store.acknowledgeBacklinkDelete("session-demo", sticker.stickerId)).pendingBacklinkDeletes).toEqual([]);
  });
});
