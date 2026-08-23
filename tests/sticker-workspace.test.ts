import { describe, expect, it, vi } from "vitest";

import { createStickerWorkspace } from "../src/client/sticker-workspace.ts";
import type { StickerRecord } from "../src/protocol.ts";

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

describe("sticker workspace", () => {
  it("loads once and commits successful optimistic-concurrency writes", async () => {
    const saveSessionNote = vi.fn(async () => ({ revision: "sha256:next" }));
    const bridge = {
      readSessionNote: vi.fn(async () => ({
        protocolVersion: 1 as const,
        type: "session-note" as const,
        sessionId: "session-demo",
        revision: "sha256:base",
        stickers: [sticker],
      })),
      saveSessionNote,
    };
    const workspace = createStickerWorkspace(bridge);

    await Promise.all([workspace.ensure("session-demo"), workspace.ensure("session-demo")]);
    expect(bridge.readSessionNote).toHaveBeenCalledTimes(1);

    await workspace.save({ ...sticker, markdown: "更新说明", color: "green" });
    expect(saveSessionNote).toHaveBeenCalledWith(expect.objectContaining({
      revision: "sha256:base",
      stickers: [expect.objectContaining({ markdown: "更新说明", color: "green" })],
    }), "sha256:base");
    expect(workspace.list("session-demo")[0]?.record.markdown).toBe("更新说明");
    expect(workspace.revision("session-demo")).toBe("sha256:next");
  });

  it("does not remove a sticker locally when the Vault write fails", async () => {
    const bridge = {
      readSessionNote: vi.fn(async () => ({
        protocolVersion: 1 as const,
        type: "session-note" as const,
        sessionId: "session-demo",
        revision: "sha256:base",
        stickers: [sticker],
      })),
      saveSessionNote: vi.fn(async () => { throw new Error("REVISION_CONFLICT"); }),
    };
    const workspace = createStickerWorkspace(bridge);
    await workspace.ensure("session-demo");

    await expect(workspace.remove("session-demo", sticker.stickerId)).rejects.toThrow("REVISION_CONFLICT");
    expect(workspace.list("session-demo")).toHaveLength(1);
  });
});
