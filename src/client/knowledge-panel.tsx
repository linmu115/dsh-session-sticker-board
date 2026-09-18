import { VaultChoice } from './vault-choice.tsx';
import { useEffect, useRef, useState } from 'react';
import { ArchiveRestore, ChevronDown, X } from 'lucide-react';
import { KnowledgeLinks } from './knowledge-links.tsx';
import { migrateLegacyStickers, MigrationConflict } from './knowledge.ts';

type Props = { sessionId: string; local: Parameters<typeof migrateLegacyStickers>[1]; bridge: Parameters<typeof migrateLegacyStickers>[2]; onMigrated(): Promise<void>; onSelectLegacyVault?(vaultId:string):Promise<void> };
export function OrdinaryStickerTools(props: Props) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [migrationConflict, setMigrationConflict] = useState(false);
  const [vaultSelection, setVaultSelection] = useState('');
  const active = useRef(false), panel = useRef<HTMLElement>(null);
  useEffect(() => { const show = () => setOpen(true); window.addEventListener('dsh-ordinary-sticker-tools', show); return () => window.removeEventListener('dsh-ordinary-sticker-tools', show); }, []);
  useEffect(() => { if (!open) return; const previous = document.activeElement as HTMLElement | null; panel.current?.focus(); return () => { if (previous?.isConnected) previous.focus(); }; }, [open]);
  const run = async (task: () => Promise<void>) => { if (active.current) return; active.current = true; setBusy(true); setError(''); try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); if (cause instanceof MigrationConflict) setMigrationConflict(true); } finally { active.current = false; setBusy(false); } };
  const migrate = async (choice?: 'local' | 'vault') => { const count = await migrateLegacyStickers(props.sessionId, props.local, props.bridge, choice, undefined, vaultSelection); await props.onMigrated(); setMigrationConflict(false); setNotice(`已迁移 ${count} 张普通贴纸。`); };
  if (!open) return null;
  return <div className="dsh-knowledge-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) setOpen(false); }}><section className="dsh-knowledge-panel" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="普通贴纸与笔记链接" onKeyDown={event => {
    if (event.key === 'Escape' && !busy) { event.stopPropagation(); setOpen(false); }
    if (event.key === 'Tab') { const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')].filter(el => el.checkVisibility()); const first = items[0], last = items.at(-1); if (!first) { event.preventDefault(); return; } if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
  }}><header className="dsh-knowledge-heading"><h2>普通贴纸与笔记链接</h2><button disabled={busy} aria-label="关闭" onClick={() => setOpen(false)}><X size={18} /></button></header><div className="dsh-knowledge-body">{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      <div className="dsh-knowledge-tools">
      <KnowledgeLinks key={props.sessionId} sessionId={props.sessionId} bridge={props.bridge} />
      <details className="dsh-knowledge-disclosure"><summary><ArchiveRestore size={18} aria-hidden="true" /><span><strong>迁移旧贴纸</strong><small>整理当前会话中的已有贴纸</small></span><ChevronDown className="dsh-knowledge-chevron" size={16} aria-hidden="true" /></summary><div className="dsh-knowledge-disclosure-body"><p className="dsh-knowledge-muted">合并 DSH 和 Obsidian 中的旧贴纸，保留原笔记正文。如有冲突，由你选择保留的版本。</p><VaultChoice bridge={props.bridge} value={vaultSelection} onChange={setVaultSelection} label="旧贴纸所在 Vault" /><button className="dsh-knowledge-outline" disabled={busy || !vaultSelection} onClick={() => void run(async () => { await props.onSelectLegacyVault?.(vaultSelection); setNotice("已保存旧回链的删除目标。请等待目标 Vault 完成同步。"); })}>保存旧回链删除目标</button><button className="dsh-knowledge-outline" disabled={busy || !props.sessionId} onClick={() => void run(() => migrate())}>迁移 / 继续上次迁移</button>{migrationConflict && <div className="dsh-knowledge-conflict"><p>发现内容不同的旧贴纸，请选择保留的版本。</p><div><button className="dsh-knowledge-outline" disabled={busy} onClick={() => void run(() => migrate('local'))}>冲突对象采用 DSH 版本</button><button className="dsh-knowledge-outline" disabled={busy} onClick={() => void run(() => migrate('vault'))}>冲突对象采用 Vault 版本</button></div></div>}</div></details>
      </div>
{busy && <p role="status">正在处理…</p>}</div></section></div>;
}
