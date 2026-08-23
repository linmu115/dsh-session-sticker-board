import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Quote } from "lucide-react";

import { createMessageAnchor } from "./anchor.ts";
import type { StickerView } from "./sticker-store.ts";
import { PROTOCOL_VERSION, type StickerRecord } from "../protocol.ts";

const MESSAGE_KINDS = new Set(["user", "steering", "assistant-step"]);

export function isEligibleMessageSelection(input: {
  kind: string;
  sameMessage: boolean;
  blank: boolean;
  streaming: boolean;
  excluded: boolean;
  hasSession: boolean;
  hasAnchor: boolean;
}): boolean {
  return MESSAGE_KINDS.has(input.kind)
    && input.sameMessage
    && !input.blank
    && !input.streaming
    && !input.excluded
    && input.hasSession
    && input.hasAnchor;
}

export interface OverlayPoint { x: number; y: number }

export interface SelectionActionPlacement extends OverlayPoint {
  readonly below: boolean;
}

interface RectLike {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const SELECTION_ACTION_HEIGHT = 32;
const SELECTION_ACTION_GAP = 6;

export function placeSelectionAction(
  selectionRect: RectLike,
  sidechatToolbarRect: RectLike | null,
  viewportHeight: number,
): SelectionActionPlacement {
  const left = selectionRect.left + selectionRect.width / 2;
  if (!sidechatToolbarRect) {
    return { x: left, y: Math.max(8, selectionRect.top - 10), below: false };
  }

  const roomAbove = sidechatToolbarRect.top - SELECTION_ACTION_GAP;
  if (roomAbove >= SELECTION_ACTION_HEIGHT + 8) {
    return { x: left, y: roomAbove, below: false };
  }

  return {
    x: left,
    y: Math.min(
      Math.max(8, viewportHeight - SELECTION_ACTION_HEIGHT - 8),
      selectionRect.top + selectionRect.height + SELECTION_ACTION_GAP,
    ),
    below: true,
  };
}

export function spreadDotPoint(point: OverlayPoint, placed: readonly OverlayPoint[]): OverlayPoint {
  let y = point.y;
  while (placed.some((candidate) => Math.abs(candidate.x - point.x) < 18 && Math.abs(candidate.y - y) < 20)) {
    y += 24;
  }
  return { x: point.x, y };
}

export interface MessageSelectionSnapshot {
  readonly sessionId: string;
  readonly anchorId: string;
  readonly role: "user" | "assistant";
  readonly quote: string;
  readonly occurrence: number;
  readonly range: Range;
  readonly rect: { left: number; top: number; width: number; height: number };
}

function messageElement(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element;
  return element?.closest<HTMLElement>("[data-chat-flow-kind]") ?? null;
}

function occurrenceBefore(root: HTMLElement, range: Range, quote: string): number {
  try {
    const prefix = document.createRange();
    prefix.selectNodeContents(root);
    prefix.setEnd(range.startContainer, range.startOffset);
    const text = prefix.toString();
    let occurrence = 0;
    let offset = text.indexOf(quote);
    while (offset >= 0) {
      occurrence += 1;
      offset = text.indexOf(quote, offset + Math.max(1, quote.length));
    }
    return occurrence;
  } catch {
    return 0;
  }
}

export function captureMessageSelection(sessionId: string): MessageSelectionSnapshot | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const start = messageElement(range.startContainer);
  const end = messageElement(range.endContainer);
  const anchor = start?.closest<HTMLElement>("[data-chat-anchor-key]") ?? null;
  const quote = selection.toString();
  const kind = start?.dataset.chatFlowKind ?? "";
  const excluded = start?.closest("[data-dsh-sticker-board]") !== null;
  const eligible = isEligibleMessageSelection({
    kind,
    sameMessage: start !== null && start === end,
    blank: quote.trim() === "",
    streaming: start?.hasAttribute("data-streaming") === true || start?.querySelector("[data-streaming]") !== null,
    excluded,
    hasSession: sessionId !== "",
    hasAnchor: anchor?.dataset.chatAnchorKey !== undefined,
  });
  if (!eligible || !start || !anchor?.dataset.chatAnchorKey) return null;
  const rect = range.getBoundingClientRect();
  return {
    sessionId,
    anchorId: anchor.dataset.chatAnchorKey,
    role: kind === "assistant-step" ? "assistant" : "user",
    quote,
    occurrence: occurrenceBefore(anchor, range, quote),
    range: range.cloneRange(),
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
  };
}

