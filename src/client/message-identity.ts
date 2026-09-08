/** Stable message identity in native and external Chat nodes, with old Context ids retained by callers. */
export interface MessageIdentityNode {
  readonly kind?: string;
  readonly data?: unknown;
}

export function messageIdOfNode(node: MessageIdentityNode | undefined): string | undefined {
  if (!node || !node.data || typeof node.data !== "object") return undefined;
  const data = node.data as { messageId?: unknown; finalNode?: { messageId?: unknown }; item?: { messageId?: unknown } };
  const id = node.kind === "executor-assistant" ? data.item?.messageId
    : node.kind === "assistant-step" ? data.finalNode?.messageId
      : node.kind === "user" || node.kind === "steering" ? data.messageId : undefined;
  return typeof id === "string" && id !== "" ? id : undefined;
}

/** Prefer public Session scope, retaining unscoped legacy DOM only as a fallback. */
export function findMessageAnchorRoot(documentLike: Document, renderedKey: string, sessionId: string): HTMLElement | null {
  const anchor = `[data-chat-anchor-key="${CSS.escape(renderedKey)}"]`;
  return documentLike.querySelector<HTMLElement>(`${anchor}[data-message-session-id="${CSS.escape(sessionId)}"]`)
    ?? documentLike.querySelector<HTMLElement>(`${anchor}:not([data-message-session-id])`);
}
