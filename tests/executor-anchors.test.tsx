import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { captureMessageSelection, resolveDurableAnchorId, resolveRenderedAnchorKey, resolveSelectionForStickerAction } from "../src/client/overlay.tsx";
import { applyDeepLink } from "../src/client/deep-link.ts";
import { hashQuote } from "../src/client/anchor.ts";
let dom: JSDOM | undefined;
afterEach(() => { vi.unstubAllGlobals(); dom?.window.close(); dom = undefined; });
function documentWith(html: string) {
  dom = new JSDOM(html);
  vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("Node", dom.window.Node); vi.stubGlobal("NodeFilter", dom.window.NodeFilter);
  Object.defineProperty(dom.window.Range.prototype, "getBoundingClientRect", { value: () => ({ left: 10, top: 10, width: 100, height: 20 }) });
  const p = dom.window.document.querySelector("p")!;
  const range = dom.window.document.createRange(); range.selectNodeContents(p);
  dom.window.getSelection()!.addRange(range);
  return { root: p.parentElement!, range };
}
const message = '<article data-chat-flow-kind="executor-assistant" data-chat-anchor-key="executor-key" data-message-id="message-1" data-message-role="assistant" data-message-session-id="session-1" data-message-settled="true"><p>Recorded answer</p></article>';
describe("executor message sticker compatibility", () => {
  it("captures the public message identity and role without renaming its renderer", () => {
    documentWith(message);
    expect(captureMessageSelection("session-1")).toMatchObject({ sessionId: "session-1", anchorId: "message-1", role: "assistant", quote: "Recorded answer" });
  });
  it("rejects unsettled, streaming, excluded, foreign-session and cross-message selections", () => {
    const f = documentWith(message);
    f.root.dataset.messageSettled = "false"; expect(captureMessageSelection("session-1")).toBeNull();
    f.root.dataset.messageSettled = "true"; expect(captureMessageSelection("other-session")).toBeNull();
    f.root.setAttribute("data-streaming", "true"); expect(captureMessageSelection("session-1")).toBeNull(); f.root.removeAttribute("data-streaming");
    f.root.setAttribute("data-dsh-sticker-board", "true"); expect(captureMessageSelection("session-1")).toBeNull(); f.root.removeAttribute("data-dsh-sticker-board");
    document.body.insertAdjacentHTML("beforeend", message.replaceAll("message-1", "message-2"));
    f.range.setEndAfter(document.body.lastElementChild!); expect(captureMessageSelection("session-1")).toBeNull();
  });
  it("rechecks tracked selection settlement instead of reviving a stale create action", () => {
    const f = documentWith(message);
    const tracked = captureMessageSelection("session-1"); expect(tracked).not.toBeNull();
    window.getSelection()!.removeAllRanges();
    expect(resolveSelectionForStickerAction(tracked, "session-1")).toBe(tracked);
    f.root.dataset.messageSettled = "false";
    expect(resolveSelectionForStickerAction(tracked, "session-1")).toBeNull();
  });
  it("retains native message fallback when public metadata is absent", () => {
    documentWith('<article data-chat-flow-kind="assistant-step" data-chat-anchor-key="native-key"><p>Native answer</p></article>');
    expect(captureMessageSelection("session-1")).toMatchObject({ anchorId: "native-key", role: "assistant" });
  });
  it("resolves message ids and old context ids to the same current renderer", () => {
    const node = { key: "executor-key", id: "legacy-item-id", kind: "executor-assistant", data: { item: { messageId: "message-1" }, content: { kind: "assistant", text: "Recorded answer" } } };
    const snapshot = { order: [node.key], nodes: new Map([[node.key, node]]) };
    expect(resolveDurableAnchorId(snapshot, node.key)).toBe("message-1");
    expect(resolveRenderedAnchorKey(snapshot, "message-1")).toBe(node.key);
    expect(resolveRenderedAnchorKey(snapshot, "legacy-item-id")).toBe(node.key);
  });
  it("verifies an external answer quote and deep-links by its public message id", async () => {
    const node = { key: "executor-key", id: "legacy-item-id", kind: "executor-assistant", data: { item: { messageId: "message-1" }, content: { kind: "assistant", text: "Recorded answer" } } };
    const snapshot = { order: [node.key], nodes: new Map([[node.key, node]]) };
    const session = { getSnapshot: () => ({ hasMore: false }), loadOlder: async () => {} };
    const ctx = { sessions: { list: { getSnapshot: () => ({ phase: "ready", current: "session-1", byId: { "session-1": {} } }) }, open: () => {}, binding: () => ({ session }) }, uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => snapshot }) }) } };
    const locate = vi.fn(() => true);
    const result = await applyDeepLink(ctx as never, { protocolVersion: 1, type: "deep-link", actionId: "a", sessionId: "session-1", anchorId: "message-1", quoteHash: await hashQuote("Recorded answer") }, { quote: "Recorded answer", locate });
    expect(result.status).toBe("located"); expect(locate).toHaveBeenCalledWith(node.key);
  });
});

it("scopes the default DOM jump when two session views retain the same inherited anchor", async () => {
  documentWith(message.replaceAll('session-1', 'foreign-session') + message);
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  const [foreign, current] = [...document.querySelectorAll<HTMLElement>("article")];
  foreign!.scrollIntoView = vi.fn(); current!.scrollIntoView = vi.fn();
  const node = { key: "executor-key", id: "old-item", kind: "executor-assistant", data: { item: { messageId: "message-1" }, content: { kind: "assistant", text: "Recorded answer" } } };
  const snapshot = { order: [node.key], nodes: new Map([[node.key, node]]) };
  const session = { getSnapshot: () => ({ hasMore: false }), loadOlder: async () => {} };
  const ctx = { sessions: { list: { getSnapshot: () => ({ phase: "ready", current: "session-1", byId: { "session-1": {} } }) }, open: () => {}, binding: () => ({ session }) }, uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => snapshot }) }) } };
  const result = await applyDeepLink(ctx as never, { protocolVersion: 1, type: "deep-link", actionId: "a", sessionId: "session-1", anchorId: "message-1" });
  expect(result.status).toBe("located"); expect(current!.scrollIntoView).toHaveBeenCalledOnce(); expect(foreign!.scrollIntoView).not.toHaveBeenCalled();
});
