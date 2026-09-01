import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  PROTOCOL_VERSION,
  localStickerStateSchema,
  sessionNoteDocumentSchema,
  type SessionNoteDocument,
  stickerSchema,
  type StickerRecord,
} from "../protocol.ts";
import type { LocalStickerState } from "../protocol.ts";
export type { LocalStickerState } from "../protocol.ts";

export interface SaveLocalSessionRequest {
  document: SessionNoteDocument;
  expectedRevision: string;
  enqueueBacklinkDelete?: StickerRecord;
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

function documentRevision(document: Pick<SessionNoteDocument, "sessionId" | "stickers">): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ sessionId: document.sessionId, stickers: document.stickers }))
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
    const input = sessionNoteDocumentSchema.parse(request.document);
    const current = await this.read(input.sessionId);
    if (current.document.revision !== request.expectedRevision) {
      const error = new Error(`Sticker revision conflict: expected ${request.expectedRevision}, found ${current.document.revision}`) as Error & { code: string };
      error.code = "REVISION_CONFLICT";
      throw error;
    }
    const document = sessionNoteDocumentSchema.parse({
      ...input,
      revision: documentRevision(input),
    });
      const pendingBacklinkDeletes = [...current.pendingBacklinkDeletes];
      if (request.enqueueBacklinkDelete !== undefined
        && !pendingBacklinkDeletes.some((record) => record.stickerId === request.enqueueBacklinkDelete?.stickerId)) {
        pendingBacklinkDeletes.push(stickerSchema.parse(request.enqueueBacklinkDelete));
      }
      const state = localStickerStateSchema.parse({ document, pendingBacklinkDeletes });
      await this.write(input.sessionId, state);
      return state;
    });
  }

  acknowledgeBacklinkDelete(sessionId: string, stickerId: string): Promise<LocalStickerState> {
    return this.serialized(sessionId, async () => {
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
