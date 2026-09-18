import { z } from "zod";
import {
  ReferenceDeleteRequestV2Schema as BaseReferenceDeleteRequestV2Schema,
} from "dsh-annotation-core/protocol";

export {
  ANNOTATION_PROTOCOL_VERSION,
  BacklinkCommitV2Schema,
  BacklinkReceiptV2Schema,
  ObsidianNoteReferenceSourceSchema,
  ObsidianReferenceCaptureV2Schema,
  ReferenceClaimV2Schema,
  ReferenceDiscardV2Schema,
  ReferenceDeleteCommitV2Schema,
  ReferenceRefreshRequestV2Schema,
  ReferenceRefreshResultV2Schema,
  canonicalSha256,
  documentHash,
  selectedTextHash,
} from "dsh-annotation-core/protocol";
export type {
  BacklinkCommitV2,
  BacklinkReceiptV2,
  ObsidianNoteReferenceSource,
  ObsidianReferenceCaptureV2,
  ReferenceClaimV2,
  ReferenceDiscardV2,
  ReferenceDeleteCommitV2,
  ReferenceRefreshRequestV2,
  ReferenceRefreshResultV2,
} from "dsh-annotation-core/protocol";

import { sessionNoteDocumentSchema, stableLogicalTargetShape, stickerSchema } from "dsh-obsidian-bridge-protocol/data";
export * from "dsh-obsidian-bridge-protocol/data";

export const ReferenceDeleteRequestV2Schema = BaseReferenceDeleteRequestV2Schema.extend(stableLogicalTargetShape).strict();
export type ReferenceDeleteRequestV2 = z.infer<typeof ReferenceDeleteRequestV2Schema>;

export const pendingBacklinkDeleteSchema = stickerSchema.extend({ pendingVaultIds: z.array(z.string().min(1)).max(256).optional() });
export type PendingBacklinkDelete = z.infer<typeof pendingBacklinkDeleteSchema>;

// This persisted local outbox is DSH-owned, outside the cross-app wire schema.
export const localStickerStateSchema = z.object({
  document: sessionNoteDocumentSchema,
  pendingBacklinkDeletes: z.array(pendingBacklinkDeleteSchema),
}).strict();
export type LocalStickerState = z.infer<typeof localStickerStateSchema>;
