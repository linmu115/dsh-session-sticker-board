import type { RemoteFailure, RemoteResult } from "@deepseek-ai/dsh-typert-protocol";

import type { Context } from "../context-types.ts";
import { normalizeBridgeOrigin } from "../bridge/http-client.ts";
import { STICKER_REMOTE } from "../remote/typert.ts";

export interface StickerBoardRemoteNamespace {
  getBridgeConfig(): Promise<RemoteResult<{ origin: string }>>;
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
    return { origin: normalizeBridgeOrigin(config.origin), dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
