import type { BridgeAction, BridgeActionPage, BridgeHttpClient } from "../bridge/http-client.ts";

export interface BridgeActionProcessor {
  readonly cursor: number;
  process(page: BridgeActionPage, signal?: AbortSignal): Promise<{ applied: number; failed: number; cursor: number }>;
}

export function createBridgeActionProcessor(
  bridge: Pick<BridgeHttpClient, "acknowledgeDeepLink" | "acknowledgeAction">,
  apply: (message: BridgeAction, signal?: AbortSignal) => Promise<boolean>,
  onApplyError?: (error: unknown, message: BridgeAction) => void,
  accepts: (message: BridgeAction) => boolean = () => true,
): BridgeActionProcessor {
  let cursor = 0;
  let queueId: string | undefined;
  const completed = new Set<number>();
  const deepLinkOutcomes = new Map<number, { accepted: boolean; applyError?: unknown }>();
  return {
    get cursor() { return cursor; },
    async process(page, signal) {
      signal?.throwIfAborted();
      const acknowledge = (actionId: string, navigation = false) => {
        signal?.throwIfAborted();
        const method = navigation ? bridge.acknowledgeDeepLink.bind(bridge) : bridge.acknowledgeAction.bind(bridge);
        return signal === undefined ? method(actionId) : method(actionId, signal);
      };
      const applyAction = (message: BridgeAction) => signal === undefined ? apply(message) : apply(message, signal);
      const queueChanged = page.queueId !== undefined
        && page.queueId !== queueId
        && (queueId !== undefined || cursor > 0);
      const queueReset = queueChanged || page.cursor < cursor;
      if (queueReset) {
        cursor = 0;
        completed.clear();
        deepLinkOutcomes.clear();
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
        && accepts(entry.message)
        && (entry.message.referenceId === undefined || !deletingReferences.has(entry.message.referenceId))
      ));
      for (const entry of ordered) {
        if (signal?.aborted) break;
        if (entry.cursor <= cursor || completed.has(entry.cursor)) continue;
        if (!accepts(entry.message)) {
          completed.add(entry.cursor);
          continue;
        }
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
            await acknowledge(entry.message.actionId, true);
            completed.add(entry.cursor);
            applied += 1;
            continue;
          }
          if (entry.message.type === "deep-link") {
            // Targeted deep links have one owning DSH surface. Let that surface
            // take over the navigation before globally removing the one-shot
            // request, otherwise a faster unrelated browser can steal it.
            let outcome = deepLinkOutcomes.get(entry.cursor);
            if (outcome === undefined) {
              try {
                outcome = { accepted: await applyAction(entry.message) };
              } catch (applyError) {
                outcome = { accepted: false, applyError };
              }
              deepLinkOutcomes.set(entry.cursor, outcome);
            }
            await acknowledge(entry.message.actionId, true);
            deepLinkOutcomes.delete(entry.cursor);
            completed.add(entry.cursor);
            if ("applyError" in outcome) {
              failed += 1;
              onApplyError?.(outcome.applyError, entry.message);
              continue;
            }
            if (!outcome.accepted) {
              failed += 1;
              continue;
            }
            applied += 1;
            continue;
          }
          if (!await applyAction(entry.message)) {
            failed += 1;
            continue;
          }
          if (entry.message.type === "reference-delete-request") {
            await acknowledge(entry.message.actionId);
          }
          completed.add(entry.cursor);
          applied += 1;
        } catch (error) {
          if (signal?.aborted) break;
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
  subscribeVisibility?: (listener: () => void) => () => void;
  schedule?: (callback: () => void, delay: number) => () => void;
  onError?: (error: unknown) => void;
  onActionError?: (error: unknown, message: BridgeAction) => void;
  accepts?: (message: BridgeAction) => boolean;
}

export interface BridgePollingHandle {
  readonly firstCycle: Promise<void>;
  stop(): void;
}

export function startBridgePolling(
  bridge: Pick<BridgeHttpClient, "nextActions" | "acknowledgeDeepLink" | "acknowledgeAction">,
  apply: (message: BridgeAction, signal?: AbortSignal) => Promise<boolean>,
  options: BridgePollingOptions = {},
): BridgePollingHandle {
  const processor = createBridgeActionProcessor(bridge, apply, options.onActionError, options.accepts);
  const schedule = options.schedule ?? ((callback, delay) => {
    const timer = globalThis.setTimeout(callback, delay);
    return () => globalThis.clearTimeout(timer);
  });
  const visibilityState = options.visibilityState
    ?? (() => typeof document === "undefined" ? "visible" : document.visibilityState);
  const subscribeVisibility = options.subscribeVisibility ?? ((listener: () => void) => {
    if (typeof document === "undefined") return () => undefined;
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  });
  let stopped = false;
  const abort = new AbortController();
  let running = false;
  let wakeRequested = false;
  let cancelScheduled: (() => void) | undefined;
  let networkDelay = 1_000;
  let resolveFirst!: () => void;
  const firstCycle = new Promise<void>((resolve) => { resolveFirst = resolve; });

  const cycle = async (): Promise<void> => {
    if (stopped) return;
    if (running) {
      wakeRequested = true;
      return;
    }
    running = true;
    cancelScheduled = undefined;
    let delay: number;
    try {
      const page = await bridge.nextActions(processor.cursor, abort.signal);
      if (stopped) return;
      await processor.process(page, abort.signal);
      networkDelay = 1_000;
      delay = visibilityState() === "hidden" ? 3_000 : 750;
    } catch (error) {
      if (!stopped) options.onError?.(error);
      delay = networkDelay;
      networkDelay = Math.min(networkDelay * 2, 10_000);
    }
    running = false;
    resolveFirst();
    if (stopped) return;
    if (wakeRequested) {
      wakeRequested = false;
      void cycle();
      return;
    }
    cancelScheduled = schedule(() => { void cycle(); }, delay);
  };
  const unsubscribeVisibility = subscribeVisibility(() => {
    if (stopped || visibilityState() === "hidden") return;
    cancelScheduled?.();
    cancelScheduled = undefined;
    if (running) wakeRequested = true;
    else void cycle();
  });
  void cycle();
  return {
    firstCycle,
    stop() {
      if (stopped) return;
      stopped = true;
      abort.abort();
      resolveFirst();
      cancelScheduled?.();
      unsubscribeVisibility();
    },
  };
}
