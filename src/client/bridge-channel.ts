import type { BorrowedBridgeTransport, ObsidianBridgeLifecycle, VaultConnectionSnapshot } from 'dsh-obsidian-bridge-lifecycle/api';
import type { BridgeHttpClient } from '../bridge/http-client.ts';

export type VaultKnowledgeBridge = Pick<BridgeHttpClient, 'knowledge'> & {
  forVault?(vaultId: string): BorrowedBridgeTransport;
  listVaults?(): readonly VaultConnectionSnapshot[];
};
export type StickerBridgeChannel = Pick<BridgeHttpClient,
  'readSessionNote' | 'saveSessionNote' | 'deleteStickerBacklinks' | 'openNote' | 'listBacklinks' | 'knowledge'> & {
    forVault(vaultId: string): BorrowedBridgeTransport;
    listVaults(): readonly VaultConnectionSnapshot[];
    handoffReference: NonNullable<ObsidianBridgeLifecycle['handoffReference']>;
  };

export function selectedVault(bridge: VaultKnowledgeBridge, vaultId?: string): string | undefined {
  if (vaultId) return vaultId;
  if (!bridge.listVaults) return undefined; // Structural clients used by older integrations.
  const available = bridge.listVaults().filter(vault => vault.state === 'bound');
  if (available.length !== 1) throw Object.assign(new Error(available.length ? '请选择目标 Vault；旧记录不会自动归入其中一个。' : '尚未绑定可用的 Vault'), { code: available.length ? 'AMBIGUOUS_VAULT' : 'VAULT_UNAVAILABLE' });
  return available[0]!.vaultId;
}
export function pinKnowledge(bridge: VaultKnowledgeBridge, vaultId?: string): VaultKnowledgeBridge {
  const selected = selectedVault(bridge, vaultId);
  return selected && bridge.forVault ? bridge.forVault(selected) : bridge;
}

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
    knowledge: async (operation, input) => {
      if (operation !== 'notes' || typeof input.vaultId === 'string' || !resolve()?.listVaults) return transport(typeof input.vaultId === 'string' ? input.vaultId : undefined).knowledge(operation, input);
      // Each page cursor retains the originating Vault, never a last-connected endpoint.
      const cursors: Record<string, string | null> | undefined = typeof input.after === 'string' ? JSON.parse(input.after) : undefined;
      const vaults = listVaults().filter(vault => vault.state === 'bound' && (!cursors || cursors[vault.vaultId] != null));
      if (!vaults.length && !cursors) return unavailable();
      const pages = await Promise.all(vaults.map(async vault => {
        const { after: _after, ...query } = input;
        const page = await transport(vault.vaultId).knowledge('notes', { ...query, ...(cursors?.[vault.vaultId] ? { after: cursors[vault.vaultId] } : {}) }) as { items: Record<string,unknown>[]; nextCursor: string | null };
        return { vaultId: vault.vaultId, ...page, items: page.items.map(row => ({ ...row, vaultId: vault.vaultId, vaultName: vault.displayName })) };
      }));
      return { items: pages.flatMap(page => page.items), nextCursor: pages.some(page => page.nextCursor) ? JSON.stringify(Object.fromEntries(pages.map(page => [page.vaultId, page.nextCursor]))) : null };
    },
    handoffReference: async input => { const lifecycle = resolve(); if (!lifecycle?.handoffReference) return unavailable(); return lifecycle.handoffReference(input); },
  };
}
