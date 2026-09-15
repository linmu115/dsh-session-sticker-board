import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Trash2, X } from 'lucide-react';
import type { GraphSessionIdentity } from '@linmu/dsh-session-contracts';
import type { Context } from '../context-types.ts';
import type { StickerChatSnapshotLike } from './overlay.tsx';
import { resolveRenderedAnchorKey, spreadDotPoint } from './overlay.tsx';
import type { StickerView } from './sticker-store.ts';
import { StickerGeometryCache } from './sticker-geometry.ts';
import { knowledgeRequest } from './knowledge.ts';
import { cleanSourceMarkerBubble, groupSourceMarkers, loadSourceMarkers, resolveSourceMarkerAnchorKey, revokeSourceMarker, SOURCE_MARKERS_CHANGED } from './source-markers.ts';
import type { SourceMarker, SourceMarkerLocalReferences } from './source-markers.ts';

type MarkerMenu = { key: string; mode: 'targets' | 'actions'; point?: { x: number; y: number } };

export function SourceMarkerOverlay({ ctx, sessionId, snapshot, ordinaryStickers = [] }: { ctx: Context; sessionId: string; snapshot: StickerChatSnapshotLike | undefined; ordinaryStickers?: readonly StickerView[] }) {
  const [markers, setMarkers] = useState<SourceMarker[]>([]), [geometryVersion, setGeometryVersion] = useState(0);
  const [menu, setMenu] = useState<MarkerMenu | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const current = useRef(sessionId), requestVersion = useRef(0), navigating = useRef(false);
  const mounted = useRef(false);
  current.current = sessionId;
  const cache = useMemo(() => new StickerGeometryCache(document), [sessionId]);
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = async (preserveOnError = false): Promise<SourceMarker[] | undefined> => {
    const ticket = ++requestVersion.current;
    try {
      const rows = await loadSourceMarkers(sessionId);
      if (!mounted.current || current.current !== sessionId || ticket !== requestVersion.current) return;
      setMarkers(rows);
      return rows;
    } catch (cause) {
      if (!preserveOnError && mounted.current && current.current === sessionId && ticket === requestVersion.current) setMarkers([]);
      throw cause;
    }
  };

  useEffect(() => {
    mounted.current = true;
    setMarkers([]); setMenu(null); setError(''); setBusy(false);
    let disposed = false, pending = false, repeat = false;
    const update = async () => {
      if (disposed || document.visibilityState === 'hidden') return;
      if (pending || navigating.current) { repeat = true; return; }
      pending = true;
      try { await refresh(true); } catch { /* Preserve existing markers on a transient disconnect; every action is verified by authority. */ }
      finally { pending = false; if (repeat && !disposed) { repeat = false; void update(); } }
    };
    const trigger = () => { void update(); };
    trigger();
    window.addEventListener(SOURCE_MARKERS_CHANGED, trigger);
    window.addEventListener('focus', trigger);
    document.addEventListener('visibilitychange', trigger);
    const timer = window.setInterval(trigger, 15000);
    return () => {
      disposed = true; mounted.current = false; requestVersion.current++;
      window.clearInterval(timer);
      window.removeEventListener(SOURCE_MARKERS_CHANGED, trigger);
      window.removeEventListener('focus', trigger);
      document.removeEventListener('visibilitychange', trigger);
    };
  }, [sessionId]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => { frame = 0; setGeometryVersion(version => version + 1); });
    };
    const observer = new MutationObserver(records => { if (cache.processMutations(records)) update(); });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeOldValue: true,
      attributeFilter: ['data-chat-anchor-key', 'class', 'style', 'hidden', 'data-streaming'] });
    cache.clear(); update();
    document.addEventListener('scroll', update, true); window.addEventListener('resize', update);
    return () => { observer.disconnect(); document.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); if (frame) window.cancelAnimationFrame(frame); cache.clear(); };
  }, [cache]);

  const groups = useMemo(() => groupSourceMarkers(markers), [markers]);
  const geometry = useMemo(() => {
    const located = groups.flatMap(group => {
      const renderedAnchorKey = resolveSourceMarkerAnchorKey(snapshot, group.messageId);
      return renderedAnchorKey ? [{ group, renderedAnchorKey, record: { anchorId: group.messageId, quote: group.selectedText, occurrence: group.occurrence } }] : [];
    });
    const rectangles = cache.measure(located, { width: window.innerWidth, height: window.innerHeight });
    const placed: Array<{ x: number; y: number }> = [];
    return located.flatMap((item, index) => {
      const rects = rectangles[index] ?? [];
      if (!rects.length) return [];
      // Reserve the nearer column for ordinary red sticker symbols.
      const point = spreadDotPoint({ x: rects.at(-1)!.right + 31, y: rects[0]!.top + rects[0]!.height / 2 }, placed);
      placed.push(point);
      const alreadyHighlighted = ordinaryStickers.some(({ record }) => snapshot &&
        resolveRenderedAnchorKey(snapshot, record.anchorId) === item.renderedAnchorKey &&
        record.quote === item.group.selectedText && record.occurrence === item.group.occurrence);
      return [{ ...item, rects, point, alreadyHighlighted }];
    });
  }, [groups, snapshot, cache, geometryVersion, ordinaryStickers]);
  const activeMenu = geometry.find(item => item.group.key === menu?.key);
  const menuPoint = menu?.point ?? activeMenu?.point;

  useEffect(() => {
    if (!activeMenu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const close = (event: MouseEvent) => { if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenu(null); };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [activeMenu?.group.key, menu?.mode]);

  const open = async (key: string, targetId?: string) => {
    if (navigating.current) return;
    navigating.current = true; setBusy(true); setError('');
    try {
      const rows = await refresh();
      if (!rows || !mounted.current || current.current !== sessionId) return;
      const group = groupSourceMarkers(rows).find(item => item.key === key);
      const target = targetId ? group?.targets.find(item => item.targetLogicalSessionId === targetId) : group?.targets.length === 1 ? group.targets[0] : undefined;
      if (!group || (targetId && !target)) { setMenu(null); throw new Error('这条来源引用已解除或不可用'); }
      if (!target) { setMenu({ key, mode: 'targets' }); return; }
      const identity = await knowledgeRequest<GraphSessionIdentity>('resolve', { logicalSessionId: target.targetLogicalSessionId });
      if (!mounted.current || current.current !== sessionId) return;
      await ctx.sessions.open(identity.nativeSessionId);
      setMenu(null);
    } catch (cause) { if (mounted.current && current.current === sessionId) setError(cause instanceof Error ? cause.message : '暂时无法打开目标会话'); }
    finally { navigating.current = false; if (mounted.current && current.current === sessionId) setBusy(false); }
  };

  const remove = async (marker: SourceMarker) => {
    if (navigating.current) return;
    navigating.current = true; requestVersion.current++; setBusy(true); setError('');
    let revoked = false;
    const notify = () => window.dispatchEvent(new CustomEvent(SOURCE_MARKERS_CHANGED, { detail: { sessionId, referenceId: marker.referenceId } }));
    try {
      await revokeSourceMarker(sessionId, marker.referenceId);
      revoked = true;
      if (mounted.current && current.current === sessionId) {
        setMarkers(previous => previous.filter(item => item.referenceId !== marker.referenceId));
        setMenu(null);
      }
      notify();
      const core = ctx.get('annotationCore') as SourceMarkerLocalReferences | undefined;
      const cleaned = await cleanSourceMarkerBubble(marker, core);
      if (!cleaned && mounted.current && current.current === sessionId) setError('引用已解除，本地引用气泡暂未同步；请稍后刷新会话。');
    } catch (cause) {
      if (mounted.current && current.current === sessionId) setError(revoked ? '引用已解除，本地引用气泡暂未同步；请稍后刷新会话。' : cause instanceof Error ? cause.message : '删除引用失败，请稍后重试');
    } finally {
      navigating.current = false;
      if (mounted.current && current.current === sessionId) setBusy(false);
      if (revoked) notify();
    }
  };

  return <>
    {geometry.flatMap(({ group, rects, alreadyHighlighted }) => alreadyHighlighted ? [] : rects.map((rect, index) => <span key={group.key + ':' + index}
      className="dsh-sticker-board-highlight dsh-sticker-board-highlight-yellow dsh-source-reference-highlight"
      data-source-marker-group={group.key} style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />))}
    {geometry.map(({ group, point, renderedAnchorKey }) => <button key={group.key} type="button"
      className="dsh-sticker-board-dot dsh-source-reference-dot" disabled={busy}
      data-dsh-source-message-id={group.messageId} data-dsh-sticker-anchor-id={renderedAnchorKey}
      style={{ left: point.x, top: point.y }}
      title={group.targets.length === 1 ? `进入引用会话：${group.targets[0]!.targetTitle}` : `选择引用会话（${group.targets.length}）`}
      aria-label={group.targets.length === 1 ? `进入引用会话：${group.targets[0]!.targetTitle}` : `选择引用会话（${group.targets.length}）`}
      aria-haspopup="menu"
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (!navigating.current) setMenu({ key: group.key, mode: 'actions', point: { x: event.clientX, y: event.clientY } }); }}
      onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); event.stopPropagation(); if (!navigating.current) setMenu({ key: group.key, mode: 'actions' }); } }}
      onClick={event => { event.preventDefault(); event.stopPropagation(); void open(group.key); }}>
      <ArrowUpRight size={12} strokeWidth={2.5} aria-hidden="true" />
    </button>)}
    {activeMenu && menuPoint && <div ref={menuRef} className="dsh-sticker-board-menu dsh-source-reference-menu" role={menu?.mode === 'actions' ? 'menu' : 'dialog'} aria-label={menu?.mode === 'actions' ? '会话引用操作' : '选择引用会话'}
      style={{ left: Math.max(8, Math.min(window.innerWidth - 280, menuPoint.x + 14)), top: Math.max(8, Math.min(window.innerHeight - Math.min(320, window.innerHeight * .6) - 8, menuPoint.y)) }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenu(null); return; }
        if (menu?.mode !== 'actions' || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}>
      {menu?.mode === 'actions' ? <>
        <div className="dsh-sticker-board-menu-title">会话引用</div>
        <button type="button" role="menuitem" disabled={busy} onClick={() => void open(activeMenu.group.key)}><ArrowUpRight size={14} aria-hidden="true" /><span>{activeMenu.group.targets.length === 1 ? '进入会话' : '选择目标会话…'}</span></button>
        <div className="dsh-source-reference-menu-separator" role="separator" />
        {activeMenu.group.references.map(reference => {
          const targetTitle = reference.targetTitle || '未命名会话';
          const sameTitle = activeMenu.group.references.filter(item => (item.targetTitle || '未命名会话') === targetTitle);
          const title = targetTitle + (sameTitle.length > 1 ? `（引用 ${sameTitle.findIndex(item => item.referenceId === reference.referenceId) + 1}）` : '');
          const label = activeMenu.group.references.length === 1 ? '删除引用' : `删除引用：${title}`;
          return <button type="button" role="menuitem" className="dsh-sticker-board-danger" disabled={busy} key={reference.referenceId} title={label}
            onClick={() => void remove(reference)}><Trash2 size={14} aria-hidden="true" /><span>{label}</span></button>;
        })}
      </> : <>
        <div className="dsh-sticker-board-menu-title">选择要进入的会话</div>
        {activeMenu.group.targets.map(target => <button type="button" key={target.targetLogicalSessionId} disabled={busy}
          onClick={() => void open(activeMenu.group.key, target.targetLogicalSessionId)}>{target.targetTitle || '未命名会话'}</button>)}
        <button type="button" onClick={() => setMenu(null)}>关闭</button>
      </>}
    </div>}
    {error && <div className="dsh-sticker-board-menu dsh-source-reference-error" role="alert"><span>{error}</span><button type="button" aria-label="关闭引用提示" onClick={() => setError('')}><X size={14} /></button></div>}
  </>;
}
