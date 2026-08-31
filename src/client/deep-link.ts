import { hashQuote } from "./anchor.ts";
import type { ChatSnapshotLike, Context, ObservableSnapshot, SessionFace } from "../context-types.ts";
import type { DeepLinkAction } from "../protocol.ts";

export type DeepLinkResult =
  | { status: "located"; sessionId: string; anchorId: string }
  | { status: "missing-session"; sessionId: string }
  | { status: "missing-anchor"; sessionId: string; anchorId: string }
  | { status: "content-changed"; sessionId: string; anchorId: string }
  | { status: "dom-unavailable"; sessionId: string; anchorId: string }
  | { status: "annotation-missing"; sessionId: string; anchorId: string; setId: string };

export interface ApplyDeepLinkOptions {
  readonly quote?: string;
  readonly locate?: (anchorId: string) => boolean | Promise<boolean>;
  readonly openAnnotation?: (setId: string, referenceId?: string) => void | boolean | Promise<void | boolean>;
  readonly openAnnotationInSession?: (sessionId: string, setId: string, referenceId?: string) => void | boolean | Promise<void | boolean>;
  readonly revealConversation?: (sessionId: string) => void | Promise<void>;
  readonly waitForBinding?: (ctx: Context, sessionId: string) => Promise<SessionFace | undefined>;
  readonly resolveLogicalTarget?: (target: {
    readonly referenceType: "annotation" | "sticker" | "obsidian-reference";
    readonly logicalSessionId: string;
    readonly logicalAnchorId?: string;
    readonly legacySessionId: string;
    readonly legacyAnchorId?: string;
  }) => Promise<{ readonly sessionId: string; readonly anchorId?: string } | undefined>;
}

export async function resolveMaintenanceProjection(input: {
  readonly referenceType: "annotation" | "sticker" | "obsidian-reference";
  readonly logicalSessionId?: string;
  readonly logicalAnchorId?: string;
  readonly legacySessionId: string;
  readonly legacyAnchorId?: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<{
  readonly logicalSessionId?: string;
  readonly logicalAnchorId?: string;
  readonly sessionId: string;
  readonly anchorId?: string;
} | undefined> {
  const response = await (input.fetchImpl ?? fetch)("/dsh-session-maintenance/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "reference:resolve",
      referenceType: input.referenceType,
      logicalSessionId: input.logicalSessionId ?? null,
      logicalAnchorId: input.logicalAnchorId ?? null,
      legacyNativeSessionId: input.legacySessionId,
      legacyNativeAnchorId: input.legacyAnchorId ?? null,
    }),
  });
  if (!response.ok) return undefined;
  const body = await response.json() as {
    readonly referenceResolution?: {
      readonly status?: string;
      readonly logicalSessionId?: string | null;
      readonly logicalAnchorId?: string | null;
      readonly nativeSessionId?: string | null;
      readonly nativeAnchorId?: string | null;
    };
  };
  const resolved = body.referenceResolution;
  if (resolved?.status !== "resolved" || typeof resolved.nativeSessionId !== "string") return undefined;
  return {
    ...(resolved.logicalSessionId ? { logicalSessionId: resolved.logicalSessionId } : {}),
    ...(resolved.logicalAnchorId ? { logicalAnchorId: resolved.logicalAnchorId } : {}),
    sessionId: resolved.nativeSessionId,
    ...(resolved.nativeAnchorId !== null && resolved.nativeAnchorId !== undefined
      ? { anchorId: resolved.nativeAnchorId }
      : input.legacyAnchorId === undefined ? {} : { anchorId: input.legacyAnchorId }),
  };
}

