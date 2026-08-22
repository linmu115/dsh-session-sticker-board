import {
  parseBridgeMessage,
  type DeepLinkAction,
  type OpenNoteAction,
  type PendingCitation,
  type ResolvedCitation,
  type SessionNoteDocument,
} from "../protocol.ts";

export type DshBridgeAction = DeepLinkAction | PendingCitation;

export interface QueuedDshAction {
  cursor: number;
  message: DshBridgeAction;
}

export interface BridgeClientOptions {
  origin: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  clientId?: string;
}

export interface PollingOptions {
  visibilityState?: () => DocumentVisibilityState;
  schedule?: (callback: () => void, delay: number) => () => void;
  onError?: (error: unknown) => void;
}

export interface PollingHandle {
  firstCycle: Promise<void>;
  stop(): void;
}

export interface BridgeClient {
  nextActions(): Promise<QueuedDshAction[]>;
  ack(actionId: string): Promise<void>;
  applyActions(
    actions: readonly QueuedDshAction[],
    apply: (message: DshBridgeAction) => Promise<boolean>,
  ): Promise<{ applied: number; cursor: number }>;
  startPolling(apply: (message: DshBridgeAction) => Promise<boolean>, options?: PollingOptions): PollingHandle;
  readSessionNote(sessionId: string): Promise<SessionNoteDocument>;
  saveSessionNote(document: SessionNoteDocument, expectedRevision: string): Promise<{ revision: string }>;
  resolveCitation(citation: ResolvedCitation): Promise<{ notePath: string; blockId: string }>;
  openNote(action: OpenNoteAction): Promise<void>;
  dispose(): void;
}

export class BridgeHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "BridgeHttpError";
  }
}

function loopbackOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
    throw new Error(`Obsidian bridge must use an HTTP loopback origin: ${value}`);
  }
  return url.origin;
}

function messageId(message: DshBridgeAction): string {
  return message.type === "pending-citation" ? message.citationId : message.actionId;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    return typeof body.error === "string" ? body.error : `Bridge returned HTTP ${response.status}`;
  } catch {
    return `Bridge returned HTTP ${response.status}`;
  }
}

