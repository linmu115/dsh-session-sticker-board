import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {StickerLocalStore} from '../src/host/local-store.ts';
import { describe, expect, it, vi } from "vitest";

import { createStickerWorkspace } from "../src/client/sticker-workspace.ts";
import { createStickerBridgeChannel } from '../src/client/bridge-channel.ts';
import type { SessionNoteDocument, StickerRecord } from "../src/protocol.ts";

const sticker: StickerRecord = {
  stickerId: "9bb3a80e-230d-44d1-a37c-f7b79d2bf315",
  sessionId: "session-demo",
  anchorId: "message:user-2",
  role: "user",
  quote: "完整组合",
  quoteHash: "sha256:quote",
  occurrence: 0,
  markdown: "初始说明",
  tags: ["架构"],
  color: "yellow",
};

function document(stickers: StickerRecord[] = [], revision = "sha256:empty"): SessionNoteDocument {
  return {
    protocolVersion: 1,
    type: "session-note",
    sessionId: "session-demo",
    revision,
    stickers,
  };
}

function local(initial = document()) {
  let current = { document: initial, pendingBacklinkDeletes: [] as StickerRecord[] };
  return {
    readLocalState: vi.fn(async () => current),
    saveLocalSession: vi.fn(async (request: { document: SessionNoteDocument; expectedRevision: string; enqueueBacklinkDelete?: StickerRecord }) => {
      if (request.expectedRevision !== current.document.revision) throw new Error("REVISION_CONFLICT");
      current = {
        document: { ...request.document, revision: `sha256:local-${request.document.stickers.length}-${request.document.stickers[0]?.markdown ?? "empty"}` },
        pendingBacklinkDeletes: request.enqueueBacklinkDelete === undefined
          ? current.pendingBacklinkDeletes
          : [...current.pendingBacklinkDeletes, request.enqueueBacklinkDelete],
      };
      return current;
    }),
    acknowledgeBacklinkDelete: vi.fn(async ({ stickerId }: { sessionId: string; stickerId: string }) => {
      current = { ...current, pendingBacklinkDeletes: current.pendingBacklinkDeletes.filter((record) => record.stickerId !== stickerId) };
      return current;
    }),
  };
}

function offlineBridge() {
  return {
    readSessionNote: vi.fn(async () => { throw new TypeError("offline"); }),
    saveSessionNote: vi.fn(async () => { throw new TypeError("offline"); }),
    deleteStickerBacklinks: vi.fn(async () => { throw new TypeError("offline"); }),
  };
}

