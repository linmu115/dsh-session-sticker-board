import { StickerColorPicker } from './sticker-color-picker.tsx';
import {
  Copy,
  ExternalLink,
  Link,
  Quote,
  RefreshCw,
  RotateCcw,
  Check,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import type { BetterSidebarService, Context, SidebarTab, TabComponentProps } from "../context-types.ts";
import {
  PROTOCOL_VERSION,
  type OpenNoteAction,
  type StickerBacklink,
  type StickerRecord,
} from "../protocol.ts";
import { createStickerCommands } from "./overlay.tsx";
import type { StickerWorkspace } from "./sticker-workspace.ts";

export const STICKER_DETAIL_TAB_TYPE = "dsh-session-sticker-board:detail";
export const STICKER_DETAIL_TAB_ID = "dsh-session-sticker-board:detail";

interface StickerTabMeta {
  stickerId: string;
}

function parseStickerTabMeta(value: unknown): StickerTabMeta | null {
  if (typeof value !== "object" || value === null) return null;
  const stickerId = (value as { stickerId?: unknown }).stickerId;
  return typeof stickerId === "string" && stickerId !== "" ? { stickerId } : null;
}

export function backlinkOpenAction(
  backlink: StickerBacklink,
  createActionId: () => string = () => crypto.randomUUID(),
): OpenNoteAction {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "open-note",
    actionId: createActionId(),
    notePath: backlink.notePath,
    ...(backlink.vaultId ? { vaultId: backlink.vaultId } : {}),
    ...(backlink.blockId ? { blockId: backlink.blockId } : {}),
    line: backlink.line,
    ...(backlink.column !== undefined ? { column: backlink.column } : {}),
  };
}

export async function openStickerInSidebar(service: BetterSidebarService, record: StickerRecord): Promise<boolean> {
  const snapshot = service.getSnapshot();
  if (snapshot.sessionId !== record.sessionId || snapshot.state === undefined) return false;
  if (!service.isTabEnabled(STICKER_DETAIL_TAB_TYPE)) return false;
  if (!service.features.includes("updateTab") || !service.features.includes("tabMeta")) return false;

  const meta: StickerTabMeta = { stickerId: record.stickerId };
  const seed = {
    type: STICKER_DETAIL_TAB_TYPE,
    id: STICKER_DETAIL_TAB_ID,
    title: "贴纸",
    meta,
  };
  if (service.openTabResult && service.listTabInstances && service.updateTabInstance && service.activateTabInstance) {
    const scope = { sessionId: record.sessionId };
    const existing = service.listTabInstances(scope, { type: STICKER_DETAIL_TAB_TYPE })[0];
    const handle = existing?.handle ?? await service.openTabResult(seed, scope);
    if (!service.updateTabInstance(handle, { title: seed.title, meta })) return false;
    return service.activateTabInstance(handle);
  }
  service.updateTab(STICKER_DETAIL_TAB_ID, { meta });
  service.openTab(seed, { sessionId: record.sessionId });
  return true;
}

export interface StickerSidebarController {
  attach(service: BetterSidebarService): void;
  detach(service: BetterSidebarService): void;
  openSticker(record: StickerRecord): Promise<boolean>;
}

export function createStickerSidebarController(): StickerSidebarController {
  let current: BetterSidebarService | null = null;
  return {
    attach(service) { current = service; },
    detach(service) { if (current === service) current = null; },
    async openSticker(record) {
      if (current === null) return false;
      try {
        return await openStickerInSidebar(current, record);
      } catch (error) {
        console.warn("[dsh-session-sticker-board] failed to open sticker sidebar", error);
        return false;
      }
    },
  };
}

