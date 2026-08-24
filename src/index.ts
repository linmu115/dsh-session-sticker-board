import s from "@deepseek-ai/schemastery";
import type { Context as CordisContext } from "@deepseek-ai/cordis";
import type { AnnotationCoreHost } from "dsh-annotation-core/host-api";

import { createBridgeHttpClient, normalizeBridgeOrigin } from "./bridge/http-client.ts";
import type { Context } from "./context-types.ts";
import { createObsidianSourceAdapter } from "./host/obsidian-source-adapter.ts";
import { StickerBoardRemoteService } from "./remote/service.ts";

export const name = "dsh-session-sticker-board";

export interface Config {
  bridgeOrigin: string;
}

export const Config = s.object({
  bridgeOrigin: s.string().default("http://127.0.0.1:18473"),
});

export const inject = [] as const;

export function apply(ctx: Context, config: Config): void {
  const bridgeOrigin = normalizeBridgeOrigin(config.bridgeOrigin);
  const bridge = createBridgeHttpClient({ origin: bridgeOrigin });
  new StickerBoardRemoteService(ctx as unknown as CordisContext, bridgeOrigin);
  const sourceFiber = ctx.inject(["annotationCoreHost"], (injectedContext) => {
    const annotationCoreHost = injectedContext.get("annotationCoreHost") as AnnotationCoreHost | undefined;
    if (annotationCoreHost === undefined) return;
    return annotationCoreHost.registerSourceAdapter("obsidian-note", createObsidianSourceAdapter(bridge));
  });
  ctx.effect(() => () => {
    void sourceFiber.dispose();
    bridge.dispose();
  }, "dsh-session-sticker-board: host");
}