describe("sticker workspace", () => {
  it('waits for its first Vault metadata commit before saving a newly selected sticker', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sticker-first-save-race-'));
    const store = new StickerLocalStore(directory);
    let release!: () => void;
    const metadataReturned = new Promise<void>(resolve => { release = resolve; });
    let committed = false;
    const persistence = {
      readLocalState: (id: string) => store.read(id),
      saveLocalSession: vi.fn(async (request: Parameters<StickerLocalStore['save']>[0]) => {
        const result = await store.save(request);
        if (!request.document.stickers.length) { committed = true; await metadataReturned; }
        return result;
      }),
      acknowledgeBacklinkDelete: ({ sessionId, stickerId }: { sessionId: string; stickerId: string }) => store.acknowledgeBacklinkDelete(sessionId, stickerId),
    };
    const route = { readSessionNote: vi.fn(async () => document()), saveSessionNote: vi.fn(async () => ({ revision: 'saved' })), deleteStickerBacklinks: vi.fn() };
    const workspace = createStickerWorkspace(persistence, { ...route, listVaults: () => [{ vaultId: 'vault-a', state: 'bound' }] as never, forVault: () => route as never });
    try {
      await workspace.ensure(sticker.sessionId);
      await vi.waitFor(() => expect(committed).toBe(true));
      const saving = workspace.save(sticker);
      await Promise.resolve(); await Promise.resolve();
      expect(persistence.saveLocalSession).toHaveBeenCalledTimes(1);
      expect((await store.read(sticker.sessionId)).document.revision).not.toBe('sha256:empty');
      release();
      await saving;
      await workspace.sync(sticker.sessionId);
      expect((await store.read(sticker.sessionId)).document).toMatchObject({ vaultId: 'vault-a', stickers: [sticker] });
      expect(workspace.revision(sticker.sessionId)).toBe((await store.read(sticker.sessionId)).document.revision);
    } finally { release(); workspace.dispose(); await rm(directory, { recursive: true, force: true }); }
  });

  it('adopts another client metadata-only revision but refuses a later genuine content edit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sticker-multiclient-race-'));
    const store = new StickerLocalStore(directory);
    const persistence = {
      readLocalState: (id: string) => store.read(id), saveLocalSession: store.save.bind(store),
      acknowledgeBacklinkDelete: ({ sessionId, stickerId }: { sessionId: string; stickerId: string }) => store.acknowledgeBacklinkDelete(sessionId, stickerId),
    };
    const bridge = offlineBridge();
    const workspace = createStickerWorkspace(persistence, bridge);
    try {
      await workspace.ensure(sticker.sessionId); await workspace.sync(sticker.sessionId);
      const otherClient = await store.save({ document: { ...document(), vaultId: 'vault-a' }, expectedRevision: 'sha256:empty' });
      expect(workspace.revision(sticker.sessionId)).toBe('sha256:empty');
      await workspace.sync(sticker.sessionId);
      expect(workspace.revision(sticker.sessionId)).toBe(otherClient.document.revision);
      await workspace.save(sticker); await workspace.sync(sticker.sessionId);
      const baseline = await store.read(sticker.sessionId);
      const concurrent = await store.save({ document: { ...baseline.document, stickers: [{ ...sticker, markdown: 'other client edit' }] }, expectedRevision: baseline.document.revision });
      await expect(workspace.save({ ...sticker, markdown: 'stale client draft' })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
      expect((await store.read(sticker.sessionId)).document).toEqual(concurrent.document);
      expect(workspace.list(sticker.sessionId)[0]?.record.markdown).toBe(sticker.markdown);
      expect(workspace.syncStatus(sticker.sessionId)).toBe('conflict');
      expect(bridge.saveSessionNote).not.toHaveBeenCalled();
    } finally { workspace.dispose(); await rm(directory, { recursive: true, force: true }); }
  });

  it('imports existing remote stickers after its first Vault pin, but never resurrects an explicitly emptied document', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sticker-pristine-import-'));
    const store = new StickerLocalStore(directory);
    const persistence = {
      readLocalState: (id: string) => store.read(id), saveLocalSession: store.save.bind(store),
      acknowledgeBacklinkDelete: ({ sessionId, stickerId }: { sessionId: string; stickerId: string }) => store.acknowledgeBacklinkDelete(sessionId, stickerId),
    };
    const route = { readSessionNote: vi.fn(async () => document([sticker], 'sha256:remote')), saveSessionNote: vi.fn(async () => ({ revision: 'saved' })), deleteStickerBacklinks: vi.fn(async () => ({ notesChanged: 0, linksRemoved: 0 })) };
    const bridge = { ...route, listVaults: () => [{ vaultId: 'vault-a', state: 'bound' }] as never, forVault: () => route as never };
    let workspace = createStickerWorkspace(persistence, bridge);
    try {
      await workspace.ensure(sticker.sessionId); await workspace.sync(sticker.sessionId);
      expect(workspace.list(sticker.sessionId)).toHaveLength(1);
      await workspace.remove(sticker.sessionId, sticker.stickerId); await workspace.sync(sticker.sessionId);
      expect(workspace.list(sticker.sessionId)).toHaveLength(0);
      workspace.dispose(); workspace = createStickerWorkspace(persistence, bridge);
      await workspace.ensure(sticker.sessionId); await workspace.sync(sticker.sessionId);
      expect(workspace.list(sticker.sessionId)).toHaveLength(0);
      expect((await store.read(sticker.sessionId)).document.stickers).toEqual([]);
      expect(route.saveSessionNote).toHaveBeenLastCalledWith(expect.objectContaining({ stickers: [] }), 'sha256:remote');
    } finally { workspace.dispose(); await rm(directory, { recursive: true, force: true }); }
  });

  it('keeps independent local CRUD available with no remote knowledge service injected', async () => {
    const persistence = local();
    const workspace = createStickerWorkspace(persistence, createStickerBridgeChannel(() => undefined));
    await workspace.save(sticker);
    await workspace.save({ ...sticker, markdown: '无 Bridge 的编辑' });
    expect(workspace.list(sticker.sessionId)[0]?.record.markdown).toBe('无 Bridge 的编辑');
    await workspace.remove(sticker.sessionId, sticker.stickerId);
    expect(workspace.list(sticker.sessionId)).toHaveLength(0);
    await workspace.syncAll();
    expect(workspace.syncStatus(sticker.sessionId)).toBe('local-only');
    expect((await persistence.readLocalState()).pendingBacklinkDeletes).toHaveLength(1);
    workspace.dispose();
  });

  it('surfaces an unreadable local store instead of writing a replacement', async () => {
    const persistence = local();
    persistence.readLocalState.mockRejectedValue(new Error('store unreadable'));
    const workspace = createStickerWorkspace(persistence, createStickerBridgeChannel(() => undefined));
    await expect(workspace.save(sticker)).rejects.toThrow('store unreadable');
    expect(persistence.saveLocalSession).not.toHaveBeenCalled();
    expect(workspace.list(sticker.sessionId)).toHaveLength(0);
    workspace.dispose();
  });

  it("keeps a write conflict visible and requires a content choice before retrying", async () => {
    const persistence = local(document([sticker], "sha256:local"));
    const bridge = {
      readSessionNote: vi.fn(async () => document([{ ...sticker, markdown: "Obsidian edit" }], "sha256:remote")),
      saveSessionNote: vi.fn(async () => ({ revision: "sha256:saved" })),
      deleteStickerBacklinks: vi.fn(async () => ({ notesChanged: 0, linksRemoved: 0 })),
    };
    bridge.saveSessionNote.mockRejectedValueOnce(Object.assign(new Error("Note changed during save"), { code: "revision-conflict" }));
    const workspace = createStickerWorkspace(persistence, bridge);
    await workspace.ensure("session-demo");
    await vi.waitFor(() => expect(workspace.syncStatus("session-demo")).toBe("conflict"));
    await workspace.syncAll();
    expect(bridge.saveSessionNote).toHaveBeenCalledTimes(1);
    expect(workspace.syncIssue("session-demo")).toBe("Note changed during save");
    expect(workspace.health()).toMatchObject({ state: "conflict", pendingCount: 1 });
    await workspace.resolveConflict("session-demo", "use-obsidian");
    expect(workspace.list("session-demo")[0]?.record.markdown).toBe("Obsidian edit");
    expect(workspace.syncStatus("session-demo")).toBe("synced");
    expect(workspace.syncIssue("session-demo")).toBeUndefined();
  });

  it("can explicitly keep local content after a conflict", async () => {
    const persistence = local(document([sticker], "sha256:local"));
    const bridge = {
      readSessionNote: vi.fn(async () => document([], "sha256:remote")),
      saveSessionNote: vi.fn(async () => ({ revision: "sha256:saved" })),
      deleteStickerBacklinks: vi.fn(async () => ({ notesChanged: 0, linksRemoved: 0 })),
    };
    bridge.saveSessionNote.mockRejectedValueOnce(Object.assign(new Error("conflict"), { code: "REVISION_CONFLICT" }));
    const workspace = createStickerWorkspace(persistence, bridge);
    await workspace.ensure("session-demo");
    await vi.waitFor(() => expect(workspace.syncStatus("session-demo")).toBe("conflict"));
    await workspace.resolveConflict("session-demo", "keep-local");
    expect(bridge.saveSessionNote).toHaveBeenLastCalledWith(expect.objectContaining({ stickers: [sticker] }), "sha256:remote");
    expect(workspace.syncStatus("session-demo")).toBe("synced");
  });

  it("does not write an Obsidian note from a late load after disposal", async () => {
    let completeRead!: (value: SessionNoteDocument) => void;
    const bridge = {
      readSessionNote: vi.fn(() => new Promise<SessionNoteDocument>((resolve) => { completeRead = resolve; })),
      saveSessionNote: vi.fn(async () => ({ revision: "sha256:saved" })),
      deleteStickerBacklinks: vi.fn(async () => ({ notesChanged: 0, linksRemoved: 0 })),
    };
    const workspace = createStickerWorkspace(local(document([sticker], "sha256:local")), bridge);
    await workspace.ensure("session-demo");
    await vi.waitFor(() => expect(bridge.readSessionNote).toHaveBeenCalledOnce());
    workspace.dispose();
    completeRead(document([], "sha256:remote"));
    await Promise.resolve();
    await Promise.resolve();
    expect(bridge.saveSessionNote).not.toHaveBeenCalled();
    expect(workspace.health().state).toBe("closed");
  });

  it("creates and edits durable local stickers while Obsidian is offline", async () => {
    const persistence = local();
    const bridge = offlineBridge();
    const workspace = createStickerWorkspace(persistence, bridge);

    await workspace.ensure("session-demo");
    await workspace.save(sticker);
    await workspace.save({ ...sticker, markdown: "离线更新", color: "green" });

    expect(workspace.list("session-demo")[0]?.record).toMatchObject({ markdown: "离线更新", color: "green" });
    expect(persistence.saveLocalSession).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(workspace.syncStatus("session-demo")).toBe("local-only"));
  });

  it("imports an existing Obsidian session note once, then treats local state as authoritative", async () => {
    const persistence = local();
    const bridge = {
      readSessionNote: vi.fn(async () => document([sticker], "sha256:vault")),
      saveSessionNote: vi.fn(async () => ({ revision: "sha256:vault-next" })),
      deleteStickerBacklinks: vi.fn(async () => ({ notesChanged: 0, linksRemoved: 0 })),
    };
    const workspace = createStickerWorkspace(persistence, bridge);

    await workspace.ensure("session-demo");
    await vi.waitFor(() => expect(workspace.list("session-demo")).toHaveLength(1));
    expect(persistence.saveLocalSession).toHaveBeenCalledOnce();
    expect(workspace.syncStatus("session-demo")).toBe("synced");
  });

  it("deletes locally even when Obsidian backlink cleanup is unavailable", async () => {
    const persistence = local(document([sticker], "sha256:local"));
    const bridge = offlineBridge();
    const workspace = createStickerWorkspace(persistence, bridge);
    await workspace.ensure("session-demo");

    await expect(workspace.remove("session-demo", sticker.stickerId)).resolves.toBeUndefined();
    expect(workspace.list("session-demo")).toHaveLength(0);
    await vi.waitFor(() => expect(bridge.deleteStickerBacklinks).toHaveBeenCalledWith(sticker));
  });

  it("drains a persisted backlink deletion after a workspace restart and reconnect", async () => {
    const persistence = local(document([sticker], "sha256:local"));
    const offline = createStickerWorkspace(persistence, offlineBridge());
    await offline.ensure("session-demo");
    await offline.remove("session-demo", sticker.stickerId);
    await vi.waitFor(async () => {
      expect((await persistence.readLocalState()).pendingBacklinkDeletes).toEqual([sticker]);
    });

    const bridge = {
      readSessionNote: vi.fn(async () => document([sticker], "sha256:vault")),
      saveSessionNote: vi.fn(async () => ({ revision: "sha256:vault-next" })),
      deleteStickerBacklinks: vi.fn(async () => ({ notesChanged: 1, linksRemoved: 1 })),
    };
    const restarted = createStickerWorkspace(persistence, bridge);
    await restarted.ensure("session-demo");
    await vi.waitFor(() => expect(persistence.acknowledgeBacklinkDelete).toHaveBeenCalledWith({
      sessionId: "session-demo",
      stickerId: sticker.stickerId,
    }));
    expect(restarted.list("session-demo")).toHaveLength(0);
  });
});

