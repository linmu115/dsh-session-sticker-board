import { describe, expect, it, vi } from "vitest";

import { BridgeHttpError, BridgeUnavailableError, createBridgeHttpClient } from "../src/bridge/http-client.ts";
import {
  documentHash,
  selectedTextHash,
  type DeepLinkAction,
  type ObsidianReferenceCaptureV2,
  type SessionNoteDocument,
  type StickerRecord,
} from "../src/protocol.ts";

const ORIGIN = "http://127.0.0.1:28473";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function handshake() {
  return json(200, {
    token: "token",
    expiresAt: 20_000,
    annotationProtocolVersion: 2,
    stickerProtocolVersion: 1,
    bridgeOrigin: ORIGIN,
    capabilities: ["reference-capture-v2", "reference-refresh", "backlink-commit-v2", "reference-delete-v2"],
  });
}

const deepLink: DeepLinkAction = {
  protocolVersion: 1,
  type: "deep-link",
  actionId: "6f09f1be-5dc1-48e4-ac08-e3c05d70ac01",
  sessionId: "session-1",
  anchorId: "user-1",
  stickerId: "9bb3a80e-230d-44d1-a37c-f7b79d2bf315",
};

const capture: ObsidianReferenceCaptureV2 = {
  annotationProtocolVersion: 2,
  type: "reference-capture",
  actionId: "capture-1",
  referenceId: "reference-1",
  source: {
    sourceType: "obsidian-note",
    selectedText: "引用",
    locator: {
      vaultId: "vault-1", notePath: "note.md", blockId: "block-1", occurrence: 0,
      selectedTextHash: selectedTextHash("引用"),
    },
    snapshot: {
      markdown: "引用 ^block-1\n", documentHash: documentHash("引用 ^block-1\n"),
      capturedAt: 100, freshness: "captured",
    },
  },
};

describe("DSH v2 bridge HTTP client", () => {
  it("preflights the exact Host-selected origin before handshaking", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/v2/health")) return json(200, {
        annotationProtocolVersion: 2,
        stickerProtocolVersion: 1,
        bridgeOrigin: ORIGIN,
        capabilities: ["reference-capture-v2", "reference-refresh", "backlink-commit-v2", "reference-delete-v2"],
      });
      return handshake();
    });
    const client = createBridgeHttpClient({ origin: ORIGIN, fetch, now: () => 1_000 });
    await client.preflight();
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([`${ORIGIN}/v2/health`, `${ORIGIN}/v2/handshake`]);
  });

  it("rejects Host/Client/Obsidian port disagreement before polling", async () => {
    const fetch = vi.fn(async () => json(200, {
      annotationProtocolVersion: 2,
      stickerProtocolVersion: 1,
      bridgeOrigin: "http://127.0.0.1:18473",
      capabilities: ["reference-capture-v2", "reference-refresh", "backlink-commit-v2", "reference-delete-v2"],
    }));
    const client = createBridgeHttpClient({ origin: ORIGIN, fetch });
    await expect(client.preflight()).rejects.toMatchObject({ code: "protocol-mismatch" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects a mismatched handshake even when the Host calls a route without browser preflight", async () => {
    const fetch = vi.fn(async () => json(200, {
      token: "token",
      expiresAt: 20_000,
      annotationProtocolVersion: 2,
      stickerProtocolVersion: 1,
      bridgeOrigin: "http://127.0.0.1:18473",
      capabilities: ["reference-capture-v2", "reference-refresh", "backlink-commit-v2", "reference-delete-v2"],
    }));
    const client = createBridgeHttpClient({ origin: ORIGIN, fetch, now: () => 1_000 });
    await expect(client.nextActions(0)).rejects.toMatchObject({ code: "protocol-mismatch" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("distinguishes an offline bridge from a protocol mismatch", async () => {
    const client = createBridgeHttpClient({
      origin: ORIGIN,
      fetch: vi.fn(async () => { throw new TypeError("fetch failed"); }),
    });
    await expect(client.preflight()).rejects.toBeInstanceOf(BridgeUnavailableError);
  });

  it("parses both v2 captures and historical deep links from one action page", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/v2/handshake")) return handshake();
      return json(200, {
        queueId: "bridge-queue-1",
        cursor: 2,
        actions: [{ cursor: 1, message: capture }, { cursor: 2, message: deepLink }],
      });
    });
    const client = createBridgeHttpClient({ origin: ORIGIN, fetch, now: () => 1_000 });
    await expect(client.nextActions(0)).resolves.toEqual({
      queueId: "bridge-queue-1",
      cursor: 2,
      actions: [{ cursor: 1, message: capture }, { cursor: 2, message: deepLink }],
    });
  });

  it("preserves typed bridge conflicts", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/v2/handshake")) return handshake();
      return json(409, { code: "SOURCE_CHANGED", error: "Known snapshot does not match" });
    });
    const client = createBridgeHttpClient({ origin: ORIGIN, fetch, now: () => 1_000 });
    await expect(client.refreshReference("reference-1", `sha256:${"1".repeat(64)}`))
      .rejects.toEqual(new BridgeHttpError(409, "source-changed", "Known snapshot does not match"));
  });

  it("treats an already-consumed one-shot action as acknowledged", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/v2/handshake")) return handshake();
      return json(404, { error: "Action was not found" });
    });
    const client = createBridgeHttpClient({ origin: ORIGIN, fetch, now: () => 1_000 });
    await expect(client.acknowledgeDeepLink(deepLink.actionId)).resolves.toBeUndefined();
    await expect(client.acknowledgeAction("delete-action")).resolves.toBeUndefined();
  });

  it("retains session-note and sticker-backlink v1 operations", async () => {
    const document: SessionNoteDocument = {
      protocolVersion: 1, type: "session-note", sessionId: "session-1", revision: "sha256:one", stickers: [],
    };
    const sticker: StickerRecord = {
      stickerId: "9bb3a80e-230d-44d1-a37c-f7b79d2bf315",
      sessionId: "session-1", anchorId: "user-1", role: "user", quote: "引用", quoteHash: "sha256:quote",
      occurrence: 0, markdown: "", tags: [], color: "yellow",
    };
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      if (value.endsWith("/v2/handshake")) return handshake();
      if (init?.method === "PUT") return json(200, { revision: "sha256:two" });
      if (value.includes("/v1/sticker-backlinks?")) return json(200, { backlinks: [] });
      return json(200, document);
    });
    const client = createBridgeHttpClient({ origin: ORIGIN, fetch, now: () => 1_000 });
    await expect(client.readSessionNote("session-1")).resolves.toEqual(document);
    await expect(client.saveSessionNote(document, "sha256:one")).resolves.toEqual({ revision: "sha256:two" });
    await expect(client.listBacklinks(sticker)).resolves.toEqual([]);
  });
});
