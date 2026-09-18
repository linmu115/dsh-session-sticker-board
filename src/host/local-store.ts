import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  PROTOCOL_VERSION,
  localStickerStateSchema,
  sessionNoteDocumentSchema,
  type SessionNoteDocument,
  stickerSchema,
  pendingBacklinkDeleteSchema,
  type PendingBacklinkDelete,
  type StickerRecord,
} from "../protocol.ts";
import type { LocalStickerState } from "../protocol.ts";
export type { LocalStickerState } from "../protocol.ts";

export interface SaveLocalSessionRequest {
  document: SessionNoteDocument;
  expectedRevision: string;
  enqueueBacklinkDelete?: PendingBacklinkDelete;
  updateBacklinkDelete?: PendingBacklinkDelete;
}

export function defaultStickerStorageDirectory(
  env: NodeJS.ProcessEnv = process.env,
  userHome = homedir(),
): string {
  const configured = env.DSH_HOME?.trim();
  const dshHome = configured ? configured : join(userHome, ".dsh");
  return join(dshHome, "plugin-data", "dsh-session-sticker-board");
}

function emptyDocument(sessionId: string): SessionNoteDocument {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "session-note",
    sessionId,
    revision: "sha256:empty",
    stickers: [],
  };
}

function documentRevision(document: Pick<SessionNoteDocument, "sessionId" | "stickers" | "vaultId">): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ sessionId: document.sessionId, stickers: document.stickers, ...(document.vaultId ? { vaultId: document.vaultId } : {}) }))
    .digest("hex");
  return `sha256:${digest}`;
}

