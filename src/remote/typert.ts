import type { InvocationDescriptor, TypertRemoteContribution } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry/types";
import { z } from "zod";

export const STICKER_REMOTE_DESCRIPTORS: readonly InvocationDescriptor[] = [{
  id: "dsh-session-sticker-board#stickerBoard/getBridgeConfig",
  service: "stickerBoard",
  namespace: "stickerBoard",
  method: "getBridgeConfig",
  invocation: { kind: "direct" },
  parameters: [],
  result: {
    mode: "strict",
    typeSymbol: "dsh-session-sticker-board#BridgeConfig",
    schema: z.object({ origin: z.string().url() }).strict(),
  },
}];

export const TYPERT: TypertContribution = {
  package: "dsh-session-sticker-board",
  face: "host",
  schemas: [],
  invocations: STICKER_REMOTE_DESCRIPTORS,
  model: {
    services: [{
      key: "stickerBoard",
      exportName: "StickerBoardRemoteService",
      members: [],
      types: [],
      tags: [],
      description: "Profile-scoped Obsidian bridge configuration boundary.",
    }],
    events: [],
    objects: [],
  },
};

export const STICKER_REMOTE: TypertRemoteContribution = {
  package: "dsh-session-sticker-board",
  descriptors: STICKER_REMOTE_DESCRIPTORS,
};

export default TYPERT;
