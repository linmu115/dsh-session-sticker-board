import { describe, expect, it, vi } from "vitest";

import {
  buildDshLogicalLink,
  buildReferenceMarkdown,
  buildStickerWikiLink,
  createSelectionRecomputeHandlers,
  createStickerCommands,
  findSharedSelectionToolbar,
  isEligibleMessageSelection,
  mountNativeSelectionAction,
  placeSelectionAction,
  resolveSelectionForStickerAction,
  resolveDurableAnchorId,
  resolveRenderedAnchorKey,
  spreadDotPoint,
} from "../src/client/overlay.tsx";
import type { MessageSelectionSnapshot } from "../src/client/overlay.tsx";
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

  it("maps rendered Conversation keys to durable node IDs and back", () => {
    const renderedKey = "13:input-message019d-user-message";
    const nodes = new Map([[renderedKey, { id: "019d-user-message" }]]);
    const snapshot = {
      chat: {
        order: [renderedKey],
        nodes: { get: (key: string) => nodes.get(key) },
      },
    };

    expect(resolveDurableAnchorId(snapshot, renderedKey)).toBe("019d-user-message");
    expect(resolveRenderedAnchorKey(snapshot, "019d-user-message")).toBe(renderedKey);
    expect(resolveDurableAnchorId(snapshot, "unknown-key")).toBe("unknown-key");
  });

  it("moves colliding red dots in stable 24 pixel steps", () => {
    expect(spreadDotPoint({ x: 100, y: 100 }, [])).toEqual({ x: 100, y: 100 });
    expect(spreadDotPoint({ x: 100, y: 100 }, [{ x: 100, y: 100 }])).toEqual({ x: 100, y: 124 });
    expect(spreadDotPoint(
      { x: 100, y: 100 },
      [{ x: 100, y: 100 }, { x: 100, y: 124 }],
    )).toEqual({ x: 100, y: 148 });
  });

  it("keeps the sticker action visible beside the sidechat selection toolbar", () => {
    const selection = { left: 300, top: 180, width: 120, height: 22 };

    expect(placeSelectionAction(selection, null, 720)).toEqual({
      x: 360,
      y: 170,
      below: false,
    });
    expect(placeSelectionAction(selection, {
      left: 250,
      top: 134,
      width: 220,
      height: 36,
    }, 720)).toEqual({
      x: 360,
      y: 128,
      below: false,
    });
    expect(placeSelectionAction({ ...selection, top: 38 }, {
      left: 250,
      top: 4,
      width: 220,
      height: 24,
    }, 720)).toEqual({
      x: 360,
      y: 66,
      below: true,
    });
  });

  it("uses the existing Sidechat selection toolbar as the sticker action host", () => {
    const toolbar = {} as HTMLElement;
    const querySelector = vi.fn(() => toolbar);

    expect(findSharedSelectionToolbar({ querySelector })).toBe(toolbar);
    expect(querySelector).toHaveBeenCalledWith(
      '[role="toolbar"][aria-label="划选注释"], [role="toolbar"][aria-label="Selection annotations"]',
    );
  });

  it("recaptures the live message selection before using the tracked fallback", () => {
    const tracked = { sessionId: "tracked" } as MessageSelectionSnapshot;
    const live = { sessionId: "live" } as MessageSelectionSnapshot;
    const capture = vi.fn(() => live);

    expect(resolveSelectionForStickerAction(tracked, "session-demo", capture)).toBe(live);
    expect(capture).toHaveBeenCalledWith("session-demo");
    expect(resolveSelectionForStickerAction(tracked, "session-demo", () => null)).toBe(tracked);
  });

  it("mounts a native sticker action into the shared toolbar and disposes it", () => {
    const listeners = new Map<string, (event: Event) => void>();
    const button = {
      type: "",
      className: "",
      textContent: "",
      addEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn((type: string) => {
        listeners.delete(type);
      }),
      remove: vi.fn(),
    };
    const host = { appendChild: vi.fn() };
    const documentLike = { createElement: vi.fn(() => button) };
    const activate = vi.fn();

    const dispose = mountNativeSelectionAction(
      host as unknown as HTMLElement,
      activate,
      documentLike as unknown as Pick<Document, "createElement">,
    );

    expect(host.appendChild).toHaveBeenCalledWith(button);
    expect(button.type).toBe("button");
    expect(button.className).toBe("dsh-sticker-board-selection-action-shared");
    expect(button.textContent).toBe("添加贴纸");

    const mouseDown = { preventDefault: vi.fn() } as unknown as Event;
    listeners.get("pointerdown")?.(mouseDown);
    listeners.get("mousedown")?.(mouseDown);
    expect(mouseDown.preventDefault).toHaveBeenCalledTimes(2);

    const click = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as Event;
    listeners.get("click")?.(click);
    expect(click.preventDefault).toHaveBeenCalledOnce();
    expect(click.stopPropagation).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledOnce();

    dispose();
    expect(button.remove).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it("keeps the delayed selection fallback after the synchronous mouse capture", () => {
    const callbacks = new Map<number, () => void>();
    let nextTimer = 0;
    const timerHost = {
      setTimeout: vi.fn((callback: () => void) => {
        nextTimer += 1;
        callbacks.set(nextTimer, callback);
        return nextTimer;
      }),
      clearTimeout: vi.fn((timer: number) => { callbacks.delete(timer); }),
    };
    const recompute = vi.fn();
    const handlers = createSelectionRecomputeHandlers(recompute, timerHost, 80);

    handlers.onSelectionChange();
    expect(recompute).not.toHaveBeenCalled();
    expect(callbacks.size).toBe(1);

    handlers.onMouseUp();
    expect(recompute).toHaveBeenCalledTimes(1);
    expect(callbacks.size).toBe(1);

    const delayed = callbacks.entries().next().value;
    expect(delayed).toBeDefined();
    callbacks.delete(delayed![0]);
    delayed![1]();
    expect(recompute).toHaveBeenCalledTimes(2);

    handlers.onKeyUp();
    expect(callbacks.size).toBe(1);
    handlers.dispose();
    expect(callbacks.size).toBe(0);
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
      "[[DeepHarness/Sessions/session-demo#^dsh-sticker-9bb3a80e|贴纸来源]]\n[回到 DSH：插件维护系统的用户提问](obsidian://deepharness?session=session-demo&anchor=user-node-42&quoteHash=sha256%3A30101ebf&sticker=9bb3a80e-230d-44d1-a37c-f7b79d2bf315)",
    );
    expect(writeText.mock.calls[1]?.[0]).toBe(buildReferenceMarkdown(sticker, "插件维护系统的用户提问"));
    expect(buildDshLogicalLink(sticker)).toBe(
      "obsidian://deepharness?session=session-demo&anchor=user-node-42&quoteHash=sha256%3A30101ebf&sticker=9bb3a80e-230d-44d1-a37c-f7b79d2bf315",
    );
    expect(buildStickerWikiLink(sticker)).toBe(
      "[[DeepHarness/Sessions/session-demo#^dsh-sticker-9bb3a80e|贴纸来源]]",
    );
    expect(writeText.mock.calls[1]?.[0]).toContain(
      "> 来源：[[DeepHarness/Sessions/session-demo#^dsh-sticker-9bb3a80e|贴纸来源]]",
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
