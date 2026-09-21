import type { BorrowedBridgeTransport, ObsidianBridgeLifecycle, VaultConnectionSnapshot } from 'dsh-obsidian-bridge/api';
import type { BridgeHttpClient } from '../bridge/http-client.ts';

export type StickerBridgeChannel = Pick<BridgeHttpClient,
  'readSessionNote' | 'saveSessionNote' | 'deleteStickerBacklinks' | 'openNote' | 'listBacklinks'> & {
    forVault(vaultId: string): BorrowedBridgeTransport;
    listVaults(): readonly VaultConnectionSnapshot[];
    handoffReference: NonNullable<ObsidianBridgeLifecycle['handoffReference']>;
  };

/** Consumers borrow pinned routes; Bridge retains queue, connection and disposal ownership. */
export function createStickerBridgeChannel(resolve: () => ObsidianBridgeLifecycle | undefined): StickerBridgeChannel {
  const unavailable = (): never => { throw Object.assign(new Error('Obsidian Bridge 尚未连接；普通贴纸仍可保存在 DSH。'), { name: 'BridgeUnavailableError' }); };
  const listVaults = () => resolve()?.listVaults?.() ?? [];
  const transport = (vaultId?: string) => {
    const lifecycle = resolve();
    return vaultId ? lifecycle?.forVault?.(vaultId) ?? unavailable() : lifecycle?.transport ?? unavailable();
  };
  return {
    forVault: vaultId => transport(vaultId), listVaults,
    readSessionNote: async (...args) => transport().readSessionNote(...args),
    saveSessionNote: async (document, revision) => transport(document.vaultId).saveSessionNote(document, revision),
    deleteStickerBacklinks: async sticker => transport((sticker as {vaultId?:string}).vaultId).deleteStickerBacklinks(sticker),
    openNote: async action => transport(action.vaultId).openNote(action),
    listBacklinks: async sticker => {
      const vaults = listVaults().filter(vault => vault.state === 'bound');
      if (!vaults.length) return transport().listBacklinks(sticker);
      return (await Promise.all(vaults.map(async vault => (await transport(vault.vaultId).listBacklinks({...sticker,vaultId:vault.vaultId})).map(row => ({ ...row, vaultId: vault.vaultId }))))).flat();
    },
    handoffReference: async input => { const lifecycle = resolve(); if (!lifecycle?.handoffReference) return unavailable(); return lifecycle.handoffReference(input); },
  };
}
