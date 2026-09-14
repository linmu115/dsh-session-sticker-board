import type { Context } from "@deepseek-ai/cordis";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

import { normalizeBridgeOrigin } from "../bridge/http-client.ts";
import { StickerLocalStore, type LocalStickerState, type SaveLocalSessionRequest } from "../host/local-store.ts";
import { localStickerStateSchema } from '../protocol.ts';
type Knowledge = { dispatch(operation: string, input: Record<string, unknown>): Promise<unknown> };

export class StickerBoardRemoteService extends TypertRemoteService {
  readonly origin: string;

  constructor(private readonly hostContext: Context, origin: string, readonly localStore = new StickerLocalStore()) {
    super(hostContext, "stickerBoard");
    this.origin = normalizeBridgeOrigin(origin);
  }

  private knowledge(): Knowledge | undefined { return this.hostContext.get('maintenanceKnowledge') as unknown as Knowledge | undefined; }
  async getBridgeConfig(): Promise<{ origin: string; managed: boolean }> {
    return { origin: this.origin, managed: Boolean(this.knowledge()) };
  }

  async readLocalState(sessionId: string): Promise<LocalStickerState> {
    const knowledge = this.knowledge();
    if (knowledge) return localStickerStateSchema.parse(await knowledge.dispatch('legacy-state', { nativeSessionId: sessionId }));
    if (await this.localStore.ownership(sessionId)) throw new Error('此会话已迁移，Maintenance 暂不可用；旧副本不会重新启用');
    return this.localStore.read(sessionId);
  }

  saveLocalSession(request: SaveLocalSessionRequest): Promise<LocalStickerState> {
    const knowledge = this.knowledge();
    if (knowledge) return knowledge.dispatch('legacy-save', request as unknown as Record<string, unknown>).then(value => localStickerStateSchema.parse(value));
    return this.localStore.save(request);
  }

  async acknowledgeBacklinkDelete(request: { sessionId: string; stickerId: string }): Promise<LocalStickerState> {
    const knowledge = this.knowledge();
    if (knowledge) {
      const state = await this.readLocalState(request.sessionId);
      return localStickerStateSchema.parse(await knowledge.dispatch('legacy-save', { document: state.document, expectedRevision: state.document.revision, acknowledgeStickerId: request.stickerId }));
    }
    return this.localStore.acknowledgeBacklinkDelete(request.sessionId, request.stickerId);
  }

  async knowledgeOperation(operation: string, inputJson: string): Promise<string> {
    if (inputJson.length > 512 * 1024) throw new Error('单次请求过大');
    const input = JSON.parse(inputJson) as Record<string, unknown>;
    const knowledge = this.knowledge();
    if (!knowledge) throw new Error('Maintenance 知识接口暂不可用');
    if (typeof input.sessionId !== 'string' || !input.sessionId || input.sessionId.length > 256) throw new Error('无效会话身份');
    if (operation === 'freeze') return JSON.stringify(await this.localStore.freeze(input.sessionId));
    if (operation === 'activate') {
      const receipt = await knowledge.dispatch('get', { namespace: 'stickers', objectId: input.receiptId }) as { content: { body: { kind: string; phase: string; migrationId: string; legacySessionId: string } } };
      if (receipt.content.body.kind !== 'migration' || receipt.content.body.phase !== 'active' || receipt.content.body.migrationId !== input.migrationId || receipt.content.body.legacySessionId !== input.sessionId) throw new Error('Maintenance 未确认迁移');
      await this.localStore.activate(input.sessionId, String(input.migrationId), String(input.receiptId));
      return JSON.stringify({ active: true });
    }
    throw new Error('不支持的贴纸迁移操作');
  }
}
