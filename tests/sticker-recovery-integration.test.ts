import { afterEach, describe, expect, it, vi } from "vitest";
import { createStickerWorkspace, type StickerLocalPersistence, type StickerWorkspace } from "../src/client/sticker-workspace.ts";
import { applyDeepLink } from "../src/client/deep-link.ts";
import type { LocalStickerState, SessionNoteDocument, StickerRecord } from "../src/protocol.ts";

const sessionId = "session";
const sticker: StickerRecord = { stickerId: "a", sessionId, anchorId: "anchor", role: "user", quote: "quote", quoteHash: "sha256:quote", occurrence: 0, markdown: "local", tags: [], color: "yellow" };
function doc(stickers: StickerRecord[] = [sticker], revision = "sha256:local"): SessionNoteDocument {
  return { protocolVersion: 1, type: "session-note", sessionId, revision, stickers };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const workspaces: StickerWorkspace[] = [];
afterEach(() => { for (const workspace of workspaces.splice(0)) workspace.dispose(); });
function fixture(initial = doc(), deletes: StickerRecord[] = []) {
  let state: LocalStickerState = { document: initial, pendingBacklinkDeletes: deletes };
  let revision = 0;
  const local = {
    readLocalState: vi.fn(async () => state),
    saveLocalSession: vi.fn(async (request: Parameters<StickerLocalPersistence["saveLocalSession"]>[0]) => {
      if (request.expectedRevision !== state.document.revision) throw Object.assign(new Error("local CAS"), { code: "revision-conflict" });
      state = { document: { ...request.document, revision: `sha256:${++revision}` }, pendingBacklinkDeletes: request.enqueueBacklinkDelete ? [...state.pendingBacklinkDeletes, request.enqueueBacklinkDelete] : state.pendingBacklinkDeletes };
      return state;
    }),
    acknowledgeBacklinkDelete: vi.fn(async ({ stickerId }: { sessionId: string; stickerId: string }) => {
      state = { ...state, pendingBacklinkDeletes: state.pendingBacklinkDeletes.filter(item => item.stickerId !== stickerId) }; return state;
    }),
  };
  const bridge = {
    readSessionNote: vi.fn(async () => doc([{ ...sticker, markdown: "remote" }], "sha256:remote")),
    saveSessionNote: vi.fn(async () => ({ revision: "sha256:saved" })),
    deleteStickerBacklinks: vi.fn(async () => ({ notesChanged: 1, linksRemoved: 1 })),
  };
  const workspace = createStickerWorkspace(local, bridge); workspaces.push(workspace);
  return { local, bridge, workspace, state: () => state };
}
async function conflicted(f: ReturnType<typeof fixture>) {
  f.bridge.saveSessionNote.mockRejectedValueOnce(Object.assign(new Error("remote conflict"), { code: "revision-conflict" }));
  await f.workspace.ensure(sessionId);
  await vi.waitFor(() => expect(f.workspace.syncStatus(sessionId)).toBe("conflict"));
}

describe("sticker recovery integration", () => {
  it.each(["keep-local", "use-obsidian"] as const)("serializes edits submitted during %s recovery", async choice => {
    const f = fixture(); await conflicted(f);
    const remote = deferred<SessionNoteDocument>();
    f.bridge.readSessionNote.mockReturnValueOnce(remote.promise);
    const resolve = f.workspace.resolveConflict(sessionId, choice);
    await vi.waitFor(() => expect(f.bridge.readSessionNote).toHaveBeenCalledTimes(2));
    const edit = f.workspace.save({ ...sticker, markdown: "edited during recovery" });
    remote.resolve(doc([{ ...sticker, markdown: "remote choice" }], "sha256:r2"));
    await resolve; await edit; await f.workspace.sync(sessionId);
    expect(f.workspace.list(sessionId)[0]?.record.markdown).toBe("edited during recovery");
    expect(f.bridge.saveSessionNote).toHaveBeenLastCalledWith(expect.objectContaining({ stickers: [expect.objectContaining({ markdown: "edited during recovery" })] }), expect.any(String));
  });

  it("does not resurrect a pending deletion when adopting Obsidian after conflict", async () => {
    const f = fixture(); await conflicted(f);
    await f.workspace.remove(sessionId, sticker.stickerId);
    expect(f.state().pendingBacklinkDeletes).toHaveLength(1);
    await f.workspace.resolveConflict(sessionId, "use-obsidian");
    expect(f.workspace.list(sessionId)).toEqual([]);
    expect(f.bridge.saveSessionNote).toHaveBeenLastCalledWith(expect.objectContaining({ stickers: [] }), expect.any(String));
  });

  it("does not start another remote deletion after disposal during local acknowledgment", async () => {
    const second = { ...sticker, stickerId: "b" };
    const f = fixture(doc([]), [sticker, second]);
    const ack = deferred<LocalStickerState>(); f.local.acknowledgeBacklinkDelete.mockReturnValueOnce(ack.promise);
    await f.workspace.ensure(sessionId);
    await vi.waitFor(() => expect(f.local.acknowledgeBacklinkDelete).toHaveBeenCalledTimes(1));
    const completion = f.workspace.sync(sessionId);
    f.workspace.dispose(); ack.resolve({ document: doc([]), pendingBacklinkDeletes: [second] }); await completion;
    expect(f.bridge.deleteStickerBacklinks).toHaveBeenCalledTimes(1);
    expect(f.bridge.readSessionNote).not.toHaveBeenCalled();
  });

  it("does not start a local save after disposal while initial local state is loading", async () => {
    const f = fixture(); const load = deferred<LocalStickerState>(); f.local.readLocalState.mockReturnValueOnce(load.promise);
    const save = f.workspace.save({ ...sticker, markdown: "late" });
    // Attach a rejection handler before releasing the interrupted operation.
    const settled = save.catch(() => undefined);
    await vi.waitFor(() => expect(f.local.readLocalState).toHaveBeenCalledTimes(1));
    f.workspace.dispose(); load.resolve(f.state()); await settled;
    expect(f.local.saveLocalSession).not.toHaveBeenCalled();
  });

  it("does not apply a late conflict-adoption persistence response after disposal", async () => {
    const f = fixture(); await conflicted(f);
    const adoption = deferred<LocalStickerState>(); f.local.saveLocalSession.mockReturnValueOnce(adoption.promise);
    const recovery = f.workspace.resolveConflict(sessionId, "use-obsidian");
    await vi.waitFor(() => expect(f.local.saveLocalSession).toHaveBeenCalledTimes(1));
    f.workspace.dispose(); adoption.resolve({ document: doc([{ ...sticker, markdown: "late remote" }]), pendingBacklinkDeletes: [] });
    await recovery;
    expect(f.workspace.list(sessionId)[0]?.record.markdown).toBe("local");
    expect(f.workspace.health().state).toBe("closed");
  });

  it("reports an initial local load failure in health instead of reporting synced", async () => {
    const f = fixture(); f.local.readLocalState.mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(f.workspace.ensure(sessionId)).rejects.toThrow("disk unavailable");
    expect(f.workspace.health().state).not.toBe("synced");
    expect(f.workspace.health().lastError).toContain("disk unavailable");
    await f.workspace.syncAll();
    expect(f.workspace.syncStatus(sessionId)).toBe("synced");
    expect(f.workspace.health()).toEqual({ state: "synced", pendingCount: 0 });
    expect(f.workspace.syncIssue(sessionId)).toBeUndefined();
  });

  it("stops navigation before opening a session when logical resolution completes after abort", async () => {
    const resolved = deferred<{ sessionId: string }>(); const abort = new AbortController(); const open = vi.fn();
    const ctx = { sessions: { open, list: { getSnapshot: () => ({ phase: "ready", byId: { session: {} } }) } } };
    const navigating = applyDeepLink(ctx as never, { protocolVersion: 1, type: "deep-link", actionId: "action", sessionId, anchorId: "anchor", logicalSessionId: "logical" }, { signal: abort.signal, resolveLogicalTarget: () => resolved.promise });
    const rejected = expect(navigating).rejects.toThrow(); abort.abort(); resolved.resolve({ sessionId }); await rejected;
    expect(open).not.toHaveBeenCalled();
  });

  it("does not locate or open an annotation after an aborted historical page load", async () => {
    const page = deferred<void>(); const abort = new AbortController();
    const loadOlder = vi.fn(() => page.promise); const locate = vi.fn(() => true); const openAnnotation = vi.fn();
    let loaded = false;
    const session = { getSnapshot: () => ({ hasMore: !loaded }), loadOlder };
    const ctx = {
      sessions: { open: vi.fn(), list: { getSnapshot: () => ({ current: sessionId, phase: "ready", byId: { session: {} } }) }, binding: () => ({ session }) },
      uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => ({ order: loaded ? ["anchor"] : [], nodes: { get: () => loaded ? { data: { content: [{ type: "text", text: "quote" }] } } : undefined } }) }) }) },
    };
    const navigating = applyDeepLink(ctx as never, { protocolVersion: 1, type: "deep-link", actionId: "action", sessionId, anchorId: "anchor", setId: "set" }, { signal: abort.signal, locate, openAnnotation });
    const rejected = expect(navigating).rejects.toThrow();
    await vi.waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(1));
    abort.abort(); loaded = true; page.resolve(); await rejected;
    expect(locate).not.toHaveBeenCalled(); expect(openAnnotation).not.toHaveBeenCalled();
  });

  it.each([
    [Object.assign(new Error("disconnected"), { name: "BridgeUnavailableError" }), "local-only"],
    [Object.assign(new Error("unauthorized"), { code: "unauthorized" }), "error"],
    [Object.assign(new Error("stale revision"), { code: "revision-conflict" }), "conflict"],
  ] as const)("classifies %s and exposes its diagnostic", async (error, status) => {
    const f = fixture(); f.bridge.readSessionNote.mockRejectedValueOnce(error);
    await f.workspace.ensure(sessionId);
    await vi.waitFor(() => expect(f.workspace.syncStatus(sessionId)).toBe(status));
    expect(f.workspace.syncIssue(sessionId)).toBe(error.message);
    expect(f.workspace.health()).toMatchObject({ pendingCount: 1, lastError: error.message });
  });
});