function StickerDetailPanel(props: {
  workspace: StickerWorkspace;
  tab: SidebarTab;
  sessionId: string;
  openNote(action: OpenNoteAction): Promise<void>;
  listBacklinks(record: StickerRecord): Promise<StickerBacklink[]>;
  close(): void;
}): ReactNode {
  useSyncExternalStore(
    useCallback((listener: () => void) => props.workspace.subscribe(listener), [props.workspace]),
    () => props.workspace.getSnapshot(),
    () => props.workspace.getSnapshot(),
  );
  useEffect(() => {
    void props.workspace.ensure(props.sessionId).catch((error) => {
      console.warn("[dsh-session-sticker-board] sticker sidebar load failed", error);
    });
  }, [props.workspace, props.sessionId]);

  const stickerId = parseStickerTabMeta(props.tab.meta)?.stickerId;
  const view = stickerId === undefined
    ? undefined
    : props.workspace.list(props.sessionId).find((candidate) => candidate.record.stickerId === stickerId);
  if (!view) {
    return <div className="dsh-sticker-sidebar-empty">贴纸不存在或仍在加载。</div>;
  }
  return (
    <StickerDetailForm
      key={view.record.stickerId}
      record={view.record as StickerRecord}
      workspace={props.workspace}
      openNote={props.openNote}
      listBacklinks={props.listBacklinks}
      close={props.close}
    />
  );
}

