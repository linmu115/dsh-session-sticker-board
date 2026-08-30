import {
  ANNOTATION_PROTOCOL_VERSION,
  BacklinkReceiptV2Schema,
  ObsidianReferenceCaptureV2Schema,
  ReferenceRefreshResultV2Schema,
  ReferenceDeleteRequestV2Schema,
  STICKER_PROTOCOL_VERSION,
  deepLinkActionSchema,
  parseBridgeMessage,
  stickerBacklinkSchema,
  type BacklinkCommitV2,
  type BacklinkReceiptV2,
  type DeepLinkAction,
  type ObsidianReferenceCaptureV2,
  type OpenNoteAction,
  type ReferenceClaimV2,
  type ReferenceRefreshResultV2,
  type ReferenceDeleteCommitV2,
  type ReferenceDeleteRequestV2,
  type SessionNoteDocument,
  type StickerBacklink,
  type StickerRecord,
} from "../protocol.ts";

export type BridgeErrorCode =
  | "source-changed"
  | "revision-conflict"
  | "idempotency-conflict"
  | "note-not-found"
  | "protocol-mismatch"
  | "http-error";

const ERROR_CODES: Record<string, BridgeErrorCode> = {
  SOURCE_CHANGED: "source-changed",
  REVISION_CONFLICT: "revision-conflict",
  IDEMPOTENCY_CONFLICT: "idempotency-conflict",
  NOTE_NOT_FOUND: "note-not-found",
};

export class BridgeHttpError extends Error {
  constructor(readonly status: number, readonly code: BridgeErrorCode, message: string) {
    super(message);
    this.name = "BridgeHttpError";
  }
}

export class BridgeUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BridgeUnavailableError";
  }
}

export type BridgeAction = DeepLinkAction | ObsidianReferenceCaptureV2 | ReferenceDeleteRequestV2;

export interface QueuedBridgeAction {
  cursor: number;
  message: BridgeAction;
}

export interface BridgeActionPage {
  queueId?: string;
  cursor: number;
  actions: readonly QueuedBridgeAction[];
}

export interface BridgeHttpClientOptions {
  origin: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  clientId?: string;
  requestOrigin?: string;
}

export interface BridgeHttpClient {
  readonly origin: string;
  preflight(): Promise<void>;
  nextActions(after: number): Promise<BridgeActionPage>;
  acknowledgeDeepLink(actionId: string): Promise<void>;
  acknowledgeAction(actionId: string): Promise<void>;
  claimReference(actionId: string, claim: ReferenceClaimV2): Promise<void>;
  refreshReference(referenceId: string, knownDocumentHash: string, signal?: AbortSignal): Promise<ReferenceRefreshResultV2>;
  discardReference(referenceId: string): Promise<void>;
  commitBacklink(commit: BacklinkCommitV2): Promise<BacklinkReceiptV2>;
  deleteCommittedReference(commit: ReferenceDeleteCommitV2): Promise<void>;
  readSessionNote(sessionId: string): Promise<SessionNoteDocument>;
  saveSessionNote(document: SessionNoteDocument, expectedRevision: string): Promise<{ revision: string }>;
  openNote(action: OpenNoteAction): Promise<void>;
  listBacklinks(sticker: StickerRecord): Promise<StickerBacklink[]>;
  dispose(): void;
}

export function normalizeBridgeOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
    throw new TypeError(`Obsidian bridge must use an HTTP loopback origin: ${value}`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new TypeError("Obsidian bridge origin cannot contain a path, query or fragment");
  }
  return url.origin;
}

async function responseError(response: Response): Promise<BridgeHttpError> {
  let message = `Bridge returned HTTP ${response.status}`;
  let code: BridgeErrorCode = "http-error";
  try {
    const body = await response.json() as { error?: unknown; code?: unknown };
    if (typeof body.error === "string") message = body.error;
    if (typeof body.code === "string") code = ERROR_CODES[body.code] ?? "http-error";
  } catch {
    // Keep the bounded fallback above.
  }
  return new BridgeHttpError(response.status, code, message);
}

