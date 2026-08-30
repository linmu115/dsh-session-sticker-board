import { describe, expect, it, vi } from "vitest";

import { createHostBridgeActionHandler } from "../src/host/reference-delete-actions.ts";
import type { ReferenceDeleteRequestV2 } from "../src/protocol.ts";

const deletion: ReferenceDeleteRequestV2 = {
  annotationProtocolVersion: 2,
  type: "reference-delete-request",
  actionId: "delete-action",
  referenceId: "reference-1",
  profileId: "web",
  sessionId: "session-1",
  setId: "set-1",
  requestedAt: 100,
};

describe("host reference deletion", () => {
  it("forwards matching deletion requests to Core without a browser session", async () => {
    const deleteReferenceLink = vi.fn(async () => ({ deleted: true, scope: "sent" as const }));
    const apply = createHostBridgeActionHandler({ deleteReferenceLink }, "web");

    await expect(apply(deletion)).resolves.toBe(true);
    expect(deleteReferenceLink).toHaveBeenCalledWith("session-1", "set-1", "reference-1");
  });

  it("advances past actions that belong to the browser or another profile", async () => {
    const deleteReferenceLink = vi.fn(async () => ({ deleted: true, scope: "sent" as const }));
    const apply = createHostBridgeActionHandler({ deleteReferenceLink }, "web");

    await expect(apply({ ...deletion, profileId: "other" })).resolves.toBe(true);
    await expect(apply({
      protocolVersion: 1,
      type: "deep-link",
      actionId: "deep-link-action",
      sessionId: "session-1",
      anchorId: "anchor-1",
    })).resolves.toBe(true);
    expect(deleteReferenceLink).not.toHaveBeenCalled();
  });
})