export function StickerDetailForm(props: {
  record: StickerRecord;
  workspace: StickerWorkspace;
  openNote(action: OpenNoteAction): Promise<void>;
  listBacklinks(record: StickerRecord): Promise<StickerBacklink[]>;
  close(): void;
}): ReactNode {
  const [vaultSelection, setVaultSelection] = useState("");
  const [markdown, setMarkdown] = useState(props.record.markdown);
  const [tags, setTags] = useState(props.record.tags.join(", "));
  const [color, setColor] = useState<StickerRecord["color"]>(props.record.color);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [backlinks, setBacklinks] = useState<StickerBacklink[]>([]);
  const [backlinkPhase, setBacklinkPhase] = useState<"loading" | "ready" | "error">("loading");
  const [backlinkError, setBacklinkError] = useState("");

  const syncStatus = props.workspace.syncStatus(props.record.sessionId);
  const syncIssue = props.workspace.syncIssue(props.record.sessionId);
  const dirty = markdown !== props.record.markdown
    || tags !== props.record.tags.join(", ")
    || color !== props.record.color;

  // Presentation split. The recovery block carries migration-era controls ("旧贴纸所在
  // Vault" / "保存目标") that only mean something when a write actually failed, so it is
  // limited to the two failed states. "local-only" is also the status before the first
  // sync runs, which is why showing the controls there produced a wall of stray buttons;
  // it keeps only the read-only diagnostics when a sync issue was actually recorded.
  const showsVaultTarget = (syncStatus === "conflict" || syncStatus === "error")
    && props.workspace.selectVault !== undefined
    && (props.workspace.vaults?.().length ?? 0) > 0;
  const showsSyncRecovery = syncStatus === "conflict" || syncStatus === "error"
    || (syncStatus === "local-only" && syncIssue !== undefined);

  const loadBacklinks = useCallback(async (): Promise<void> => {
    setBacklinkPhase("loading");
    setBacklinkError("");
    try {
      setBacklinks(await props.listBacklinks(props.record));
      setBacklinkPhase("ready");
    } catch (reason) {
      setBacklinkError(reason instanceof Error ? reason.message : String(reason));
      setBacklinkPhase("error");
    }
  }, [props.listBacklinks, props.record]);

  useEffect(() => {
    void loadBacklinks();
  }, [loadBacklinks]);

  const reset = (): void => {
    setMarkdown(props.record.markdown);
    setTags(props.record.tags.join(", "));
    setColor(props.record.color);
    setPhase("idle");
    setError("");
  };
  const save = async (): Promise<void> => {
    setPhase("saving");
    setError("");
    try {
      await props.workspace.save({
        ...props.record,
        markdown,
        tags: tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
        color,
      });
      setPhase("saved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setPhase("error");
    }
  };
  const resolveConflict = async (choice: "keep-local" | "use-obsidian"): Promise<void> => {
    setPhase("saving");
    setError("");
    try {
      await props.workspace.resolveConflict(props.record.sessionId, choice);
      const current = props.workspace.list(props.record.sessionId).find((item) => item.record.stickerId === props.record.stickerId);
      if (!current) { props.close(); return; }
      setMarkdown(current.record.markdown);
      setTags(current.record.tags.join(", "));
      setColor(current.record.color);
      setPhase("saved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setPhase("error");
    }
  };
  const commands = createStickerCommands(props.record, {
    sessionTitle: props.record.sessionId,
    clipboard: navigator.clipboard,
    openNote: props.openNote,
    remove: () => props.workspace.remove(props.record.sessionId, props.record.stickerId),
    confirm: (message) => window.confirm(message),
  });

  return (
    <section className="dsh-sticker-sidebar-detail" aria-label="贴纸内容">
      <header className="dsh-sticker-sidebar-heading">
        <h3>贴纸内容</h3>

      </header>
      <div className="dsh-sticker-sidebar-quote"><Quote size={14} aria-hidden="true" /> {props.record.quote}</div>
      <label className="dsh-sticker-sidebar-field">
        <span className="dsh-sticker-sr-only">贴纸正文</span>
        <textarea value={markdown} onChange={(event) => { setMarkdown(event.target.value); setPhase("idle"); }} placeholder="写下与这段对话相关的长期笔记" />
      </label>
      <details className="dsh-sticker-extra"><summary>标签</summary><label className="dsh-sticker-sidebar-field">
        <span className="dsh-sticker-sr-only">标签</span>
        <input value={tags} onChange={(event) => { setTags(event.target.value); setPhase("idle"); }} placeholder="标签，以逗号分隔" />
      </label></details>
      <footer className="dsh-sticker-sidebar-footer"><StickerColorPicker stickerId={props.record.stickerId} value={color} onChange={value => { setColor(value); setPhase("idle"); }} disabled={phase === "saving"} />        <div className="dsh-sticker-sidebar-actions">
          <button type="button" className="dsh-sticker-sidebar-icon-button" title="重置未保存修改" aria-label="重置未保存修改" disabled={!dirty || phase === "saving"} onClick={reset}><RotateCcw size={15} /></button>
          <button type="button" className="dsh-sticker-sidebar-icon-button" title="打开关联笔记" aria-label="打开关联笔记" disabled={!props.record.notePath} onClick={() => void commands.openLinkedNote()}><ExternalLink size={15} /></button>
          <button type="button" className="dsh-sticker-sidebar-icon-button" title="复制笔记链接" aria-label="复制笔记链接" onClick={() => void commands.copyLogicalLink()}><Link size={15} /></button>
          <button type="button" className="dsh-sticker-sidebar-icon-button" title="复制引用 Markdown" aria-label="复制引用 Markdown" onClick={() => void commands.copyReferenceMarkdown()}><Copy size={15} /></button>
          <button type="button" className="dsh-sticker-sidebar-icon-button dsh-sticker-sidebar-icon-button-danger" title="删除引用" aria-label="删除引用" onClick={() => void commands.deleteSticker().then((deleted) => { if (deleted) props.close(); })}><Trash2 size={15} /></button>
        </div>
        <span className={`dsh-sticker-sidebar-status${phase === "error" ? " dsh-sticker-sidebar-status-error" : ""}`}>
          {phase === "saving"
            ? "正在保存到 DSH..."
            : phase === "error"
              ? error
              : dirty
                ? "有未保存修改"
                : syncStatus === "conflict"
                  ? "Obsidian 笔记在同步期间发生修改，请选择要保留的贴纸内容"
                  : syncStatus === "error"
                    ? "已保存到 DSH；Obsidian 同步未完成"
                : syncStatus === "synced"
                  ? "已保存；Obsidian 双链已同步"
                  : syncStatus === "syncing"
                    ? "已保存到 DSH；正在同步 Obsidian 双链"
                    : "已保存到 DSH；Obsidian 双链待连接"}
        </span>
        <button type="button" className="dsh-sticker-sidebar-save" aria-label="保存贴纸" title="保存贴纸" disabled={!dirty || phase === "saving"} onClick={() => void save()}><Check size={17} /></button>
      </footer>
      {showsSyncRecovery && (
        <div className="dsh-sticker-sidebar-sync-recovery" role="status">
          {syncStatus === "conflict" ? <>
            <button type="button" disabled={dirty || phase === "saving"} onClick={() => void resolveConflict("keep-local")}>使用 DSH 贴纸内容</button>
            <button type="button" disabled={dirty || phase === "saving"} onClick={() => void resolveConflict("use-obsidian")}>使用 Obsidian 贴纸内容</button>
          </> : syncStatus === "error" ? <button type="button" onClick={() => void props.workspace.sync(props.record.sessionId)}>重试同步</button> : null}
          {showsVaultTarget && <label>旧贴纸所在 Vault<select aria-label="旧贴纸所在 Vault" value={vaultSelection} onChange={event => setVaultSelection(event.target.value)}><option value="">请选择 Vault</option>{props.workspace.vaults?.().filter(vault => vault.state === 'bound').map(vault => <option key={vault.vaultId} value={vault.vaultId}>{vault.displayName} · {vault.vaultId}</option>)}</select><button disabled={!vaultSelection || phase === 'saving'} onClick={() => { setPhase('saving'); void props.workspace.selectVault!(props.record.sessionId, vaultSelection).then(() => setPhase('saved')).catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)); setPhase('error'); }); }}>保存目标</button></label>}{syncIssue && <details><summary>查看同步详情</summary><p>{syncIssue}</p></details>}
        </div>
      )}
      <section className="dsh-sticker-sidebar-backlinks" aria-label="反向链接">
        <header>
          <h4>反向链接</h4>
          <button
            type="button"
            className="dsh-sticker-sidebar-icon-button"
            title="刷新反向链接"
            aria-label="刷新反向链接"
            disabled={backlinkPhase === "loading"}
            onClick={() => void loadBacklinks()}
          >
            <RefreshCw size={14} />
          </button>
        </header>
        {backlinkPhase === "loading" ? <p className="dsh-sticker-sidebar-backlink-state">正在检查 Obsidian 引用...</p> : null}
        {backlinkPhase === "error" ? <p className="dsh-sticker-sidebar-backlink-state dsh-sticker-sidebar-status-error">{backlinkError}</p> : null}
        {backlinkPhase === "ready" && backlinks.length === 0 ? <p className="dsh-sticker-sidebar-backlink-state">尚无 Obsidian 笔记引用此贴纸。</p> : null}
        {backlinks.length > 0 ? (
          <ul className="dsh-sticker-sidebar-backlink-list">
            {backlinks.map((backlink) => (
              <li key={`${backlink.vaultId ?? ""}:${backlink.notePath}:${backlink.blockId ?? `${backlink.line}:${backlink.column ?? 0}`}`}>
                <button
                  type="button"
                  title={`在 Obsidian 中打开 ${backlink.notePath}`}
                  onClick={() => void props.openNote(backlinkOpenAction(backlink)).catch((reason: unknown) => {
                    setBacklinkError(reason instanceof Error ? reason.message : String(reason));
                    setBacklinkPhase("error");
                  })}
                >
                  <span className="dsh-sticker-sidebar-backlink-title">{backlink.heading ?? backlink.notePath.split("/").at(-1)?.replace(/\.md$/i, "") ?? backlink.notePath}</span>
                  <span className="dsh-sticker-sidebar-backlink-path">{backlink.vaultId ? backlink.vaultId + " · " : ""}{backlink.notePath} · 第 {backlink.line + 1} 行</span>
                  <span className="dsh-sticker-sidebar-backlink-excerpt">{backlink.excerpt}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </section>
  );
}

export function registerStickerSidebar(
  ctx: Context,
  workspace: StickerWorkspace,
  openNote: (action: OpenNoteAction) => Promise<void>,
  listBacklinks: (record: StickerRecord) => Promise<StickerBacklink[]>,
): () => void {
  const unregisterDetail = ctx.betterSidebar.registerTab({
    id: STICKER_DETAIL_TAB_TYPE,
    title: "贴纸",
    icon: (size) => <Quote size={size} />,
    order: 65,
    hidden: true,
    single: true,
    component: ({ tab, scope }: TabComponentProps) => (
      <StickerDetailPanel
        workspace={workspace}
        tab={tab}
        sessionId={scope.sessionId}
        openNote={openNote}
        listBacklinks={listBacklinks}
        close={() => ctx.betterSidebar.closeTab(tab.id, scope)}
      />
    ),
  });
  return unregisterDetail;
}