function sessionFile(root: string, sessionId: string): string {
  const key = createHash("sha256").update(sessionId).digest("hex");
  return join(root, "sessions", `${key}.json`);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

export class StickerLocalStore {
  private readonly mutations = new Map<string, Promise<unknown>>();

  constructor(readonly root: string = defaultStickerStorageDirectory()) {}

  async ownership(sessionId: string): Promise<{ migrationId: string; phase: 'frozen' | 'active'; receiptId?: string; vaultId?: string } | null> {
    try {
      const value = JSON.parse(await readFile(sessionFile(this.root, sessionId) + '.ownership', 'utf8'));
      if (typeof value.migrationId !== 'string' || !['frozen','active'].includes(value.phase)) throw new Error('贴纸迁移登记损坏，暂停写入');
      return value;
    } catch (error) { if (isMissing(error)) return null; throw error; }
  }
  freeze(sessionId: string, vaultId?: string): Promise<unknown> {
    return this.serialized(sessionId, async () => {
      const ownership = await this.ownership(sessionId) ?? { migrationId: randomUUID(), phase: 'frozen' as const, vaultId: undefined as string | undefined };
      const originalVault = ownership.vaultId ?? (await this.read(sessionId)).document.vaultId;
      if (originalVault && vaultId && originalVault !== vaultId) throw new Error('旧贴纸已固定到 Vault：' + originalVault);
      if (vaultId && !ownership.vaultId) ownership.vaultId = vaultId;
      await this.writeOwnership(sessionId, ownership);
      return { ...ownership, state: await this.read(sessionId) };
    });
  }
  activate(sessionId: string, migrationId: string, receiptId: string): Promise<void> {
    return this.serialized(sessionId, async () => {
      const ownership = await this.ownership(sessionId);
      if (!ownership || ownership.migrationId !== migrationId || (ownership.receiptId && ownership.receiptId !== receiptId)) throw new Error('迁移回执与本地冻结记录不同');
      await this.writeOwnership(sessionId, { ...ownership, migrationId, phase: 'active', receiptId });
    });
  }
  private async writeOwnership(sessionId: string, value: unknown): Promise<void> {
    const path = sessionFile(this.root, sessionId) + '.ownership';
    await mkdir(dirname(path), { recursive: true });
    const temporary = path + '.' + randomUUID() + '.tmp';
    const handle = await open(temporary, 'wx');
    try { await handle.writeFile(JSON.stringify(value), 'utf8'); await handle.sync(); } finally { await handle.close(); }
    try { await rename(temporary, path); } catch (error) { await rm(temporary, { force: true }); throw error; }
  }
  private async assertWritable(sessionId: string): Promise<void> {
    if (await this.ownership(sessionId)) throw Object.assign(new Error('旧贴纸已冻结或迁入 Maintenance，禁止重新写入本地副本'), { code: 'STICKER_MIGRATION_REQUIRED' });
  }

  async read(sessionId: string): Promise<LocalStickerState> {
    if (sessionId.trim() === "") throw new TypeError("Session ID must not be empty");
    const file = sessionFile(this.root, sessionId);
    try {
      const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
      const state = localStickerStateSchema.safeParse(raw);
      const parsed = state.success
        ? state.data
        : { document: sessionNoteDocumentSchema.parse(raw), pendingBacklinkDeletes: [] };
      if (parsed.document.sessionId !== sessionId) throw new Error("Sticker store session identity does not match its file key");
      return parsed;
    } catch (error) {
      if (isMissing(error)) return { document: emptyDocument(sessionId), pendingBacklinkDeletes: [] };
      throw error;
    }
  }

  save(request: SaveLocalSessionRequest): Promise<LocalStickerState> {
    return this.serialized(request.document.sessionId, async () => {
    await this.assertWritable(request.document.sessionId);
    const input = sessionNoteDocumentSchema.parse(request.document);
    const current = await this.read(input.sessionId);
    if (current.document.revision !== request.expectedRevision) {
      const error = new Error(`Sticker revision conflict: expected ${request.expectedRevision}, found ${current.document.revision}`) as Error & { code: string };
      error.code = "REVISION_CONFLICT";
      throw error;
    }
    if (current.document.vaultId && input.vaultId !== current.document.vaultId) throw new Error("旧贴纸的 Vault 归属不能被隐式改变");
    const document = sessionNoteDocumentSchema.parse({
      ...input,
      revision: documentRevision(input),
    });
      const pendingBacklinkDeletes = [...current.pendingBacklinkDeletes];
      if (request.enqueueBacklinkDelete !== undefined
        && !pendingBacklinkDeletes.some((record) => record.stickerId === request.enqueueBacklinkDelete?.stickerId)) {
        pendingBacklinkDeletes.push(pendingBacklinkDeleteSchema.parse(request.enqueueBacklinkDelete));
      }
      if (request.updateBacklinkDelete) {
        const index = pendingBacklinkDeletes.findIndex(record => record.stickerId === request.updateBacklinkDelete!.stickerId);
        if (index < 0 || request.updateBacklinkDelete.sessionId !== input.sessionId) throw new Error('待删除回链不属于当前队列');
        const before = pendingBacklinkDeletes[index]!;
        const after = pendingBacklinkDeleteSchema.parse(request.updateBacklinkDelete);
        if (before.pendingVaultIds && after.pendingVaultIds?.some(vaultId => !before.pendingVaultIds!.includes(vaultId))) throw new Error('不得将待删除回链改投新的 Vault');
        pendingBacklinkDeletes[index] = after;
      }
      const state = localStickerStateSchema.parse({ document, pendingBacklinkDeletes });
      await this.write(input.sessionId, state);
      return state;
    });
  }

  acknowledgeBacklinkDelete(sessionId: string, stickerId: string): Promise<LocalStickerState> {
    return this.serialized(sessionId, async () => {
      await this.assertWritable(sessionId);
      const current = await this.read(sessionId);
      const state = localStickerStateSchema.parse({
        ...current,
        pendingBacklinkDeletes: current.pendingBacklinkDeletes.filter((record) => record.stickerId !== stickerId),
      });
      await this.write(sessionId, state);
      return state;
    });
  }

  private serialized<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const prior = this.mutations.get(sessionId) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(work);
    this.mutations.set(sessionId, next);
    void next.finally(() => {
      if (this.mutations.get(sessionId) === next) this.mutations.delete(sessionId);
    }).catch(() => undefined);
    return next;
  }

  private async write(sessionId: string, state: LocalStickerState): Promise<void> {
    const file = sessionFile(this.root, sessionId);
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    try {
      await rm(file, { force: true });
      await rename(temporary, file);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
