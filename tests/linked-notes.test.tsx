// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { LinkedNotes } from '../src/client/linked-notes.tsx';
import { knowledgeRequest } from '../src/client/knowledge.ts';
import { unlinkNote } from '../src/client/unlink-note.ts';
vi.mock('../src/client/knowledge.ts',()=>({knowledgeRequest:vi.fn()}));
let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
const object={objectId:'link',revision:1,deleted:false,content:{title:'Note',body:{logicalSessionId:'logical',note:{noteId:'note',notePath:'Folder/Note.md',blockId:'block'}}}};
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.mocked(knowledgeRequest).mockImplementation(async(op:any)=>op==='resolve'?{nativeSessionId:'native',logicalSessionId:'logical'}:op==='status'?{profileId:'web'}:op==='get'?object:{items:[object],nextCursor:null});});
afterEach(async()=>{await act(()=>root.unmount());host.remove();vi.clearAllMocks();});
async function fixture(){const core={addReference:vi.fn(async()=>({setId:'set',referenceId:'ref',created:true})),discardPendingOperation:vi.fn(async()=>{}),fenceReferenceOperation:vi.fn(),removeReference:vi.fn()};const ctx={get:()=>core,sessions:{scope:()=>({get:()=>core}),list:{getSnapshot:()=>({current:'native'})}}} as any;const bridge={knowledge:vi.fn(async(op:string)=>op==='link-reference-prepare'?{referenceId:'ref',source:{sourceType:'obsidian-note'}}:{committed:true})};await act(async()=>root.render(<LinkedNotes sessionId="native" ctx={ctx} bridge={bridge}/>));return{ctx,core,bridge};}
async function click(text:string){await act(async()=>{const b=[...host.querySelectorAll('button')].find(b=>b.textContent?.includes(text));expect(b).toBeTruthy();b!.click();});}
it('shows a persistent relation without loading material, and opens Obsidian explicitly',async()=>{const f=await fixture();expect(host.textContent).toContain('关联笔记');expect(f.bridge.knowledge).not.toHaveBeenCalled();await click('Note');await click('在 Obsidian 打开');expect(f.bridge.knowledge).toHaveBeenCalledWith('note-open',{noteId:'note',blockId:'block'});expect(f.core.addReference).not.toHaveBeenCalled();});
it('adds and claims a reference without submitting a model request',async()=>{const f=await fixture();await click('Note');await click('引用到本轮');expect(f.core.addReference).toHaveBeenCalledWith('native',{sourceType:'obsidian-note'},expect.objectContaining({referenceId:'ref'}));expect(f.bridge.knowledge.mock.calls.map(c=>c[0])).toEqual(['link-reference-prepare','link-reference-commit']);expect(host.textContent).toContain('发送消息后参与回答');});
it('refuses to add after switching sessions during preparation',async()=>{const f=await fixture();f.bridge.knowledge.mockImplementationOnce(async()=>{f.ctx.sessions.list.getSnapshot=()=>({current:'other'});return{referenceId:'ref',source:{sourceType:'obsidian-note'}};});await click('Note');await click('引用到本轮');expect(f.core.addReference).not.toHaveBeenCalled();expect(host.textContent).toContain('会话已切换');});
it('compensates a pending bubble when the companion cannot durably bind it',async()=>{const f=await fixture();f.bridge.knowledge.mockImplementation(async(op:string)=>{if(op==='link-reference-commit')throw new Error('无法保存引用');return{referenceId:'ref',source:{sourceType:'obsidian-note'}};});await click('Note');await click('引用到本轮');expect(f.core.discardPendingOperation).toHaveBeenCalledWith('native',expect.any(String));expect(host.textContent).toContain('无法保存引用');expect(host.textContent).not.toContain('已加入本轮引用');});

it('unlinks the note from the action panel while leaving pending references alone',async()=>{
  const f=await fixture();await click('Note');await click('解除关联');
  expect(f.bridge.knowledge).toHaveBeenCalledWith('link-delete',expect.objectContaining({objectId:'link',logicalSessionId:'logical',notePath:'Folder/Note.md'}));
  expect(knowledgeRequest).toHaveBeenCalledWith('write',expect.objectContaining({namespace:'obsidian-links',objectId:'link',expectedRevision:1,deleted:true}));
  expect(host.querySelector('.dsh-linked-note-chip')).toBeNull();
  expect(host.textContent).toContain('已解除关联');
  expect(f.core.removeReference).not.toHaveBeenCalled();expect(f.core.discardPendingOperation).not.toHaveBeenCalled();
});

it('keeps the link and displays the failure when Companion deletion fails',async()=>{
  const f=await fixture();f.bridge.knowledge.mockRejectedValueOnce(new Error('Obsidian 未连接'));
  await click('Note');await click('解除关联');
  expect(host.querySelector('.dsh-linked-note-chip')).not.toBeNull();expect(host.textContent).toContain('Obsidian 未连接');
  expect(vi.mocked(knowledgeRequest).mock.calls.some(([op])=>op==='write')).toBe(false);
});

it('accepts the deletion already completed by Companion background sync',async()=>{
  const f=await fixture();f.bridge.knowledge.mockImplementationOnce(async()=>{
    vi.mocked(knowledgeRequest).mockImplementation(async()=>({...object,revision:2,deleted:true}));return{committed:true};
  });
  await click('Note');await click('解除关联');
  expect(host.textContent).toContain('已解除关联');
  expect(vi.mocked(knowledgeRequest).mock.calls.some(([op])=>op==='write')).toBe(false);
});

it('does not delete a relation belonging to another session',async()=>{
  const bridge={knowledge:vi.fn()};
  await expect(unlinkNote('link',{nativeSessionId:'other',logicalSessionId:'other'} as any,bridge)).rejects.toThrow('不属于当前会话');
  expect(bridge.knowledge).not.toHaveBeenCalled();
});
