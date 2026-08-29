import type { Context as CordisContext } from "@deepseek-ai/cordis";
import type { ReactNode } from "react";

export type SessionId = string;

export interface ObservableSnapshot<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

export interface ChatNodeLike {
  key: string;
  id: string;
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

export interface SessionScope {
  sessionId: SessionId;
  cwd?: string;
}

export interface SidebarTab {
  id: string;
  type: string;
  title: string;
  path?: string;
  meta?: unknown;
}

export interface SidebarState {
  splits?: unknown;
  bottomSplits?: unknown;
  panelOpen?: boolean;
}

export interface SidebarSnapshot {
  sessionId?: SessionId;
  state?: SidebarState;
}

export interface TabComponentProps {
  ctx: Context;
  scope: SessionScope;
  tab: SidebarTab;
  visible: boolean;
}

export interface TabDescriptor {
  id: string;
  title: string | (() => string);
  icon?: ReactNode | ((size: number) => ReactNode);
  order?: number;
  hidden?: boolean;
  single?: boolean;
  component: (props: TabComponentProps) => ReactNode;
}

export interface BetterSidebarService {
  readonly version: string;
  readonly features: readonly string[];
  registerTab(descriptor: TabDescriptor): () => void;
  openTab(seed: {
    type: string;
    title?: string;
    path?: string;
    id?: string;
    meta?: unknown;
  }, scope?: SessionScope): void;
  closeTab(tabId: string, scope?: SessionScope): void;
  activateTab(tabId: string, scope?: SessionScope): void;
  updateTab(tabId: string, patch: { title?: string; path?: string; meta?: unknown }): void;
  isTabEnabled(id: string): boolean;
  getSnapshot(): SidebarSnapshot;
  subscribeState?(listener: () => void): () => void;
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
  readonly appearance?: "session" | "file" | "folder";
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

export type Context = Omit<CordisContext, "sessions" | "slots"> & {
  sessions: SessionsService;
  slots: SlotsService;
  betterSidebar: BetterSidebarService;
  get(name: string): unknown;
};
