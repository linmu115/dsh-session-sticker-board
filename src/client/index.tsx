import type { AnnotationCoreClient } from "dsh-annotation-core/client-api";
import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { BridgeUnavailableError, createBridgeHttpClient } from "../bridge/http-client.ts";
import type { BetterSidebarService, Context } from "../context-types.ts";
import type { OpenNoteAction, StickerRecord } from "../protocol.ts";
import { consumeObsidianReferenceCapture } from "./annotation-consumer.ts";
import { startBridgePolling } from "./bridge-polling.ts";
import { applyDeepLink } from "./deep-link.ts";
import {
  resolveDurableAnchorId,
  resolveRenderedAnchorKey,
  StickerOverlay,
} from "./overlay.tsx";
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
  const resolveAnchorId = useCallback((renderedKey: string): string => {
    const snapshot = props.ctx.sessions.binding(sessionId)?.session.getSnapshot();
    return snapshot ? resolveDurableAnchorId(snapshot, renderedKey) : renderedKey;
  }, [props.ctx, sessionId]);
  const resolveAnchorKey = useCallback((anchorId: string): string => {
    const snapshot = props.ctx.sessions.binding(sessionId)?.session.getSnapshot();
    return snapshot ? resolveRenderedAnchorKey(snapshot, anchorId) : anchorId;
  }, [props.ctx, sessionId]);
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
      resolveAnchorId={resolveAnchorId}
      resolveAnchorKey={resolveAnchorKey}
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
    let annotationCore: SessionOpeningAnnotationCore | undefined;
    let unregisterObsidianSource = (): void => undefined;
    const annotationFiber = ready.inject(["annotationCore"], (annotationContext) => {
      const injected = annotationContext as unknown as { annotationCore: SessionOpeningAnnotationCore; effect: Context["effect"] };
      injected.effect(() => {
        const service = injected.annotationCore;
        annotationCore = service;
        unregisterObsidianSource = service.registerSourceAdapter("obsidian-note", {
          async openSource(item) {
            if (item.sourceType !== "obsidian-note") throw new TypeError("Expected an Obsidian reference");
            await bridge.openNote(openSourceAction(item.locator.notePath, item.locator.blockId));
          },
        });
        return () => {
          unregisterObsidianSource();
          unregisterObsidianSource = (): void => undefined;
          if (annotationCore === service) annotationCore = undefined;
        };
      }, "dsh-session-sticker-board: annotation core");
    });

    const stickers = createStickerWorkspace(bridge);
    const stickerSidebar = createStickerSidebarController();
    let betterSidebar: BetterSidebarService | undefined;
    const sidebarFiber = ready.inject(["betterSidebar"], (sidebarContext) => {
      const injected = sidebarContext as unknown as Context;
      injected.effect(() => {
        const service = injected.betterSidebar;
        betterSidebar = service;
        stickerSidebar.attach(service);
        const unregister = registerStickerSidebar(
          injected,
          stickers,
          (action) => bridge.openNote(action),
          (record) => bridge.listBacklinks(record),
        );
        return () => {
          unregister();
          stickerSidebar.detach(service);
          if (betterSidebar === service) betterSidebar = undefined;
        };
      }, "dsh-session-sticker-board: sidebar tab");
    });

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
      const core = annotationCore;
      if (action.type === "reference-delete-request") {
        if (core === undefined || action.profileId !== PROFILE_ID) return false;
        await core.deleteReferenceLink(action.sessionId, action.setId, action.referenceId);
        return true;
      }
      if (action.type === "reference-capture") {
        if (core === undefined) return false;
        const sessionId = ready.sessions.list.getSnapshot().current;
        if (!sessionId) return false;
        await consumeObsidianReferenceCapture({
          capture: action,
          sessionId,
          profileId: PROFILE_ID,
          annotationCore: core,
          bridge,
        });
        return true;
      }
      if (action.setId !== undefined && core === undefined) return false;
      const isStickerAction = action.stickerId !== undefined
        || (action.setId === undefined && action.quoteHash !== undefined);
      if (isStickerAction) {
        try {
          await stickers.ensure(action.sessionId);
        } catch (error) {
          console.warn("[dsh-session-sticker-board] sticker deep-link load failed", error);
          return true;
        }
      }
      const matchingSticker = !isStickerAction ? undefined : stickers.list(action.sessionId).find((view) => (
        action.stickerId !== undefined
          ? view.record.stickerId === action.stickerId
          : view.record.anchorId === action.anchorId
            && (!action.quoteHash || view.record.quoteHash === action.quoteHash)
      ));
      if (isStickerAction && matchingSticker === undefined) {
        console.warn("[dsh-session-sticker-board] sticker deep-link target no longer exists", {
          sessionId: action.sessionId,
          stickerId: action.stickerId,
          anchorId: action.anchorId,
        });
        return true;
      }
      const result = await applyDeepLink(ready, action, {
        ...(matchingSticker ? { quote: matchingSticker.record.quote } : {}),
        ...(core === undefined ? {} : {
          openAnnotation: async (setId: string, referenceId?: string) => {
            if (typeof core.openAnnotationInSession === "function") {
              return core.openAnnotationInSession(action.sessionId, setId, referenceId);
            }
            core.openAnnotation(setId, referenceId);
            return true;
          },
        }),
      });
      if (result.status !== "located") {
        console.warn("[dsh-session-sticker-board] deep-link was not located", result);
      }
      // Every parsed deep link is a one-shot UI command. Even a missing DOM or
      // deleted target is terminal; replaying it would reopen the same session.
      return true;
    };
    const polling = startBridgePolling(bridge, applyAction, {
      onError: (error) => console.warn("[dsh-session-sticker-board] Obsidian bridge unavailable", error),
      onActionError: (error, action) => console.warn(
        "[dsh-session-sticker-board] Obsidian bridge action failed",
        { actionId: action.actionId, type: action.type, error },
      ),
    });

    ready.effect(() => () => {
      polling.stop();
      void annotationFiber.dispose();
      void sidebarFiber.dispose();
      unregisterObsidianSource();
      bridge.dispose();
      void mountedRemote.dispose();
      setTimeout(() => root.unmount());
      overlayHost.remove();
    }, "dsh-session-sticker-board: client");
  });
}