function rangeOfSticker(sticker: StickerRecord): Range | null {
  try {
    const root = document.querySelector<HTMLElement>(
      `[data-chat-anchor-key="${CSS.escape(sticker.anchorId)}"]`,
    );
    if (!root || !root.isConnected || !sticker.quote) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const text = root.textContent ?? "";
    let start = -1;
    let cursor = 0;
    for (let index = 0; index <= sticker.occurrence; index += 1) {
      start = text.indexOf(sticker.quote, cursor);
      if (start < 0) return null;
      cursor = start + Math.max(1, sticker.quote.length);
    }
    const end = start + sticker.quote.length;
    let absolute = 0;
    let startNode: Text | null = null;
    let startOffset = 0;
    let endNode: Text | null = null;
    let endOffset = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0;
      const next = absolute + length;
      if (!startNode && start < next) {
        startNode = node as Text;
        startOffset = start - absolute;
      }
      if (startNode && end <= next) {
        endNode = node as Text;
        endOffset = end - absolute;
        break;
      }
      absolute = next;
    }
    if (!startNode || !endNode) return null;
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  } catch {
    return null;
  }
}

function rangeRects(range: Range): DOMRect[] {
  try {
    return [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
  } catch {
    return [];
  }
}

type StickerDraft = Pick<StickerRecord, "markdown" | "tags" | "color">;

export interface StickerOverlayProps {
  readonly sessionId: string;
  readonly sessionTitle: string;
  readonly stickers: readonly StickerView[];
  readonly onSave: (record: StickerRecord) => Promise<void>;
  readonly onDelete: (stickerId: string) => Promise<void>;
  readonly onOpenNote: StickerCommandDependencies["openNote"];
  readonly onOpenSticker?: (record: StickerRecord) => boolean;
}

interface EditorState {
  readonly record: StickerRecord;
  readonly point: OverlayPoint;
  readonly isNew: boolean;
}

interface MenuState {
  readonly view: StickerView;
  readonly point: OverlayPoint;
}

export class StickerErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: unknown): void {
    console.error("[dsh-session-sticker-board] overlay crashed", error);
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export function StickerOverlay(props: StickerOverlayProps): ReactNode {
  return <StickerErrorBoundary><StickerOverlayInner {...props} /></StickerErrorBoundary>;
}

function StickerOverlayInner(props: StickerOverlayProps): ReactNode {
  const [selection, setSelection] = useState<MessageSelectionSnapshot | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [geometryVersion, setGeometryVersion] = useState(0);

  useEffect(() => {
    let timer = 0;
    const update = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setSelection(captureMessageSelection(props.sessionId)), 80);
    };
    document.addEventListener("selectionchange", update);
    document.addEventListener("mouseup", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("mouseup", update);
      window.clearTimeout(timer);
    };
  }, [props.sessionId]);

  useEffect(() => {
    let frame = 0;
    const update = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setGeometryVersion((version) => version + 1);
      });
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const geometry = useMemo(() => {
    const placed: OverlayPoint[] = [];
    return props.stickers.map((view) => {
      const range = rangeOfSticker(view.record as StickerRecord);
      const rects = range ? rangeRects(range) : [];
      if (!rects.length) return { view, rects, point: null };
      const last = rects.at(-1)!;
      const point = spreadDotPoint({ x: last.right + 7, y: rects[0]!.top + rects[0]!.height / 2 }, placed);
      placed.push(point);
      return { view, rects, point };
    });
  }, [props.stickers, geometryVersion]);

  const selectionAction = useMemo(() => {
    if (!selection) return null;
    const sidechatToolbar = document.querySelector<HTMLElement>(
      '[data-dsh-sidechat] [role="toolbar"]',
    );
    const sidechatRect = sidechatToolbar?.getBoundingClientRect() ?? null;
    return placeSelectionAction(
      selection.rect,
      sidechatRect && sidechatRect.width > 0 && sidechatRect.height > 0 ? sidechatRect : null,
      window.innerHeight,
    );
  }, [selection, geometryVersion]);

  const beginCreate = useCallback(async () => {
    if (!selection) return;
    const anchor = await createMessageAnchor({
      sessionId: selection.sessionId,
      nodeId: selection.anchorId,
      role: selection.role,
      quote: selection.quote,
      occurrence: selection.occurrence,
    });
    const stickerId = crypto.randomUUID();
    setEditor({
      isNew: true,
      point: { x: selection.rect.left + selection.rect.width, y: selection.rect.top },
      record: {
        stickerId,
        sessionId: anchor.sessionId,
        anchorId: anchor.anchorId,
        role: anchor.role,
        quote: anchor.quote,
        quoteHash: anchor.quoteHash,
        occurrence: anchor.occurrence,
        markdown: "",
        tags: [],
        color: "yellow",
        blockId: `dsh-sticker-${stickerId.slice(0, 8)}`,
      },
    });
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }, [selection]);

  const save = async (draft: StickerDraft): Promise<void> => {
    if (!editor) return;
    try {
      setError(null);
      await props.onSave({ ...editor.record, ...draft });
      setEditor(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const commandFor = (view: StickerView) => createStickerCommands(view.record as StickerRecord, {
    sessionTitle: props.sessionTitle,
    clipboard: navigator.clipboard,
    openNote: props.onOpenNote,
    remove: () => props.onDelete(view.record.stickerId),
    confirm: (message) => window.confirm(message),
  });

  return (
    <>
      {selection && selectionAction && !editor && !menu && (
        <button
          type="button"
          className={`dsh-sticker-board-selection-action${selectionAction.below ? " dsh-sticker-board-selection-action-below" : ""}`}
          style={{ left: selectionAction.x, top: selectionAction.y }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void beginCreate()}
        >
          添加贴纸
        </button>
      )}
      {geometry.flatMap(({ view, rects }) => rects.map((rect, index) => (
        <span
          key={`${view.record.stickerId}-highlight-${index}`}
          className={`dsh-sticker-board-highlight dsh-sticker-board-highlight-${view.record.color}`}
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      )))}
      {geometry.map(({ view, point }) => point && point.y >= 0 && point.y <= window.innerHeight ? (
        <button
          key={view.record.stickerId}
          type="button"
          className="dsh-sticker-board-dot"
          data-dsh-sticker-anchor-id={view.record.anchorId}
          style={{ left: point.x, top: point.y }}
          title={`打开贴纸：${view.record.markdown || view.record.quote}`}
          aria-label="打开贴纸"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (props.onOpenSticker?.(view.record as StickerRecord)) {
              setMenu(null);
              setEditor(null);
              return;
            }
            setMenu({ view, point });
            setEditor(null);
          }}
        >
          <Quote size={11} strokeWidth={2.4} aria-hidden="true" />
        </button>
      ) : null)}
      {menu && (
        <StickerMenu
          view={menu.view}
          point={menu.point}
          hasLinkedNote={Boolean(menu.view.record.notePath)}
          onEdit={() => {
            setEditor({ record: menu.view.record as StickerRecord, point: menu.point, isNew: false });
            setMenu(null);
          }}
          onOpen={() => void commandFor(menu.view).openLinkedNote().then(() => setMenu(null))}
          onCopyLink={() => void commandFor(menu.view).copyLogicalLink().then(() => setMenu(null))}
          onCopyMarkdown={() => void commandFor(menu.view).copyReferenceMarkdown().then(() => setMenu(null))}
          onDelete={() => void commandFor(menu.view).deleteSticker().then((deleted) => { if (deleted) setMenu(null); })}
          onClose={() => setMenu(null)}
        />
      )}
      {editor && (
        <StickerEditor
          record={editor.record}
          point={editor.point}
          isNew={editor.isNew}
          error={error}
          onSave={(draft) => void save(draft)}
          onCancel={() => { setEditor(null); setError(null); }}
        />
      )}
    </>
  );
}

