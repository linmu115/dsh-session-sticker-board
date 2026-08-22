import type { Context as CordisContext } from "cordis";

export type SessionId = string;

export interface ObservableSnapshot<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

export interface ChatNodeLike {
  key: string;
  kind: string;
  data: unknown;
}

export interface ConversationSnapshotLike {
  sessionId: SessionId;
  running: boolean;
  hasMore?: boolean;
  loadingOlder?: boolean;
  chat: {
    order: readonly string[];
    nodes: { get(key: string): ChatNodeLike | undefined };
  };
}

export interface SessionFace extends ObservableSnapshot<ConversationSnapshotLike> {
  loadOlder(): Promise<void>;
}

export interface SessionsService {
  list: ObservableSnapshot<{
    current?: SessionId;
    byId?: Record<string, { title?: string; archived?: boolean } | undefined>;
  }>;
  binding(id: SessionId): { session: SessionFace } | undefined;
  scope(id: SessionId): Context | undefined;
  open(id: SessionId): void;
}

export interface SlotRegisterOptions {
  name: string;
  id?: string;
  order?: number;
  registrant?: string;
}

export interface SlotsService {
  register(options: SlotRegisterOptions, component: unknown): () => void;
  inject(key: string, callback: () => (() => void) | void): () => void;
}

export interface ReferenceOccurrence {
  readonly occurrenceId: number;
  readonly source: string;
  readonly ref: string;
  readonly offset: number;
  readonly length?: number;
  readonly label: string;
  readonly clipboardText: string;
}

export interface InputStateSnapshot {
  readonly draft: string;
  readonly draftRev: number;
  readonly phase: string;
  readonly occurrences: readonly ReferenceOccurrence[];
  readonly queue?: readonly unknown[];
}

export interface ReferenceInsert {
  readonly source: string;
  readonly ref: string;
  readonly label: string;
  readonly appearance?: "session" | "file" | "folder" | "dsh-sticker-board-hidden";
  readonly clipboardText: string;
}

export interface SessionInput {
  readonly state: ObservableSnapshot<InputStateSnapshot>;
  insertReference(
    reference: ReferenceInsert,
    span: { start: number; end: number; draftRev: number },
  ): boolean;
  setDraft(text: string): void;
}

export interface ConversationService {
  input: { for(ctx: Context): SessionInput | undefined };
}

export interface InputTriggerService {
  registerSource(source: unknown): () => void;
}

export interface InputZone {
  readonly session: ConversationSnapshotLike;
  readonly input: InputStateSnapshot;
}

export interface Context extends CordisContext {
  sessions: SessionsService;
  slots: SlotsService;
  get(name: string): unknown;
}
