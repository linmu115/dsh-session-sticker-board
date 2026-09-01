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

export type StickerSyncStatus = "local-only" | "syncing" | "synced";

export interface StickerWorkspace {
  getSnapshot(): number;
  subscribe(listener: () => void): () => void;
  ensure(sessionId: string): Promise<void>;
  list(sessionId: string): readonly StickerView[];
  revision(sessionId: string): string;
  syncStatus(sessionId: string): StickerSyncStatus;
  sync(sessionId: string): Promise<void>;
  syncAll(): Promise<void>;
  save(record: StickerRecord): Promise<void>;
  remove(sessionId: string, stickerId: string): Promise<void>;
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
  const listeners = new Set<() => void>();
  let version = 0;

  const emit = (): void => {
    version += 1;
    for (const listener of listeners) listener();
  };

  const setSyncStatus = (sessionId: string, status: StickerSyncStatus): void => {
    if (syncStatuses.get(sessionId) === status) return;
    syncStatuses.set(sessionId, status);
    emit();
  };

  const attach = (sessionId: string, store: StickerStore): void => {
    entries.get(sessionId)?.unsubscribe();
    entries.set(sessionId, { store, unsubscribe: store.subscribe(emit) });
    emit();
  };

  const entry = (sessionId: string): StoreEntry => {
    const current = entries.get(sessionId);
    if (current) return current;
    const store = createStickerStore();
    const created = { store, unsubscribe: store.subscribe(emit) };
    entries.set(sessionId, created);
    return created;
  };

  const ensure = (sessionId: string): Promise<void> => {
    if (loaded.has(sessionId)) return Promise.resolve();
    const active = loads.get(sessionId);
    if (active) return active;
    const load = local.readLocalState(sessionId)
      .then((state) => {
        attach(sessionId, createStickerStore(state.document.stickers, state.document.revision));
        loaded.add(sessionId);
        setSyncStatus(sessionId, "local-only");
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
    const active = synchronizations.get(sessionId);
    if (active) {
      resyncRequested.add(sessionId);
      return active;
    }
    const synchronizeOnce = async (): Promise<void> => {
      await ensure(sessionId);
      setSyncStatus(sessionId, "syncing");
      try {
        const localState = await local.readLocalState(sessionId);
        for (const deleted of localState.pendingBacklinkDeletes) {
          await bridge.deleteStickerBacklinks(deleted);
          await local.acknowledgeBacklinkDelete({ sessionId, stickerId: deleted.stickerId });
        }
        const remote = await bridge.readSessionNote(sessionId);
        let snapshot = entry(sessionId).store.snapshot();
        if (snapshot.revision === "sha256:empty" && snapshot.stickers.length === 0 && remote.stickers.length > 0) {
          try {
            const imported = await local.saveLocalSession({
              document: documentWith(sessionId, snapshot.revision, remote.stickers),
              expectedRevision: snapshot.revision,
            });
            attach(sessionId, createStickerStore(imported.document.stickers, imported.document.revision));
            snapshot = entry(sessionId).store.snapshot();
          } catch {
            const current = await local.readLocalState(sessionId);
            attach(sessionId, createStickerStore(current.document.stickers, current.document.revision));
            snapshot = entry(sessionId).store.snapshot();
          }
        }
        const stickers = snapshot.stickers.map((view) => view.record as StickerRecord);
        await bridge.saveSessionNote(documentWith(sessionId, remote.revision, stickers), remote.revision);
        setSyncStatus(sessionId, "synced");
      } catch (error) {
        setSyncStatus(sessionId, "local-only");
        options.onSyncError?.(error);
      }
    };
    const synchronization = (async () => {
      do {
        resyncRequested.delete(sessionId);
        await synchronizeOnce();
      } while (resyncRequested.delete(sessionId));
    })().finally(() => synchronizations.delete(sessionId));
    synchronizations.set(sessionId, synchronization);
    return synchronization;
  };

  return {
    getSnapshot: () => version,
    subscribe(listener) {
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
    sync,
    async syncAll() {
      await Promise.allSettled([...loaded].map(sync));
    },
    save(record) {
      return serialized(record.sessionId, async () => {
        await ensure(record.sessionId);
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
        store.upsert(record);
        store.commit(saved.document.revision);
        setSyncStatus(record.sessionId, "local-only");
        void sync(record.sessionId);
      });
    },
    remove(sessionId, stickerId) {
      return serialized(sessionId, async () => {
        await ensure(sessionId);
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
        store.remove(stickerId);
        store.commit(saved.document.revision);
        setSyncStatus(sessionId, "local-only");
        void sync(sessionId);
      });
    },
  };
}
