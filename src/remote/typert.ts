import type { InvocationDescriptor, TypertRemoteContribution } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry/types";
import { z } from "zod";
import { localStickerStateSchema, sessionNoteDocumentSchema, stickerSchema } from "../protocol.ts";

const jsonParameter = (name: string, schema: z.ZodType, typeSymbol: string) => ({
  name,
  wire: name,
  source: "json" as const,
  codec: { mode: "strict" as const, typeSymbol, schema },
});

const localStateCodec = {
  mode: "strict" as const,
  typeSymbol: "dsh-session-sticker-board#LocalStickerState",
  schema: localStickerStateSchema,
};

const saveLocalSessionRequestSchema = z.object({
  document: sessionNoteDocumentSchema,
  expectedRevision: z.string().min(1),
  enqueueBacklinkDelete: stickerSchema.optional(),
}).strict();

const backlinkDeleteAcknowledgementSchema = z.object({
  sessionId: z.string().min(1),
  stickerId: z.string().uuid(),
}).strict();

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
}, {
  id: "dsh-session-sticker-board#stickerBoard/readLocalState",
  service: "stickerBoard",
  namespace: "stickerBoard",
  method: "readLocalState",
  invocation: { kind: "direct" },
  parameters: [jsonParameter("sessionId", z.string().min(1), "string")],
  result: localStateCodec,
}, {
  id: "dsh-session-sticker-board#stickerBoard/saveLocalSession",
  service: "stickerBoard",
  namespace: "stickerBoard",
  method: "saveLocalSession",
  invocation: { kind: "direct" },
  parameters: [jsonParameter("request", saveLocalSessionRequestSchema, "dsh-session-sticker-board#SaveLocalSessionRequest")],
  result: localStateCodec,
}, {
  id: "dsh-session-sticker-board#stickerBoard/acknowledgeBacklinkDelete",
  service: "stickerBoard",
  namespace: "stickerBoard",
  method: "acknowledgeBacklinkDelete",
  invocation: { kind: "direct" },
  parameters: [jsonParameter("request", backlinkDeleteAcknowledgementSchema, "dsh-session-sticker-board#BacklinkDeleteAcknowledgement")],
  result: localStateCodec,
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
      description: "Profile-scoped durable sticker store and optional Obsidian bridge configuration boundary.",
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