export function createBridgeHttpClient(options: BridgeHttpClientOptions): BridgeHttpClient {
  const origin = normalizeBridgeOrigin(options.origin);
  const fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  const clientId = options.clientId ?? `dsh-sticker-${crypto.randomUUID()}`;
  const controllers = new Set<AbortController>();
  let token: string | null = null;
  let tokenExpiresAt = 0;
  let disposed = false;

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    if (disposed) throw new DOMException("Bridge client was disposed", "AbortError");
    const controller = new AbortController();
    const abort = () => controller.abort(init.signal?.reason);
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener("abort", abort, { once: true });
    controllers.add(controller);
    const headers = new Headers(init.headers);
    if (options.requestOrigin !== undefined) headers.set("origin", normalizeBridgeOrigin(options.requestOrigin));
    try {
      try {
        return await fetchImplementation(`${origin}${path}`, { ...init, headers, signal: controller.signal });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new BridgeUnavailableError(`Obsidian bridge is unavailable at ${origin}`, { cause: error });
      }
    } finally {
      init.signal?.removeEventListener("abort", abort);
      controllers.delete(controller);
    }
  }

  async function handshake(force = false): Promise<void> {
    if (!force && token !== null && tokenExpiresAt > now() + 1_000) return;
    const response = await request("/v2/handshake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId }),
    });
    if (!response.ok) throw await responseError(response);
    const body = await response.json() as {
      token?: unknown;
      expiresAt?: unknown;
      annotationProtocolVersion?: unknown;
      stickerProtocolVersion?: unknown;
      bridgeOrigin?: unknown;
      capabilities?: unknown;
    };
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities : [];
    if (
      typeof body.token !== "string" || typeof body.expiresAt !== "number"
      || body.annotationProtocolVersion !== ANNOTATION_PROTOCOL_VERSION
      || body.stickerProtocolVersion !== STICKER_PROTOCOL_VERSION
      || body.bridgeOrigin !== origin
      || !["reference-capture-v2", "reference-refresh", "backlink-commit-v2", "reference-delete-v2"].every((item) => capabilities.includes(item))
    ) {
      throw new BridgeHttpError(409, "protocol-mismatch", "Obsidian bridge does not provide the required protocol v2 capabilities");
    }
    token = body.token;
    tokenExpiresAt = body.expiresAt;
  }

  async function authenticated(path: string, init: RequestInit = {}, canRetry = true): Promise<Response> {
    await handshake();
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    const response = await request(path, { ...init, headers });
    if (response.status === 401 && canRetry) {
      token = null;
      tokenExpiresAt = 0;
      await handshake(true);
      return authenticated(path, init, false);
    }
    if (!response.ok) throw await responseError(response);
    return response;
  }

  async function post(path: string, value: unknown, signal?: AbortSignal): Promise<Response> {
    return authenticated(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
      ...(signal === undefined ? {} : { signal }),
    });
  }

  return {
    origin,
    async preflight() {
      const response = await request("/v2/health");
      if (!response.ok) throw await responseError(response);
      const body = await response.json() as {
        annotationProtocolVersion?: unknown;
        stickerProtocolVersion?: unknown;
        bridgeOrigin?: unknown;
        capabilities?: unknown;
      };
      const capabilities = Array.isArray(body.capabilities) ? body.capabilities : [];
      if (
        body.annotationProtocolVersion !== ANNOTATION_PROTOCOL_VERSION
        || body.stickerProtocolVersion !== STICKER_PROTOCOL_VERSION
        || body.bridgeOrigin !== origin
        || !["reference-capture-v2", "reference-refresh", "backlink-commit-v2", "reference-delete-v2"].every((item) => capabilities.includes(item))
      ) {
        throw new BridgeHttpError(409, "protocol-mismatch", "Host, Client and Obsidian bridge configuration do not agree");
      }
      await handshake();
    },
    async nextActions(after) {
      if (!Number.isInteger(after) || after < 0) throw new TypeError("Bridge cursor must be a non-negative integer");
      const response = await authenticated(`/v2/actions/pending?after=${after}`);
      const body = await response.json() as { queueId?: unknown; cursor?: unknown; actions?: unknown };
      if (!Number.isInteger(body.cursor) || !Array.isArray(body.actions)) throw new Error("Bridge action page is invalid");
      if (body.queueId !== undefined && (typeof body.queueId !== "string" || body.queueId === "")) {
        throw new Error("Bridge queue ID is invalid");
      }
      const actions = body.actions.map((value): QueuedBridgeAction => {
        if (typeof value !== "object" || value === null) throw new Error("Bridge queue entry is invalid");
        const entry = value as { cursor?: unknown; message?: unknown };
        if (!Number.isInteger(entry.cursor) || (entry.cursor as number) < 0) throw new Error("Bridge action cursor is invalid");
        const capture = ObsidianReferenceCaptureV2Schema.safeParse(entry.message);
        const deletion = ReferenceDeleteRequestV2Schema.safeParse(entry.message);
        const message = capture.success ? capture.data : deletion.success ? deletion.data : deepLinkActionSchema.parse(entry.message);
        return { cursor: entry.cursor as number, message };
      });
      return {
        ...(typeof body.queueId === "string" ? { queueId: body.queueId } : {}),
        cursor: body.cursor as number,
        actions,
      };
    },
    async acknowledgeDeepLink(actionId) {
      await post(`/v1/actions/${encodeURIComponent(actionId)}/ack`, {});
    },
    async acknowledgeAction(actionId) {
      await post(`/v1/actions/${encodeURIComponent(actionId)}/ack`, {});
    },
    async claimReference(actionId, claim) {
      await post(`/v2/actions/${encodeURIComponent(actionId)}/ack`, claim);
    },
    async refreshReference(referenceId, knownDocumentHash, signal) {
      const response = await post(`/v2/references/${encodeURIComponent(referenceId)}/refresh`, {
        annotationProtocolVersion: ANNOTATION_PROTOCOL_VERSION,
        type: "reference-refresh",
        referenceId,
        knownDocumentHash,
      }, signal);
      return ReferenceRefreshResultV2Schema.parse(await response.json());
    },
    async discardReference(referenceId) {
      await post(`/v2/references/${encodeURIComponent(referenceId)}/discard`, {
        annotationProtocolVersion: ANNOTATION_PROTOCOL_VERSION,
        type: "reference-discard",
        referenceId,
      });
    },
    async commitBacklink(commit) {
      const response = await post("/v2/backlinks/commit", commit);
      return BacklinkReceiptV2Schema.parse(await response.json());
    },
    async deleteCommittedReference(commit) {
      await post(`/v2/references/${encodeURIComponent(commit.referenceId)}/delete-commit`, commit);
    },
    async readSessionNote(sessionId) {
      const response = await authenticated(`/v1/session-notes/${encodeURIComponent(sessionId)}`);
      const message = parseBridgeMessage(await response.json());
      if (message.type !== "session-note") throw new Error("Bridge did not return a session note");
      return message;
    },
    async saveSessionNote(document, expectedRevision) {
      const response = await authenticated(`/v1/session-notes/${encodeURIComponent(document.sessionId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document, expectedRevision }),
      });
      const body = await response.json() as { revision?: unknown };
      if (typeof body.revision !== "string") throw new Error("Bridge save response has no revision");
      return { revision: body.revision };
    },
    async openNote(action) {
      await post("/v2/obsidian/open-note", action);
    },
    async listBacklinks(sticker) {
      const query = new URLSearchParams({
        stickerId: sticker.stickerId,
        sessionId: sticker.sessionId,
        anchorId: sticker.anchorId,
        quoteHash: sticker.quoteHash,
      });
      const response = await authenticated(`/v1/sticker-backlinks?${query.toString()}`);
      const body = await response.json() as { backlinks?: unknown };
      return stickerBacklinkSchema.array().parse(body.backlinks);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    },
  };
}
