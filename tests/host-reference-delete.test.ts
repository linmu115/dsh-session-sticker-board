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
    const discardReference = vi.fn(async () => undefined);
    const deleteCommittedReference = vi.fn(async () => undefined);
    const apply = createHostBridgeActionHandler({ deleteReferenceLink }, { discardReference, deleteCommittedReference }, "web");

    await expect(apply(deletion)).resolves.toBe(true);
    expect(deleteReferenceLink).toHaveBeenCalledWith("session-1", "set-1", "reference-1");
    expect(discardReference).not.toHaveBeenCalled();
    expect(deleteCommittedReference).not.toHaveBeenCalled();
  });

  it("confirms pending deletion directly so an old Core tombstone can drain the Bridge outbox", async () => {
    const deleteReferenceLink = vi.fn(async () => ({ deleted: false, scope: "pending" as const }));
    const discardReference = vi.fn(async () => undefined);
    const deleteCommittedReference = vi.fn(async () => undefined);
    const apply = createHostBridgeActionHandler({ deleteReferenceLink }, { discardReference, deleteCommittedReference }, "web");

    await expect(apply(deletion)).resolves.toBe(true);
    expect(discardReference).toHaveBeenCalledWith("reference-1");
    expect(deleteCommittedReference).not.toHaveBeenCalled();
  });

  it("commits an already-absent sent relation so the Bridge tombstone terminates", async () => {
    const deleteReferenceLink = vi.fn(async () => ({ deleted: false, scope: "sent" as const }));
    const discardReference = vi.fn(async () => undefined);
    const deleteCommittedReference = vi.fn(async () => undefined);
    const apply = createHostBridgeActionHandler({ deleteReferenceLink }, { discardReference, deleteCommittedReference }, "web");

    await expect(apply(deletion)).resolves.toBe(true);
    expect(discardReference).not.toHaveBeenCalled();
    expect(deleteCommittedReference).toHaveBeenCalledWith({
      annotationProtocolVersion: 2,
      type: "reference-delete-commit",
      referenceId: "reference-1",
      profileId: "web",
      sessionId: "session-1",
      setId: "set-1",
      deletedAt: 100,
    });
  });

  it("leaves browser actions and other profiles for their owning consumer", async () => {
    const deleteReferenceLink = vi.fn(async () => ({ deleted: true, scope: "sent" as const }));
    const discardReference = vi.fn(async () => undefined);
    const deleteCommittedReference = vi.fn(async () => undefined);
    const apply = createHostBridgeActionHandler({ deleteReferenceLink }, { discardReference, deleteCommittedReference }, "web");

    await expect(apply({ ...deletion, profileId: "other" })).resolves.toBe(false);
    await expect(apply({
      protocolVersion: 1,
      type: "deep-link",
      actionId: "deep-link-action",
      sessionId: "session-1",
      anchorId: "anchor-1",
    })).resolves.toBe(false);
    expect(deleteReferenceLink).not.toHaveBeenCalled();
    expect(discardReference).not.toHaveBeenCalled();
    expect(deleteCommittedReference).not.toHaveBeenCalled();
  });
})
