import { describe, expect, it, vi } from "vitest";

import { mountStickerRemote } from "../src/client/remote.ts";
import { StickerBoardRemoteService } from "../src/remote/service.ts";
import { STICKER_REMOTE, TYPERT } from "../src/remote/typert.ts";

describe("sticker bridge Remote boundary", () => {
  it("declares one profile-scoped bridge configuration descriptor with no business arguments", () => {
    expect(TYPERT.package).toBe("dsh-session-sticker-board");
    expect(TYPERT.face).toBe("host");
    expect(STICKER_REMOTE.descriptors).toHaveLength(1);
    expect(STICKER_REMOTE.descriptors[0]).toMatchObject({
      namespace: "stickerBoard",
      method: "getBridgeConfig",
      invocation: { kind: "direct" },
      parameters: [],
    });
    expect(STICKER_REMOTE.descriptors[0]?.scope).toBeUndefined();
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
        };
        return undefined;
      },
    };
    const mounted = await mountStickerRemote(ctx as never);
    expect(mount).toHaveBeenCalledWith(STICKER_REMOTE);
    expect(mounted.origin).toBe("http://127.0.0.1:28473");
    await mounted.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