function pause(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function textOfNode(snapshot: ChatSnapshotLike, key: string): string | null {
  const node = snapshot.nodes.get(key);
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

function locatedNode(snapshot: ChatSnapshotLike, anchorId: string): { key: string; text: string } | null {
  const direct = textOfNode(snapshot, anchorId);
  if (direct !== null) return { key: anchorId, text: direct };
  for (const key of snapshot.order) {
    const node = snapshot.nodes.get(key);
    if (node?.id !== anchorId) continue;
    const text = textOfNode(snapshot, key);
    if (text !== null) return { key, text };
  }
  return null;
}

async function waitForChatSnapshot(
  source: ObservableSnapshot<ChatSnapshotLike | undefined>,
): Promise<ChatSnapshotLike | undefined> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const snapshot = source.getSnapshot();
    if (snapshot !== undefined) return snapshot;
    await pause(25);
  }
  return source.getSnapshot();
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

export function renderedAnchorMatches(renderedKey: string | null, anchorId: string): boolean {
  return renderedKey === anchorId || renderedKey?.endsWith(anchorId) === true;
}

async function waitForSessionCatalog(ctx: Context): Promise<boolean> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (ctx.sessions.list.getSnapshot().phase !== "pending") return true;
    await pause(25);
  }
  return ctx.sessions.list.getSnapshot().phase !== "pending";
}

function defaultLocate(anchorId: string): boolean {
  try {
    const exact = document.querySelector<HTMLElement>(
      `[data-chat-anchor-key="${CSS.escape(anchorId)}"]`,
    );
    const root = exact ?? [...document.querySelectorAll<HTMLElement>("[data-chat-anchor-key]")]
      .find((candidate) => renderedAnchorMatches(candidate.dataset.chatAnchorKey ?? null, anchorId));
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
  const stableTarget = action.logicalSessionId === undefined || options.resolveLogicalTarget === undefined
    ? undefined
    : await options.resolveLogicalTarget({
        referenceType: action.stickerId !== undefined
          ? "sticker"
          : action.referenceId !== undefined ? "obsidian-reference" : "annotation",
        logicalSessionId: action.logicalSessionId,
        ...(action.logicalAnchorId === undefined ? {} : { logicalAnchorId: action.logicalAnchorId }),
        legacySessionId: action.legacySessionId ?? action.sessionId,
        legacyAnchorId: action.legacyAnchorId ?? action.anchorId,
      });
  const sessionId = stableTarget?.sessionId ?? action.sessionId;
  const anchorId = stableTarget?.anchorId ?? action.anchorId;
  if (!await waitForSessionCatalog(ctx)) {
    return { status: "dom-unavailable", sessionId, anchorId };
  }
  const list = ctx.sessions.list.getSnapshot();
  if (list.byId && !list.byId[sessionId]) {
    return { status: "missing-session", sessionId };
  }

  ctx.sessions.open(sessionId);
  const session = await (options.waitForBinding ?? defaultWaitForBinding)(ctx, sessionId);
  if (!session) return { status: "missing-session", sessionId };

  await options.revealConversation?.(sessionId);

  const chatSource = ctx.uiConversation.binding(sessionId).target("chat");
  let chatSnapshot = await waitForChatSnapshot(chatSource);
  let located = chatSnapshot ? locatedNode(chatSnapshot, anchorId) : null;
  let pages = 0;
  while (located === null && session.getSnapshot().hasMore === true && pages < 50) {
    await session.loadOlder();
    pages += 1;
    chatSnapshot = await waitForChatSnapshot(chatSource);
    located = chatSnapshot ? locatedNode(chatSnapshot, anchorId) : null;
  }
  if (located === null) {
    return { status: "missing-anchor", sessionId, anchorId };
  }
  if (action.quoteHash && !await contentMatches(located.text, action.quoteHash, options.quote)) {
    return { status: "content-changed", sessionId, anchorId };
  }
  if (!await locateWhenRendered(options.locate ?? defaultLocate, located.key)) {
    return { status: "dom-unavailable", sessionId, anchorId };
  }
  if (action.setId !== undefined) {
    const opened = options.openAnnotationInSession !== undefined
      ? await options.openAnnotationInSession(sessionId, action.setId, action.referenceId)
      : await options.openAnnotation?.(action.setId, action.referenceId);
    if (opened === false) {
      return {
        status: "annotation-missing",
        sessionId,
        anchorId,
        setId: action.setId,
      };
    }
  }
  return { status: "located", sessionId, anchorId };
}
