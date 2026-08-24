import { describe, expect, it, vi } from "vitest";
import { conversationContextKey } from "@deepseek-ai/dsh-client-runtime/client";

vi.mock("@deepseek-ai/dsh-client-runtime/client", () => ({
  conversationContextKey: (kind: string, id: string) => `${kind}:${id}`,
}));

import { hashQuote } from "../src/client/anchor.ts";
import { applyDeepLink } from "../src/client/deep-link.ts";
import type { DeepLinkAction } from "../src/protocol.ts";

const action: DeepLinkAction = {
  protocolVersion: 1,
  type: "deep-link",
  actionId: "66192273-27df-4ed4-b44a-360456cfc6da",
  sessionId: "session-demo",
  anchorId: "message:user-42",
};

function snapshot(entries: Array<{ key: string; kind?: string; seq: number; text: string }>, hasMore: boolean) {
  const nodes = new Map(entries.map((entry) => [entry.key, {
    key: entry.key,
    kind: entry.kind ?? "user",
    data: { seq: entry.seq, content: [{ type: "text", text: entry.text }] },
  }]));
  return {
    sessionId: "session-demo",
    running: false,
    hasMore,
    loadingOlder: false,
    chat: { order: entries.map((entry) => entry.key), nodes: { get: (key: string) => nodes.get(key) } },
  };
}

function context(snapshots: ReturnType<typeof snapshot>[]) {
  let index = 0;
  const listeners = new Set<() => void>();
  let listSnapshot: { current: string; byId: Record<string, { title: string }> } = {
    current: "other",
    byId: { "session-demo": { title: "演示" } },
  };
  const session = {
    getSnapshot: () => snapshots[index]!,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    loadOlder: vi.fn(async () => {
      index = Math.min(index + 1, snapshots.length - 1);
      for (const listener of listeners) listener();
    }),
  };
  const ctx = {
    sessions: {
      list: {
        getSnapshot: () => listSnapshot,
        subscribe: () => () => undefined,
      },
      open: vi.fn(),
      binding: () => ({ session }),
    },
  };
  return { ctx, session, setListSnapshot: (value: typeof listSnapshot) => { listSnapshot = value; } };
}

describe("DSH deep links", () => {
  it("opens the session, loads older history and locates the target anchor", async () => {
    const fixture = context([
      snapshot([{ key: "message:user-99", seq: 99, text: "较新的消息" }], true),
      snapshot([{ key: "message:user-42", seq: 42, text: "目标问题" }], false),
    ]);
    const locate = vi.fn(() => true);

    const result = await applyDeepLink(fixture.ctx as never, action, { locate });

    expect(fixture.ctx.sessions.open).toHaveBeenCalledWith("session-demo");
    expect(fixture.session.loadOlder).toHaveBeenCalledTimes(1);
    expect(locate).toHaveBeenCalledWith("message:user-42");
    expect(result).toEqual({ status: "located", sessionId: "session-demo", anchorId: "message:user-42" });
  });

  it("validates a sticker quote without requiring the whole message to match", async () => {
    const fixture = context([snapshot([
      { key: "message:user-42", seq: 42, text: "Generation 保存完整组合并支持回退。" },
    ], false)]);
    const quote = "完整组合";
    const result = await applyDeepLink(fixture.ctx as never, {
      ...action,
      quoteHash: await hashQuote(quote),
    }, { quote, locate: () => true });
    expect(result.status).toBe("located");
  });

  it("reports changed content and never loads more than fifty pages", async () => {
    const changed = context([snapshot([
      { key: "message:user-42", seq: 42, text: "已经改变" },
    ], false)]);
    expect(await applyDeepLink(changed.ctx as never, {
      ...action,
      quoteHash: await hashQuote("原始内容"),
    }, { locate: () => true })).toMatchObject({ status: "content-changed" });

    const missing = context([snapshot([], true)]);
    expect(await applyDeepLink(missing.ctx as never, action, { locate: () => true })).toMatchObject({ status: "missing-anchor" });
    expect(missing.session.loadOlder).toHaveBeenCalledTimes(50);
  });

  it("rejects a deleted session without changing the current session", async () => {
    const fixture = context([snapshot([], false)]);
    fixture.setListSnapshot({ current: "other", byId: {} });
    expect(await applyDeepLink(fixture.ctx as never, action)).toEqual({
      status: "missing-session",
      sessionId: "session-demo",
    });
    expect(fixture.ctx.sessions.open).not.toHaveBeenCalled();
  });

  it("maps a Core user-message ID through conversationContextKey and opens its annotation", async () => {
    const userMessageId = "019d-user-message";
    const contextKey = conversationContextKey("input-message", userMessageId);
    const fixture = context([snapshot([{ key: contextKey, seq: 42, text: "带引用的提问" }], false)]);
    const locate = vi.fn(() => true);
    const openAnnotation = vi.fn();
    const result = await applyDeepLink(fixture.ctx as never, {
      ...action,
      anchorId: userMessageId,
      setId: "set-1",
      referenceId: "reference-1",
    }, { locate, openAnnotation });
    expect(result.status).toBe("located");
    expect(locate).toHaveBeenCalledWith(contextKey);
    expect(openAnnotation).toHaveBeenCalledWith("set-1", "reference-1");
  });
});
