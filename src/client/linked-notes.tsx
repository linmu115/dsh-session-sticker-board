import { useEffect, useRef, useState } from 'react';
import { FileText, Link2, Unlink, ArrowUpRight, Quote, X, Loader2 } from 'lucide-react';
import type { ExtensionObject, GraphSessionIdentity, KnowledgePage } from '@linmu/dsh-session-contracts';
import type { AnnotationCoreClient } from 'dsh-annotation-core/client-api';
import type { Context } from '../context-types.ts';
import { knowledgeRequest } from './knowledge.ts';
import { unlinkNote } from './unlink-note.ts';
import type { StickerBridgeChannel } from './bridge-channel.ts';
import './linked-notes.css';
import { assertMaintenanceSessionAvailable } from 'dsh-obsidian-bridge-lifecycle/api';
import { scopeLinkedNote } from './note-scope.ts';
import { VaultChoice } from './vault-choice.tsx';
import type { VaultKnowledgeBridge } from './bridge-channel.ts';

type Bridge = VaultKnowledgeBridge & Pick<StickerBridgeChannel, 'handoffReference'>;
type NoteBody = { logicalSessionId: string; note: { vaultId?: string; noteId: string; notePath: string; blockId?: string } };

/** The session dock owns this rail: it never follows a floating canvas or another session. */
export function LinkedNotes({ sessionId, ctx, bridge }: { sessionId: string; ctx: Context; bridge: Bridge }) {
  const [items, setItems] = useState<ExtensionObject[]>([]), [selected, setSelected] = useState<string>();
  const [vaultSelection, setVaultSelection] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const active = useRef(false), generation = useRef(0), operation = useRef<string>();
  const pagesShown = useRef(1);
  const mutation = useRef(0);
  useEffect(() => {
    let disposed = false, loading = false;
    const epoch = ++generation.current;
    pagesShown.current = 1;
    setItems([]); setSelected(undefined); setMessage(''); setError(''); setCursor(null);
    const refresh = async () => {
      if (loading || document.visibilityState === 'hidden' || active.current) return;
      loading = true;
      const startedAt = mutation.current;
      try {
        const target = await knowledgeRequest<GraphSessionIdentity>('resolve', { nativeSessionId: sessionId });
        const found: ExtensionObject[] = []; let after: string | null = null;
        for (let pageIndex = 0; pageIndex < pagesShown.current; pageIndex++) {
          const page: KnowledgePage = await knowledgeRequest<KnowledgePage>('list', { namespace: 'obsidian-links', logicalSessionId: target.logicalSessionId, ...(after ? { after } : {}) });
          if (disposed || generation.current !== epoch) return;
          found.push(...page.items); after = page.nextCursor; if (!after) break;
        }
        if (!disposed && generation.current === epoch && startedAt === mutation.current) { setItems(found.filter(item => !item.deleted)); setCursor(after); setError(''); }
      } catch { /* No relation rail in unmanaged/deleted sessions; keep already rendered links on transient disconnect. */ }
      finally { loading = false; }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 3000);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { disposed = true; generation.current++; clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [sessionId]);
  const run = async (work: () => Promise<void>) => {
    if (active.current) return; active.current = true; setBusy(true); setError(''); setMessage('');
    mutation.current++;
    const epoch = generation.current;
    try { await work(); } catch (e) { if (epoch === generation.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { active.current = false; if (epoch === generation.current) setBusy(false); }
  };
  const reference = async (object: ExtensionObject) => {
    const core = (ctx.sessions.scope(sessionId)?.get('annotationCore') ?? ctx.get('annotationCore')) as AnnotationCoreClient | undefined;
    if (!core?.addReference) throw new Error('注释插件尚未就绪');
    const target = await knowledgeRequest<GraphSessionIdentity>('resolve', { nativeSessionId: sessionId });
    await assertMaintenanceSessionAvailable(target.logicalSessionId);
    const current = await knowledgeRequest<ExtensionObject>('get', { namespace: 'obsidian-links', objectId: object.objectId });
    if (current.deleted || (current.content.body as NoteBody).logicalSessionId !== target.logicalSessionId) throw new Error('关联已解除或会话已改变');
    const scoped = await scopeLinkedNote(current, bridge, vaultSelection);
    const requestId = operation.current ??= crypto.randomUUID();
    const status = await knowledgeRequest<{profileId:string}>('status');
    const input = { objectId: object.objectId, operationId: requestId, nativeSessionId: target.nativeSessionId, logicalSessionId: target.logicalSessionId, profileId: status.profileId };
    try {
      await bridge.handoffReference({
        sessionId,
        ...(scoped.vaultId ? { vaultId: scoped.vaultId } : {}),
        operationId: requestId,
        prepare: async () => await scoped.route.knowledge('link-reference-prepare', input) as { referenceId: string; source: Parameters<AnnotationCoreClient['addReference']>[1] },
        commit: async (result) => { await scoped.route.knowledge('link-reference-commit', { ...input, setId: result.setId }); },
        assertCurrent: () => {
          if (ctx.sessions.list.getSnapshot().current !== sessionId) throw new Error('会话已切换，请在目标会话重新引用');
        },
      });
    } catch (e) {
      // Bridge coordinates the handoff; Core owns fencing and compensation.
      operation.current = undefined;
      throw e;
    }
    operation.current = undefined; setMessage('已加入本轮引用，发送消息后参与回答。');
  };
  const unlink = async (object: ExtensionObject) => {
    const epoch = generation.current;
    const target = await knowledgeRequest<GraphSessionIdentity>('resolve', { nativeSessionId: sessionId });
    if (epoch !== generation.current || ctx.sessions.list.getSnapshot().current !== sessionId) throw new Error('会话已切换，请在目标会话解除关联');
    await assertMaintenanceSessionAvailable(target.logicalSessionId);
    await unlinkNote(object.objectId, target, bridge, vaultSelection);
    if (epoch !== generation.current) return;
    setItems(old => old.filter(item => item.objectId !== object.objectId));
    setSelected(undefined); operation.current = undefined;
    setMessage('已解除关联，笔记正文和本轮引用保留。');
  };
  if (!items.length && !error && !message) return null;
  const focused = items.find(i => i.objectId === selected);
  return <div className="dsh-linked-notes" aria-label="当前会话关联笔记">
    <div className="dsh-linked-notes-row"><span className="dsh-linked-notes-label"><Link2 size={13} />关联笔记</span>
      {items.map(item => { const note = (item.content.body as NoteBody).note; return <button key={item.objectId} type="button" className={'dsh-linked-note-chip' + (selected === item.objectId ? ' is-selected' : '')} aria-expanded={selected === item.objectId} title={(note.vaultId ?? '待选择 Vault') + ' · ' + note.notePath} onClick={() => { setSelected(selected === item.objectId ? undefined : item.objectId); setMessage(''); setError(''); operation.current = undefined; }} disabled={busy}><FileText size={13} /><span>{note.vaultId ? note.vaultId + ' · ' : ''}{note.notePath.split('/').at(-1)?.replace(/\.md$/, '')}</span></button>; })}
      {cursor && <button type="button" className="dsh-linked-note-chip" disabled={busy} onClick={() => void run(async () => { const target = await knowledgeRequest<GraphSessionIdentity>('resolve', { nativeSessionId: sessionId }); const page = await knowledgeRequest<KnowledgePage>('list', { namespace: 'obsidian-links', logicalSessionId: target.logicalSessionId, after: cursor }); setItems(old => [...old, ...page.items.filter(i => !old.some(o => o.objectId === i.objectId))]); pagesShown.current++; setCursor(page.nextCursor); })}>更多</button>}
    </div>
    {focused && <section className="dsh-linked-note-detail" aria-label="关联笔记操作"><div><strong>{(focused.content.body as NoteBody).note.notePath}</strong><button type="button" aria-label="收起关联笔记" onClick={() => setSelected(undefined)} disabled={busy}><X size={14} /></button></div>{!(focused.content.body as NoteBody).note.vaultId && <VaultChoice bridge={bridge} value={vaultSelection} onChange={setVaultSelection} label="旧关联的目标 Vault" />}<p>此关联长期保留。引用到本轮后，内容才会随消息交给 AI。</p><div className="dsh-linked-note-actions"><button type="button" disabled={busy} onClick={() => void run(async () => { const scoped = await scopeLinkedNote(focused, bridge, vaultSelection); const note = scoped.note; await scoped.route.knowledge('note-open', { noteId: note.noteId, ...(note.blockId ? { blockId: note.blockId } : {}) }); })}><ArrowUpRight size={14} />在 Obsidian 打开</button><button type="button" disabled={busy} onClick={() => void run(() => reference(focused))}>{busy ? <Loader2 size={14} /> : <Quote size={14} />}引用到本轮</button><button type="button" className="dsh-linked-note-unlink" title="仅解除当前会话与笔记的关联" disabled={busy} onClick={() => void run(() => unlink(focused))}><Unlink size={14} />解除关联</button></div></section>}
    {message && <p role="status" className="dsh-linked-note-message">{message}</p>}{error && <p role="alert" className="dsh-linked-note-error">{error}</p>}
  </div>;
}

export function registerLinkedNotes(ctx: Context, bridge: Bridge): () => void {
  return ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'dsh-linked-notes', order: 15 }, (props: { sessionId: string }) => <LinkedNotes key={props.sessionId} sessionId={String(props.sessionId)} ctx={ctx} bridge={bridge} />));
}

