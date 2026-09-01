import { describe, expect, it, vi } from "vitest";

import { mountStickerRemote } from "../src/client/remote.ts";
import { StickerBoardRemoteService } from "../src/remote/service.ts";
import { STICKER_REMOTE, TYPERT } from "../src/remote/typert.ts";

describe("sticker bridge Remote boundary", () => {
  it("declares profile-scoped bridge configuration and durable local sticker operations", () => {
    expect(TYPERT.package).toBe("dsh-session-sticker-board");
    expect(TYPERT.face).toBe("host");
    expect(STICKER_REMOTE.descriptors).toHaveLength(4);
    expect(STICKER_REMOTE.descriptors[0]).toMatchObject({
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

  it("returns the Host-selected non-default bridge origin", () => {
    const service = Object.create(StickerBoardRemoteService.prototype) as StickerBoardRemoteService;
    Object.defineProperty(service, "origin", { value: "http://127.0.0.1:28473" });
    expect(service.getBridgeConfig()).toEqual({ origin: "http://127.0.0.1:28473" });
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
