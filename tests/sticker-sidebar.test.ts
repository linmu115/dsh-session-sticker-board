import { describe, expect, it, vi } from "vitest";

import type { BetterSidebarService } from "../src/context-types.ts";
import type { StickerRecord } from "../src/protocol.ts";
import {
  STICKER_DETAIL_TAB_ID,
  STICKER_DETAIL_TAB_TYPE,
  createStickerSidebarController,
  backlinkOpenAction,
  openStickerInSidebar,
} from "../src/client/sticker-sidebar.tsx";

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

function service(overrides: Partial<BetterSidebarService> = {}): BetterSidebarService {
  return {
    version: "0.15.0",
    features: ["updateTab", "tabMeta"],
    registerTab: vi.fn(() => () => undefined),
    openTab: vi.fn(),
    closeTab: vi.fn(),
    activateTab: vi.fn(),
    updateTab: vi.fn(),
    isTabEnabled: vi.fn(() => true),
    getSnapshot: vi.fn(() => ({ sessionId: "session-demo", state: {} })),
    ...overrides,
  };
}

describe("sticker sidebar", () => {
  it("opens a backlink at its stable block and exact fallback line", () => {
    expect(backlinkOpenAction({
      notePath: "项目/架构.md",
      line: 12,
      column: 4,
      blockId: "sticker-reference",
      excerpt: "回到贴纸",
    }, () => "1378702f-84d2-4e73-9f74-c08d269b2c7f")).toEqual({
      protocolVersion: 1,
      type: "open-note",
      actionId: "1378702f-84d2-4e73-9f74-c08d269b2c7f",
      notePath: "项目/架构.md",
      blockId: "sticker-reference",
      line: 12,
      column: 4,
    });
  });

  it("updates and opens the single detail tab for the selected sticker", () => {
    const sidebar = service();
    expect(openStickerInSidebar(sidebar, sticker)).toBe(true);
    expect(sidebar.updateTab).toHaveBeenCalledWith(STICKER_DETAIL_TAB_ID, {
      path: `dsh-sticker:${sticker.stickerId}`,
      meta: { stickerId: sticker.stickerId },
    });
    expect(sidebar.openTab).toHaveBeenCalledWith(expect.objectContaining({
      type: STICKER_DETAIL_TAB_TYPE,
      id: STICKER_DETAIL_TAB_ID,
      meta: { stickerId: sticker.stickerId },
    }), { sessionId: "session-demo" });
  });

  it("falls back when the sidebar is missing, disabled or too old", () => {
    const controller = createStickerSidebarController();
    expect(controller.openSticker(sticker)).toBe(false);
    const disabled = service({ isTabEnabled: () => false });
    controller.attach(disabled);
    expect(controller.openSticker(sticker)).toBe(false);
    controller.detach(disabled);
    const old = service({ features: [] });
    controller.attach(old);
    expect(controller.openSticker(sticker)).toBe(false);
  });
});
