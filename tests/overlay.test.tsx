import { describe, expect, it, vi } from "vitest";

import {
  buildDshLogicalLink,
  buildReferenceMarkdown,
  createStickerCommands,
  isEligibleMessageSelection,
  spreadDotPoint,
} from "../src/client/overlay.tsx";
import type { StickerRecord } from "../src/protocol.ts";

const sticker: StickerRecord = {
  stickerId: "9bb3a80e-230d-44d1-a37c-f7b79d2bf315",
  sessionId: "session-demo",
  anchorId: "user-node-42",
  role: "user",
  quote: "Generation 保存完整组合。",
  quoteHash: "sha256:30101ebf",
  occurrence: 0,
  markdown: "版本边界说明",
  tags: ["架构"],
  color: "yellow",
  notePath: "架构/DSH维护引擎.md",
  blockId: "dsh-sticker-9bb3a80e",
};

describe("sticker overlay commands", () => {
  it("accepts stable user, steering and assistant message selections", () => {
    for (const kind of ["user", "steering", "assistant-step"]) {
      expect(isEligibleMessageSelection({
        kind,
        sameMessage: true,
        blank: false,
        streaming: false,
        excluded: false,
        hasSession: true,
        hasAnchor: true,
      })).toBe(true);
    }
    expect(isEligibleMessageSelection({
      kind: "tool-result",
      sameMessage: true,
      blank: false,
      streaming: false,
      excluded: false,
      hasSession: true,
      hasAnchor: true,
    })).toBe(false);
  });

  it("moves colliding red dots in stable 24 pixel steps", () => {
    expect(spreadDotPoint({ x: 100, y: 100 }, [])).toEqual({ x: 100, y: 100 });
    expect(spreadDotPoint({ x: 100, y: 100 }, [{ x: 100, y: 100 }])).toEqual({ x: 100, y: 124 });
    expect(spreadDotPoint(
      { x: 100, y: 100 },
      [{ x: 100, y: 100 }, { x: 100, y: 124 }],
    )).toEqual({ x: 100, y: 148 });
  });

  it("copies stable logical and Markdown links from a message dot", async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>(async () => undefined);
    const commands = createStickerCommands(sticker, {
      sessionTitle: "插件维护系统的用户提问",
      clipboard: { writeText },
      openNote: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      confirm: () => true,
    });

    await commands.copyLogicalLink();
    await commands.copyReferenceMarkdown();

    expect(writeText.mock.calls[0]?.[0]).toBe(
      "[回到 DSH：插件维护系统的用户提问](dsh://open/session/session-demo?anchor=user-node-42&quoteHash=sha256%3A30101ebf)",
    );
    expect(writeText.mock.calls[1]?.[0]).toBe(buildReferenceMarkdown(sticker, "插件维护系统的用户提问"));
    expect(buildDshLogicalLink(sticker)).toBe(
      "dsh://open/session/session-demo?anchor=user-node-42&quoteHash=sha256%3A30101ebf",
    );
  });

  it("requires confirmation before deleting a linked sticker", async () => {
    const remove = vi.fn(async () => undefined);
    const commands = createStickerCommands(sticker, {
      sessionTitle: "会话",
      clipboard: { writeText: vi.fn(async () => undefined) },
      openNote: vi.fn(async () => undefined),
      remove,
      confirm: () => false,
    });

    expect(await commands.deleteSticker()).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });
});
