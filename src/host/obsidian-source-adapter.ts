import type { DeletedReferenceBinding, HostSourceAdapter, SentReferenceBinding } from "dsh-annotation-core/host-api";

import { BridgeHttpError, BridgeUnavailableError, type BridgeHttpClient } from "../bridge/http-client.ts";
import { ANNOTATION_PROTOCOL_VERSION } from "../protocol.ts";

type SourceBridge = Pick<BridgeHttpClient, "refreshReference" | "discardReference" | "commitBacklink" | "deleteCommittedReference">;
type ReferenceItem = SentReferenceBinding["item"];

type SourcePreparationErrorCode =
  | "online-refresh-failed"
  | "source-missing"
  | "source-changed"
  | "protocol-mismatch";

class ObsidianSourcePreparationError extends Error {
  constructor(readonly code: SourcePreparationErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ObsidianSourcePreparationError";
  }
}

function obsidianItem(item: ReferenceItem): asserts item is Extract<ReferenceItem, { sourceType: "obsidian-note" }> {
  if (item.sourceType !== "obsidian-note") {
    throw new ObsidianSourcePreparationError("protocol-mismatch", "Obsidian adapter received a non-Obsidian reference");
  }
}

function offline(item: Extract<ReferenceItem, { sourceType: "obsidian-note" }>): ReferenceItem {
  return { ...item, snapshot: { ...item.snapshot, freshness: "offline" } };
}

function preparationError(error: unknown): ObsidianSourcePreparationError {
  if (error instanceof ObsidianSourcePreparationError) return error;
  if (error instanceof BridgeHttpError) {
    if (error.code === "source-changed") return new ObsidianSourcePreparationError("source-changed", error.message, { cause: error });
    if (error.code === "note-not-found") return new ObsidianSourcePreparationError("source-missing", error.message, { cause: error });
    if (error.code === "protocol-mismatch") return new ObsidianSourcePreparationError("protocol-mismatch", error.message, { cause: error });
  }
  return new ObsidianSourcePreparationError("online-refresh-failed", error instanceof Error ? error.message : String(error), { cause: error });
}

export function createObsidianSourceAdapter(bridge: SourceBridge): HostSourceAdapter {
  return {
    async prepare(item, signal) {
      obsidianItem(item);
      let result;
      try {
        result = await bridge.refreshReference(item.referenceId, item.snapshot.documentHash, signal);
      } catch (error) {
        if (error instanceof BridgeUnavailableError) return offline(item);
        throw preparationError(error);
      }
      if (result.kind === "offline") return offline(item);
      if (result.kind === "blocked") {
        const code = result.reason === "note-missing" || result.reason === "block-missing"
          ? "source-missing"
          : "source-changed";
        throw new ObsidianSourcePreparationError(code, `Obsidian source cannot be prepared: ${result.reason}`);
      }
      return { ...item, ...result.source };
    },
    async discardPending(item) {
      obsidianItem(item);
      await bridge.discardReference(item.referenceId);
    },
    async commitBacklink(binding: SentReferenceBinding) {
      obsidianItem(binding.item);
      return bridge.commitBacklink({
        annotationProtocolVersion: ANNOTATION_PROTOCOL_VERSION,
        type: "backlink-commit",
        referenceId: binding.referenceId,
        setId: binding.setId,
        profileId: binding.profileId,
        sessionId: binding.sessionId,
        userMessageId: binding.userMessageId,
        userAnchorId: binding.userAnchorId,
        userTextHash: binding.userTextHash,
      });
    },
    async deleteCommitted(binding: DeletedReferenceBinding) {
      obsidianItem(binding.item);
      await bridge.deleteCommittedReference({
        annotationProtocolVersion: ANNOTATION_PROTOCOL_VERSION,
        type: "reference-delete-commit",
        referenceId: binding.referenceId,
        profileId: binding.profileId,
        sessionId: binding.sessionId,
        setId: binding.setId,
        deletedAt: binding.deletedAt,
      });
    },
  };
}
