import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { createBridgeClient } from "./bridge-client.ts";
import {
  CITATION_REFERENCE_APPEARANCE,
  clearAllSessionReferences,
  createCitationTray,
  createPendingCitationStore,
  createSubmissionResolver,
  registerCitationReferenceSource,
  syncAllSessionReferences,
} from "./composer.tsx";
import { applyDeepLink } from "./deep-link.ts";
import { StickerOverlay } from "./overlay.tsx";
import {
  createStickerSidebarController,
  registerStickerSidebar,
} from "./sticker-sidebar.tsx";
import { createStickerWorkspace, type StickerWorkspace } from "./sticker-workspace.ts";
import type { Context } from "../context-types.ts";
import type { PendingCitation, StickerRecord } from "../protocol.ts";
import "./styles.css";

const BRIDGE_ORIGIN = "__DSH_OBSIDIAN_BRIDGE_ORIGIN__";

export const inject = ["sessions", "slots"];

function StickerBoardRoot(props: {
  ctx: Context;
  workspace: StickerWorkspace;
  openNote: Parameters<typeof StickerOverlay>[0]["onOpenNote"];
  openSticker: (record: StickerRecord) => boolean;
}): ReactNode {
  const sessionList = useSyncExternalStore(
    useCallback((listener: () => void) => props.ctx.sessions.list.subscribe(listener), [props.ctx]),
    () => props.ctx.sessions.list.getSnapshot(),
    () => props.ctx.sessions.list.getSnapshot(),
  );
  useSyncExternalStore(
    useCallback((listener: () => void) => props.workspace.subscribe(listener), [props.workspace]),
    () => props.workspace.getSnapshot(),
    () => props.workspace.getSnapshot(),
  );
  const sessionId = sessionList.current ?? "";
  useEffect(() => {
    if (sessionId) void props.workspace.ensure(sessionId).catch((error) => {
      console.warn("[dsh-session-sticker-board] session-note load failed", error);
    });
  }, [props.workspace, sessionId]);
  if (!sessionId) return null;
  const title = sessionList.byId?.[sessionId]?.title ?? sessionId;
  return (
    <StickerOverlay
      sessionId={sessionId}
      sessionTitle={title}
      stickers={props.workspace.list(sessionId)}
      onSave={(record) => props.workspace.save(record)}
      onDelete={(stickerId) => props.workspace.remove(sessionId, stickerId)}
      onOpenNote={props.openNote}
      onOpenSticker={props.openSticker}
    />
  );
}

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const bridge = createBridgeClient({ origin: BRIDGE_ORIGIN });
    const citations = createPendingCitationStore();
    const stickers = createStickerWorkspace(bridge);
    const stickerSidebar = createStickerSidebarController();
    const sidebarFiber = ctx.inject(["betterSidebar"], (sidebarContext) => {
      const injected = sidebarContext as Context;
      injected.effect(() => {
        stickerSidebar.attach(injected.betterSidebar);
        const unregister = registerStickerSidebar(
          injected,
          stickers,
          (action) => bridge.openNote(action),
          (record) => bridge.listBacklinks(record),
        );
        return () => {
          unregister();
          stickerSidebar.detach(injected.betterSidebar);
        };
      }, "dsh-session-sticker-board: sidebar tab");
    });
    const resolver = createSubmissionResolver({
      store: citations,
      resolveCitation: (citation) => bridge.resolveCitation(citation),
    });
    const unregisterReferenceSource = registerCitationReferenceSource(ctx, citations);
    const hiddenReferenceStyle = document.createElement("style");
    hiddenReferenceStyle.dataset.dshStickerBoardHiddenReference = "";
    hiddenReferenceStyle.textContent = `[data-reference-appearance="${CITATION_REFERENCE_APPEARANCE}"] { visibility: hidden !important; }`;
    document.head.appendChild(hiddenReferenceStyle);

    const overlayHost = document.createElement("div");
    overlayHost.dataset.dshStickerBoard = "";
    document.body.appendChild(overlayHost);
    const root = createRoot(overlayHost);
    root.render(
      <StickerBoardRoot
        ctx={ctx}
        workspace={stickers}
        openNote={(action) => bridge.openNote(action)}
        openSticker={(record) => stickerSidebar.openSticker(record)}
      />,
    );

    const offCitations = citations.subscribe(() => syncAllSessionReferences(ctx, citations));
    const offSlot = ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
      name: "conversation.input.dock",
      id: "dsh-session-sticker-board-citations",
      order: 12,
      registrant: "dsh-session-sticker-board",
    }, createCitationTray(ctx, citations, resolver)));

    const applyAction = async (action: PendingCitation | import("../protocol.ts").DeepLinkAction): Promise<boolean> => {
      if (action.type === "deep-link") {
        await stickers.ensure(action.sessionId).catch(() => undefined);
        const matchingSticker = stickers.list(action.sessionId).find((view) => (
          view.record.anchorId === action.anchorId
          && (!action.quoteHash || view.record.quoteHash === action.quoteHash)
        ));
        const result = await applyDeepLink(ctx, action, {
          ...(matchingSticker ? { quote: matchingSticker.record.quote } : {}),
        });
        if (result.status !== "located") {
          console.warn("[dsh-session-sticker-board] deep-link was not located", result);
        }
        // A DOM miss is usually the one-frame gap after sessions.open(); keep
        // the queue action unacked so the next poll retries it.
        return result.status !== "dom-unavailable";
      }
      const sessionId = ctx.sessions.list.getSnapshot().current;
      if (!sessionId) return false;
      citations.add(sessionId, action);
      return true;
    };
    const polling = bridge.startPolling(applyAction, {
      onError: (error) => console.warn("[dsh-session-sticker-board] Obsidian bridge unavailable", error),
    });

    return () => {
      polling.stop();
      void sidebarFiber.dispose();
      offSlot();
      offCitations();
      clearAllSessionReferences(ctx, citations);
      unregisterReferenceSource();
      bridge.dispose();
      hiddenReferenceStyle.remove();
      setTimeout(() => root.unmount());
      overlayHost.remove();
    };
  }, "dsh-session-sticker-board: client");
}
