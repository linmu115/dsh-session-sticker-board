import s from "@deepseek-ai/schemastery";
import type { Context as CordisContext } from "@deepseek-ai/cordis";
import { normalizeBridgeOrigin } from "./bridge/http-client.ts";
import type { Context } from "./context-types.ts";
import { StickerBoardRemoteService } from "./remote/service.ts";
import { defaultStickerStorageDirectory, legacyStickerStorageDirectory, StickerLocalStore } from "./host/local-store.ts";
import type { ObsidianBridgeLifecycle } from "dsh-obsidian-bridge/api";

export const name = "dsh-session-sticker-board";

export interface Config {
  bridgeOrigin: string;
  storageDirectory?: string;
}

export const Config = s.object({
  bridgeOrigin: s.string().default(""),
  storageDirectory: s.string(),
});

export const inject = ['annotationCoreHost', 'obsidianBridgeLifecycle'] as const;

export function apply(ctx: Context, config: Config): void {
  const lifecycle = ctx.get('obsidianBridgeLifecycle') as ObsidianBridgeLifecycle | undefined;
  const configuredOrigin = config.bridgeOrigin?.trim();
  const bridgeOrigin = normalizeBridgeOrigin(configuredOrigin || lifecycle?.bridgeOrigin || "http://127.0.0.1:18473");
  if (lifecycle && bridgeOrigin !== lifecycle.bridgeOrigin) {
    throw new Error("Sticker Board and Bridge Lifecycle must use the same Obsidian Bridge address");
  }
  const explicitDirectory = config.storageDirectory?.trim();
  const profileId = lifecycle?.runtimeIdentity?.profileId;
  if (!explicitDirectory && !profileId) throw new Error('Sticker default storage requires the current Bridge profile identity');
  const storageDirectory = explicitDirectory || defaultStickerStorageDirectory(profileId!);
  new StickerBoardRemoteService(
    ctx as unknown as CordisContext,
    bridgeOrigin,
    new StickerLocalStore(storageDirectory, explicitDirectory ? undefined : { root: legacyStickerStorageDirectory(), profileId: profileId! }),
  );
}
