import { useEffect, useRef, useState } from 'react';
import type { ExtensionObject, GraphCapture, GraphPreviewPage, GraphSessionIdentity, KnowledgePage, SessionSticker } from '@linmu/dsh-session-contracts';
import type { Context } from '../context-types.ts';
import { knowledgeRequest, migrateLegacyStickers, MigrationConflict } from './knowledge.ts';
import { KnowledgeLinks } from './knowledge-links.tsx';

type Item = { id: string; title: string; logicalSessionId?: string };
type Source = { sessionId: string; anchorId: string; selectedText: string };
type Props = {
  ctx: Context; sessionId: string;
  local: { knowledgeOperation(operation: string, input: Record<string, unknown>): Promise<unknown> };
  bridge: { knowledge(operation: string, input: Record<string, unknown>): Promise<unknown> };
  onMigrated(): Promise<void>;
};
export function KnowledgePanel(props: Props) {
  const [open, setOpen] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [items, setItems] = useState<ExtensionObject[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false), [picker, setPicker] = useState(false), [workspace, setWorkspace] = useState<Item | undefined>();
  const [directory, setDirectory] = useState<Item[]>([]), [directoryCursor, setDirectoryCursor] = useState<string | null>(null);
  const [source, setSource] = useState<Source | undefined>(), [migrationConflict, setMigrationConflict] = useState(false);
  const operation = useRef(crypto.randomUUID()), active = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = async (work: () => Promise<void>) => {
    if (active.current) return; active.current = true; setBusy(true); setError('');
    try { await work(); } catch (e) { if (alive.current) { setError(e instanceof Error ? e.message : String(e)); if (e instanceof MigrationConflict) setMigrationConflict(true); } }
    finally { active.current = false; if (alive.current) setBusy(false); }
  };
  const load = async (after?: string, showDeleted = deleted) => {
    const page = await knowledgeRequest<KnowledgePage>('list', { namespace: 'stickers', deleted: showDeleted ? 'deleted' : 'active', ...(after ? { after } : {}) });
    if (!alive.current) return;
    setItems(previous => after ? [...previous, ...page.items] : page.items); setCursor(page.nextCursor);
  };
  const loadDirectory = async (space?: Item, after?: string) => {
    const page = await knowledgeRequest<{ items: Item[]; nextCursor: string | null }>('directory', { ...(space ? { workspaceId: space.id } : {}), ...(after ? { after } : {}) });
    if (!alive.current) return;
    setDirectory(old => after ? [...old, ...page.items] : page.items); setDirectoryCursor(page.nextCursor); setWorkspace(space);
  };
  useEffect(() => {
    const show = (event: Event) => {
      if (active.current) return;
      const next = (event as CustomEvent<Source | undefined>).detail;
      setOpen(true); setSource(next); setPicker(Boolean(next)); setMigrationConflict(false); operation.current = crypto.randomUUID();
      void run(async () => { await load(); if (next) await loadDirectory(); });
    };
    window.addEventListener('dsh-session-sticker-open', show);
    return () => window.removeEventListener('dsh-session-sticker-open', show);
  }, []);
  const create = async (item?: Item) => {
    const target = await knowledgeRequest<GraphSessionIdentity>(item ? 'resolve' : 'create-session', item ? { logicalSessionId: item.logicalSessionId ?? item.id } : { operationId: operation.current });
    let origin: SessionSticker['source'];
    if (source) {
      const identity = await knowledgeRequest<GraphSessionIdentity>('resolve', { nativeSessionId: source.sessionId });
      const latest = await knowledgeRequest<GraphPreviewPage>('preview', { logicalSessionId: identity.logicalSessionId });
      const preview = await knowledgeRequest<GraphPreviewPage>('preview', { logicalSessionId: identity.logicalSessionId, sourceVersionId: latest.sourceVersionId, sourceAnchorId: source.anchorId });
      const core = props.ctx.get('annotationCore') as { addCrossSessionReference?(targetId: string, capture: GraphCapture & { expectedSourceVersionId: string }, options: { operationId: string }): Promise<{ referenceId: string }> } | undefined;
      if (!core?.addCrossSessionReference) throw new Error('当前注释插件尚未提供跨会话引用');
      const reference = await core.addCrossSessionReference(target.nativeSessionId, { ...preview.capture, selectedText: source.selectedText, expectedSourceVersionId: preview.sourceVersionId }, { operationId: operation.current });
      origin = { logicalSessionId: identity.logicalSessionId, sourceVersionId: preview.sourceVersionId, sourceAnchorId: preview.capture.anchorId, referenceId: reference.referenceId };
    }
    const result = await knowledgeRequest<{ status: string }>('write', { namespace: 'stickers', objectId: 'session-' + operation.current, expectedRevision: 0, title: target.title || '独立会话', body: { kind: 'session', logicalSessionId: target.logicalSessionId, ...(origin ? { source: origin } : {}) } });
    if (result.status === 'conflict') throw new Error('会话贴纸保存冲突，请到扩展面板核对');
    setPicker(false); setSource(undefined); operation.current = crypto.randomUUID(); await load();
    setNotice(source ? '会话贴纸已建立，引用已加入目标会话输入框，发送后参与回答。' : '会话贴纸已建立，点击贴纸进入完整会话。');
  };
  const migrate = async (choice?: 'local' | 'vault') => {
    const count = await migrateLegacyStickers(props.sessionId, props.local, props.bridge, choice);
    setMigrationConflict(false); await props.onMigrated(); await load(); setNotice(`已迁移 ${count} 张贴纸，后续由 Maintenance 保存。`);
  };
  if (!open) return null;
  return <div className="dsh-knowledge-backdrop"><section className="dsh-knowledge-panel" role="dialog" aria-modal="true" aria-label="会话贴纸">
    <header><h2>会话贴纸</h2><button disabled={busy} aria-label="关闭" onClick={() => setOpen(false)}>×</button></header>
    <p>贴纸连接真实会话，点击进入完整会话页。来源引用只在你发送后参与回答。</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {picker ? <>
      <h3>{source ? '从选中回复建立会话贴纸' : '选择贴纸绑定的会话'}</h3>
      {source && <blockquote>{source.selectedText.slice(0,200)}</blockquote>}
      {workspace && <button disabled={busy} onClick={() => void run(() => loadDirectory())}>← 返回工作区</button>}
      <div className="dsh-knowledge-list" onScroll={event => { const el = event.currentTarget; if (directoryCursor && el.scrollHeight - el.scrollTop - el.clientHeight < 60) void run(() => loadDirectory(workspace, directoryCursor)); }}>
        {directory.map(item => <button disabled={busy} key={item.id} onClick={() => void run(() => workspace ? create(item) : loadDirectory(item))}>{item.title}</button>)}
        {directoryCursor && <button disabled={busy} onClick={() => void run(() => loadDirectory(workspace, directoryCursor))}>加载更多</button>}
      </div><footer><button disabled={busy} onClick={() => void run(() => create())}>新建独立会话</button><button disabled={busy} onClick={() => setPicker(false)}>返回贴纸</button></footer>
    </> : <>
      <footer><button disabled={busy} onClick={() => { setSource(undefined); operation.current = crypto.randomUUID(); setPicker(true); void run(() => loadDirectory()); }}>新建 / 挂接会话贴纸</button><button disabled={busy} onClick={() => { setDeleted(!deleted); void run(() => load(undefined, !deleted)); }}>{deleted ? '返回当前对象' : '已删除对象'}</button></footer>
      <div className="dsh-knowledge-list">{items.map(object => {
        const body = object.content.body as { kind: string; logicalSessionId: string };
        return <article key={object.objectId}><small>{body.kind === 'session' ? '会话贴纸' : '注释贴纸'}</small><button disabled={busy || object.deleted} onClick={() => void run(async () => { const current = await knowledgeRequest<ExtensionObject>('get', { namespace: 'stickers', objectId: object.objectId }); if (current.deleted) throw new Error('对象已删除'); const target = await knowledgeRequest<GraphSessionIdentity>('resolve', { logicalSessionId: (current.content.body as { logicalSessionId: string }).logicalSessionId }); await props.ctx.sessions.open(target.nativeSessionId); setOpen(false); })}>{object.content.title}</button><button disabled={busy} onClick={() => void run(async () => { const result = await knowledgeRequest<{ status: string }>('write', { namespace: 'stickers', objectId: object.objectId, expectedRevision: object.revision, title: object.content.title, body: object.content.body, deleted: !object.deleted }); if (result.status === 'conflict') throw new Error('对象已在另一窗口修改'); await load(); })}>{object.deleted ? '恢复对象' : '删除对象'}</button></article>;
      })}{cursor && <button disabled={busy} onClick={() => void run(() => load(cursor))}>加载更多</button>}</div>
      <KnowledgeLinks key={props.sessionId} sessionId={props.sessionId} bridge={props.bridge} />
      <details><summary>迁移当前会话的旧贴纸</summary><p>合并 DSH 和 Vault 中的旧对象，核对回执后改由 Maintenance 保存。原笔记正文保留。</p><button disabled={busy || !props.sessionId} onClick={() => void run(() => migrate())}>迁移 / 继续上次迁移</button>{migrationConflict && <footer><button disabled={busy} onClick={() => void run(() => migrate('local'))}>冲突对象采用 DSH 版本</button><button disabled={busy} onClick={() => void run(() => migrate('vault'))}>冲突对象采用 Vault 版本</button></footer>}</details>
    </>}{busy && <p role="status">正在处理…</p>}
  </section></div>;
}
