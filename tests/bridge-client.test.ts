import { describe, expect, it, vi } from "vitest";

import { createBridgeClient } from "../src/client/bridge-client.ts";
import type {
  DeepLinkAction,
  OpenNoteAction,
  ResolvedCitation,
  SessionNoteDocument,
} from "../src/protocol.ts";

const action: DeepLinkAction = {
  protocolVersion: 1,
  type: "deep-link",
  actionId: "6f09f1be-5dc1-48e4-ac08-e3c05d70ac01",
  sessionId: "session-demo",
  anchorId: "user-node-42",
  quoteHash: "sha256:30101ebf",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("DSH bridge client", () => {
  it("re-handshakes once after 401 and acknowledges an applied action", async () => {
    const responses = [
      json(200, { token: "old-token", expiresAt: 20_000 }),
      json(401, { error: "expired" }),
      json(200, { token: "new-token", expiresAt: 30_000 }),
      json(200, { cursor: 1, actions: [{ cursor: 1, message: action }] }),
      json(200, { acknowledged: true, actionId: action.actionId }),
    ];
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => responses.shift() ?? json(500, {}));
    const client = createBridgeClient({ origin: "http://127.0.0.1:27124", fetch, now: () => 1_000 });

    const actions = await client.nextActions();
    expect(actions).toEqual([{ cursor: 1, message: action }]);
    await client.applyActions(actions, async () => true);

    const handshakes = fetch.mock.calls.filter(([url]) => String(url).endsWith("/v1/handshake"));
    const acknowledgements = fetch.mock.calls.filter(([url]) => String(url).endsWith(`/v1/actions/${action.actionId}/ack`));
    expect(handshakes).toHaveLength(2);
    expect(acknowledgements).toHaveLength(1);
  });

  it("does not acknowledge an action that the DSH UI could not apply", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/v1/handshake")) return json(200, { token: "token", expiresAt: 20_000 });
      if (String(url).includes("/actions/next")) return json(200, { cursor: 1, actions: [{ cursor: 1, message: action }] });
      return json(200, {});
    });
    const client = createBridgeClient({ origin: "http://127.0.0.1:27124", fetch, now: () => 1_000 });
    const actions = await client.nextActions();

    const result = await client.applyActions(actions, async () => false);

    expect(result).toEqual({ applied: 0, cursor: 0 });
    expect(fetch.mock.calls.some(([url]) => String(url).includes("/ack"))).toBe(false);
  });

  it("aborts in-flight requests after disposal", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const client = createBridgeClient({ origin: "http://127.0.0.1:27124", fetch });
    const pending = client.nextActions();
    client.dispose();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("uses slower polling while the DSH page is hidden", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/v1/handshake")) return json(200, { token: "token", expiresAt: 20_000 });
      return json(200, { cursor: 0, actions: [] });
    });
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    const client = createBridgeClient({ origin: "http://127.0.0.1:27124", fetch, now: () => 1_000 });
    const polling = client.startPolling(async () => true, {
      visibilityState: () => "hidden",
      schedule: (callback, delay) => {
        scheduled.push({ callback, delay });
        return () => undefined;
      },
    });

    await polling.firstCycle;
    expect(scheduled[0]?.delay).toBe(3_000);
    polling.stop();
  });

  it("reads and saves session notes, resolves citations and opens notes", async () => {
    const document: SessionNoteDocument = {
      protocolVersion: 1,
      type: "session-note",
      sessionId: "session-demo",
      revision: "sha256:one",
      stickers: [],
    };
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), ...(init ? { init } : {}) });
      if (String(url).endsWith("/v1/handshake")) return json(200, { token: "token", expiresAt: 20_000 });
      if (init?.method === "PUT") return json(200, { revision: "sha256:two" });
      if (String(url).endsWith("/v1/citations/resolve")) return json(200, { notePath: "note.md", blockId: "dsh-ref-a17" });
      if (String(url).endsWith("/v1/obsidian/open-note")) return json(200, { opened: true });
      return json(200, document);
    });
    const client = createBridgeClient({ origin: "http://127.0.0.1:27124", fetch, now: () => 1_000 });
    const resolved: ResolvedCitation = {
      protocolVersion: 1,
      type: "resolved-citation",
      citationId: "76213b70-7f6e-41be-b2e3-1b195cbf1268",
      sessionId: "session-demo",
      anchorId: "user-node-42",
      role: "user",
      quoteHash: "sha256:30101ebf",
    };
    const openNote: OpenNoteAction = {
      protocolVersion: 1,
      type: "open-note",
      actionId: "1378702f-84d2-4e73-9f74-c08d269b2c7f",
      notePath: "note.md",
      blockId: "dsh-ref-a17",
    };

    expect(await client.readSessionNote("session-demo")).toEqual(document);
    expect(await client.saveSessionNote(document, "sha256:one")).toEqual({ revision: "sha256:two" });
    expect(await client.resolveCitation(resolved)).toEqual({ notePath: "note.md", blockId: "dsh-ref-a17" });
    await client.openNote(openNote);

    const put = requests.find((request) => request.init?.method === "PUT");
    expect(JSON.parse(String(put?.init?.body))).toEqual({ document, expectedRevision: "sha256:one" });
    expect(requests.some((request) => request.url.endsWith("/v1/obsidian/open-note"))).toBe(true);
  });
});
