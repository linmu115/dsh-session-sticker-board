import type { BridgeAction } from "../bridge/http-client.ts";

type HostDeletionCapability = {
  deleteReferenceLink: (
    sessionId: string,
    setId: string,
    referenceId: string,
  ) => Promise<{ deleted: boolean; scope: "pending" | "sent" }>;
};

/** Apply only durable cross-app deletion on the DSH host; UI actions stay browser-owned. */
export function createHostBridgeActionHandler(
  core: HostDeletionCapability,
  profileId: string,
): (action: BridgeAction) => Promise<boolean> {
  return async (action) => {
    if (action.type !== "reference-delete-request" || action.profileId !== profileId) return true;
    await core.deleteReferenceLink(action.sessionId, action.setId, action.referenceId);
    return true;
  };
}
