import { pinKnowledge, selectedVault, type VaultKnowledgeBridge } from './bridge-channel.ts';
import type { KnowledgeMigration } from '@linmu/dsh-session-contracts';
import type { LocalStickerState, SessionNoteDocument, StickerRecord } from '../protocol.ts';
export async function knowledgeRequest<T>(operation: string, input: Record<string, unknown> = {}): Promise<T> {
  let response: Response;
  try { response = await fetch('/maintenance-knowledge/api/' + operation, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(15000) }); }
  catch { throw Object.assign(new Error('维护服务暂不可用，内容尚未确认保存；输入已保留，请连接恢复后重试。'), { code: 'MAINTENANCE_UNAVAILABLE' }); }
  const result = await response.json().catch(() => { throw Object.assign(new Error('此实例未提供有效的维护知识接口，无法确认保存；已有数据保留。'), { code: 'MAINTENANCE_UNAVAILABLE' }); });
  if (!response.ok) throw Object.assign(new Error(result.error?.message ?? '知识操作未完成'), { code: result.error?.code });
  return result;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable((value as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(value);
}
export class MigrationConflict extends Error {
  constructor(readonly ids: string[]) { super('同一张旧贴纸在 DSH 和 Vault 中有不同编辑。请打开「贴纸与笔记链接 → 迁移旧贴纸」选择冲突版本，再重试创建；输入内容已保留。'); }
}
export function mergeLegacyStickers(local: LocalStickerState, remote: SessionNoteDocument, choice?: 'local' | 'vault'): StickerRecord[] {
  const deleted = new Set(local.pendingBacklinkDeletes.map(s => s.stickerId));
  const records = new Map(local.document.stickers.filter(s => !deleted.has(s.stickerId)).map(s => [s.stickerId, s]));
  const conflicts: string[] = [];
  for (const record of remote.stickers) {
    if (deleted.has(record.stickerId)) continue;
    const old = records.get(record.stickerId);
    if (old && stable(old) !== stable(record)) { conflicts.push(record.stickerId); if (choice === 'vault') records.set(record.stickerId, record); }
    else records.set(record.stickerId, record);
  }
  if (conflicts.length && !choice) throw new MigrationConflict(conflicts);
  return [...records.values()].sort((a,b) => a.stickerId.localeCompare(b.stickerId));
}
export async function migrateLegacyStickers(sessionId: string, local: { knowledgeOperation(operation: string, input: Record<string, unknown>): Promise<unknown> }, bridge: VaultKnowledgeBridge, choice?: 'local' | 'vault', request = knowledgeRequest, vaultSelection?: string): Promise<number> {
  const vaultId = selectedVault(bridge, vaultSelection);
  const route = pinKnowledge(bridge, vaultId);
  const frozen = await local.knowledgeOperation('freeze', { sessionId, ...(vaultId ? { vaultId } : {}) }) as { migrationId: string; vaultId?: string; state: LocalStickerState };
  if (frozen.vaultId && frozen.vaultId !== vaultId) throw new Error('请继续使用上次迁移选择的 Vault：' + frozen.vaultId);
  const vault = await route.knowledge('session-freeze', { sessionId, migrationId: frozen.migrationId }) as { vaultId: string; document: SessionNoteDocument };
  if (vaultId && vault.vaultId !== vaultId) throw new Error('迁移 Vault 身份不匹配');
  const stickers = mergeLegacyStickers(frozen.state, vault.document, choice);
  const source = stable({ local: frozen.state, remote: vault.document, stickers });
  const sourceDigest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)))].map(b => b.toString(16).padStart(2,'0')).join('');
  const input: KnowledgeMigration = { migrationId: frozen.migrationId, vaultId: vault.vaultId, nativeSessionId: sessionId, sourceDigest, sourceRevision: vault.document.revision, phase: 'stage', stickers: stickers.map(s => ({ legacyId: s.stickerId, title: (s.quote || s.markdown || '贴纸').slice(0,500), record: JSON.parse(JSON.stringify(s)) })), pendingBacklinkDeletes: JSON.parse(JSON.stringify(frozen.state.pendingBacklinkDeletes)) };
  await request('migrate', input);
  const receipt = await request<{ object: { objectId: string } }>('migrate', { ...input, phase: 'activate' });
  await route.knowledge('session-activate', { sessionId, migrationId: frozen.migrationId, receiptId: receipt.object.objectId });
  await local.knowledgeOperation('activate', { sessionId, migrationId: frozen.migrationId, receiptId: receipt.object.objectId });
  return stickers.length;
}
