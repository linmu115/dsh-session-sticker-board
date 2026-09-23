import type { ObsidianBridgeLifecycle } from "dsh-obsidian-bridge/api";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import type { BetterSidebarService, Context } from "../context-types.ts";
import type { StickerRecord } from "../protocol.ts";
import { createStickerBridgeChannel } from './bridge-channel.ts';
import { applyDeepLink } from "./deep-link.ts";
import { matchesRuntimeScope } from "./runtime-scope.ts";
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

// Ordinary Sticker UI is available only with all three feature providers.
// Cordis waits for late services and disposes the mounted fiber when any leaves.
export const inject = ["sessions", "remote", "uiConversation", "annotationCore", "obsidianBridgeLifecycle"] as const;

function StickerBoardRoot(props: {
  ctx: Context;
  workspace: StickerWorkspace;
  openNote: Parameters<typeof StickerOverlay>[0]["onOpenNote"];
  openSticker: (record: StickerRecord) => boolean | Promise<boolean>;
  resolveLogicalLocation: NonNullable<Parameters<typeof StickerOverlay>[0]["resolveLogicalLocation"]>;
}): ReactNode {
  const [selectionActions, setSelectionActions] = useState<Parameters<typeof StickerOverlay>[0]['selectionActions']>();
  useEffect(() => {
    const fiber = props.ctx.inject(['annotationCore'], ready => {
      const core = ready.get('annotationCore') as NonNullable<Parameters<typeof StickerOverlay>[0]['selectionActions']> | undefined;
      ready.effect(() => {
        if (core?.registerSelectionAction) setSelectionActions(core);
        return () => setSelectionActions(undefined);
      }, 'stickers: native selection action availability');
    });
    return () => { void fiber.dispose(); };
  }, [props.ctx]);
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
  const chatSource = useMemo(
    () => sessionId ? props.ctx.uiConversation.binding(sessionId).target("chat") : undefined,
    [props.ctx, sessionId],
  );
  const chatSnapshot = useSyncExternalStore(
    useCallback(
      (listener: () => void) => chatSource?.subscribe(listener) ?? (() => undefined),
      [chatSource],
    ),
    () => chatSource?.getSnapshot(),
    () => chatSource?.getSnapshot(),
  );
  const resolveAnchorId = useCallback((renderedKey: string): string => {
    return chatSnapshot ? resolveDurableAnchorId(chatSnapshot, renderedKey) : renderedKey;
  }, [chatSnapshot]);
  const resolveAnchorKey = useCallback((anchorId: string): string => {
    return chatSnapshot ? resolveRenderedAnchorKey(chatSnapshot, anchorId) : anchorId;
  }, [chatSnapshot]);
  useEffect(() => {
    if (sessionId) void props.workspace.ensure(sessionId).catch((error) => {
      console.warn("[dsh-session-sticker-board] session-note load failed", error);
    });
  }, [props.workspace, sessionId]);
  if (!sessionId) return null;
  const title = sessionList.byId?.[sessionId]?.title ?? sessionId;
  return (
    <StickerOverlay
      {...(selectionActions ? { selectionActions } : {})}
      sessionId={sessionId}
      sessionTitle={title}
      stickers={props.workspace.list(sessionId)}
      onSave={(record) => props.workspace.save(record)}
      onDelete={(stickerId) => props.workspace.remove(sessionId, stickerId)}
      onOpenNote={props.openNote}
      onOpenSticker={props.openSticker}
      resolveAnchorId={resolveAnchorId}
      resolveAnchorKey={resolveAnchorKey}
      resolveLogicalLocation={props.resolveLogicalLocation}
    />
  );
}

