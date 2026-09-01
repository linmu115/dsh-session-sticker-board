import type { Context } from "@deepseek-ai/cordis";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

import { normalizeBridgeOrigin } from "../bridge/http-client.ts";
import { StickerLocalStore, type LocalStickerState, type SaveLocalSessionRequest } from "../host/local-store.ts";

export class StickerBoardRemoteService extends TypertRemoteService {
  readonly origin: string;

  constructor(ctx: Context, origin: string, readonly localStore = new StickerLocalStore()) {
    super(ctx, "stickerBoard");
    this.origin = normalizeBridgeOrigin(origin);
  }

  getBridgeConfig(): { origin: string } {
    return { origin: this.origin };
  }

  readLocalState(sessionId: string): Promise<LocalStickerState> {
    return this.localStore.read(sessionId);
  }

  saveLocalSession(request: SaveLocalSessionRequest): Promise<LocalStickerState> {
    return this.localStore.save(request);
  }

  acknowledgeBacklinkDelete(request: { sessionId: string; stickerId: string }): Promise<LocalStickerState> {
    return this.localStore.acknowledgeBacklinkDelete(request.sessionId, request.stickerId);
  }
}
