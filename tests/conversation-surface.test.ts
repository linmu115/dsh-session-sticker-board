import { describe, expect, it, vi } from "vitest";

import { revealConversationSurface } from "../src/client/conversation-surface.ts";

function fixture(panelOpen: boolean) {
  let open = panelOpen;
  const click = vi.fn(() => { open = false; });
  const root = {
    querySelector: vi.fn(() => ({
      querySelectorAll: () => [{ click: vi.fn() }, { click }],
    })),
  } as unknown as Document;
  const sidebar = {
    getSnapshot: () => ({ state: { panelOpen: open } }),
  };
  return { click, root, sidebar };
}

describe("conversation surface reveal", () => {
  it("collapses the currently open Better Sidebar with its rightmost toggle", async () => {
    const input = fixture(true);
    await expect(revealConversationSurface(input.sidebar, input.root)).resolves.toBe(true);
    expect(input.click).toHaveBeenCalledOnce();
  });

  it("does not disturb a conversation that is already visible", async () => {
    const input = fixture(false);
    await expect(revealConversationSurface(input.sidebar, input.root)).resolves.toBe(false);
    expect(input.click).not.toHaveBeenCalled();
    expect(input.root.querySelector).not.toHaveBeenCalled();
  });
});
