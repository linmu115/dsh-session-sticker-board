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
  readonly locate?: (anchorId: string) => boolean;
  readonly waitForBinding?: (ctx: Context, sessionId: string) => Promise<SessionFace | undefined>;
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

async function defaultWaitForBinding(ctx: Context, sessionId: string): Promise<SessionFace | undefined> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const binding = ctx.sessions.binding(sessionId);
    if (binding) return binding.session;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
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

  let snapshot = session.getSnapshot();
  let text = textOfNode(snapshot, action.anchorId);
  let pages = 0;
  while (text === null && snapshot.hasMore === true && pages < 50) {
    await session.loadOlder();
    pages += 1;
    snapshot = session.getSnapshot();
    text = textOfNode(snapshot, action.anchorId);
  }
  if (text === null) {
    return { status: "missing-anchor", sessionId: action.sessionId, anchorId: action.anchorId };
  }
  if (action.quoteHash && !await contentMatches(text, action.quoteHash, options.quote)) {
    return { status: "content-changed", sessionId: action.sessionId, anchorId: action.anchorId };
  }
  if (!(options.locate ?? defaultLocate)(action.anchorId)) {
    return { status: "dom-unavailable", sessionId: action.sessionId, anchorId: action.anchorId };
  }
  return { status: "located", sessionId: action.sessionId, anchorId: action.anchorId };
}
