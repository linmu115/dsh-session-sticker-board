import { useState } from 'react';
import type { ExtensionObject, GraphSessionIdentity, KnowledgePage, NoteIdentity } from '@linmu/dsh-session-contracts';
import { knowledgeRequest } from './knowledge.ts';
export function KnowledgeLinks({ sessionId, bridge }: { sessionId: string; bridge: { knowledge(operation: string, input: Record<string, unknown>): Promise<unknown> } }) {
  const [items, setItems] = useState<ExtensionObject[]>([]), [paths, setPaths] = useState<{ notePath: string }[]>([]), [query, setQuery] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [cursor, setCursor] = useState<string | null>(null), [pathCursor, setPathCursor] = useState<string | null>(null);
  const run = async (work: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const target = () => knowledgeRequest<GraphSessionIdentity>('resolve', { nativeSessionId: sessionId });
  const load = async (after?: string) => {
    const identity = await target();
    const page = await knowledgeRequest<KnowledgePage>('list', { namespace: 'obsidian-links', logicalSessionId: identity.logicalSessionId, deleted: 'all', ...(after ? { after } : {}) });
    setItems(old => after ? [...old, ...page.items] : page.items); setCursor(page.nextCursor);
  };
  const search = async (after?: string) => {
    const page = await bridge.knowledge('notes', { query, ...(after ? { after } : {}) }) as { items: { notePath: string }[]; nextCursor: string | null };
    setPaths(old => after ? [...old, ...page.items] : page.items); setPathCursor(page.nextCursor);
  };
  const change = async (object: ExtensionObject, deleted: boolean) => {
    const identity = await target(), body = object.content.body as { kind: string; logicalSessionId: string; note: NoteIdentity };
    if (body.logicalSessionId !== identity.logicalSessionId) throw new Error('当前会话已改变');
    await bridge.knowledge(deleted ? 'link-delete' : 'link-commit', { objectId: object.objectId, notePath: body.note.notePath, ...identity, title: object.content.title });
    const resolved = await bridge.knowledge('note-resolve', { noteId: body.note.noteId }) as NoteIdentity;
    const result = await knowledgeRequest<{ status: string }>('write', { namespace: 'obsidian-links', objectId: object.objectId, expectedRevision: object.revision, title: object.content.title, body: { ...body, note: { ...body.note, ...resolved }, syncState: 'synced' }, deleted });
    if (result.status === 'conflict') throw new Error('链接有并发修改，请在扩展面板核对');
    await load();
  };
  const attach = async (path: string) => {
    const identity = await target(), note = await bridge.knowledge('note-register', { notePath: path }) as NoteIdentity;
    const objectId = 'note-session-' + crypto.randomUUID();
    const result = await knowledgeRequest<{ status: string; object: ExtensionObject }>('write', { namespace: 'obsidian-links', objectId, expectedRevision: 0, title: path, body: { kind: 'note-link', note, logicalSessionId: identity.logicalSessionId, syncState: 'pending' } });
    if (result.status === 'conflict') throw new Error('链接身份冲突');
    await load();
    await change(result.object, false);
    setPaths([]);
  };
  return <details onToggle={e => { if (e.currentTarget.open && !items.length) void run(() => load()); }}><summary>当前会话的 Obsidian 双向链接</summary><p>关联不自动读取笔记正文；解除只操作所选链接。</p>{error && <p role="alert">{error}</p>}<div className="dsh-knowledge-list">{items.map(object => {
    const body = object.content.body as { note: NoteIdentity; syncState: string };
    return <article key={object.objectId}><button disabled={busy || object.deleted} onClick={() => void run(async () => { await bridge.knowledge('note-open', { noteId: body.note.noteId, ...(body.note.blockId ? { blockId: body.note.blockId } : {}) }); })}>{object.content.title}</button><small>{object.deleted ? '已解除' : body.syncState === 'synced' ? '已关联' : '待核对'}</small><button disabled={busy} onClick={() => void run(() => change(object, !object.deleted))}>{object.deleted ? '恢复链接' : '解除此链接'}</button>{!object.deleted && body.syncState !== 'synced' && <button disabled={busy} onClick={() => void run(() => change(object, false))}>重试同步</button>}</article>;
  })}{cursor && <button disabled={busy} onClick={() => void run(() => load(cursor))}>加载更多链接</button>}</div><input aria-label="查找笔记" value={query} onChange={e => setQuery(e.target.value)} placeholder="笔记名称" /><button disabled={busy} onClick={() => void run(() => search())}>查找可关联笔记</button><div className="dsh-knowledge-list">{paths.map(path => <button key={path.notePath} disabled={busy} onClick={() => void run(() => attach(path.notePath))}>{path.notePath} ＋</button>)}{pathCursor && <button disabled={busy} onClick={() => void run(() => search(pathCursor))}>更多笔记</button>}</div></details>;
}
