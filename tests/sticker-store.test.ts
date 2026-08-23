import { describe, expect, it } from "vitest";

import { createStickerStore } from "../src/client/sticker-store.ts";
import type { StickerRecord } from "../src/protocol.ts";

function sticker(stickerId: string, anchorId: string): StickerRecord {
  return {
    stickerId,
    sessionId: "session-demo",
    anchorId,
    role: "user",
    quote: anchorId,
    quoteHash: `sha256:${anchorId}`,
    occurrence: 0,
    markdown: "笔记",
    tags: [],
    color: "yellow",
  };
}

const first = sticker("9bb3a80e-230d-44d1-a37c-f7b79d2bf315", "node-1");
const second = sticker("048a8418-98e9-4c60-8b2b-d44535fd1299", "node-2");
const third = sticker("53366496-d3e3-4d5e-bfff-a5947149394c", "node-3");

describe("sticker state store", () => {
  it("reflows display numbers after deletion without changing stable UUIDs", () => {
    const store = createStickerStore([first, second, third], "sha256:one");
    const before = store.snapshot();
    store.remove(second.stickerId);
    const after = store.snapshot();

    expect(before.stickers.map((entry) => entry.displayNumber)).toEqual([1, 2, 3]);
    expect(after.stickers.map((entry) => [entry.record.stickerId, entry.displayNumber])).toEqual([
      [first.stickerId, 1],
      [third.stickerId, 2],
    ]);
    expect(before.stickers).toHaveLength(3);
    expect(Object.isFrozen(after)).toBe(true);
  });

  it("tracks saving, conflict, orphaned and committed revisions immutably", () => {
    const store = createStickerStore([first], "sha256:one");
    store.beginSave(first.stickerId);
    expect(store.snapshot().stickers[0]?.status).toBe("saving");
    store.markConflict(first.stickerId);
    expect(store.snapshot().stickers[0]?.status).toBe("conflict");
    store.markOrphaned(first.stickerId);
    expect(store.snapshot().stickers[0]?.status).toBe("orphaned");
    store.commit("sha256:two");
    expect(store.snapshot()).toMatchObject({ revision: "sha256:two" });
    expect(store.snapshot().stickers[0]?.status).toBe("active");
  });
});
