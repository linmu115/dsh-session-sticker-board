// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { LinkedNotes } from '../src/client/linked-notes.tsx';
import { knowledgeRequest } from '../src/client/knowledge.ts';
vi.mock('../src/client/knowledge.ts',()=>({knowledgeRequest:vi.fn()}));
let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
const object={objectId:'link',deleted:false,content:{body:{logicalSessionId:'logical',note:{noteId:'note',notePath:'Folder/Note.md',blockId:'block'}}}};
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.mocked(knowledgeRequest).mockImplementation(async(op:any)=>op==='resolve'?{nativeSessionId:'native',logicalSessionId:'logical'}:op==='status'?{profileId:'web'}:op==='get'?object:{items:[object],nextCursor:null});});
afterEach(async()=>{await act(()=>root.unmount());host.remove();vi.clearAllMocks();});
async function fixture(){const core={addReference:vi.fn(async()=>({setId:'set',referenceId:'ref',created:true})),fenceReferenceOperation:vi.fn(),removeReference:vi.fn()};const ctx={get:()=>core,sessions:{scope:()=>({get:()=>core}),list:{getSnapshot:()=>({current:'native'})}}} as any;const bridge={knowledge:vi.fn(async(op:string)=>op==='link-reference-prepare'?{referenceId:'ref',source:{sourceType:'obsidian-note'}}:{committed:true})};await act(async()=>root.render(<LinkedNotes sessionId="native" ctx={ctx} bridge={bridge}/>));return{ctx,core,bridge};}
async function click(text:string){await act(async()=>{const b=[...host.querySelectorAll('button')].find(b=>b.textContent?.includes(text));expect(b).toBeTruthy();b!.click();});}
it('shows a persistent relation without loading material, and opens Obsidian explicitly',async()=>{const f=await fixture();expect(host.textContent).toContain('关联笔记');expect(f.bridge.knowledge).not.toHaveBeenCalled();await click('Note');await click('在 Obsidian 打开');expect(f.bridge.knowledge).toHaveBeenCalledWith('note-open',{noteId:'note',blockId:'block'});expect(f.core.addReference).not.toHaveBeenCalled();});
it('adds and claims a reference without submitting a model request',async()=>{const f=await fixture();await click('Note');await click('引用到本轮');expect(f.core.addReference).toHaveBeenCalledWith('native',{sourceType:'obsidian-note'},expect.objectContaining({referenceId:'ref'}));expect(f.bridge.knowledge.mock.calls.map(c=>c[0])).toEqual(['link-reference-prepare','link-reference-commit']);expect(host.textContent).toContain('发送消息后参与回答');});
it('refuses to add after switching sessions during preparation',async()=>{const f=await fixture();f.bridge.knowledge.mockImplementationOnce(async()=>{f.ctx.sessions.list.getSnapshot=()=>({current:'other'});return{referenceId:'ref',source:{sourceType:'obsidian-note'}};});await click('Note');await click('引用到本轮');expect(f.core.addReference).not.toHaveBeenCalled();expect(host.textContent).toContain('会话已切换');});
