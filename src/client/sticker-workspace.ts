import type { BridgeClient } from "./bridge-client.ts";
import { createStickerStore, type StickerStore, type StickerView } from "./sticker-store.ts";
import { PROTOCOL_VERSION, type LocalStickerState, type SessionNoteDocument, type StickerRecord } from "../protocol.ts";

type StickerBridge = Pick<BridgeClient, "readSessionNote" | "saveSessionNote" | "deleteStickerBacklinks">;

export interface StickerLocalPersistence {
  readLocalState(sessionId: string): Promise<LocalStickerState>;
  saveLocalSession(request: {
    document: SessionNoteDocument;
    expectedRevision: string;
    enqueueBacklinkDelete?: StickerRecord;
  }): Promise<LocalStickerState>;
  acknowledgeBacklinkDelete(request: { sessionId: string; stickerId: string }): Promise<LocalStickerState>;
}

export type StickerSyncStatus = "local-only" | "syncing" | "synced" | "conflict" | "error";

export interface StickerWorkspace {
  getSnapshot(): number;
  subscribe(listener: () => void): () => void;
  ensure(sessionId: string): Promise<void>;
  list(sessionId: string): readonly StickerView[];
  revision(sessionId: string): string;
  syncStatus(sessionId: string): StickerSyncStatus;
  syncIssue(sessionId: string): string | undefined;
  health(): { state: string; pendingCount: number; lastError?: string };
  sync(sessionId: string): Promise<void>;
  resolveConflict(sessionId: string, choice: "keep-local" | "use-obsidian"): Promise<void>;
  syncAll(): Promise<void>;
  save(record: StickerRecord): Promise<void>;
  remove(sessionId: string, stickerId: string): Promise<void>;
  dispose(): void;
}

interface StoreEntry {
  store: StickerStore;
  unsubscribe: () => void;
}

