import type { ObsidianBridgeLifecycle } from "dsh-obsidian-bridge-lifecycle/api";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import type { BetterSidebarService, Context } from "../context-types.ts";
import type { StickerRecord } from "../protocol.ts";
import { createStickerBridgeChannel } from './bridge-channel.ts';
import { applyDeepLink, resolveMaintenanceProjection } from "./deep-link.ts";
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
import { OrdinaryStickerTools } from './knowledge-panel.tsx';
import { knowledgeRequest, migrateLegacyStickers } from './knowledge.ts';
import { registerLinkedNotes } from './linked-notes.tsx';

export const inject = ["sessions", "remote", "uiConversation"] as const;

function StickerBoardRoot(props: {
  ctx: Context;
  knowledge?: Pick<Parameters<typeof OrdinaryStickerTools>[0], 'local' | 'bridge'>;
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
    <>{props.knowledge && <OrdinaryStickerTools sessionId={sessionId} local={props.knowledge.local} bridge={props.knowledge.bridge} onMigrated={() => props.workspace.ensure(sessionId)} />}
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
    </>
  );
}

export function apply(ctx: Context): void {
  try {
    ctx.inject(inject, async (injectedContext) => {
      try {
        const ready = injectedContext as unknown as Context & { obsidianBridgeLifecycle?: ObsidianBridgeLifecycle };
        const mountedRemote = await mountStickerRemote(ready);
        const managedIdentity = mountedRemote.managed ? await knowledgeRequest<{ instanceId: string }>('status') : undefined;
        const resolveBridge = () => ready.get('obsidianBridgeLifecycle') as ObsidianBridgeLifecycle | undefined;
        const currentIdentity = () => resolveBridge()?.runtimeIdentity ?? (managedIdentity ? { dshInstanceId: managedIdentity.instanceId } : undefined);
        const bridge = createStickerBridgeChannel(resolveBridge);
        const stickers = createStickerWorkspace(mountedRemote.managed ? {
          ...mountedRemote,
          // Keep the engine's structured error code across the browser boundary.
          readLocalState: sessionId => knowledgeRequest('legacy-state', { nativeSessionId: sessionId }),
        } : mountedRemote, bridge, mountedRemote.managed ? {
          migrateLegacy: sessionId => migrateLegacyStickers(sessionId, mountedRemote, bridge),
        } : {});
        const knowledgeSlots = mountedRemote.managed ? ready.inject(['slots'], slotContext => {
          const slotsReady = slotContext as unknown as Context;
          const slots = slotsReady.slots;
          slotsReady.effect(() => registerLinkedNotes(slotsReady, bridge));
          return slots.inject('conversation.session.header.actions', () => slots.register({ name: 'conversation.session.header.actions', id: 'knowledge-session-stickers', order: 89 }, () => <button className="dsh-knowledge-trigger" onClick={() => window.dispatchEvent(new CustomEvent('dsh-ordinary-sticker-tools'))}>贴纸与笔记链接</button>));
        }) : undefined;
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
        if (mountedRemote.managed) overlayHost.dataset.dshKnowledge = '1';
        document.body.appendChild(overlayHost);
        const root = createRoot(overlayHost);
        root.render(
          <StickerBoardRoot
            ctx={ready}
            workspace={stickers}
            {...(mountedRemote.managed ? { knowledge: { local: mountedRemote, bridge: bridge as typeof bridge & { knowledge(operation: string, input: Record<string, unknown>): Promise<unknown> } } } : {})}
            openNote={(action) => bridge.openNote(action)}
            openSticker={(record) => stickerSidebar.openSticker(record)}
            resolveLogicalLocation={async ({ sessionId, anchorId }) => {
              const runtimeIdentity = currentIdentity();
              const resolved = await resolveMaintenanceProjection({
                referenceType: "sticker",
                legacySessionId: sessionId,
                legacyAnchorId: anchorId,
              }).catch(() => undefined);
              return {
                ...(runtimeIdentity?.dshInstanceId === undefined ? {} : {
                  dshInstanceId: runtimeIdentity.dshInstanceId,
                }),
                ...(resolved?.logicalSessionId === undefined ? {} : { logicalSessionId: resolved.logicalSessionId }),
                ...(resolved?.logicalAnchorId === undefined ? {} : { logicalAnchorId: resolved.logicalAnchorId }),
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
          if (action.anchorId === '@session' && action.logicalSessionId) {
            const target = await knowledgeRequest<{ nativeSessionId: string }>('resolve', { logicalSessionId: action.logicalSessionId });
            signal?.throwIfAborted(); await ready.sessions.open(target.nativeSessionId); return true;
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
            resolveLogicalTarget: async (target) => resolveMaintenanceProjection({ ...target, ...(signal === undefined ? {} : { signal }) }).catch(() => undefined),
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
        ready.effect(() => () => {
          void bridgeFiber.dispose();
          stickers.dispose();
          void sidebarFiber.dispose();
          void knowledgeSlots?.dispose();
          void mountedRemote.dispose();
          setTimeout(() => root.unmount());
          overlayHost.remove();
        }, "dsh-session-sticker-board: client");
      } catch (error) {
        throw error;
      }
    });
  } catch (error) {
    throw error;
  }
}
