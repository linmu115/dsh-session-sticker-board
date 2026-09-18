import { expect, it, vi } from 'vitest';
import type { ObsidianBridgeLifecycle } from 'dsh-obsidian-bridge-lifecycle/api';
import { createStickerBridgeChannel } from '../src/client/bridge-channel.ts';

it('fails remote requests explicitly when Bridge is absent', async () => {
  const channel = createStickerBridgeChannel(() => undefined);
  await expect(channel.readSessionNote('session')).rejects.toMatchObject({ name: 'BridgeUnavailableError' });
  await expect(channel.knowledge('note-open', {})).rejects.toMatchObject({ name: 'BridgeUnavailableError' });
  expect(channel).not.toHaveProperty('dispose');
  expect(channel).not.toHaveProperty('nextActions');
  expect(channel).not.toHaveProperty('acknowledgeAction');
});

it('borrows the current service after a late mount, removal and replacement', async () => {
  let lifecycle: ObsidianBridgeLifecycle | undefined;
  const channel = createStickerBridgeChannel(() => lifecycle);
  const first = { knowledge: vi.fn(async () => 'first') };
  const next = { knowledge: vi.fn(async () => 'next') };
  lifecycle = { transport: first } as unknown as ObsidianBridgeLifecycle;
  await expect(channel.knowledge('note-open', { noteId: 'note' })).resolves.toBe('first');
  lifecycle = undefined;
  await expect(channel.knowledge('note-open', {})).rejects.toMatchObject({ name: 'BridgeUnavailableError' });
  lifecycle = { transport: next } as unknown as ObsidianBridgeLifecycle;
  await expect(channel.knowledge('note-open', {})).resolves.toBe('next');
  expect(first.knowledge).toHaveBeenCalledOnce();
});

it('delegates reference handoff intact and preserves service receiver', async () => {
  const input = { sessionId: 'session', operationId: 'operation', prepare: vi.fn(), commit: vi.fn(), assertCurrent: vi.fn() };
  const lifecycle = { handoffReference: vi.fn(async function(this: unknown, actual: unknown) {
    expect(this).toBe(lifecycle); expect(actual).toBe(input);
    return { setId: 'set', referenceId: 'reference' };
  }) } as unknown as ObsidianBridgeLifecycle;
  await expect(createStickerBridgeChannel(() => lifecycle).handoffReference(input)).resolves.toEqual({ setId: 'set', referenceId: 'reference' });
  expect(input.prepare).not.toHaveBeenCalled();
});

it('aggregates same-name notes and backlinks with explicit Vault routes and independent cursors', async () => {
 const routes = Object.fromEntries(['a','b'].map(vaultId => [vaultId, { knowledge:vi.fn(async (_op:string,input:Record<string,unknown>)=>({items:[{notePath:'Same.md'}],nextCursor:input.after?null:vaultId==='a'?'a-next':null})), listBacklinks:vi.fn(async()=>[{notePath:'Same.md',line:0}]), openNote:vi.fn(async()=>{}) }]));
 const lifecycle={listVaults:()=>['a','b'].map(vaultId=>({vaultId,displayName:vaultId,state:'bound'})),forVault:(id:string)=>routes[id],transport:{knowledge:()=>{throw new Error('ambiguous');}}} as unknown as ObsidianBridgeLifecycle;
 const channel=createStickerBridgeChannel(()=>lifecycle);
 const page=await channel.knowledge('notes',{query:''}) as {items:{vaultId:string}[];nextCursor:string};expect(page.items.map(x=>x.vaultId)).toEqual(['a','b']);
 await channel.knowledge('notes',{query:'',after:page.nextCursor});expect(routes.a!.knowledge).toHaveBeenLastCalledWith('notes',{query:'',after:'a-next'});expect(routes.b!.knowledge).toHaveBeenCalledTimes(1);
 const backlinks=await channel.listBacklinks({} as never);expect(backlinks.map(x=>x.vaultId)).toEqual(['a','b']);
 await channel.openNote({protocolVersion:1,type:'open-note',actionId:'action',vaultId:'b',notePath:'Same.md'});expect(routes.b!.openNote).toHaveBeenCalledOnce();expect(routes.a!.openNote).not.toHaveBeenCalled();
});