export function createStickerWorkspace(
  local: StickerLocalPersistence,
  bridge: StickerBridge,
  options: { onSyncError?: (error: unknown) => void } = {},
): StickerWorkspace {
  const entries = new Map<string, StoreEntry>();
  const loaded = new Set<string>();
  const loads = new Map<string, Promise<void>>();
  const mutations = new Map<string, Promise<void>>();
  const synchronizations = new Map<string, Promise<void>>();
  const resyncRequested = new Set<string>();
  const syncStatuses = new Map<string, StickerSyncStatus>();
  const syncIssues = new Map<string, string>();
  const conflicts = new Set<string>();
  const listeners = new Set<() => void>();
  let version = 0;
  let disposed = false;

  const emit = (): void => {
    if (disposed) return;
    version += 1;
    for (const listener of listeners) listener();
  };

  const setSyncStatus = (sessionId: string, status: StickerSyncStatus): void => {
    if (syncStatuses.get(sessionId) === status) return;
    syncStatuses.set(sessionId, status);
    emit();
  };

  const attach = (sessionId: string, store: StickerStore): void => {
    if (disposed) return;
    entries.get(sessionId)?.unsubscribe();
    entries.set(sessionId, { store, unsubscribe: store.subscribe(emit) });
    emit();
  };

  const entry = (sessionId: string): StoreEntry => {
    const current = entries.get(sessionId);
    if (current) return current;
    const store = createStickerStore();
    if (disposed) return { store, unsubscribe: () => undefined };
    const created = { store, unsubscribe: store.subscribe(emit) };
    entries.set(sessionId, created);
    return created;
  };

  const ensure = (sessionId: string): Promise<void> => {
    if (disposed) return Promise.reject(new Error("Sticker workspace has closed"));
    if (loaded.has(sessionId)) return Promise.resolve();
    const active = loads.get(sessionId);
    if (active) return active;
    const load = local.readLocalState(sessionId)
      .then((state) => {
        if (disposed) return;
        attach(sessionId, createStickerStore(state.document.stickers, state.document.revision));
        loaded.add(sessionId);
        syncIssues.delete(sessionId);
        setSyncStatus(sessionId, "local-only");
      })
      .catch((error: unknown) => {
        if (!disposed) {
          syncIssues.set(sessionId, error instanceof Error ? error.message : String(error));
          setSyncStatus(sessionId, "error");
        }
        throw error;
      })
      .finally(() => loads.delete(sessionId));
    loads.set(sessionId, load);
    return load;
  };

  const serialized = (sessionId: string, work: () => Promise<void>): Promise<void> => {
    const prior = mutations.get(sessionId) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(work);
    mutations.set(sessionId, next);
    void next.finally(() => {
      if (mutations.get(sessionId) === next) mutations.delete(sessionId);
    }).catch(() => undefined);
    return next;
  };

  const documentWith = (
    sessionId: string,
    revision: string,
    stickers: readonly StickerRecord[],
  ): SessionNoteDocument => ({
    protocolVersion: PROTOCOL_VERSION,
    type: "session-note",
    sessionId,
    revision,
    stickers: [...stickers],
  });

  const sync = (sessionId: string): Promise<void> => {
    if (disposed || conflicts.has(sessionId)) return Promise.resolve();
    const active = synchronizations.get(sessionId);
    if (active) {
      resyncRequested.add(sessionId);
      return active;
    }
    const synchronizeOnce = async (): Promise<void> => {
      try {
        await ensure(sessionId);
        if (disposed) return;
        setSyncStatus(sessionId, "syncing");
        const localState = await local.readLocalState(sessionId);
        if (disposed) return;
        for (const deleted of localState.pendingBacklinkDeletes) {
          await bridge.deleteStickerBacklinks(deleted);
          if (disposed) return;
          await local.acknowledgeBacklinkDelete({ sessionId, stickerId: deleted.stickerId });
          if (disposed) return;
        }
        const remote = await bridge.readSessionNote(sessionId);
        if (disposed) return;
        let snapshot = entry(sessionId).store.snapshot();
        if (snapshot.revision === "sha256:empty" && snapshot.stickers.length === 0 && remote.stickers.length > 0) {
          try {
            const imported = await local.saveLocalSession({
              document: documentWith(sessionId, snapshot.revision, remote.stickers),
              expectedRevision: snapshot.revision,
            });
            if (disposed) return;
            attach(sessionId, createStickerStore(imported.document.stickers, imported.document.revision));
            snapshot = entry(sessionId).store.snapshot();
          } catch {
            if (disposed) return;
            const current = await local.readLocalState(sessionId);
            if (disposed) return;
            attach(sessionId, createStickerStore(current.document.stickers, current.document.revision));
            snapshot = entry(sessionId).store.snapshot();
          }
        }
        const stickers = snapshot.stickers.map((view) => view.record as StickerRecord);
        if (disposed) return;
        await bridge.saveSessionNote(documentWith(sessionId, remote.revision, stickers), remote.revision);
        if (disposed) return;
        syncIssues.delete(sessionId);
        setSyncStatus(sessionId, "synced");
      } catch (error) {
        if (disposed) return;
        const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
        const message = error instanceof Error ? error.message : String(error);
        syncIssues.set(sessionId, message);
        if (code === "revision-conflict" || code === "REVISION_CONFLICT") {
          conflicts.add(sessionId);
          setSyncStatus(sessionId, "conflict");
        } else {
          const unavailable = error instanceof TypeError || (error instanceof Error && error.name === "BridgeUnavailableError");
          setSyncStatus(sessionId, unavailable ? "local-only" : "error");
        }
        options.onSyncError?.(error);
      }
    };
    const synchronization = (async () => {
      do {
        resyncRequested.delete(sessionId);
        await synchronizeOnce();
      } while (!disposed && !conflicts.has(sessionId) && resyncRequested.delete(sessionId));
    })().finally(() => synchronizations.delete(sessionId));
    synchronizations.set(sessionId, synchronization);
    return synchronization;
  };

  return {
    getSnapshot: () => version,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async ensure(sessionId) {
      await ensure(sessionId);
      void sync(sessionId);
    },
    list(sessionId) {
      return entry(sessionId).store.snapshot().stickers;
    },
    revision(sessionId) {
      return entry(sessionId).store.snapshot().revision;
    },
    syncStatus(sessionId) {
      return syncStatuses.get(sessionId) ?? "local-only";
    },
    syncIssue: (sessionId) => syncIssues.get(sessionId),
    health() {
      const pending = [...new Set([...loaded, ...syncIssues.keys()])].filter((id) => syncStatuses.get(id) !== "synced");
      const lastError = [...syncIssues.values()].at(-1);
      return {
        state: disposed ? "closed" : conflicts.size ? "conflict" : [...syncStatuses.values()].includes("error") ? "error" : pending.length ? "pending" : "synced",
        pendingCount: pending.length,
        ...(lastError === undefined ? {} : { lastError }),
      };
    },
    sync,
    resolveConflict(sessionId, choice) {
      return serialized(sessionId, async () => {
        await ensure(sessionId);
        await synchronizations.get(sessionId);
        if (disposed) return;
        if (choice === "use-obsidian") {
          const remote = await bridge.readSessionNote(sessionId);
          if (disposed) return;
          const current = await local.readLocalState(sessionId);
          if (disposed) return;
          const deleted = new Set(current.pendingBacklinkDeletes.map((record) => record.stickerId));
          const adopted = await local.saveLocalSession({
            document: documentWith(sessionId, current.document.revision, remote.stickers.filter((record) => !deleted.has(record.stickerId))),
            expectedRevision: current.document.revision,
          });
          if (disposed) return;
          attach(sessionId, createStickerStore(adopted.document.stickers, adopted.document.revision));
        }
        conflicts.delete(sessionId);
        syncIssues.delete(sessionId);
        setSyncStatus(sessionId, "local-only");
        await sync(sessionId);
      });
    },
    async syncAll() {
      const sessions = [...new Set([...loaded, ...syncIssues.keys()])];
      let next = 0;
      await Promise.allSettled(Array.from({ length: Math.min(3, sessions.length) }, async () => {
        while (!disposed && next < sessions.length) await sync(sessions[next++]!);
      }));
    },
    save(record) {
      return serialized(record.sessionId, async () => {
        await ensure(record.sessionId);
        if (disposed) return;
        const store = entry(record.sessionId).store;
        const snapshot = store.snapshot();
        const records = snapshot.stickers.map((view) => view.record as StickerRecord);
        const existing = records.findIndex((candidate) => candidate.stickerId === record.stickerId);
        const next = [...records];
        if (existing < 0) next.push(record);
        else next[existing] = record;
        const saved = await local.saveLocalSession({
          document: documentWith(record.sessionId, snapshot.revision, next),
          expectedRevision: snapshot.revision,
        });
        if (disposed) return;
        store.upsert(record);
        store.commit(saved.document.revision);
        setSyncStatus(record.sessionId, conflicts.has(record.sessionId) ? "conflict" : "local-only");
        void sync(record.sessionId);
      });
    },
    remove(sessionId, stickerId) {
      return serialized(sessionId, async () => {
        await ensure(sessionId);
        if (disposed) return;
        const store = entry(sessionId).store;
        const snapshot = store.snapshot();
        const current = snapshot.stickers.find((view) => view.record.stickerId === stickerId);
        if (!current) throw new Error(`Sticker was not found: ${stickerId}`);
        const next = snapshot.stickers
          .filter((view) => view.record.stickerId !== stickerId)
          .map((view) => view.record as StickerRecord);
        const saved = await local.saveLocalSession({
          document: documentWith(sessionId, snapshot.revision, next),
          expectedRevision: snapshot.revision,
          enqueueBacklinkDelete: current.record as StickerRecord,
        });
        if (disposed) return;
        store.remove(stickerId);
        store.commit(saved.document.revision);
        setSyncStatus(sessionId, conflicts.has(sessionId) ? "conflict" : "local-only");
        void sync(sessionId);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const current of entries.values()) current.unsubscribe();
      listeners.clear();
      resyncRequested.clear();
    },
  };
}
