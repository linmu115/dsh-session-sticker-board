import type { BetterSidebarService } from "../context-types.ts";

function pause(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Reveal the native conversation before resolving a deep link. Better Sidebar
 * does not currently publish a collapse command, so this capability is
 * detected from its public snapshot and its stable toggle host. Missing or
 * changed sidebar implementations remain a no-op.
 */
export async function revealConversationSurface(
  sidebar: Pick<BetterSidebarService, "getSnapshot"> | undefined,
  root: Document = document,
): Promise<boolean> {
  if (sidebar?.getSnapshot().state?.panelOpen !== true) return false;

  const cluster = root.querySelector<HTMLElement>("[data-dsh-toggle-cluster]");
  const toggles = cluster === null
    ? []
    : Array.from(cluster.querySelectorAll<HTMLButtonElement>('button:not([aria-disabled="true"])'));
  const panelToggle = toggles.at(-1);
  if (panelToggle === undefined) return false;

  panelToggle.click();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (sidebar.getSnapshot().state?.panelOpen !== true) return true;
    await pause(25);
  }
  return false;
}
