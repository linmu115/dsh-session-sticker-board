import type { ObsidianBridgeLifecycle } from 'dsh-obsidian-bridge-lifecycle/api';
import type { BridgeHttpClient } from '../bridge/http-client.ts';

export type StickerBridgeChannel = Pick<BridgeHttpClient,
  'readSessionNote' | 'saveSessionNote' | 'deleteStickerBacklinks' | 'openNote' | 'listBacklinks' | 'knowledge'> & {
    handoffReference: NonNullable<ObsidianBridgeLifecycle['handoffReference']>;
  };

/** Borrow the current Bridge service, including after a late mount or restart.
 * No transport, queue or lifecycle is owned by the ordinary sticker consumer. */
export function createStickerBridgeChannel(resolve: () => ObsidianBridgeLifecycle | undefined): StickerBridgeChannel {
  const unavailable = (): never => {
    throw Object.assign(new Error('Obsidian Bridge 尚未连接；普通贴纸仍可保存在 DSH。'), { name: 'BridgeUnavailableError' });
  };
  const transport = () => resolve()?.transport ?? unavailable();
  return {
    readSessionNote: async (...args) => transport().readSessionNote(...args),
    saveSessionNote: async (...args) => transport().saveSessionNote(...args),
    deleteStickerBacklinks: async (...args) => transport().deleteStickerBacklinks(...args),
    openNote: async (...args) => transport().openNote(...args),
    listBacklinks: async (...args) => transport().listBacklinks(...args),
    knowledge: async (...args) => transport().knowledge(...args),
    handoffReference: async (input) => {
      const lifecycle = resolve();
      if (!lifecycle?.handoffReference) return unavailable();
      return lifecycle.handoffReference(input);
    },
  };
}
