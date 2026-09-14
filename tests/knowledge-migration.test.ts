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
