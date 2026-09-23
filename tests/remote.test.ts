import { describe, expect, it, vi } from "vitest";

import { mountStickerRemote } from "../src/client/remote.ts";
import { StickerBoardRemoteService } from "../src/remote/service.ts";
import { STICKER_REMOTE, TYPERT } from "../src/remote/typert.ts";

describe("sticker bridge Remote boundary", () => {
  it('unmounts and settles cancellation without waiting for a hung configuration request', async () => {
    const abort = new AbortController();
    const dispose = vi.fn(async () => {});
    const config = vi.fn(() => new Promise<never>(() => {}));
    const get = (name: string) => name === 'remote' ? { $mount: async () => dispose } : { getBridgeConfig: config };
    const mounting = mountStickerRemote({ get } as never, abort.signal);
    await vi.waitFor(() => expect(config).toHaveBeenCalledOnce());
    abort.abort();
    await expect(mounting).rejects.toMatchObject({ name: 'AbortError' });
    expect(dispose).toHaveBeenCalledOnce();
  });
  it.each(['mount', 'configuration'])('releases a remote acquired after cancellation during %s', async (phase) => {
    const abort = new AbortController();
    const dispose = vi.fn(async () => {});
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const namespace = { getBridgeConfig: async () => {
      if (phase === 'configuration') await pending;
      return { ok: true, value: { origin: 'http://127.0.0.1:28473' } };
    } };
    const get = vi.fn((name: string) => name === 'remote' ? { $mount: async () => { if (phase === 'mount') await pending; return dispose; } } : namespace);
    const mounting = mountStickerRemote({ get } as never, abort.signal);
    await Promise.resolve();
    abort.abort(); finish();
    await expect(mounting).rejects.toMatchObject({ name: 'AbortError' });
    expect(dispose).toHaveBeenCalledOnce();
    if (phase === 'mount') expect(get).toHaveBeenCalledTimes(1);
  });
  it("declares profile-scoped bridge configuration and durable local sticker operations", () => {
    expect(TYPERT.package).toBe("dsh-session-sticker-board");
    expect(TYPERT.face).toBe("host");
    expect(STICKER_REMOTE.descriptors).toHaveLength(4);
    expect(STICKER_REMOTE.descriptors.find(d => d.method === 'getBridgeConfig')).toMatchObject({
      namespace: "stickerBoard",
      method: "getBridgeConfig",
      invocation: { kind: "direct" },
      parameters: [],
    });
    expect(STICKER_REMOTE.descriptors[0]?.scope).toBeUndefined();
    expect(STICKER_REMOTE.descriptors.map((descriptor) => descriptor.method)).toEqual([
      "getBridgeConfig", "readLocalState", "saveLocalSession", "acknowledgeBacklinkDelete",
    ]);
  });

  it("returns the Host-selected non-default bridge origin", async () => {
    const service = Object.create(StickerBoardRemoteService.prototype) as StickerBoardRemoteService;
    Object.defineProperty(service, "origin", { value: "http://127.0.0.1:28473" });
    Object.defineProperty(service, 'hostContext', { value: { get: () => undefined } });
    await expect(service.getBridgeConfig()).resolves.toEqual({ origin: "http://127.0.0.1:28473" });
  });

  it("mounts, reads and disposes the same descriptor on the Client", async () => {
    const dispose = vi.fn(async () => undefined);
    const mount = vi.fn(async () => dispose);
    const ctx = {
      get(name: string) {
        if (name === "remote") return { $mount: mount };
        if (name === "remote.stickerBoard") return {
          getBridgeConfig: async () => ({ ok: true as const, value: { origin: "http://127.0.0.1:28473" } }),
          readLocalState: async (sessionId: string) => ({ ok: true as const, value: { document: {
              protocolVersion: 1 as const,
              type: "session-note" as const,
              sessionId,
              revision: "sha256:empty",
              stickers: [],
            }, pendingBacklinkDeletes: [],
          } }),
          saveLocalSession: async (request: unknown) => ({ ok: true as const, value: {
            document: (request as { document: unknown }).document,
            pendingBacklinkDeletes: [],
          } }),
          acknowledgeBacklinkDelete: async () => ({ ok: true as const, value: { document: {
            protocolVersion: 1 as const,
            type: "session-note" as const,
            sessionId: "session-demo",
            revision: "sha256:empty",
            stickers: [],
          }, pendingBacklinkDeletes: [] } }),
        };
        return undefined;
      },
    };
    const mounted = await mountStickerRemote(ctx as never);
    expect(mount).toHaveBeenCalledWith(STICKER_REMOTE);
    expect(mounted.origin).toBe("http://127.0.0.1:28473");
    await expect(mounted.readLocalState("session-demo")).resolves.toMatchObject({ document: { sessionId: "session-demo" } });
    await mounted.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