async function mountStickerClient(ready: Context, signal: AbortSignal, own: (dispose: () => void | Promise<void>) => void): Promise<void> {
  const mountedRemote = await mountStickerRemote(ready, signal);
  own(() => mountedRemote.dispose());
  signal.throwIfAborted();
  const resolveBridge = () => ready.get('obsidianBridgeLifecycle') as ObsidianBridgeLifecycle | undefined;
  const currentIdentity = () => resolveBridge()?.runtimeIdentity;
  const bridge = createStickerBridgeChannel(resolveBridge);
  const stickers = createStickerWorkspace(mountedRemote, bridge);
  own(() => stickers.dispose());
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
  own(() => sidebarFiber.dispose());

  const overlayHost = document.createElement("div");
  overlayHost.dataset.dshStickerBoard = "";
  document.body.appendChild(overlayHost);
  own(() => overlayHost.remove());
  const root = createRoot(overlayHost);
  own(() => root.unmount());
  root.render(
    <StickerBoardRoot
      ctx={ready}
      workspace={stickers}
      openNote={(action) => bridge.openNote(action)}
      openSticker={(record) => stickerSidebar.openSticker(record)}
      resolveLogicalLocation={async ({ sessionId, anchorId }) => {
        const runtimeIdentity = currentIdentity();
        return {
          ...(runtimeIdentity?.dshInstanceId === undefined ? {} : {
            dshInstanceId: runtimeIdentity.dshInstanceId,
          }),
          legacySessionId: sessionId,
          legacyAnchorId: anchorId,
        };
      }}
    />,
  );

  const applyAction = async (action: import("../bridge/http-client.ts").BridgeAction, signal?: AbortSignal): Promise<boolean> => {
    const runtimeIdentity = currentIdentity();
    signal?.throwIfAborted();
    if (action.type !== "deep-link" || action.setId !== undefined) return false;
    if (!matchesRuntimeScope(action, runtimeIdentity)) return false;
    signal?.throwIfAborted();
    if (action.anchorId === '@session') {
      await ready.sessions.open(action.sessionId);
      return true;
    }
    const isStickerAction = action.stickerId !== undefined
      || action.quoteHash !== undefined;
    if (isStickerAction) {
      try {
        await stickers.ensure(action.sessionId);
        signal?.throwIfAborted();
      } catch (error) {
        console.warn("[dsh-session-sticker-board] sticker deep-link load failed", error);
        return true;
      }
    }
    const matchingSticker = !isStickerAction ? undefined : stickers.list(action.sessionId).find((view) => matchesRuntimeScope(view.record, runtimeIdentity) && (
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
      ...(runtimeIdentity === undefined ? {} : { runtimeIdentity: runtimeIdentity }),
      ...(signal === undefined ? {} : { signal }),
      ...(matchingSticker ? { quote: matchingSticker.record.quote } : {}),
    });
    if (result.status !== "located") {
      console.warn("[dsh-session-sticker-board] deep-link was not located", result);
    }
    return true;
  };
  const bridgeFiber = ready.inject(['obsidianBridgeLifecycle'], bridgeContext => {
    const shared = bridgeContext.get('obsidianBridgeLifecycle') as ObsidianBridgeLifecycle;
    bridgeContext.effect(() => {
      const unregisterHealth = shared.registerHealthSource?.('stickers', {
        getHealth: () => stickers.health(),
        subscribe: listener => stickers.subscribe(listener),
        retry: () => { void stickers.syncAll(); },
      });
      const unregisterActions = shared.registerActionHandler?.('session-sticker-board', {
        accepts: (action) => action.type === "deep-link"
          && matchesRuntimeScope(action, currentIdentity())
          && action.setId === undefined
          && (action.stickerId !== undefined || action.quoteHash !== undefined || action.anchorId === '@session'),
        handle: applyAction,
      });
      const unregisterSync = shared.mountWhenReady('session-sticker-board:sync', () => {
        void stickers.syncAll();
      });
      return () => {
        unregisterSync();
        unregisterActions?.();
        unregisterHealth?.();
      };
    }, 'stickers: shared Bridge channel');
  });
  own(() => bridgeFiber.dispose());
}

export function apply(ctx: Context): void {
  ctx.inject(inject, injectedContext => {
    const ready = injectedContext as unknown as Context;
    // Own startup before its first await so dependency loss can cancel it.
    ready.effect(() => {
      const lifetime = new AbortController();
      const disposers: Array<() => void | Promise<void>> = [];
      const cleanup = async () => {
        const failures: unknown[] = [];
        for (const dispose of disposers.splice(0).reverse()) {
          try { await dispose(); } catch (error) { failures.push(error); }
        }
        if (failures.length) throw new AggregateError(failures, 'Sticker client cleanup failed');
      };
      // Cordis defers an async plugin's own effects until startup settles.
      // The synchronous owner can cancel its LOADING child, while genuine
      // initialization errors remain visible as a FAILED child activation.
      const startup = ready.plugin({
        name: 'dsh-session-sticker-board:client-startup',
        apply: async () => {
          try {
            await mountStickerClient(ready, lifetime.signal, dispose => { disposers.push(dispose); });
          } catch (error) {
            await cleanup();
            if (!lifetime.signal.aborted) throw error;
          }
        },
      });
      return async () => {
        lifetime.abort();
        await startup.dispose();
        await cleanup();
      };
    }, 'dsh-session-sticker-board: client');
  });
}
