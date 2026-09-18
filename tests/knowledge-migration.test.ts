import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StickerLocalStore } from '../src/host/local-store.ts';
import { createStickerWorkspace } from '../src/client/sticker-workspace.ts';
import { mergeLegacyStickers, migrateLegacyStickers } from '../src/client/knowledge.ts';
import type { LocalStickerState, StickerRecord } from '../src/protocol.ts';
const record: StickerRecord = { stickerId:'bd823205-e8db-4909-aa27-844385bde244',sessionId:'native',anchorId:'reply',role:'assistant',quote:'重点',quoteHash:'sha256:quote',occurrence:0,markdown:'原贴纸',tags:[],color:'yellow' };
const state: LocalStickerState = {document:{protocolVersion:1,type:'session-note',sessionId:'native',revision:'sha256:initial',stickers:[record]},pendingBacklinkDeletes:[]};
it.each([false, true])('initializes on first save, retaining existing stickers: %s', async hasLegacy => {
  let migrated = false;
  let current = structuredClone({ ...state, document: { ...state.document, stickers: hasLegacy ? [record] : [] } });
  const migrateLegacy = vi.fn(async () => { migrated = true; });
  const local = { managed: true, readLocalState: async () => {
    if (!migrated) throw Object.assign(new Error('migration required'), { code: 'STICKER_MIGRATION_REQUIRED' });
    return current;
  }, saveLocalSession: vi.fn(async ({ document }: { document: LocalStickerState['document'] }) => {
    current = { ...current, document: { ...document, revision: 'sha256:saved' } }; return current;
  }), acknowledgeBacklinkDelete: async () => current };
  const workspace = createStickerWorkspace(local, { readSessionNote: vi.fn(), saveSessionNote: vi.fn(), deleteStickerBacklinks: vi.fn() }, { migrateLegacy });
  try {
    await expect(workspace.ensure('native')).rejects.toThrow('migration required');
    expect(migrateLegacy).not.toHaveBeenCalled();
    await Promise.all(['new1', 'new2'].map(stickerId => workspace.save({ ...record, stickerId, markdown: stickerId })));
    expect(migrateLegacy).toHaveBeenCalledTimes(1);
    expect(current.document.stickers.map(s => s.stickerId)).toEqual([...(hasLegacy ? [record.stickerId] : []), 'new1', 'new2']);
  } finally { workspace.dispose(); }
});
it.each(['STICKER_MIGRATION_REQUIRED', 'NETWORK_ERROR'])('does not save after a migration conflict or unrelated error: %s', async code => {
  const migrateLegacy = vi.fn(async () => { throw new Error('conflicting legacy edits'); });
  const local = { managed: true, readLocalState: vi.fn(async () => { throw Object.assign(new Error('read failed'), { code }); }), saveLocalSession: vi.fn(), acknowledgeBacklinkDelete: vi.fn() };
  const workspace = createStickerWorkspace(local, { readSessionNote: vi.fn(), saveSessionNote: vi.fn(), deleteStickerBacklinks: vi.fn() }, { migrateLegacy });
  try {
    await expect(workspace.save(record)).rejects.toThrow(code === 'NETWORK_ERROR' ? 'read failed' : 'conflicting legacy edits');
    expect(migrateLegacy).toHaveBeenCalledTimes(code === 'NETWORK_ERROR' ? 0 : 1);
    expect(local.saveLocalSession).not.toHaveBeenCalled();
  } finally { workspace.dispose(); }
});
it('retains the local ownership fence across restart without changing the source document',async()=>{
  const root=await mkdtemp(join(tmpdir(),'synthetic-sticker-knowledge-'));
  try {
    const store=new StickerLocalStore(root),empty=await store.read('native');
    const saved=await store.save({document:state.document,expectedRevision:empty.document.revision});
    const frozen=await store.freeze('native') as {migrationId:string};
    const restarted=new StickerLocalStore(root);
    await expect(restarted.save({document:state.document,expectedRevision:saved.document.revision})).rejects.toThrow('冻结');
    await expect(restarted.acknowledgeBacklinkDelete('native',record.stickerId)).rejects.toThrow('冻结');
    expect(await restarted.freeze('native')).toMatchObject({migrationId:frozen.migrationId,state:saved});
    await restarted.activate('native',frozen.migrationId,'receipt');
    expect(await restarted.read('native')).toEqual(saved);
    await expect(new StickerLocalStore(root).save({document:state.document,expectedRevision:saved.document.revision})).rejects.toThrow();
  } finally { await rm(root,{recursive:true,force:true}); }
});
it('requires an explicit choice for conflicting objects and preserves deletion intent',()=>{
  const remote={...state.document,stickers:[{...record,markdown:'Vault编辑'}]};
  expect(()=>mergeLegacyStickers(state,remote)).toThrow('不同编辑');
  expect(mergeLegacyStickers(state,remote,'local')[0]!.markdown).toBe('原贴纸');
  expect(mergeLegacyStickers(state,remote,'vault')[0]!.markdown).toBe('Vault编辑');
  expect(mergeLegacyStickers({...state,pendingBacklinkDeletes:[record]},remote)).toEqual([]);
});
it('retries a lost activation acknowledgement with the same digest and mapping before switching the local writer',async()=>{
  const order:string[]=[],inputs:Record<string,unknown>[]=[];
  const local={knowledgeOperation:vi.fn(async(operation:string)=>{order.push('local:'+operation);return {migrationId:'fixed-migration',state};})};
  let interrupted=true;
  const bridge={knowledge:vi.fn(async(operation:string)=>{order.push('vault:'+operation);if(operation==='session-activate'&&interrupted){interrupted=false;throw new Error('lost reply');}return {vaultId:'vault',document:state.document};})};
  const request=async<T>(_operation:string,input:Record<string,unknown>={})=>{inputs.push(input);order.push('engine:'+String(input.phase));return {object:{objectId:'receipt'}} as T;};
  await expect(migrateLegacyStickers('native',local,bridge,undefined,request)).rejects.toThrow('lost reply');
  expect(order).not.toContain('local:activate');
  await expect(migrateLegacyStickers('native',local,bridge,undefined,request)).resolves.toBe(1);
  expect(new Set(inputs.map(i=>i.sourceDigest)).size).toBe(1);expect(order.at(-1)).toBe('local:activate');
});
it('edits managed stickers without importing or overwriting Vault documents',async()=>{
  let current=structuredClone(state);
  const local={managed:true,readLocalState:async()=>current,saveLocalSession:vi.fn(async(input:{document:LocalStickerState['document']})=>{current={...current,document:{...input.document,revision:'sha256:next'}};return current;}),acknowledgeBacklinkDelete:async()=>current};
  const bridge={readSessionNote:vi.fn(),saveSessionNote:vi.fn(),deleteStickerBacklinks:vi.fn()};
  const workspace=createStickerWorkspace(local,bridge);
  try{await workspace.ensure('native');await workspace.save({...record,markdown:'Maintenance编辑'});await workspace.sync('native');expect(bridge.readSessionNote).not.toHaveBeenCalled();expect(bridge.saveSessionNote).not.toHaveBeenCalled();expect(current.document.stickers[0]!.markdown).toBe('Maintenance编辑');}finally{workspace.dispose();}
});

it('persists a migration Vault fence across restart and refuses another candidate',async()=>{
 const root=await mkdtemp(join(tmpdir(),'synthetic-vault-fence-'));
 try {const store=new StickerLocalStore(root);const frozen=await store.freeze('native','vault-a') as {migrationId:string};
 await expect(new StickerLocalStore(root).freeze('native','vault-b')).rejects.toThrow('vault-a');
 await store.activate('native',frozen.migrationId,'receipt');expect(await new StickerLocalStore(root).ownership('native')).toMatchObject({vaultId:'vault-a',phase:'active'});
 } finally {await rm(root,{recursive:true,force:true});}
});
