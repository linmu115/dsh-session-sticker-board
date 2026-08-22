export interface MessageAnchor {
  sessionId: string;
  anchorId: string;
  nodeId?: string;
  seq?: number;
  role: "user" | "assistant";
  quote: string;
  occurrence: number;
  quoteHash: string;
}

export interface MessageAnchorInput {
  sessionId: string;
  nodeId?: string;
  seq?: number;
  role: "user" | "assistant";
  quote: string;
  occurrence: number;
}

export interface MessageCandidate {
  nodeId?: string;
  seq?: number;
  role: "user" | "assistant";
  text: string;
}

export type AnchorResolution<T extends MessageCandidate = MessageCandidate> =
  | { status: "resolved"; candidate: T; range: { start: number; end: number } }
  | { status: "content-changed" }
  | { status: "orphaned" };

export async function hashQuote(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function createMessageAnchor(input: MessageAnchorInput): Promise<MessageAnchor> {
  if (!input.nodeId && input.seq === undefined) throw new Error("A message anchor needs nodeId or seq");
  if (!input.quote) throw new Error("A message anchor quote cannot be empty");
  if (!Number.isInteger(input.occurrence) || input.occurrence < 0) throw new Error("Quote occurrence must be non-negative");
  return {
    ...input,
    anchorId: input.nodeId ?? `seq-${input.seq}`,
    quoteHash: await hashQuote(input.quote),
  };
}

function quoteRange(text: string, quote: string, occurrence: number): { start: number; end: number } | null {
  let cursor = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    const start = text.indexOf(quote, cursor);
    if (start < 0) return null;
    if (index === occurrence) return { start, end: start + quote.length };
    cursor = start + Math.max(1, quote.length);
  }
  return null;
}

export async function resolveMessageAnchor<T extends MessageCandidate>(
  anchor: MessageAnchor,
  candidates: readonly T[],
): Promise<AnchorResolution<T>> {
  const roleMatches = candidates.filter((candidate) => candidate.role === anchor.role);
  const nodeMatch = anchor.nodeId ? roleMatches.find((candidate) => candidate.nodeId === anchor.nodeId) : undefined;
  const candidate = nodeMatch ?? (anchor.seq === undefined ? undefined : roleMatches.find((value) => value.seq === anchor.seq));
  if (!candidate) return { status: "orphaned" };
  const range = quoteRange(candidate.text, anchor.quote, anchor.occurrence);
  if (!range || await hashQuote(candidate.text.slice(range.start, range.end)) !== anchor.quoteHash) {
    return { status: "content-changed" };
  }
  return { status: "resolved", candidate, range };
}

export function dataChatAnchorKey(anchor: MessageAnchor): string {
  return `${anchor.sessionId}:${anchor.anchorId}:${anchor.role}`;
}