it('persists partial multi-Vault deletion and retries only the original remaining target after restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'synthetic-sticker-outbox-'));
 const store=new StickerLocalStore(directory);
 let choices=['a','b'];let onlineB=false;
 const deletes={a:vi.fn(async()=>({notesChanged:1,linksRemoved:1})),b:vi.fn(async()=>{if(!onlineB)throw new Error('B offline');return{notesChanged:1,linksRemoved:1};}),c:vi.fn(async()=>({notesChanged:0,linksRemoved:0}))};
 const persistence={readLocalState:(id:string)=>store.read(id),saveLocalSession:store.save.bind(store),acknowledgeBacklinkDelete:({sessionId,stickerId}:{sessionId:string;stickerId:string})=>store.acknowledgeBacklinkDelete(sessionId,stickerId)};
 const bridge={...offlineBridge(),listVaults:()=>choices.map(vaultId=>({vaultId,state:'bound',binding:{target:{instanceId:'instance'}}})) as never,forVault:(vaultId:string)=>({deleteStickerBacklinks:deletes[vaultId as keyof typeof deletes]}) as never};
 let workspace=createStickerWorkspace(persistence,bridge);
 try {
  await workspace.save(sticker);await workspace.sync(sticker.sessionId);await workspace.remove(sticker.sessionId,sticker.stickerId);await workspace.sync(sticker.sessionId);
  expect((await store.read(sticker.sessionId)).pendingBacklinkDeletes[0]?.pendingVaultIds).toEqual(['b']);expect(deletes.a).toHaveBeenCalledOnce();
  workspace.dispose();choices=['c'];workspace=createStickerWorkspace(persistence,bridge);await workspace.ensure(sticker.sessionId);await workspace.sync(sticker.sessionId);
  expect(deletes.c).not.toHaveBeenCalled();expect(deletes.a).toHaveBeenCalledOnce();expect((await store.read(sticker.sessionId)).pendingBacklinkDeletes[0]?.pendingVaultIds).toEqual(['b']);
  onlineB=true;await workspace.sync(sticker.sessionId);expect((await store.read(sticker.sessionId)).pendingBacklinkDeletes).toEqual([]);expect(deletes.c).not.toHaveBeenCalled();
 }finally{workspace.dispose();await rm(directory,{recursive:true,force:true});}
});
it('requires an explicit legacy Vault and keeps it pinned when another becomes the only online Vault',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'synthetic-sticker-route-'));const store=new StickerLocalStore(directory);
 let choices=['a','b'];const routes=Object.fromEntries(['a','b'].map(id=>[id,{readSessionNote:vi.fn(async()=>({...document(),vaultId:id})),saveSessionNote:vi.fn(async()=>({revision:'saved'})),deleteStickerBacklinks:vi.fn()}]));
 const persistence={readLocalState:(id:string)=>store.read(id),saveLocalSession:store.save.bind(store),acknowledgeBacklinkDelete:({sessionId,stickerId}:{sessionId:string;stickerId:string})=>store.acknowledgeBacklinkDelete(sessionId,stickerId)};
 const bridge={...offlineBridge(),listVaults:()=>choices.map(vaultId=>({vaultId,state:'bound'})) as never,forVault:(id:string)=>{if(!choices.includes(id))throw new Error('original Vault offline');return routes[id] as never;}};
 const workspace=createStickerWorkspace(persistence,bridge);
 try{await workspace.save({...sticker,notePath:'Same.md'});await workspace.sync(sticker.sessionId);expect(routes.a!.readSessionNote).not.toHaveBeenCalled();expect(routes.b!.readSessionNote).not.toHaveBeenCalled();
 await workspace.selectVault!(sticker.sessionId,'a');expect((await store.read(sticker.sessionId)).document).toMatchObject({vaultId:'a',stickers:[{vaultId:'a'}]});
 choices=['b'];await workspace.sync(sticker.sessionId);expect(routes.b!.readSessionNote).not.toHaveBeenCalled();expect(workspace.syncIssue(sticker.sessionId)).toContain('original Vault offline');
 }finally{workspace.dispose();await rm(directory,{recursive:true,force:true});}
});
