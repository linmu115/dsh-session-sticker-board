import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

import { hashQuote } from "./anchor.ts";
import { PROTOCOL_VERSION, type PendingCitation, type ResolvedCitation } from "../protocol.ts";
import type {
  Context,
  ConversationService,
  InputStateSnapshot,
  InputTriggerService,
  InputZone,
  SessionInput,
} from "../context-types.ts";

export interface PendingCitationView {
  readonly citation: PendingCitation;
  readonly displayNumber: number;
}

export interface PendingCitationStore {
  getSnapshot(): number;
  subscribe(listener: () => void): () => void;
  add(sessionId: string, citation: PendingCitation): void;
  remove(sessionId: string, citationId: string): void;
  list(sessionId: string): readonly PendingCitationView[];
  sessions(): readonly string[];
}

export function createPendingCitationStore(): PendingCitationStore {
  const bySession = new Map<string, PendingCitation[]>();
  const listeners = new Set<() => void>();
  let version = 0;
  const emit = () => {
    version += 1;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add(sessionId, citation) {
      const current = bySession.get(sessionId) ?? [];
      if (current.some((item) => item.citationId === citation.citationId)) return;
      bySession.set(sessionId, [...current, citation]);
      emit();
    },
    remove(sessionId, citationId) {
      const current = bySession.get(sessionId) ?? [];
      const next = current.filter((item) => item.citationId !== citationId);
      if (next.length === current.length) return;
      // Keep an empty tombstone for the activation lifetime. The native
      // composer reference synchronizer must still visit this session once to
      // remove the model-context occurrence after its last card disappears.
      bySession.set(sessionId, next);
      emit();
    },
    list(sessionId) {
      return Object.freeze((bySession.get(sessionId) ?? []).map((citation, index) => Object.freeze({
        citation,
        displayNumber: index + 1,
      })));
    },
    sessions: () => [...bySession.keys()],
  };
}

const REFERENCE_SOURCE = "dsh-session-sticker-board-citations";
export const CITATION_REFERENCE_APPEARANCE = "dsh-sticker-board-hidden" as const;
const REFERENCE_SEPARATOR = "|";

export function referenceForSession(sessionId: string): string {
  return encodeURIComponent(sessionId);
}

