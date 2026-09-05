import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { StickerGeometryCache, rangeOfSticker } from "../src/client/sticker-geometry.ts";
import type { StickerRecord } from "../src/protocol.ts";

let dom: JSDOM;
let document: Document;
let cache: StickerGeometryCache;
let observer: MutationObserver;
let trees: ReturnType<typeof vi.spyOn>;
let ranges: ReturnType<typeof vi.spyOn>;
let rectReads: ReturnType<typeof vi.fn>;
const viewport = { width: 1000, height: 800, margin: 100 };
const bounds = new Map<Element, number>();
const previousCss = globalThis.CSS;
const previousDocument = globalThis.document;

function record(key: string, quote = "quoted"): StickerRecord {
  return { stickerId: key, sessionId: "session", anchorId: key, quote, occurrence: 0,
    role: "user", quoteHash: "sha256:abc", markdown: "", tags: [], color: "yellow" };
}
function input(key: string, quote = "quoted") { return { record: record(key, quote), renderedAnchorKey: key }; }
function anchor(key: string, top = 20, text = "prefix quoted suffix") {
  const node = document.createElement("article"); node.dataset.chatAnchorKey = key; node.textContent = text;
  bounds.set(node, top); document.body.append(node); return node;
}
function process() { return cache.processMutations(observer.takeRecords()); }

beforeEach(() => {
  dom = new JSDOM("<body></body>"); document = dom.window.document;
  Object.assign(globalThis, { CSS: { escape: (key: string) => key }, document });
  bounds.clear();
  vi.spyOn(dom.window.HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return new dom.window.DOMRect(10, bounds.get(this) ?? 20, 200, 30);
  });
  rectReads = vi.fn(function (this: Range) {
    const element = this.startContainer.parentElement?.closest("[data-chat-anchor-key]");
    return [new dom.window.DOMRect(20, element ? bounds.get(element) ?? 20 : 20, 80, 20)];
  });
  Object.defineProperty(dom.window.Range.prototype, "getClientRects", { configurable: true, value: rectReads });
  trees = vi.spyOn(document, "createTreeWalker"); ranges = vi.spyOn(document, "createRange");
  cache = new StickerGeometryCache(document);
  observer = new dom.window.MutationObserver(() => {});
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true });
});
afterEach(() => {
  observer.disconnect(); cache.clear(); vi.restoreAllMocks(); dom.window.close();
  Object.assign(globalThis, { CSS: previousCss, document: previousDocument });
});

