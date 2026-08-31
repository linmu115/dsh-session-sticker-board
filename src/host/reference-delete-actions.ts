import type { BridgeAction } from "../bridge/http-client.ts";
import type { ReferenceDeleteRequestV2 } from "../protocol.ts";

type HostDeletionCapability = {
  deleteReferenceLink: (
    sessionId: string,
    setId: string,
    referenceId: string,
  ) => Promise<{ deleted: boolean; scope: "pending" | "sent" }>;
};

type ReferenceDeleteAcknowledger = {
  discardReference(referenceId: string): Promise<void>;
  deleteCommittedReference(commit: {
    annotationProtocolVersion: 2;
    type: "reference-delete-commit";
    referenceId: string;
    profileId: string;
    sessionId: string;
    setId: string;
    deletedAt: number;
  }): Promise<void>;
};

export async function confirmAlreadyDeletedReference(
  bridge: ReferenceDeleteAcknowledger,
  action: ReferenceDeleteRequestV2,
  result: { deleted: boolean; scope: "pending" | "sent" },
): Promise<void> {
  if (result.deleted) return;
  if (result.scope === "pending") {
    await bridge.discardReference(action.referenceId);
    return;
  }
  await bridge.deleteCommittedReference({
    annotationProtocolVersion: action.annotationProtocolVersion,
    type: "reference-delete-commit",
    referenceId: action.referenceId,
    profileId: action.profileId,
    sessionId: action.sessionId,
    setId: action.setId,
    deletedAt: action.requestedAt,
  });
}

/** Apply only durable cross-app deletion on the DSH host; UI actions stay browser-owned. */
export function createHostBridgeActionHandler(
  core: HostDeletionCapability,
  bridge: ReferenceDeleteAcknowledger,
  profileId: string,
): (action: BridgeAction) => Promise<boolean> {
  return async (action) => {
    if (action.type !== "reference-delete-request" || action.profileId !== profileId) return false;
    const result = await core.deleteReferenceLink(action.sessionId, action.setId, action.referenceId);
    await confirmAlreadyDeletedReference(bridge, action, result);
    return true;
  };
}