export function createBridgeClient(options: BridgeClientOptions): BridgeClient {
  const origin = loopbackOrigin(options.origin);
  const fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  const clientId = options.clientId ?? `dsh-web-${crypto.randomUUID()}`;
  const controllers = new Set<AbortController>();
  const pollingStops = new Set<() => void>();
  let token: string | null = null;
  let tokenExpiresAt = 0;
  let cursor = 0;
  let disposed = false;

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    if (disposed) throw new DOMException("Bridge client was disposed", "AbortError");
    const controller = new AbortController();
    controllers.add(controller);
    try {
      return await fetchImplementation(`${origin}${path}`, { ...init, signal: controller.signal });
    } finally {
      controllers.delete(controller);
    }
  }

  async function handshake(force = false): Promise<void> {
    if (!force && token && tokenExpiresAt > now() + 1_000) return;
    const response = await request("/v1/handshake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId }),
    });
    if (!response.ok) throw new BridgeHttpError(response.status, await errorMessage(response));
    const body = await response.json() as { token?: unknown; expiresAt?: unknown };
    if (typeof body.token !== "string" || typeof body.expiresAt !== "number") {
      throw new Error("Bridge handshake response is invalid");
    }
    token = body.token;
    tokenExpiresAt = body.expiresAt;
  }

  async function authenticated(path: string, init: RequestInit = {}, canRetry = true): Promise<Response> {
    await handshake();
    const response = await request(path, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
    });
    if (response.status === 401 && canRetry) {
      token = null;
      tokenExpiresAt = 0;
      await handshake(true);
      return authenticated(path, init, false);
    }
    if (!response.ok) throw new BridgeHttpError(response.status, await errorMessage(response));
    return response;
  }

  async function nextActions(): Promise<QueuedDshAction[]> {
    const response = await authenticated(`/v1/actions/next?after=${cursor}`);
    const body = await response.json() as { actions?: unknown };
    if (!Array.isArray(body.actions)) throw new Error("Bridge action response is invalid");
    return body.actions.map((value) => {
      if (!value || typeof value !== "object") throw new Error("Bridge queue entry is invalid");
      const entry = value as { cursor?: unknown; message?: unknown };
      if (!Number.isInteger(entry.cursor) || (entry.cursor as number) < 0) throw new Error("Bridge action cursor is invalid");
      const message = parseBridgeMessage(entry.message);
      if (message.type !== "deep-link" && message.type !== "pending-citation") {
        throw new Error(`Bridge message is not a DSH action: ${message.type}`);
      }
      return { cursor: entry.cursor as number, message };
    });
  }

  async function ack(actionId: string): Promise<void> {
    await authenticated(`/v1/actions/${encodeURIComponent(actionId)}/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  }

  async function applyActions(
    actions: readonly QueuedDshAction[],
    apply: (message: DshBridgeAction) => Promise<boolean>,
  ): Promise<{ applied: number; cursor: number }> {
    let applied = 0;
    for (const entry of [...actions].sort((left, right) => left.cursor - right.cursor)) {
      if (entry.cursor <= cursor) continue;
      if (!await apply(entry.message)) break;
      await ack(messageId(entry.message));
      cursor = entry.cursor;
      applied += 1;
    }
    return { applied, cursor };
  }

  function startPolling(
    apply: (message: DshBridgeAction) => Promise<boolean>,
    pollingOptions: PollingOptions = {},
  ): PollingHandle {
    let stopped = false;
    let cancelScheduled: (() => void) | null = null;
    let networkDelay = 1_000;
    let resolveFirst!: () => void;
    const firstCycle = new Promise<void>((resolve) => { resolveFirst = resolve; });
    const schedule = pollingOptions.schedule ?? ((callback, delay) => {
      const timer = globalThis.setTimeout(callback, delay);
      return () => globalThis.clearTimeout(timer);
    });
    const visibilityState = pollingOptions.visibilityState
      ?? (() => typeof document === "undefined" ? "visible" : document.visibilityState);

    const stop = () => {
      if (stopped) return;
      stopped = true;
      cancelScheduled?.();
      pollingStops.delete(stop);
    };
    pollingStops.add(stop);

    const cycle = async () => {
      if (stopped || disposed) return;
      let delay: number;
      try {
        const actions = await nextActions();
        await applyActions(actions, apply);
        networkDelay = 1_000;
        delay = visibilityState() === "hidden" ? 3_000 : 750;
      } catch (error) {
        if (disposed || (error instanceof DOMException && error.name === "AbortError")) {
          stop();
          resolveFirst();
          return;
        }
        pollingOptions.onError?.(error);
        delay = networkDelay;
        networkDelay = Math.min(networkDelay * 2, 10_000);
      }
      if (!stopped) cancelScheduled = schedule(() => { void cycle(); }, delay);
      resolveFirst();
    };
    void cycle();
    return { firstCycle, stop };
  }

  async function readSessionNote(sessionId: string): Promise<SessionNoteDocument> {
    const response = await authenticated(`/v1/session-notes/${encodeURIComponent(sessionId)}`);
    const message = parseBridgeMessage(await response.json());
    if (message.type !== "session-note") throw new Error("Bridge did not return a session note");
    return message;
  }

  async function saveSessionNote(
    document: SessionNoteDocument,
    expectedRevision: string,
  ): Promise<{ revision: string }> {
    const response = await authenticated(`/v1/session-notes/${encodeURIComponent(document.sessionId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document, expectedRevision }),
    });
    const body = await response.json() as { revision?: unknown };
    if (typeof body.revision !== "string") throw new Error("Bridge save response has no revision");
    return { revision: body.revision };
  }

  async function resolveCitation(citation: ResolvedCitation): Promise<{ notePath: string; blockId: string }> {
    const response = await authenticated("/v1/citations/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(citation),
    });
    const body = await response.json() as { notePath?: unknown; blockId?: unknown };
    if (typeof body.notePath !== "string" || typeof body.blockId !== "string") {
      throw new Error("Bridge citation response is invalid");
    }
    return { notePath: body.notePath, blockId: body.blockId };
  }

  async function openNote(action: OpenNoteAction): Promise<void> {
    await authenticated("/v1/obsidian/open-note", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
    });
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const stop of [...pollingStops]) stop();
    for (const controller of controllers) controller.abort();
    controllers.clear();
  }

  return {
    nextActions,
    ack,
    applyActions,
    startPolling,
    readSessionNote,
    saveSessionNote,
    resolveCitation,
    openNote,
    dispose,
  };
}
