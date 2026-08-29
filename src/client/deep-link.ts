import { hashQuote } from "./anchor.ts";
import type { Context, ConversationSnapshotLike, SessionFace } from "../context-types.ts";
import type { DeepLinkAction } from "../protocol.ts";

export type DeepLinkResult =
  | { status: "located"; sessionId: string; anchorId: string }
  | { status: "missing-session"; sessionId: string }
  | { status: "missing-anchor"; sessionId: string; anchorId: string }
  | { status: "content-changed"; sessionId: string; anchorId: string }
  | { status: "dom-unavailable"; sessionId: string; anchorId: string };

export interface ApplyDeepLinkOptions {
  readonly quote?: string;
  readonly locate?: (anchorId: string) => boolean | Promise<boolean>;
  readonly openAnnotation?: (setId: string, referenceId?: string) => void | boolean | Promise<void | boolean>;
  readonly revealConversation?: (sessionId: string) => void | Promise<void>;
  readonly waitForBinding?: (ctx: Context, sessionId: string) => Promise<SessionFace | undefined>;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function textOfNode(snapshot: ConversationSnapshotLike, key: string): string | null {
  const node = snapshot.chat.nodes.get(key);
  if (!node || !node.data || typeof node.data !== "object") return null;
  const data = node.data as { content?: unknown; blocks?: unknown };
  const content = Array.isArray(data.content) ? data.content : Array.isArray(data.blocks) ? data.blocks : [];
  const text = content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as { type?: unknown; kind?: unknown; text?: unknown };
      return record.type === "text" || record.kind === "text" ? String(record.text ?? "") : "";
    })
    .join("\n");
  return text;
}

function locatedNode(snapshot: ConversationSnapshotLike, anchorId: string): { key: string; text: string } | null {
  const direct = textOfNode(snapshot, anchorId);
  if (direct !== null) return { key: anchorId, text: direct };
  for (const key of snapshot.chat.order) {
    const node = snapshot.chat.nodes.get(key);
    if (node?.id !== anchorId) continue;
    const text = textOfNode(snapshot, key);
    if (text !== null) return { key, text };
  }
  return null;
}

async function defaultWaitForBinding(ctx: Context, sessionId: string): Promise<SessionFace | undefined> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const binding = ctx.sessions.binding(sessionId);
    const current = ctx.sessions.list.getSnapshot().current;
    if (binding && (current === undefined || current === sessionId)) return binding.session;
    await pause(25);
  }
  return undefined;
}

function defaultLocate(anchorId: string): boolean {
  try {
    const root = document.querySelector<HTMLElement>(
      `[data-chat-anchor-key="${CSS.escape(anchorId)}"]`,
    );
    if (!root) return false;
    root.scrollIntoView({ block: "center", behavior: "smooth" });
    root.classList.remove("dsh-sticker-board-deep-link-flash");
    // Force a style flush so repeated jumps restart the animation.
    void root.offsetWidth;
    root.classList.add("dsh-sticker-board-deep-link-flash");
    window.setTimeout(() => root.classList.remove("dsh-sticker-board-deep-link-flash"), 2_000);
    const dot = document.querySelector<HTMLButtonElement>(
      `.dsh-sticker-board-dot[data-dsh-sticker-anchor-id="${CSS.escape(anchorId)}"]`,
    );
    dot?.click();
    return true;
  } catch {
    return false;
  }
}

async function contentMatches(text: string, hash: string, quote?: string): Promise<boolean> {
  if (quote !== undefined) {
    if (!text.includes(quote)) return false;
    return await hashQuote(quote) === hash;
  }
  return await hashQuote(text) === hash;
}

async function locateWhenRendered(
  locate: (anchorId: string) => boolean | Promise<boolean>,
  anchorId: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await locate(anchorId)) return true;
    await pause(25);
  }
  return false;
}

export async function applyDeepLink(
  ctx: Context,
  action: DeepLinkAction,
  options: ApplyDeepLinkOptions = {},
): Promise<DeepLinkResult> {
  const list = ctx.sessions.list.getSnapshot();
  if (list.byId && !list.byId[action.sessionId]) {
    return { status: "missing-session", sessionId: action.sessionId };
  }

  ctx.sessions.open(action.sessionId);
  const session = await (options.waitForBinding ?? defaultWaitForBinding)(ctx, action.sessionId);
  if (!session) return { status: "missing-session", sessionId: action.sessionId };

  await options.revealConversation?.(action.sessionId);

  let snapshot = session.getSnapshot();
  let located = locatedNode(snapshot, action.anchorId);
  let pages = 0;
  while (located === null && snapshot.hasMore === true && pages < 50) {
    await session.loadOlder();
    pages += 1;
    snapshot = session.getSnapshot();
    located = locatedNode(snapshot, action.anchorId);
  }
  if (located === null) {
    return { status: "missing-anchor", sessionId: action.sessionId, anchorId: action.anchorId };
  }
  if (action.quoteHash && !await contentMatches(located.text, action.quoteHash, options.quote)) {
    return { status: "content-changed", sessionId: action.sessionId, anchorId: action.anchorId };
  }
  if (!await locateWhenRendered(options.locate ?? defaultLocate, located.key)) {
    return { status: "dom-unavailable", sessionId: action.sessionId, anchorId: action.anchorId };
  }
  if (action.setId !== undefined) await options.openAnnotation?.(action.setId, action.referenceId);
  return { status: "located", sessionId: action.sessionId, anchorId: action.anchorId };
}
