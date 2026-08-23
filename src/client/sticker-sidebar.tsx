import {
  Copy,
  ExternalLink,
  Link,
  Quote,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import type { BetterSidebarService, Context, SidebarTab, TabComponentProps } from "../context-types.ts";
import { type OpenNoteAction, type StickerRecord } from "../protocol.ts";
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

function stickerPath(stickerId: string): string {
  return `dsh-sticker:${stickerId}`;
}

export function openStickerInSidebar(service: BetterSidebarService, record: StickerRecord): boolean {
  const snapshot = service.getSnapshot();
  if (snapshot.sessionId !== record.sessionId || snapshot.state === undefined) return false;
  if (!service.isTabEnabled(STICKER_DETAIL_TAB_TYPE)) return false;
  if (!service.features.includes("updateTab") || !service.features.includes("tabMeta")) return false;

  const meta: StickerTabMeta = { stickerId: record.stickerId };
  const seed = {
    type: STICKER_DETAIL_TAB_TYPE,
    id: STICKER_DETAIL_TAB_ID,
    title: "贴纸",
    path: stickerPath(record.stickerId),
    meta,
  };
  service.updateTab(STICKER_DETAIL_TAB_ID, { path: seed.path, meta });
  service.openTab(seed, { sessionId: record.sessionId });
  return true;
}

export interface StickerSidebarController {
  attach(service: BetterSidebarService): void;
  detach(service: BetterSidebarService): void;
  openSticker(record: StickerRecord): boolean;
}

export function createStickerSidebarController(): StickerSidebarController {
  let current: BetterSidebarService | null = null;
  return {
    attach(service) { current = service; },
    detach(service) { if (current === service) current = null; },
    openSticker(record) {
      if (current === null) return false;
      try {
        return openStickerInSidebar(current, record);
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
      close={props.close}
    />
  );
}

function StickerDetailForm(props: {
  record: StickerRecord;
  workspace: StickerWorkspace;
  openNote(action: OpenNoteAction): Promise<void>;
  close(): void;
}): ReactNode {
  const [markdown, setMarkdown] = useState(props.record.markdown);
  const [tags, setTags] = useState(props.record.tags.join(", "));
  const [color, setColor] = useState<StickerRecord["color"]>(props.record.color);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const colors: StickerRecord["color"][] = ["yellow", "green", "pink", "blue"];
  const dirty = markdown !== props.record.markdown
    || tags !== props.record.tags.join(", ")
    || color !== props.record.color;

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
        <div className="dsh-sticker-sidebar-actions">
          <button type="button" className="dsh-sticker-sidebar-icon-button" title="重置未保存修改" aria-label="重置未保存修改" disabled={!dirty || phase === "saving"} onClick={reset}><RotateCcw size={15} /></button>
          <button type="button" className="dsh-sticker-sidebar-icon-button" title="打开关联笔记" aria-label="打开关联笔记" disabled={!props.record.notePath} onClick={() => void commands.openLinkedNote()}><ExternalLink size={15} /></button>
          <button type="button" className="dsh-sticker-sidebar-icon-button" title="复制笔记链接" aria-label="复制笔记链接" onClick={() => void commands.copyLogicalLink()}><Link size={15} /></button>
          <button type="button" className="dsh-sticker-sidebar-icon-button" title="复制引用 Markdown" aria-label="复制引用 Markdown" onClick={() => void commands.copyReferenceMarkdown()}><Copy size={15} /></button>
          <button type="button" className="dsh-sticker-sidebar-icon-button dsh-sticker-sidebar-icon-button-danger" title="删除引用" aria-label="删除引用" onClick={() => void commands.deleteSticker().then((deleted) => { if (deleted) props.close(); })}><Trash2 size={15} /></button>
        </div>
      </header>
      <div className="dsh-sticker-sidebar-quote"><Quote size={14} aria-hidden="true" /> {props.record.quote}</div>
      <label className="dsh-sticker-sidebar-field">
        <span>Markdown 笔记</span>
        <textarea value={markdown} onChange={(event) => { setMarkdown(event.target.value); setPhase("idle"); }} placeholder="写下与这段对话相关的长期笔记" />
      </label>
      <label className="dsh-sticker-sidebar-field">
        <span>标签</span>
        <input value={tags} onChange={(event) => { setTags(event.target.value); setPhase("idle"); }} placeholder="标签，以逗号分隔" />
      </label>
      <div className="dsh-sticker-board-color-row" aria-label="高亮颜色">
        {colors.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={`dsh-sticker-board-swatch dsh-sticker-board-swatch-${candidate}`}
            data-selected={candidate === color ? "true" : "false"}
            title={`${candidate} 高亮`}
            aria-label={`${candidate} 高亮`}
            onClick={() => { setColor(candidate); setPhase("idle"); }}
          />
        ))}
      </div>
      <footer className="dsh-sticker-sidebar-footer">
        <span className={`dsh-sticker-sidebar-status${phase === "error" ? " dsh-sticker-sidebar-status-error" : ""}`}>
          {phase === "saving" ? "正在保存..." : phase === "saved" ? "已保存" : phase === "error" ? error : dirty ? "有未保存修改" : "内容已同步"}
        </span>
        <button type="button" className="dsh-sticker-sidebar-save" disabled={!dirty || phase === "saving"} onClick={() => void save()}><Save size={14} />保存</button>
      </footer>
    </section>
  );
}

export function registerStickerSidebar(
  ctx: Context,
  workspace: StickerWorkspace,
  openNote: (action: OpenNoteAction) => Promise<void>,
): () => void {
  return ctx.betterSidebar.registerTab({
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
        close={() => ctx.betterSidebar.closeTab(tab.id, scope)}
      />
    ),
  });
}
