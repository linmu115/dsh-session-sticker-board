import { useState } from 'react';
import { ChevronDown, CircleAlert, FileText, Link2, Loader2, Plus, Search } from 'lucide-react';
import type { ExtensionObject, GraphSessionIdentity, KnowledgePage, NoteIdentity } from '@linmu/dsh-session-contracts';
import { assertMaintenanceSessionAvailable } from 'dsh-obsidian-bridge/api';
import { scopeLinkedNote } from './note-scope.ts';
import { VaultChoice } from './vault-choice.tsx';
import { pinKnowledge, type VaultKnowledgeBridge } from './bridge-channel.ts';
import { knowledgeRequest } from './knowledge.ts';
export function KnowledgeLinks({ sessionId, bridge }: { sessionId: string; bridge: VaultKnowledgeBridge }) {
  const [items, setItems] = useState<ExtensionObject[]>([]), [paths, setPaths] = useState<{ notePath: string; vaultId?: string; vaultName?: string }[]>([]), [query, setQuery] = useState('');
  const [selectedVault, setSelectedVault] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [cursor, setCursor] = useState<string | null>(null), [pathCursor, setPathCursor] = useState<string | null>(null);
  const run = async (work: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const target = async () => { const identity = await knowledgeRequest<GraphSessionIdentity>('resolve', { nativeSessionId: sessionId }); await assertMaintenanceSessionAvailable(identity.logicalSessionId); return identity; };
  const load = async (after?: string) => {
    const identity = await target();
    const page = await knowledgeRequest<KnowledgePage>('list', { namespace: 'obsidian-links', logicalSessionId: identity.logicalSessionId, deleted: 'all', ...(after ? { after } : {}) });
    setItems(old => after ? [...old, ...page.items] : page.items); setCursor(page.nextCursor);
  };
  const search = async (after?: string) => {
    const page = await bridge.knowledge('notes', { query, ...(after ? { after } : {}) }) as { items: { notePath: string; vaultId?: string; vaultName?: string }[]; nextCursor: string | null };
    setPaths(old => after ? [...old, ...page.items] : page.items); setPathCursor(page.nextCursor);
  };
  const change = async (object: ExtensionObject, deleted: boolean) => {
    const identity = await target();
    const scoped = await scopeLinkedNote(object, bridge, selectedVault); object = scoped.object;
    const body = object.content.body as { kind: string; logicalSessionId: string; note: NoteIdentity };
    if (body.logicalSessionId !== identity.logicalSessionId) throw new Error('当前会话已改变');
    await scoped.route.knowledge(deleted ? 'link-delete' : 'link-commit', { objectId: object.objectId, notePath: body.note.notePath, ...identity, title: object.content.title });
    const resolved = await scoped.route.knowledge('note-resolve', { noteId: body.note.noteId }) as NoteIdentity;
    const result = await knowledgeRequest<{ status: string }>('write', { namespace: 'obsidian-links', objectId: object.objectId, expectedRevision: object.revision, title: object.content.title, body: { ...body, note: { ...body.note, ...resolved }, syncState: 'synced' }, deleted });
    if (result.status === 'conflict') throw new Error('链接有并发修改，请在扩展面板核对');
    await load();
  };
  const attach = async (path: string, vaultId?: string) => {
    const identity = await target(), route = pinKnowledge(bridge, vaultId), note = await route.knowledge('note-register', { notePath: path }) as NoteIdentity;
    const objectId = 'note-session-' + crypto.randomUUID();
    const result = await knowledgeRequest<{ status: string; object: ExtensionObject }>('write', { namespace: 'obsidian-links', objectId, expectedRevision: 0, title: path, body: { kind: 'note-link', note, logicalSessionId: identity.logicalSessionId, syncState: 'pending' } });
    if (result.status === 'conflict') throw new Error('链接身份冲突');
    await load();
    await change(result.object, false);
    setPaths([]);
  };
  return <details className="dsh-knowledge-disclosure" onToggle={e => { if (e.currentTarget.open && !items.length) void run(() => load()); }}><summary><Link2 size={18} aria-hidden="true" /><span><strong>Obsidian 双向链接</strong><small>关联当前会话与笔记</small></span><ChevronDown className="dsh-knowledge-chevron" size={16} aria-hidden="true" /></summary><div className="dsh-knowledge-disclosure-body"><p className="dsh-knowledge-muted">打开关联笔记，或把新的笔记连接到当前会话。</p>{error && <div className="dsh-knowledge-feedback is-error" role="alert"><CircleAlert size={16} aria-hidden="true" /><span>{error}</span></div>}<VaultChoice bridge={bridge} value={selectedVault} onChange={setSelectedVault} label="旧关联的目标 Vault" /><div className="dsh-knowledge-list dsh-knowledge-links">{items.map(object => {
    const body = object.content.body as { note: NoteIdentity; syncState: string };
    return <article className="dsh-knowledge-link-row" key={object.objectId}><button className="dsh-knowledge-entry" disabled={busy || object.deleted} onClick={() => void run(async () => { const scoped = await scopeLinkedNote(object, bridge, selectedVault); await scoped.route.knowledge('note-open', { noteId: body.note.noteId, ...(body.note.blockId ? { blockId: body.note.blockId } : {}) }); })}><FileText size={16} aria-hidden="true" /><span className="dsh-knowledge-entry-copy"><strong title={object.content.title}>{object.content.title}</strong><small>{body.note.vaultId ? body.note.vaultId + ' · ' : '待选择 Vault · '}{object.deleted ? '已解除' : body.syncState === 'synced' ? '已关联' : '待核对'}</small></span></button><button className="dsh-knowledge-text-action" disabled={busy} onClick={() => void run(() => change(object, !object.deleted))}>{object.deleted ? '恢复链接' : '解除此链接'}</button>{!object.deleted && body.syncState !== 'synced' && <button className="dsh-knowledge-text-action" disabled={busy} onClick={() => void run(() => change(object, false))}>重试同步</button>}</article>;
  })}{!items.length && !busy && <p className="dsh-knowledge-muted">还没有关联笔记。</p>}{cursor && <button className="dsh-knowledge-more" disabled={busy} onClick={() => void run(() => load(cursor))}>加载更多链接</button>}</div><form className="dsh-knowledge-search" onSubmit={event => { event.preventDefault(); void run(() => search()); }}><label><Search size={16} aria-hidden="true" /><input aria-label="查找笔记" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索笔记名称…" /></label><button type="submit" className="dsh-knowledge-outline" disabled={busy}>查找笔记</button></form><div className="dsh-knowledge-list dsh-knowledge-note-results">{paths.map(path => <button className="dsh-knowledge-choice" aria-label={'关联 ' + path.notePath} key={(path.vaultId ?? '') + ':' + path.notePath} disabled={busy} onClick={() => void run(() => attach(path.notePath, path.vaultId))}><FileText size={16} aria-hidden="true" /><span>{path.notePath}<small>{path.vaultName ?? path.vaultId}</small></span><Plus size={16} aria-hidden="true" /></button>)}{pathCursor && <button className="dsh-knowledge-more" disabled={busy} onClick={() => void run(() => search(pathCursor))}>更多笔记</button>}</div>{busy && <div className="dsh-knowledge-loading" role="status"><Loader2 className="dsh-knowledge-spinner" size={16} aria-hidden="true" />正在处理链接…</div>}</div></details>;
}
