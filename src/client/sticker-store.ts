import type { StickerRecord } from "../protocol.ts";

export type StickerStatus = "active" | "orphaned" | "saving" | "conflict" | "deleted";

export type FrozenStickerRecord = Readonly<Omit<StickerRecord, "tags">> & {
  readonly tags: readonly string[];
};

export interface StickerView {
  readonly record: FrozenStickerRecord;
  readonly status: StickerStatus;
  readonly displayNumber: number;
}

export interface StickerSnapshot {
  readonly revision: string;
  readonly stickers: readonly StickerView[];
}

export interface StickerStore {
  snapshot(): StickerSnapshot;
  subscribe(listener: (snapshot: StickerSnapshot) => void): () => void;
  upsert(record: StickerRecord): void;
  beginSave(stickerId: string): void;
  markConflict(stickerId: string): void;
  markOrphaned(stickerId: string): void;
  commit(revision: string): void;
  remove(stickerId: string): void;
}

interface MutableSticker {
  record: StickerRecord;
  status: StickerStatus;
}

function frozenRecord(record: StickerRecord): FrozenStickerRecord {
  return Object.freeze({ ...record, tags: Object.freeze([...record.tags]) });
}

export function createStickerStore(
  initial: readonly StickerRecord[] = [],
  initialRevision = "sha256:empty",
): StickerStore {
  let revision = initialRevision;
  const entries: MutableSticker[] = initial.map((record) => ({ record: { ...record, tags: [...record.tags] }, status: "active" }));
  const listeners = new Set<(snapshot: StickerSnapshot) => void>();

  function makeSnapshot(): StickerSnapshot {
    const stickers = entries.map((entry, index) => Object.freeze({
      record: frozenRecord(entry.record),
      status: entry.status,
      displayNumber: index + 1,
    }));
    return Object.freeze({ revision, stickers: Object.freeze(stickers) });
  }

  function emit(): void {
    const value = makeSnapshot();
    for (const listener of listeners) listener(value);
  }

  function updateStatus(stickerId: string, status: StickerStatus): void {
    const entry = entries.find((candidate) => candidate.record.stickerId === stickerId);
    if (!entry) throw new Error(`Sticker was not found: ${stickerId}`);
    entry.status = status;
    emit();
  }

  return {
    snapshot: makeSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    upsert(record) {
      const existing = entries.find((candidate) => candidate.record.stickerId === record.stickerId);
      if (existing) {
        existing.record = { ...record, tags: [...record.tags] };
        existing.status = "active";
      } else {
        entries.push({ record: { ...record, tags: [...record.tags] }, status: "active" });
      }
      emit();
    },
    beginSave(stickerId) { updateStatus(stickerId, "saving"); },
    markConflict(stickerId) { updateStatus(stickerId, "conflict"); },
    markOrphaned(stickerId) { updateStatus(stickerId, "orphaned"); },
    commit(nextRevision) {
      revision = nextRevision;
      for (const entry of entries) entry.status = "active";
      emit();
    },
    remove(stickerId) {
      const index = entries.findIndex((entry) => entry.record.stickerId === stickerId);
      if (index < 0) throw new Error(`Sticker was not found: ${stickerId}`);
      entries[index]!.status = "deleted";
      entries.splice(index, 1);
      emit();
    },
  };
}
