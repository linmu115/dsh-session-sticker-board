import type { StickerRecord } from "../protocol.ts";

interface SearchCharacter {
  readonly value: string;
  readonly node: Text;
  readonly startOffset: number;
  readonly endOffset: number;
}

function isIgnoredSearchCharacter(value: string): boolean {
  return /[\s\u200b-\u200d\u2060\ufeff]/u.test(value);
}

function normalizedSearchCharacters(root: HTMLElement): SearchCharacter[] {
  const characters: SearchCharacter[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */);
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const node = current as Text;
    const text = node.data;
    let offset = 0;
    for (const value of text) {
      const startOffset = offset;
      offset += value.length;
      if (isIgnoredSearchCharacter(value)) continue;
      // indexOf uses UTF-16 offsets, including for astral characters.
      for (const unit of value.split("")) characters.push({ value: unit, node, startOffset, endOffset: offset });
    }
  }
  return characters;
}

function normalizedSearchText(value: string): string {
  return [...value].filter((character) => !isIgnoredSearchCharacter(character)).join("");
}

export function rangeOfSticker(sticker: StickerRecord, renderedAnchorKey = sticker.anchorId): Range | null {
  try {
    const root = document.querySelector<HTMLElement>(
      `[data-chat-anchor-key="${CSS.escape(renderedAnchorKey)}"]`,
    );
    if (!root || !root.isConnected || !sticker.quote) return null;
    return rangeFromCharacters(root, normalizedSearchCharacters(root), sticker);
  } catch {
    return null;
  }
}

function rangeFromCharacters(root: HTMLElement, characters: SearchCharacter[], sticker: StickerRecord, text = characters.map((character) => character.value).join("")): Range | null {
  try {
    const quote = normalizedSearchText(sticker.quote);
    if (!quote) return null;
    let start = -1;
    let cursor = 0;
    for (let index = 0; index <= sticker.occurrence; index += 1) {
      start = text.indexOf(quote, cursor);
      if (start < 0) return null;
      cursor = start + quote.length;
    }
    const first = characters[start];
    const last = characters[start + quote.length - 1];
    if (!first || !last) return null;
    const range = root.ownerDocument.createRange();
    range.setStart(first.node, first.startOffset);
    range.setEnd(last.node, last.endOffset);
    if (normalizedSearchText(range.toString()) !== quote) return null;
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

const ANCHOR = "[data-chat-anchor-key]";
const OWNED = ".dsh-sticker-board-highlight, .dsh-sticker-board-dot, .dsh-sticker-board-selection-action, .dsh-sticker-board-selection-action-shared, .dsh-sticker-board-editor, .dsh-sticker-board-menu";
interface AnchorGeometry {
  root: HTMLElement | null;
  characters?: SearchCharacter[];
  text?: string;
  ranges: Map<string, Range | null>;
}
export interface StickerGeometryInput { record: StickerRecord; renderedAnchorKey: string }
export interface StickerViewport { width: number; height: number; margin?: number }

function signature(record: StickerRecord): string { return JSON.stringify([record.quote, record.occurrence]); }
function elementOf(node: Node): Element | null { return node.nodeType === 1 ? node as Element : node.parentElement; }
function owned(node: Node): boolean { return Boolean(elementOf(node)?.closest(OWNED)); }
function nearViewport(rect: DOMRect, viewport: StickerViewport): boolean {
  const margin = viewport.margin ?? 160;
  return rect.bottom >= -margin && rect.top <= viewport.height + margin && rect.right >= -margin && rect.left <= viewport.width + margin;
}

/** Cache text/ranges separately from viewport-dependent layout measurements. */
export class StickerGeometryCache {
  private readonly anchors = new Map<string, AnchorGeometry>();
  constructor(private readonly documentLike: Document) {}

  clear(): void { this.anchors.clear(); }

  /** Returns whether external DOM changes may require a new layout pass. */
  processMutations(records: readonly MutationRecord[]): boolean {
    let changed = false;
    const invalidate = (element: Element): void => {
      const key = element.getAttribute("data-chat-anchor-key");
      if (key !== null) this.anchors.delete(key);
    };
    for (const record of records) {
      if (owned(record.target)) continue;
      const nodes = [...record.addedNodes, ...record.removedNodes];
      if (record.type === "childList" && nodes.length > 0 && nodes.every(owned)) continue;
      changed = true;
      const element = elementOf(record.target);
      // Styling affects rects, but does not require searching the message again.
      if (record.type !== "attributes" || record.attributeName === "data-chat-anchor-key") {
        let anchor = element?.closest(ANCHOR) ?? null;
        while (anchor) { invalidate(anchor); anchor = anchor.parentElement?.closest(ANCHOR) ?? null; }
      }
      if (record.attributeName === "data-chat-anchor-key" && record.oldValue !== null) this.anchors.delete(record.oldValue);
      for (const node of nodes) {
        if (node.nodeType !== 1 || owned(node)) continue;
        const subtree = node as Element;
        invalidate(subtree);
        for (const anchor of subtree.querySelectorAll(ANCHOR)) invalidate(anchor);
      }
    }
    return changed;
  }

  measure(inputs: readonly StickerGeometryInput[], viewport: StickerViewport): DOMRect[][] {
    const active = new Map<string, Set<string>>();
    for (const input of inputs) {
      const keys = active.get(input.renderedAnchorKey) ?? new Set<string>();
      keys.add(signature(input.record)); active.set(input.renderedAnchorKey, keys);
    }
    for (const [key, entry] of this.anchors) {
      const ranges = active.get(key);
      if (!ranges) { this.anchors.delete(key); continue; }
      for (const key of entry.ranges.keys()) if (!ranges.has(key)) entry.ranges.delete(key);
    }
    const bounds = new Map<HTMLElement, DOMRect>();
    return inputs.map(({ record, renderedAnchorKey }) => {
      let entry = this.anchors.get(renderedAnchorKey);
      if (!entry || (entry.root && (!entry.root.isConnected || entry.root.dataset.chatAnchorKey !== renderedAnchorKey))) {
        const root = this.documentLike.querySelector<HTMLElement>(`[data-chat-anchor-key="${CSS.escape(renderedAnchorKey)}"]`);
        entry = { root, ranges: new Map() }; this.anchors.set(renderedAnchorKey, entry);
      }
      const root = entry.root;
      if (!root || !root.isConnected) return [];
      let rect = bounds.get(root);
      if (!rect) { rect = root.getBoundingClientRect(); bounds.set(root, rect); }
      if (!nearViewport(rect, viewport)) return [];
      const key = signature(record);
      if (!entry.ranges.has(key)) {
        entry.characters ??= normalizedSearchCharacters(root);
        entry.text ??= entry.characters.map((character) => character.value).join("");
        entry.ranges.set(key, rangeFromCharacters(root, entry.characters, record, entry.text));
      }
      const range = entry.ranges.get(key);
      return range ? rangeRects(range).filter((rect) => nearViewport(rect, viewport)) : [];
    });
  }
}
