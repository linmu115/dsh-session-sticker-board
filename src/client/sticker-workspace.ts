import type { BridgeClient } from "./bridge-client.ts";
import { createStickerStore, type StickerStore, type StickerView } from "./sticker-store.ts";
import { PROTOCOL_VERSION, type SessionNoteDocument, type StickerRecord } from "../protocol.ts";

type StickerBridge = Pick<BridgeClient, "readSessionNote" | "saveSessionNote">;

export interface StickerWorkspace {
  getSnapshot(): number;
  subscribe(listener: () => void): () => void;
  ensure(sessionId: string): Promise<void>;
  list(sessionId: string): readonly StickerView[];
  revision(sessionId: string): string;
  save(record: StickerRecord): Promise<void>;
  remove(sessionId: string, stickerId: string): Promise<void>;
}

interface StoreEntry {
  store: StickerStore;
  unsubscribe: () => void;
}

export function createStickerWorkspace(bridge: StickerBridge): StickerWorkspace {
  const entries = new Map<string, StoreEntry>();
  const loaded = new Set<string>();
  const loads = new Map<string, Promise<void>>();
  const mutations = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  let version = 0;

  const emit = (): void => {
    version += 1;
    for (const listener of listeners) listener();
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
    const load = bridge.readSessionNote(sessionId)
      .then((document) => {
        attach(sessionId, createStickerStore(document.stickers, document.revision));
        loaded.add(sessionId);
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

  return {
    getSnapshot: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ensure,
    list(sessionId) {
      return entry(sessionId).store.snapshot().stickers;
    },
    revision(sessionId) {
      return entry(sessionId).store.snapshot().revision;
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
        const result = await bridge.saveSessionNote(
          documentWith(record.sessionId, snapshot.revision, next),
          snapshot.revision,
        );
        store.upsert(record);
        store.commit(result.revision);
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
        const result = await bridge.saveSessionNote(
          documentWith(sessionId, snapshot.revision, next),
          snapshot.revision,
        );
        store.remove(stickerId);
        store.commit(result.revision);
      });
    },
  };
}
