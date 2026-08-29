import type { AnnotationCoreClient } from "dsh-annotation-core/client-api";
import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { BridgeUnavailableError, createBridgeHttpClient } from "../bridge/http-client.ts";
import type { BetterSidebarService, Context } from "../context-types.ts";
import type { OpenNoteAction, StickerRecord } from "../protocol.ts";
import { consumeObsidianReferenceCapture } from "./annotation-consumer.ts";
import { startBridgePolling } from "./bridge-polling.ts";
import { revealConversationSurface } from "./conversation-surface.ts";
import { applyDeepLink } from "./deep-link.ts";
import { StickerOverlay } from "./overlay.tsx";
import { mountStickerRemote } from "./remote.ts";
import {
  createStickerSidebarController,
  registerStickerSidebar,
} from "./sticker-sidebar.tsx";
import { createStickerWorkspace, type StickerWorkspace } from "./sticker-workspace.ts";
import "./styles.css";

const PROFILE_ID = "web";

type SessionOpeningAnnotationCore = Omit<AnnotationCoreClient, "openAnnotationInSession"> & {
  openAnnotationInSession?: (
    sessionId: string,
    setId: string,
    referenceId?: string,
  ) => Promise<boolean>;
};

export const inject = ["sessions", "remote"] as const;

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

function openSourceAction(notePath: string, blockId?: string): OpenNoteAction {
  return {
    protocolVersion: 1,
    type: "open-note",
    actionId: crypto.randomUUID(),
    notePath,
    ...(blockId === undefined ? {} : { blockId }),
  };
}

export function apply(ctx: Context): void {
  ctx.inject(inject, async (injectedContext) => {
    const ready = injectedContext as unknown as Context;
    const mountedRemote = await mountStickerRemote(ready);
    const bridge = createBridgeHttpClient({ origin: mountedRemote.origin });
    try {
      await bridge.preflight();
    } catch (error) {
      if (!(error instanceof BridgeUnavailableError)) {
        bridge.dispose();
        await mountedRemote.dispose();
        throw error;
      }
      console.warn("[dsh-session-sticker-board] Obsidian bridge is offline; saved snapshots remain usable", error);
    }
    const annotationCore = ready.get("annotationCore") as SessionOpeningAnnotationCore | undefined;
    if (annotationCore === undefined) {
      console.warn("[dsh-session-sticker-board] dsh-annotation-core is unavailable; annotation capture is disabled");
    }

    const stickers = createStickerWorkspace(bridge);
    const stickerSidebar = createStickerSidebarController();
    const sidebarFiber = ready.inject(["betterSidebar"], (sidebarContext) => {
      const injected = sidebarContext as unknown as Context;
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

    const unregisterObsidianSource = annotationCore?.registerSourceAdapter("obsidian-note", {
      async openSource(item) {
        if (item.sourceType !== "obsidian-note") throw new TypeError("Expected an Obsidian reference");
        await bridge.openNote(openSourceAction(item.locator.notePath, item.locator.blockId));
      },
    }) ?? (() => undefined);

    const overlayHost = document.createElement("div");
    overlayHost.dataset.dshStickerBoard = "";
    document.body.appendChild(overlayHost);
    const root = createRoot(overlayHost);
    root.render(
      <StickerBoardRoot
        ctx={ready}
        workspace={stickers}
        openNote={(action) => bridge.openNote(action)}
        openSticker={(record) => stickerSidebar.openSticker(record)}
      />,
    );

    const applyAction = async (action: import("../bridge/http-client.ts").BridgeAction): Promise<boolean> => {
      if (action.type === "reference-delete-request") {
        if (annotationCore === undefined || action.profileId !== PROFILE_ID) return false;
        await annotationCore.deleteReferenceLink(action.sessionId, action.setId, action.referenceId);
        return true;
      }
      if (action.type === "reference-capture") {
        if (annotationCore === undefined) return false;
        const sessionId = ready.sessions.list.getSnapshot().current;
        if (!sessionId) return false;
        await consumeObsidianReferenceCapture({
          capture: action,
          sessionId,
          profileId: PROFILE_ID,
          annotationCore,
          bridge,
        });
        return true;
      }
      await stickers.ensure(action.sessionId).catch(() => undefined);
      const matchingSticker = stickers.list(action.sessionId).find((view) => (
        view.record.anchorId === action.anchorId
        && (!action.quoteHash || view.record.quoteHash === action.quoteHash)
      ));
      const result = await applyDeepLink(ready, action, {
        ...(matchingSticker ? { quote: matchingSticker.record.quote } : {}),
        revealConversation: async () => {
          await revealConversationSurface(ready.get("betterSidebar") as BetterSidebarService | undefined);
        },
        ...(annotationCore === undefined ? {} : {
          openAnnotation: async (setId: string, referenceId?: string) => {
            if (typeof annotationCore.openAnnotationInSession === "function") {
              await annotationCore.openAnnotationInSession(action.sessionId, setId, referenceId);
              return;
            }
            annotationCore.openAnnotation(setId, referenceId);
          },
        }),
      });
      if (result.status !== "located") {
        console.warn("[dsh-session-sticker-board] deep-link was not located", result);
      }
      return result.status !== "dom-unavailable";
    };
    const polling = startBridgePolling(bridge, applyAction, {
      onError: (error) => console.warn("[dsh-session-sticker-board] Obsidian bridge unavailable", error),
    });

    ready.effect(() => () => {
      polling.stop();
      void sidebarFiber.dispose();
      unregisterObsidianSource();
      bridge.dispose();
      void mountedRemote.dispose();
      setTimeout(() => root.unmount());
      overlayHost.remove();
    }, "dsh-session-sticker-board: client");
  });
}
