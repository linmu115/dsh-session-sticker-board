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
  // The injected service can briefly report the previous session while DSH is
  // switching sessions. The body attribute is maintained by the mounted
  // sidebar itself, so it is the authoritative visual state for a deep link.
  if (root.body.hasAttribute("data-dsh-sidebar-collapsed")) return false;

  const cluster = root.querySelector<HTMLElement>("[data-dsh-toggle-cluster]");
  const toggles = cluster === null
    ? []
    : Array.from(cluster.querySelectorAll<HTMLButtonElement>('button:not([aria-disabled="true"])'));
  const panelToggle = toggles.at(-1);
  if (panelToggle === undefined) return false;

  panelToggle.click();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (root.body.hasAttribute("data-dsh-sidebar-collapsed")) return true;
    await pause(25);
  }
  return false;
}