function StickerMenu(props: {
  view: StickerView;
  point: OverlayPoint;
  hasLinkedNote: boolean;
  onEdit(): void;
  onOpen(): void;
  onCopyLink(): void;
  onCopyMarkdown(): void;
  onDelete(): void;
  onClose(): void;
}): ReactNode {
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const close = (event: MouseEvent): void => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) props.onClose();
    };
    document.addEventListener("mousedown", close, true);
    return () => document.removeEventListener("mousedown", close, true);
  }, [props]);
  return (
    <div
      ref={root}
      className="dsh-sticker-board-menu"
      style={{ left: Math.min(window.innerWidth - 230, props.point.x + 14), top: Math.min(window.innerHeight - 220, props.point.y - 12) }}
      role="menu"
    >
      <div className="dsh-sticker-board-menu-title">贴纸 {props.view.displayNumber}</div>
      <button type="button" role="menuitem" onClick={props.onEdit}>编辑贴纸</button>
      <button type="button" role="menuitem" disabled={!props.hasLinkedNote} onClick={props.onOpen}>打开关联笔记</button>
      <button type="button" role="menuitem" onClick={props.onCopyLink}>复制笔记链接</button>
      <button type="button" role="menuitem" onClick={props.onCopyMarkdown}>复制引用 Markdown</button>
      <button type="button" role="menuitem" className="dsh-sticker-board-danger" onClick={props.onDelete}>删除引用</button>
    </div>
  );
}

