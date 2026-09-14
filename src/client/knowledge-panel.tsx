import { useEffect, useRef, useState } from 'react';
import { ArchiveRestore, ArrowLeft, ArrowUpRight, Check, ChevronDown, ChevronRight, CircleAlert, Folder, Loader2, MessageSquare, Plus, RotateCcw, StickyNote, Trash2, X } from 'lucide-react';
import type { ExtensionObject, GraphCapture, GraphPreviewPage, GraphSessionIdentity, KnowledgePage, SessionSticker } from '@linmu/dsh-session-contracts';
import type { Context } from '../context-types.ts';
import { knowledgeRequest, migrateLegacyStickers, MigrationConflict } from './knowledge.ts';
import { KnowledgeLinks } from './knowledge-links.tsx';
import { SOURCE_MARKERS_CHANGED } from './source-markers.ts';

type Item = { id: string; title: string; logicalSessionId?: string };
type Source = { sessionId: string; anchorId: string; selectedText: string; occurrence?: number };
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
  const [creating, setCreating] = useState(false);
  const operation = useRef(crypto.randomUUID()), active = useRef(false), alive = useRef(true);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    const focusGuard = new MutationObserver(() => {
      if (document.activeElement === document.body && panel.current?.isConnected) panel.current.focus();
    });
    if (panel.current) focusGuard.observe(panel.current, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    return () => { focusGuard.disconnect(); if (previous?.isConnected) previous.focus(); };
  }, [open]);
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
  const loadCreateWorkspaces = async (after?: string) => {
    const page = await knowledgeRequest<{ items: Item[]; nextCursor: string | null }>('create-workspaces', after ? { after } : {});
    if (!alive.current) return;
    setDirectory(old => after ? [...old, ...page.items] : page.items); setDirectoryCursor(page.nextCursor); setWorkspace(undefined);
  };
  useEffect(() => {
    const show = (event: Event) => {
      if (active.current) return;
      const next = (event as CustomEvent<Source | undefined>).detail;
      setOpen(true); setSource(next); setPicker(Boolean(next)); setCreating(false); setWorkspace(undefined); setDeleted(false); setError(''); setNotice(''); setMigrationConflict(false); operation.current = crypto.randomUUID();
      void run(async () => { await load(undefined, false); if (next) await loadDirectory(); });
    };
    window.addEventListener('dsh-session-sticker-open', show);
    return () => window.removeEventListener('dsh-session-sticker-open', show);
  }, []);
  const create = async (item?: Item) => {
    if (!item && (!creating || !workspace)) throw new Error('请先选择新会话所在的工作区');
    let prepared: { identity: GraphSessionIdentity; preview: GraphPreviewPage; core: { addCrossSessionReference(targetId: string, capture: GraphCapture & { expectedSourceVersionId: string }, options: { operationId: string }): Promise<{ referenceId: string }> } } | undefined;
    let origin: SessionSticker['source'];
    if (source) {
      if (!source.selectedText.trim() || source.selectedText.length > 4000) throw new Error('请选择 1 至 4000 字的来源选文');
      if (source.occurrence !== undefined && (!Number.isSafeInteger(source.occurrence) || source.occurrence < 0)) throw new Error('来源选区位置无效，请重新选择');
      const identity = await knowledgeRequest<GraphSessionIdentity>('resolve', { nativeSessionId: source.sessionId });
      const latest = await knowledgeRequest<GraphPreviewPage>('preview', { logicalSessionId: identity.logicalSessionId });
      const preview = await knowledgeRequest<GraphPreviewPage>('preview', { logicalSessionId: identity.logicalSessionId, sourceVersionId: latest.sourceVersionId, sourceAnchorId: source.anchorId });
      if (!preview.capture?.messageId || preview.capture.anchorId !== source.anchorId) throw new Error('来源回复尚未完整保存，请重新选择');
      const core = props.ctx.get('annotationCore') as { addCrossSessionReference?(targetId: string, capture: GraphCapture & { expectedSourceVersionId: string }, options: { operationId: string }): Promise<{ referenceId: string }> } | undefined;
      if (!core?.addCrossSessionReference) throw new Error('当前注释插件尚未提供跨会话引用');
      prepared = { identity, preview, core: core as NonNullable<typeof prepared>['core'] };
    }
    const target = await knowledgeRequest<GraphSessionIdentity>(item ? 'resolve' : 'create-session', item ? { logicalSessionId: item.logicalSessionId ?? item.id } : { operationId: operation.current, workspaceId: workspace!.id });
    if (source && prepared) {
      const { identity, preview, core } = prepared;
      const reference = await core.addCrossSessionReference(target.nativeSessionId, { ...preview.capture, selectedText: source.selectedText, expectedSourceVersionId: preview.sourceVersionId }, { operationId: operation.current });
      origin = { logicalSessionId: identity.logicalSessionId, sourceVersionId: preview.sourceVersionId, sourceAnchorId: preview.capture.anchorId, referenceId: reference.referenceId,
        locator: { messageId: preview.capture.messageId, selectedText: source.selectedText, occurrence: source.occurrence ?? 0 } };
    }
    const result = await knowledgeRequest<{ status: string }>('write', { namespace: 'stickers', objectId: 'session-' + operation.current, expectedRevision: 0, title: target.title || '独立会话', body: { kind: 'session', logicalSessionId: target.logicalSessionId, ...(origin ? { source: origin } : {}) } });
    if (result.status === 'conflict') throw new Error('会话贴纸保存冲突，请到扩展面板核对');
    window.dispatchEvent(new Event(SOURCE_MARKERS_CHANGED));
    setPicker(false); setSource(undefined); setDeleted(false); operation.current = crypto.randomUUID(); await load(undefined, false);
    setNotice(source ? '会话贴纸已建立，引用已加入目标会话输入框，发送后参与回答。' : '会话贴纸已建立，点击贴纸进入完整会话。');
    if (source) { await props.ctx.sessions.open(target.nativeSessionId); setOpen(false); }
  };
  const migrate = async (choice?: 'local' | 'vault') => {
    const count = await migrateLegacyStickers(props.sessionId, props.local, props.bridge, choice);
    setMigrationConflict(false); await props.onMigrated(); await load(); setNotice(`已迁移 ${count} 张贴纸，后续由 Maintenance 保存。`);
  };
  if (!open) return null;
  return <div className="dsh-knowledge-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) setOpen(false); }}><section ref={panel} tabIndex={-1} className="dsh-knowledge-panel" role="dialog" aria-modal="true" aria-label="会话贴纸" aria-busy={busy} onKeyDown={event => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    if (event.key === 'Tab') {
      const targets = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]')].filter(element => element.checkVisibility());
      const first = targets[0], last = targets.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }}>
    <header className="dsh-knowledge-heading"><div className="dsh-knowledge-heading-copy"><span className="dsh-knowledge-mark"><StickyNote size={20} aria-hidden="true" /></span><div><h2>会话贴纸</h2><p>把相关对话放在一起，随时继续。</p></div></div><button className="dsh-knowledge-icon" disabled={busy} aria-label="关闭" onClick={() => setOpen(false)}><X size={18} aria-hidden="true" /></button></header>
    <div className="dsh-knowledge-body">
    {error && <div className="dsh-knowledge-feedback is-error" role="alert"><CircleAlert size={16} aria-hidden="true" /><span>{error}</span></div>}{notice && <div className="dsh-knowledge-feedback" role="status"><Check size={16} aria-hidden="true" /><span>{notice}</span></div>}
    {picker ? <>
      <button className="dsh-knowledge-back" disabled={busy} onClick={() => setPicker(false)}><ArrowLeft size={16} aria-hidden="true" />返回贴纸</button>
      <div className="dsh-knowledge-section-title"><h3>{source ? '从这段回复开始' : '添加会话贴纸'}</h3><p>{creating ? '先选择工作区，再新建独立会话。' : '新开一段对话，或选择已有会话。'}</p></div>
      {source && <blockquote className="dsh-knowledge-source">{source.selectedText.slice(0,200)}</blockquote>}
      {!creating && <button className="dsh-knowledge-create" disabled={busy} aria-label="新建独立会话" onClick={() => void run(async () => { await loadCreateWorkspaces(); setCreating(true); })}><span className="dsh-knowledge-create-icon"><Plus size={20} aria-hidden="true" /></span><span><strong>新建独立会话</strong><small>先选择新会话所在的工作区</small></span><ArrowUpRight size={16} aria-hidden="true" /></button>}
      {creating ? <>
        <div className="dsh-knowledge-directory-heading"><button className="dsh-knowledge-back" disabled={busy} onClick={() => void run(async () => { if (workspace) await loadCreateWorkspaces(); else { await loadDirectory(); setCreating(false); } })}><ArrowLeft size={14} aria-hidden="true" />{workspace ? '重新选择工作区' : '选择已有会话'}</button><span>{workspace?.title ?? '选择新会话所在工作区'}</span></div>
        {workspace ? <button className="dsh-knowledge-create" disabled={busy} aria-label="在所选工作区新建会话" onClick={() => void run(() => create())}><span className="dsh-knowledge-create-icon"><Plus size={20} aria-hidden="true" /></span><span><strong>在「{workspace.title}」中新建会话</strong><small>保留所选引用，创建独立会话贴纸</small></span><ArrowUpRight size={16} aria-hidden="true" /></button> : <div className="dsh-knowledge-list dsh-knowledge-directory" onScroll={event => { const el = event.currentTarget; if (directoryCursor && el.scrollHeight - el.scrollTop - el.clientHeight < 60) void run(() => loadCreateWorkspaces(directoryCursor)); }}>
          {directory.map(item => <button className="dsh-knowledge-choice" disabled={busy} key={item.id} aria-label={item.title} onClick={() => setWorkspace(item)}><Folder size={18} aria-hidden="true" /><span>{item.title}</span><ChevronRight size={16} aria-hidden="true" /></button>)}
          {!directory.length && !busy && <p className="dsh-knowledge-muted">暂时没有可用工作区，请先在 DSH 新建工作区。</p>}
          {directoryCursor && <button className="dsh-knowledge-more" disabled={busy} onClick={() => void run(() => loadCreateWorkspaces(directoryCursor))}>加载更多</button>}
        </div>}
      </> : <>
      <div className="dsh-knowledge-directory-heading">{workspace ? <><button className="dsh-knowledge-back" disabled={busy} onClick={() => void run(() => loadDirectory())}><ArrowLeft size={14} aria-hidden="true" />返回工作区</button><span>{workspace.title}</span></> : <span>从工作区选择已有会话</span>}</div>
      <div className="dsh-knowledge-list dsh-knowledge-directory" onScroll={event => { const el = event.currentTarget; if (directoryCursor && el.scrollHeight - el.scrollTop - el.clientHeight < 60) void run(() => loadDirectory(workspace, directoryCursor)); }}>
        {directory.map(item => <button className="dsh-knowledge-choice" disabled={busy} key={item.id} aria-label={item.title} onClick={() => void run(() => workspace ? create(item) : loadDirectory(item))}>{workspace ? <MessageSquare size={18} aria-hidden="true" /> : <Folder size={18} aria-hidden="true" />}<span>{item.title}</span><ChevronRight size={16} aria-hidden="true" /></button>)}
        {!directory.length && !busy && <p className="dsh-knowledge-muted">{workspace ? '这个工作区暂时没有会话。' : '暂时没有可用工作区。'}</p>}
        {directoryCursor && <button className="dsh-knowledge-more" disabled={busy} onClick={() => void run(() => loadDirectory(workspace, directoryCursor))}>加载更多</button>}
      </div>
      </>}
    </> : <>
      <div className="dsh-knowledge-toolbar"><div className="dsh-knowledge-tabs" role="group" aria-label="贴纸视图"><button disabled={busy} aria-pressed={!deleted} onClick={() => { setDeleted(false); void run(() => load(undefined, false)); }}>全部贴纸</button><button disabled={busy} aria-pressed={deleted} onClick={() => { setDeleted(true); void run(() => load(undefined, true)); }}>已删除</button></div><button className="dsh-knowledge-primary" disabled={busy} onClick={() => { setSource(undefined); setCreating(false); operation.current = crypto.randomUUID(); setPicker(true); void run(() => loadDirectory()); }}><Plus size={16} aria-hidden="true" />新建贴纸</button></div>
      <div className="dsh-knowledge-list dsh-knowledge-stickers">{items.map(object => {
        const body = object.content.body as { kind: string; logicalSessionId: string; note?: SessionSticker['note']; noteSelection?: SessionSticker['noteSelection'] };
        const note = body.kind === 'session' ? body.note : undefined;
        const selectedText = Array.from(body.noteSelection?.selectedText ?? '');
        const excerpt = selectedText.slice(0, 240).join('') + (selectedText.length > 240 ? '…' : '');
        return <article className="dsh-knowledge-card" key={object.objectId}><button className="dsh-knowledge-entry" aria-label={object.content.title} disabled={busy || object.deleted} onClick={() => void run(async () => { const current = await knowledgeRequest<ExtensionObject>('get', { namespace: 'stickers', objectId: object.objectId }); if (current.deleted) throw new Error('对象已删除'); const target = await knowledgeRequest<GraphSessionIdentity>('resolve', { logicalSessionId: (current.content.body as { logicalSessionId: string }).logicalSessionId }); await props.ctx.sessions.open(target.nativeSessionId); setOpen(false); })}><span className="dsh-knowledge-entry-icon"><MessageSquare size={18} aria-hidden="true" /></span><span className="dsh-knowledge-entry-copy"><strong title={object.content.title}>{object.content.title}</strong><small>{body.kind === 'session' ? '会话贴纸' : '注释贴纸'}{object.deleted ? ' · 已删除' : ' · 打开完整会话'}</small></span>{!object.deleted && <ArrowUpRight className="dsh-knowledge-entry-arrow" size={16} aria-hidden="true" />}</button><button className="dsh-knowledge-icon" disabled={busy} aria-label={object.deleted ? '恢复对象' : '删除对象'} title={object.deleted ? '恢复贴纸' : '删除贴纸'} onClick={() => void run(async () => { const result = await knowledgeRequest<{ status: string }>('write', { namespace: 'stickers', objectId: object.objectId, expectedRevision: object.revision, title: object.content.title, body: object.content.body, deleted: !object.deleted }); if (result.status === 'conflict') throw new Error('对象已在另一窗口修改'); window.dispatchEvent(new Event(SOURCE_MARKERS_CHANGED)); await load(); })}>{object.deleted ? <RotateCcw size={16} aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}</button>{note && <div className="dsh-knowledge-card-note"><small title={note.notePath}>来源笔记：{note.notePath.split('/').at(-1) || note.notePath}</small>{excerpt && <blockquote>{excerpt}</blockquote>}<div><button className="dsh-knowledge-text-action" disabled={busy || object.deleted} onClick={() => void run(async () => { await props.bridge.knowledge('note-open', { noteId: note.noteId, ...(note.blockId ? { blockId: note.blockId } : {}) }); })}>打开来源笔记</button><span>仅建立关联，不自动送入模型</span></div></div>}</article>;
      })}{!items.length && !busy && <div className="dsh-knowledge-empty"><span><StickyNote size={26} aria-hidden="true" /></span><h3>{deleted ? '没有已删除的贴纸' : '还没有会话贴纸'}</h3><p>{deleted ? '删除的贴纸会出现在这里，可以随时恢复。' : '新建一张贴纸，把相关会话放在手边。'}</p></div>}{cursor && <button className="dsh-knowledge-more" disabled={busy} onClick={() => void run(() => load(cursor))}>加载更多</button>}</div>
      <div className="dsh-knowledge-tools">
      <KnowledgeLinks key={props.sessionId} sessionId={props.sessionId} bridge={props.bridge} />
      <details className="dsh-knowledge-disclosure"><summary><ArchiveRestore size={18} aria-hidden="true" /><span><strong>迁移旧贴纸</strong><small>整理当前会话中的已有贴纸</small></span><ChevronDown className="dsh-knowledge-chevron" size={16} aria-hidden="true" /></summary><div className="dsh-knowledge-disclosure-body"><p className="dsh-knowledge-muted">合并 DSH 和 Obsidian 中的旧贴纸，保留原笔记正文。如有冲突，由你选择保留的版本。</p><button className="dsh-knowledge-outline" disabled={busy || !props.sessionId} onClick={() => void run(() => migrate())}>迁移 / 继续上次迁移</button>{migrationConflict && <div className="dsh-knowledge-conflict"><p>发现内容不同的旧贴纸，请选择保留的版本。</p><div><button className="dsh-knowledge-outline" disabled={busy} onClick={() => void run(() => migrate('local'))}>冲突对象采用 DSH 版本</button><button className="dsh-knowledge-outline" disabled={busy} onClick={() => void run(() => migrate('vault'))}>冲突对象采用 Vault 版本</button></div></div>}</div></details>
      </div>
    </>}{busy && <div className="dsh-knowledge-loading" role="status"><Loader2 className="dsh-knowledge-spinner" size={16} aria-hidden="true" />正在处理…</div>}
    </div><footer className="dsh-knowledge-footnote"><ArrowUpRight size={14} aria-hidden="true" /><span>点击贴纸打开完整会话，来源引用在发送后生效。</span></footer>
  </section></div>;
}
