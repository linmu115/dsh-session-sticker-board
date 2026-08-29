import type { BridgeAction, BridgeActionPage, BridgeHttpClient } from "../bridge/http-client.ts";

export interface BridgeActionProcessor {
  readonly cursor: number;
  process(page: BridgeActionPage): Promise<{ applied: number; failed: number; cursor: number }>;
}

export function createBridgeActionProcessor(
  bridge: Pick<BridgeHttpClient, "acknowledgeDeepLink" | "acknowledgeAction">,
  apply: (message: BridgeAction) => Promise<boolean>,
): BridgeActionProcessor {
  let cursor = 0;
  const completed = new Set<number>();
  return {
    get cursor() { return cursor; },
    async process(page) {
      let applied = 0;
      let failed = 0;
      for (const entry of [...page.actions].sort((left, right) => left.cursor - right.cursor)) {
        if (entry.cursor <= cursor || completed.has(entry.cursor)) continue;
        try {
          if (!await apply(entry.message)) {
            failed += 1;
            continue;
          }
          if (entry.message.type === "deep-link") {
            await bridge.acknowledgeDeepLink(entry.message.actionId);
          } else if (entry.message.type === "reference-delete-request") {
            await bridge.acknowledgeAction(entry.message.actionId);
          }
          completed.add(entry.cursor);
          applied += 1;
        } catch {
          failed += 1;
        }
      }
      while (completed.delete(cursor + 1)) cursor += 1;
      if (page.actions.length === 0 && page.cursor > cursor) cursor = page.cursor;
      return { applied, failed, cursor };
    },
  };
}

export interface BridgePollingOptions {
  visibilityState?: () => DocumentVisibilityState;
  schedule?: (callback: () => void, delay: number) => () => void;
  onError?: (error: unknown) => void;
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
  const processor = createBridgeActionProcessor(bridge, apply);
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
