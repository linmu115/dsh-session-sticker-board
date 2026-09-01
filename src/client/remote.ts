import type { RemoteFailure, RemoteResult } from "@deepseek-ai/dsh-typert-protocol";

import type { Context } from "../context-types.ts";
import { normalizeBridgeOrigin } from "../bridge/http-client.ts";
import { STICKER_REMOTE } from "../remote/typert.ts";
import type { LocalStickerState, SessionNoteDocument } from "../protocol.ts";

export interface StickerBoardRemoteNamespace {
  getBridgeConfig(): Promise<RemoteResult<{ origin: string }>>;
  readLocalState(sessionId: string): Promise<RemoteResult<LocalStickerState>>;
  saveLocalSession(request: {
    document: SessionNoteDocument;
    expectedRevision: string;
    enqueueBacklinkDelete?: import("../protocol.ts").StickerRecord;
  }): Promise<RemoteResult<LocalStickerState>>;
  acknowledgeBacklinkDelete(request: { sessionId: string; stickerId: string }): Promise<RemoteResult<LocalStickerState>>;
}

export class StickerRemoteFailureError extends Error {
  constructor(readonly failure: RemoteFailure) {
    super(failure.message);
    this.name = "StickerRemoteFailureError";
  }
}

function unwrapRemote<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new StickerRemoteFailureError(result.error);
  return result.value;
}

export async function mountStickerRemote(ctx: Context): Promise<{
  origin: string;
  readLocalState(sessionId: string): Promise<LocalStickerState>;
  saveLocalSession(request: {
    document: SessionNoteDocument;
    expectedRevision: string;
    enqueueBacklinkDelete?: import("../protocol.ts").StickerRecord;
  }): Promise<LocalStickerState>;
  acknowledgeBacklinkDelete(request: { sessionId: string; stickerId: string }): Promise<LocalStickerState>;
  dispose(): Promise<void>;
}> {
  const remote = ctx.get("remote") as {
    $mount(contribution: typeof STICKER_REMOTE): Promise<() => Promise<void>>;
  } | undefined;
  if (remote === undefined) throw new Error("DSH remote service is unavailable");
  const dispose = await remote.$mount(STICKER_REMOTE);
  try {
    const namespace = ctx.get("remote.stickerBoard") as StickerBoardRemoteNamespace | undefined;
    if (namespace === undefined) throw new Error("Sticker bridge Remote descriptor was not mounted");
    const config = unwrapRemote(await namespace.getBridgeConfig());
    return {
      origin: normalizeBridgeOrigin(config.origin),
      readLocalState: async (sessionId) => unwrapRemote(await namespace.readLocalState(sessionId)),
      saveLocalSession: async (request) => unwrapRemote(await namespace.saveLocalSession(request)),
      acknowledgeBacklinkDelete: async (request) => unwrapRemote(await namespace.acknowledgeBacklinkDelete(request)),
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
