// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { StickerOverlay } from "../src/client/overlay.tsx";

it("refuses to persist a new sticker if its message becomes unconfirmed while editing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => ({ left: 10, top: 100, width: 100, height: 20 }) });
  document.body.innerHTML = '<article data-chat-flow-kind="executor-assistant" data-chat-anchor-key="key" data-message-id="m" data-message-role="assistant" data-message-session-id="s" data-message-settled="true"><p>Saved reply</p></article><div id="overlay"></div>';
  const message = document.querySelector<HTMLElement>("article")!;
  const root = createRoot(document.getElementById("overlay")!);
  const save = vi.fn(async () => {});
  try {
    await act(async () => { root.render(<StickerOverlay sessionId="s" sessionTitle="Session" stickers={[]} onSave={save} onDelete={async () => {}} onOpenNote={async () => {}} resolveAnchorId={id => id} resolveAnchorKey={id => id} />); });
    const range = document.createRange(); range.selectNodeContents(message.querySelector("p")!);
    window.getSelection()!.addRange(range);
    await act(async () => { document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); });
    const create = document.querySelector<HTMLButtonElement>(".dsh-sticker-board-selection-action")!;
    expect(create).not.toBeNull();
    await act(async () => { create.click(); await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(document.querySelector('[aria-label="新建贴纸"]')).not.toBeNull();
    message.dataset.messageSettled = "false";
    const saveButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "保存")!;
    await act(async () => { saveButton.click(); });
    expect(save).not.toHaveBeenCalled();
  } finally {
    await act(async () => { root.unmount(); });
    document.body.innerHTML = ""; vi.unstubAllGlobals();
  }
});