function sessionFromReference(reference: string): string | null {
  try {
    const separator = reference.lastIndexOf(REFERENCE_SEPARATOR);
    const encoded = separator < 0 ? reference : reference.slice(0, separator);
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

function encodeOwnedReference(sessionId: string, ownsGap: boolean): string {
  return `${referenceForSession(sessionId)}${REFERENCE_SEPARATOR}${ownsGap ? "1" : "0"}`;
}

function ownsSession(reference: { source: string; ref: string }, sessionId: string): boolean {
  return reference.source === REFERENCE_SOURCE && sessionFromReference(reference.ref) === sessionId;
}

function modelContext(store: PendingCitationStore, reference: string): string {
  const sessionId = sessionFromReference(reference);
  if (!sessionId) return "";
  const items = store.list(sessionId);
  if (!items.length) return "";
  return [
    "<obsidian-citations>",
    ...items.flatMap(({ citation, displayNumber }) => [
      `[${displayNumber}]`,
      `来源：${citation.notePath}#^${citation.blockId}`,
      ...(citation.heading ? [`标题：${citation.heading}`] : []),
      "内容：",
      citation.text.trim(),
      "",
    ]),
    "</obsidian-citations>",
  ].join("\n");
}

export function createCitationReferenceSource(store: PendingCitationStore) {
  return {
    trigger: "\u0000",
    name: REFERENCE_SOURCE,
    candidates: async (): Promise<readonly never[]> => [],
    onPick: (): { text: string } => ({ text: "" }),
    codec: {
      clipboardText(reference: string): string {
        return modelContext(store, reference);
      },
      async serialize(reference: string): Promise<string> {
        const context = modelContext(store, reference);
        if (!context) throw new Error("Pending Obsidian citation context is empty");
        return context;
      },
    },
  };
}

export function registerCitationReferenceSource(ctx: Context, store: PendingCitationStore): () => void {
  const service = ctx.get("inputTriggers") as InputTriggerService | undefined;
  if (!service) {
    console.warn("[dsh-session-sticker-board] inputTriggers unavailable; citation serialization is disabled");
    return () => undefined;
  }
  return service.registerSource(createCitationReferenceSource(store));
}

function resolveInput(ctx: Context, sessionId: string): SessionInput | undefined {
  try {
    const scope = ctx.sessions.scope(sessionId);
    if (!scope) return undefined;
    const conversation = ctx.get("conversation") as ConversationService | undefined;
    return conversation?.input.for(scope);
  } catch {
    return undefined;
  }
}

export function withoutCitationReferences(snapshot: InputStateSnapshot, sessionId: string): string {
  const owned = snapshot.occurrences
    .filter((occurrence) => ownsSession(occurrence, sessionId))
    .sort((left, right) => right.offset - left.offset);
  let draft = snapshot.draft;
  for (const occurrence of owned) {
    const ownsGap = occurrence.ref.endsWith(`${REFERENCE_SEPARATOR}1`);
    let end = occurrence.offset + (occurrence.length ?? 1);
    if (ownsGap && draft[end] === " ") end += 1;
    draft = draft.slice(0, occurrence.offset) + draft.slice(end);
  }
  return draft;
}

export function syncSessionReference(
  ctx: Context,
  store: PendingCitationStore,
  sessionId: string,
): "inserted" | "removed" | "unchanged" | "unavailable" | "failed" {
  try {
    const input = resolveInput(ctx, sessionId);
    if (!input) return "unavailable";
    const snapshot = input.state.getSnapshot();
    const owned = snapshot.occurrences.filter((occurrence) => ownsSession(occurrence, sessionId));
    const hasCitations = store.list(sessionId).length > 0;
    if (hasCitations && owned.length === 0) {
      const ownsGap = snapshot.draft === "" || snapshot.draft[0] !== " ";
      const inserted = input.insertReference({
        source: REFERENCE_SOURCE,
        ref: encodeOwnedReference(sessionId, ownsGap),
        label: "",
        appearance: CITATION_REFERENCE_APPEARANCE,
        clipboardText: modelContext(store, referenceForSession(sessionId)),
      }, { start: 0, end: 0, draftRev: snapshot.draftRev });
      return inserted ? "inserted" : "failed";
    }
    if (!hasCitations && owned.length > 0) {
      const next = withoutCitationReferences(snapshot, sessionId);
      if (next !== snapshot.draft) input.setDraft(next);
      return "removed";
    }
    return "unchanged";
  } catch (error) {
    console.warn("[dsh-session-sticker-board] citation reference sync failed", error);
    return "failed";
  }
}

export function syncAllSessionReferences(ctx: Context, store: PendingCitationStore): void {
  for (const sessionId of store.sessions()) syncSessionReference(ctx, store, sessionId);
}

export function clearAllSessionReferences(ctx: Context, store: PendingCitationStore): void {
  for (const sessionId of store.sessions()) {
    const input = resolveInput(ctx, sessionId);
    if (!input) continue;
    const snapshot = input.state.getSnapshot();
    const next = withoutCitationReferences(snapshot, sessionId);
    if (next !== snapshot.draft) input.setDraft(next);
  }
}

interface ChatNode {
  key: string;
  kind: string;
  data: unknown;
}

export interface ConversationSnapshotLike {
  chat: {
    order: readonly string[];
    nodes: { get(key: string): ChatNode | undefined };
  };
}

interface SubmissionTransaction {
  baselineSeq: number;
  citationIds: readonly string[];
}

function userNodes(snapshot: ConversationSnapshotLike): Array<{ key: string; seq: number; text: string }> {
  const output: Array<{ key: string; seq: number; text: string }> = [];
  for (const key of snapshot.chat.order) {
    const node = snapshot.chat.nodes.get(key);
    if (!node || node.kind !== "user" || !node.data || typeof node.data !== "object") continue;
    const data = node.data as { seq?: unknown; content?: unknown };
    if (typeof data.seq !== "number" || !Array.isArray(data.content)) continue;
    const text = data.content
      .map((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text"
        ? String((part as { text?: unknown }).text ?? "")
        : "")
      .join("\n");
    output.push({ key, seq: data.seq, text });
  }
  return output.sort((left, right) => left.seq - right.seq);
}

export interface SubmissionResolverOptions {
  store: PendingCitationStore;
  resolveCitation(citation: ResolvedCitation): Promise<unknown>;
}

export interface SubmissionResolver {
  begin(sessionId: string, snapshot: ConversationSnapshotLike): void;
  observe(sessionId: string, snapshot: ConversationSnapshotLike): Promise<boolean>;
}

export function createSubmissionResolver(options: SubmissionResolverOptions): SubmissionResolver {
  const transactions = new Map<string, SubmissionTransaction>();
  const resolving = new Set<string>();
  return {
    begin(sessionId, snapshot) {
      const citations = options.store.list(sessionId);
      if (!citations.length) return;
      const baselineSeq = userNodes(snapshot).at(-1)?.seq ?? -1;
      transactions.set(sessionId, {
        baselineSeq,
        citationIds: citations.map((item) => item.citation.citationId),
      });
    },
    async observe(sessionId, snapshot) {
      const transaction = transactions.get(sessionId);
      if (!transaction || resolving.has(sessionId)) return false;
      const node = userNodes(snapshot).find((candidate) => candidate.seq > transaction.baselineSeq);
      if (!node) return false;
      resolving.add(sessionId);
      try {
        const quoteHash = await hashQuote(node.text);
        for (const citationId of transaction.citationIds) {
          const pending = options.store.list(sessionId).find((item) => item.citation.citationId === citationId);
          if (!pending) continue;
          await options.resolveCitation({
            protocolVersion: PROTOCOL_VERSION,
            type: "resolved-citation",
            citationId,
            sessionId,
            anchorId: node.key,
            role: "user",
            quoteHash,
          });
          options.store.remove(sessionId, citationId);
        }
        transactions.delete(sessionId);
        return true;
      } finally {
        resolving.delete(sessionId);
      }
    },
  };
}

export function isSubmissionEdge(previous: {
  phase: string;
  draft: string;
  running: boolean;
  queueLength: number;
}, current: {
  phase: string;
  draft: string;
  running: boolean;
  queueLength: number;
}): boolean {
  if (previous.phase === "plain" && current.phase !== "plain") return true;
  return previous.draft !== ""
    && current.draft === ""
    && (current.running && !previous.running || current.queueLength > previous.queueLength);
}

interface CitationTrayProps {
  readonly session: InputZone["session"];
  readonly input: InputZone["input"];
}

export function createCitationTray(
  ctx: Context,
  store: PendingCitationStore,
  resolver: SubmissionResolver,
): (props: CitationTrayProps) => ReactNode {
  return function CitationTray(props: CitationTrayProps): ReactNode {
    useSyncExternalStore(
      useCallback((listener: () => void) => store.subscribe(listener), []),
      () => store.getSnapshot(),
      () => store.getSnapshot(),
    );
    const sessionId = props.session.sessionId;
    const previous = useRef({
      sessionId,
      phase: props.input.phase,
      draft: props.input.draft,
      running: props.session.running,
      queueLength: props.input.queue?.length ?? 0,
    });

    useLayoutEffect(() => {
      const binding = ctx.sessions.binding(sessionId);
      if (!binding) return undefined;
      const observe = (): void => { void resolver.observe(sessionId, binding.session.getSnapshot()); };
      observe();
      return binding.session.subscribe(observe);
    }, [sessionId]);

    useEffect(() => {
      const current = {
        sessionId,
        phase: props.input.phase,
        draft: props.input.draft,
        running: props.session.running,
        queueLength: props.input.queue?.length ?? 0,
      };
      const prior = previous.current;
      previous.current = current;
      if (prior.sessionId !== sessionId || store.list(sessionId).length === 0) return;
      if (!isSubmissionEdge(prior, current)) return;
      const binding = ctx.sessions.binding(sessionId);
      if (binding) resolver.begin(sessionId, binding.session.getSnapshot());
    });

    const citations = store.list(sessionId);
    if (!citations.length) return null;
    return (
      <div className="dsh-sticker-board-citation-dock" data-dsh-sticker-board="">
        <div className="dsh-sticker-board-citation-rail">
          {citations.map(({ citation, displayNumber }) => (
            <div
              key={citation.citationId}
              className="dsh-sticker-board-citation-card"
              tabIndex={0}
              aria-label={`引用 ${displayNumber}：${citation.text}`}
            >
              <span className="dsh-sticker-board-citation-number">{displayNumber}</span>
              <span className="dsh-sticker-board-citation-preview">{citation.text}</span>
              <button
                type="button"
                className="dsh-sticker-board-citation-remove"
                title={`删除引用 ${displayNumber}`}
                aria-label={`删除引用 ${displayNumber}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => store.remove(sessionId, citation.citationId)}
              >
                ×
              </button>
              <div className="dsh-sticker-board-citation-tooltip" role="tooltip">
                <div className="dsh-sticker-board-citation-source">{citation.notePath}#^{citation.blockId}</div>
                {citation.heading && <div className="dsh-sticker-board-citation-heading">{citation.heading}</div>}
                <div className="dsh-sticker-board-citation-text">{citation.text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };
}
