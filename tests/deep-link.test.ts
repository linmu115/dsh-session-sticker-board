import { describe, expect, it, vi } from "vitest";

import { hashQuote } from "../src/client/anchor.ts";
import { applyDeepLink, renderedAnchorMatches } from "../src/client/deep-link.ts";
import type { DeepLinkAction } from "../src/protocol.ts";

const action: DeepLinkAction = {
  protocolVersion: 1,
  type: "deep-link",
  actionId: "66192273-27df-4ed4-b44a-360456cfc6da",
  sessionId: "session-demo",
  anchorId: "message:user-42",
};

function snapshot(entries: Array<{ key: string; id?: string; kind?: string; seq: number; text: string }>, hasMore: boolean) {
  const nodes = new Map(entries.map((entry) => [entry.key, {
    key: entry.key,
    id: entry.id ?? entry.key,
    kind: entry.kind ?? "user",
    data: { seq: entry.seq, content: [{ type: "text", text: entry.text }] },
  }]));
  return {
    session: {
      sessionId: "session-demo",
      running: false,
      hasMore,
      loadingOlder: false,
    },
    chat: { order: entries.map((entry) => entry.key), nodes: { get: (key: string) => nodes.get(key) } },
  };
}

function context(snapshots: ReturnType<typeof snapshot>[]) {
  let index = 0;
  const listeners = new Set<() => void>();
  let listSnapshot: {
    current: string | undefined;
    byId: Record<string, { title: string }>;
    phase: "pending" | "ready";
  } = {
    current: "other",
    byId: { "session-demo": { title: "演示" } },
    phase: "ready",
  };
  const session = {
    getSnapshot: () => snapshots[index]!.session,
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
      open: vi.fn((sessionId: string) => {
        listSnapshot = { ...listSnapshot, current: sessionId };
      }),
      binding: () => ({ session }),
    },
    uiConversation: {
      binding: () => ({
        target: () => ({
          getSnapshot: () => snapshots[index]!.chat,
          subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        }),
      }),
    },
  };
  return { ctx, session, setListSnapshot: (value: typeof listSnapshot) => { listSnapshot = value; } };
}

describe("DSH deep links", () => {
  it("resolves a logical sticker link to the active projection before opening", async () => {
    const fixture = context([snapshot([
      { key: "message:user-42", seq: 42, text: "目标问题" },
    ], false)]);
    fixture.setListSnapshot({ current: "other", byId: { "session-alpha2": { title: "当前投影" } }, phase: "ready" });
    const resolver = vi.fn(async () => ({ sessionId: "session-alpha2", anchorId: "message:user-42" }));
    const result = await applyDeepLink(fixture.ctx as never, {
      ...action,
      stickerId: "f6142265-c555-4547-9ed8-d9f178083841",
      logicalSessionId: "logical-session-1",
      logicalAnchorId: "logical-anchor-1",
      legacySessionId: "session-alpha1",
      legacyAnchorId: "message:user-41",
    }, { locate: () => true, resolveLogicalTarget: resolver });
    expect(resolver).toHaveBeenCalledWith({
      referenceType: "sticker",
      logicalSessionId: "logical-session-1",
      logicalAnchorId: "logical-anchor-1",
      legacySessionId: "session-alpha1",
      legacyAnchorId: "message:user-41",
    });
    expect(fixture.ctx.sessions.open).toHaveBeenCalledWith("session-alpha2");
    expect(result).toEqual({ status: "located", sessionId: "session-alpha2", anchorId: "message:user-42" });
  });

  it("matches alpha.1 composite DOM anchor keys by their durable message ID", () => {
    const durableId = "c11b0e9b-b9d1-4c07-8312-d2806e3f6e10";
    expect(renderedAnchorMatches(`13:input-message${durableId}`, durableId)).toBe(true);
    expect(renderedAnchorMatches(durableId, durableId)).toBe(true);
    expect(renderedAnchorMatches("13:input-messageanother-id", durableId)).toBe(false);
    expect(renderedAnchorMatches(null, durableId)).toBe(false);
  });

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
    fixture.setListSnapshot({ current: "other", byId: {}, phase: "ready" });
    expect(await applyDeepLink(fixture.ctx as never, action)).toEqual({
      status: "missing-session",
      sessionId: "session-demo",
    });
    expect(fixture.ctx.sessions.open).not.toHaveBeenCalled();
  });

  it("waits for the alpha.1 session catalog before deciding that a deep-link session is missing", async () => {
    const fixture = context([snapshot([
      { key: "message:user-42", seq: 42, text: "目标问题" },
    ], false)]);
    fixture.setListSnapshot({ current: undefined, byId: {}, phase: "pending" });
    setTimeout(() => fixture.setListSnapshot({
      current: "other",
      byId: { "session-demo": { title: "演示" } },
      phase: "ready",
    }), 5);

    const result = await applyDeepLink(fixture.ctx as never, action, { locate: () => true });

    expect(result.status).toBe("located");
    expect(fixture.ctx.sessions.open).toHaveBeenCalledWith("session-demo");
  });

  it("maps a durable message ID through the native Conversation node identity and opens its annotation", async () => {
    const userMessageId = "019d-user-message";
    const contextKey = `13:input-message${userMessageId}`;
    const fixture = context([snapshot([{ key: contextKey, id: userMessageId, seq: 42, text: "带引用的提问" }], false)]);
    const order: string[] = [];
    const revealConversation = vi.fn(async () => { order.push("reveal"); });
    const locate = vi.fn(() => { order.push("locate"); return true; });
    const openAnnotation = vi.fn(async () => { order.push("annotation"); });
    const result = await applyDeepLink(fixture.ctx as never, {
      ...action,
      anchorId: userMessageId,
      setId: "set-1",
      referenceId: "reference-1",
    }, { locate, openAnnotation, revealConversation });
    expect(result.status).toBe("located");
    expect(revealConversation).toHaveBeenCalledWith("session-demo");
    expect(locate).toHaveBeenCalledWith(contextKey);
    expect(openAnnotation).toHaveBeenCalledWith("set-1", "reference-1");
    expect(order).toEqual(["reveal", "locate", "annotation"]);
  });

  it("reports a deleted annotation target as terminal after locating its message", async () => {
    const userMessageId = "019d-deleted-reference";
    const contextKey = `13:input-message${userMessageId}`;
    const fixture = context([snapshot([{ key: contextKey, id: userMessageId, seq: 42, text: "已删除引用" }], false)]);

    const result = await applyDeepLink(fixture.ctx as never, {
      ...action,
      anchorId: userMessageId,
      setId: "set-deleted",
      referenceId: "reference-deleted",
    }, {
      locate: () => true,
      openAnnotation: async () => false,
    });

    expect(result).toEqual({
      status: "annotation-missing",
      sessionId: "session-demo",
      anchorId: userMessageId,
      setId: "set-deleted",
    });
  });

  it("waits for the switched session DOM to render before locating the anchor", async () => {
    const fixture = context([snapshot([{ key: "message:user-42", seq: 42, text: "目标问题" }], false)]);
    let attempts = 0;
    const result = await applyDeepLink(fixture.ctx as never, action, {
      locate: () => ++attempts >= 3,
    });
    expect(result.status).toBe("located");
    expect(attempts).toBe(3);
  });
});