describe("sticker geometry cache", () => {
  it.each([50, 200, 500])("searches and measures only near-viewport ranges among %i anchors", (count) => {
    const inputs = Array.from({ length: count }, (_, i) => { anchor(String(i), i < 10 ? 20 : 5000); return input(String(i)); });
    process();
    expect(cache.measure(inputs, viewport).filter(rects => rects.length)).toHaveLength(10);
    expect(trees).toHaveBeenCalledTimes(10); expect(ranges).toHaveBeenCalledTimes(10); expect(rectReads).toHaveBeenCalledTimes(10);
    cache.measure(inputs, viewport); // scroll/resize pass: layout reads, no text search or range reconstruction
    expect(trees).toHaveBeenCalledTimes(10); expect(ranges).toHaveBeenCalledTimes(10); expect(rectReads).toHaveBeenCalledTimes(20);
  });

  it("shares normalized text between stickers on an anchor and retains ranges across unrelated mutations", () => {
    anchor("a"); anchor("b"); process();
    const inputs = [input("a"), input("a", "suffix"), input("b")];
    cache.measure(inputs, viewport);
    expect(trees).toHaveBeenCalledTimes(2); expect(ranges).toHaveBeenCalledTimes(3);
    const unrelated = document.createElement("aside"); unrelated.textContent = "other panel"; document.body.append(unrelated);
    expect(process()).toBe(true); cache.measure(inputs, viewport);
    expect(trees).toHaveBeenCalledTimes(2); expect(ranges).toHaveBeenCalledTimes(3);
  });

  it("invalidates only changed message content, and reuses text for edited sticker quotes", () => {
    const a = anchor("a"); anchor("b"); process();
    cache.measure([input("a"), input("b")], viewport);
    (a.firstChild as Text).data = "changed quoted suffix"; expect(process()).toBe(true);
    cache.measure([input("a"), input("b")], viewport);
    expect(trees).toHaveBeenCalledTimes(3); expect(ranges).toHaveBeenCalledTimes(3);
    cache.measure([input("a", "suffix"), input("b")], viewport);
    expect(trees).toHaveBeenCalledTimes(3); expect(ranges).toHaveBeenCalledTimes(4);
    a.style.marginTop = "10px"; process(); cache.measure([input("a", "suffix"), input("b")], viewport);
    expect(trees).toHaveBeenCalledTimes(3);
  });

  it("rebuilds detached/remounted and rekeyed anchors, including previously missing anchors", () => {
    let a = anchor("a"); process(); cache.measure([input("a")], viewport);
    a.remove(); process(); expect(cache.measure([input("a")], viewport)).toEqual([[]]);
    a = anchor("a", 30); process(); expect(cache.measure([input("a")], viewport)[0]?.[0]?.top).toBe(30);
    a.dataset.chatAnchorKey = "b"; process();
    expect(cache.measure([input("a"), input("b")], viewport).map(rects => rects.length)).toEqual([0, 1]);
    expect(trees).toHaveBeenCalledTimes(3);
  });

  it("defers offscreen search until visible, filters range rects, and drops inactive caches on cleanup", () => {
    const a = anchor("a", 5000); process(); expect(cache.measure([input("a")], viewport)).toEqual([[]]);
    expect(trees).not.toHaveBeenCalled(); expect(rectReads).not.toHaveBeenCalled();
    bounds.set(a, 20); expect(cache.measure([input("a")], viewport)[0]).toHaveLength(1);
    rectReads.mockReturnValueOnce([new dom.window.DOMRect(20, 5000, 80, 20)]);
    expect(cache.measure([input("a")], viewport)).toEqual([[]]);
    cache.measure([], viewport); cache.measure([input("a")], viewport); expect(trees).toHaveBeenCalledTimes(2);
    cache.clear(); cache.measure([input("a")], viewport); expect(trees).toHaveBeenCalledTimes(3);
  });

  it("ignores its own highlights, menu content and shared-toolbar action changes", () => {
    anchor("a"); process(); cache.measure([input("a")], viewport);
    const highlight = document.createElement("span"); highlight.className = "dsh-sticker-board-highlight";
    document.body.append(highlight); expect(process()).toBe(false);
    highlight.style.left = "2px"; expect(process()).toBe(false);
    const menu = document.createElement("div"); menu.className = "dsh-sticker-board-menu";
    document.body.append(menu); process(); menu.textContent = "editor text"; expect(process()).toBe(false);
    const toolbar = document.createElement("div"); document.body.append(toolbar); process();
    const action = document.createElement("button"); action.className = "dsh-sticker-board-selection-action-shared";
    toolbar.append(action); expect(process()).toBe(false); action.remove(); expect(process()).toBe(false);
    cache.measure([input("a")], viewport); expect(trees).toHaveBeenCalledTimes(1);
  });

  it("preserves Unicode quotes and repeated occurrence identity", () => {
    anchor("a", 20, "😀 quoted 😀 quoted");
    expect(rangeOfSticker(record("a", "😀 quoted"))?.toString()).toBe("😀 quoted");
    const repeated = rangeOfSticker({ ...record("a", "😀 quoted"), occurrence: 1 });
    expect(repeated?.toString()).toBe("😀 quoted"); expect(repeated?.startOffset).toBe(10);
  });
});
