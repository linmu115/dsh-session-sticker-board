import type { BridgeAction, BridgeActionPage, BridgeHttpClient } from "../bridge/http-client.ts";

export interface BridgeActionProcessor {
  readonly cursor: number;
  process(page: BridgeActionPage): Promise<{ applied: number; failed: number; cursor: number }>;
}

export function createBridgeActionProcessor(
  bridge: Pick<BridgeHttpClient, "acknowledgeDeepLink" | "acknowledgeAction">,
  apply: (message: BridgeAction) => Promise<boolean>,
  onApplyError?: (error: unknown, message: BridgeAction) => void,
): BridgeActionProcessor {
  let cursor = 0;
  let queueId: string | undefined;
  const completed = new Set<number>();
  return {
    get cursor() { return cursor; },
    async process(page) {
      const queueChanged = page.queueId !== undefined
        && page.queueId !== queueId
        && (queueId !== undefined || cursor > 0);
      const queueReset = queueChanged || page.cursor < cursor;
      if (queueReset) {
        cursor = 0;
        completed.clear();
      }
      if (page.queueId !== undefined) queueId = page.queueId;
      let applied = 0;
      let failed = 0;
      const ordered = [...page.actions].sort((left, right) => left.cursor - right.cursor);
      const deletingReferences = new Set(ordered.flatMap((entry) => (
        entry.message.type === "reference-delete-request" ? [entry.message.referenceId] : []
      )));
      const latestNavigation = ordered.findLast((entry) => (
        entry.message.type === "deep-link"
        && (entry.message.referenceId === undefined || !deletingReferences.has(entry.message.referenceId))
      ));
      for (const entry of ordered) {
        if (entry.cursor <= cursor || completed.has(entry.cursor)) continue;
        try {
          if (
            entry.message.type === "deep-link"
            && (
              entry !== latestNavigation
              || (entry.message.referenceId !== undefined && deletingReferences.has(entry.message.referenceId))
            )
          ) {
            // Navigation is ephemeral. Consume superseded requests without
            // applying them so a reconnect cannot replay an entire click
            // history or reopen a reference that is being deleted.
            await bridge.acknowledgeDeepLink(entry.message.actionId);
            completed.add(entry.cursor);
            applied += 1;
            continue;
          }
          if (entry.message.type === "deep-link") {
            // A deep link is a one-shot navigation intent. Claim it before
            // touching session state so a later DOM/Core failure cannot leave
            // the request queued and repeatedly reopen the same session.
            await bridge.acknowledgeDeepLink(entry.message.actionId);
            completed.add(entry.cursor);
            if (!await apply(entry.message)) {
              failed += 1;
              continue;
            }
            applied += 1;
            continue;
          }
          if (!await apply(entry.message)) {
            failed += 1;
            continue;
          }
          if (entry.message.type === "reference-delete-request") {
            await bridge.acknowledgeAction(entry.message.actionId);
          }
          completed.add(entry.cursor);
          applied += 1;
        } catch (error) {
          failed += 1;
          onApplyError?.(error, entry.message);
        }
      }
      while (completed.delete(cursor + 1)) cursor += 1;
      if (!queueReset && page.actions.length === 0 && page.cursor > cursor) cursor = page.cursor;
      return { applied, failed, cursor };
    },
  };
}

export interface BridgePollingOptions {
  visibilityState?: () => DocumentVisibilityState;
  schedule?: (callback: () => void, delay: number) => () => void;
  onError?: (error: unknown) => void;
  onActionError?: (error: unknown, message: BridgeAction) => void;
}

export interface BridgePollingHandle {
  readonly firstCycle: Promise<void>;
  stop(): void;
}

export function startBridgePolling(
  bridge: Pick<BridgeHttpClient, "nextActions" | "acknowledgeDeepLink" | "acknowledgeAction">,
  apply: (message: BridgeAction) => Promise<boolean>,
  options: BridgePollingOptions = {},
): BridgePollingHandle {
  const processor = createBridgeActionProcessor(bridge, apply, options.onActionError);
  const schedule = options.schedule ?? ((callback, delay) => {
    const timer = globalThis.setTimeout(callback, delay);
    return () => globalThis.clearTimeout(timer);
  });
  const visibilityState = options.visibilityState
    ?? (() => typeof document === "undefined" ? "visible" : document.visibilityState);
  let stopped = false;
  let cancelScheduled: (() => void) | undefined;
  let networkDelay = 1_000;
  let resolveFirst!: () => void;
  const firstCycle = new Promise<void>((resolve) => { resolveFirst = resolve; });

  const cycle = async (): Promise<void> => {
    if (stopped) return;
    let delay: number;
    try {
      const page = await bridge.nextActions(processor.cursor);
      await processor.process(page);
      networkDelay = 1_000;
      delay = visibilityState() === "hidden" ? 3_000 : 750;
    } catch (error) {
      options.onError?.(error);
      delay = networkDelay;
      networkDelay = Math.min(networkDelay * 2, 10_000);
    }
    resolveFirst();
    if (!stopped) cancelScheduled = schedule(() => { void cycle(); }, delay);
  };
  void cycle();
  return {
    firstCycle,
    stop() {
      if (stopped) return;
      stopped = true;
      cancelScheduled?.();
    },
  };
}