function StickerEditor(props: {
  record: StickerRecord;
  point: OverlayPoint;
  isNew: boolean;
  error: string | null;
  onSave(draft: StickerDraft): void;
  onCancel(): void;
}): ReactNode {
  const [markdown, setMarkdown] = useState(props.record.markdown);
  const [tags, setTags] = useState(props.record.tags.join(", "));
  const [color, setColor] = useState<StickerRecord["color"]>(props.record.color);
  const colors: StickerRecord["color"][] = ["yellow", "green", "pink", "blue"];
  const left = Math.max(8, Math.min(window.innerWidth - 356, props.point.x + 14));
  const top = Math.max(8, Math.min(window.innerHeight - 330, props.point.y - 16));
  return (
    <div className="dsh-sticker-board-editor" style={{ left, top }} role="dialog" aria-label={props.isNew ? "新建贴纸" : "编辑贴纸"}>
      <div className="dsh-sticker-board-editor-title">{props.isNew ? "新建贴纸" : "编辑贴纸"}</div>
      <div className="dsh-sticker-board-quote">{props.record.quote}</div>
      <textarea value={markdown} onChange={(event) => setMarkdown(event.target.value)} placeholder="Markdown 笔记" rows={5} autoFocus />
      <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="标签，以逗号分隔" />
      <div className="dsh-sticker-board-color-row" aria-label="高亮颜色">
        {colors.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={`dsh-sticker-board-swatch dsh-sticker-board-swatch-${candidate}`}
            data-selected={candidate === color ? "true" : "false"}
            title={`${candidate} 高亮`}
            aria-label={`${candidate} 高亮`}
            onClick={() => setColor(candidate)}
          />
        ))}
      </div>
      {props.error && <div className="dsh-sticker-board-error">{props.error}</div>}
      <div className="dsh-sticker-board-editor-actions">
        <button type="button" onClick={props.onCancel}>取消</button>
        <button
          type="button"
          className="dsh-sticker-board-primary"
          onClick={() => props.onSave({
            markdown,
            tags: tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
            color,
          })}
        >
          保存
        </button>
      </div>
    </div>
  );
}

export function buildDshLogicalLink(sticker: StickerRecord): string {
  const query = new URLSearchParams({
    session: sticker.sessionId,
    anchor: sticker.anchorId,
    quoteHash: sticker.quoteHash,
    sticker: sticker.stickerId,
  });
  return `obsidian://deepharness?${query.toString()}`;
}

export function buildReferenceMarkdown(sticker: StickerRecord, sessionTitle: string): string {
  const label = `回到 DSH：${sessionTitle}`;
  return [
    `> [!dsh-reference]`,
    `> [${label}](${buildDshLogicalLink(sticker)})`,
    `> 引用内容：${sticker.quote}`,
    ...(sticker.markdown ? [`> 贴纸：${sticker.markdown}`] : []),
  ].join("\n");
}

export interface StickerCommandDependencies {
  sessionTitle: string;
  clipboard: { writeText(value: string): Promise<void> };
  openNote(action: {
    protocolVersion: 1;
    type: "open-note";
    actionId: string;
    notePath: string;
    blockId?: string;
  }): Promise<void>;
  remove(): Promise<void>;
  confirm(message: string): boolean;
}

export function createStickerCommands(sticker: StickerRecord, dependencies: StickerCommandDependencies) {
  return {
    copyLogicalLink: () => dependencies.clipboard.writeText(
      `[回到 DSH：${dependencies.sessionTitle}](${buildDshLogicalLink(sticker)})`,
    ),
    copyReferenceMarkdown: () => dependencies.clipboard.writeText(
      buildReferenceMarkdown(sticker, dependencies.sessionTitle),
    ),
    async openLinkedNote(): Promise<boolean> {
      if (!sticker.notePath) return false;
      await dependencies.openNote({
        protocolVersion: PROTOCOL_VERSION,
        type: "open-note",
        actionId: crypto.randomUUID(),
        notePath: sticker.notePath,
        ...(sticker.blockId ? { blockId: sticker.blockId } : {}),
      });
      return true;
    },
    async deleteSticker(): Promise<boolean> {
      if (sticker.notePath && !dependencies.confirm("该贴纸已关联 Obsidian 笔记，确认删除引用？")) return false;
      await dependencies.remove();
      return true;
    },
  };
}
