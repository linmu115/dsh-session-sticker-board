import type { Context } from "@deepseek-ai/cordis";
import { assertSessionWritable, observeSessionWriteAccess } from 'dsh-annotation-core/host-api';
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

import { normalizeBridgeOrigin } from "../bridge/http-client.ts";
import { StickerLocalStore, type LocalStickerState, type SaveLocalSessionRequest } from "../host/local-store.ts";

export class StickerBoardRemoteService extends TypertRemoteService {
  readonly origin: string;

  constructor(private readonly hostContext: Context, origin: string, readonly localStore: StickerLocalStore) {
    // Linked peers may resolve separate Cordis type augmentations; the runtime context is shared.
    super(hostContext as never, "stickerBoard");
    this.origin = normalizeBridgeOrigin(origin);
    observeSessionWriteAccess(hostContext);
  }

  async getBridgeConfig(): Promise<{ origin: string }> {
    return { origin: this.origin };
  }

  async readLocalState(sessionId: string): Promise<LocalStickerState> {
    if (await this.localStore.ownership(sessionId)) throw new Error('此会话的贴纸已迁出本地副本，不再从本地重新启用');
    return this.localStore.read(sessionId);
  }

  async saveLocalSession(request: SaveLocalSessionRequest): Promise<LocalStickerState> {
    await assertSessionWritable(this.hostContext);
    return this.localStore.save(request);
  }

  async acknowledgeBacklinkDelete(request: { sessionId: string; stickerId: string }): Promise<LocalStickerState> {
    await assertSessionWritable(this.hostContext);
    return this.localStore.acknowledgeBacklinkDelete(request.sessionId, request.stickerId);
  }
}
