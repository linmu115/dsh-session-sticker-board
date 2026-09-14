// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { KnowledgePanel } from '../src/client/knowledge-panel.tsx';
import { knowledgeRequest } from '../src/client/knowledge.ts';
vi.mock('../src/client/knowledge.ts',()=>({knowledgeRequest:vi.fn(),migrateLegacyStickers:vi.fn(),MigrationConflict:class extends Error{}}));
vi.mock('../src/client/knowledge-links.tsx',()=>({KnowledgeLinks:()=>null}));
let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
const core={addCrossSessionReference:vi.fn(async()=>({referenceId:'ref'}))};
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);
  vi.mocked(knowledgeRequest).mockImplementation(async(op,input)=>{
    if(op==='create-workspaces')return{items:[{id:'native-workspace',title:'空工作区'}],nextCursor:null};
    if(op==='directory')return{items:input?.workspaceId?[{id:'existing',logicalSessionId:'existing-logical',title:'已有会话'}]:[{id:'logical-workspace',title:'已有工作区'}],nextCursor:null};
    if(op==='create-session')return{nativeSessionId:'new-native',logicalSessionId:'new-logical',title:'新会话'};
    if(op==='resolve')return{nativeSessionId:'source',logicalSessionId:input?.logicalSessionId??'source-logical'};
    if(op==='preview')return{sourceVersionId:'v1',capture:{anchorId:'completed-reply',selectedText:'full reply'}};
    if(op==='write')return{status:'committed'};
    return{items:[],nextCursor:null};
  });
});
afterEach(async()=>{await act(()=>root.unmount());host.remove();vi.clearAllMocks();});
async function fixture(){await act(async()=>root.render(<KnowledgePanel ctx={{get:()=>core} as any} sessionId="source" local={{knowledgeOperation:vi.fn()}} bridge={{knowledge:vi.fn()}} onMigrated={vi.fn()}/>));await act(async()=>{window.dispatchEvent(new CustomEvent('dsh-session-sticker-open',{detail:{sessionId:'source',anchorId:'completed-reply',selectedText:'引用选区'}}));});}
async function click(label:string){await act(async()=>{const b=[...host.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')??b.textContent)===label);expect(b).toBeTruthy();b!.click();});}
const creates=()=>vi.mocked(knowledgeRequest).mock.calls.filter(([op])=>op==='create-session');
it('selects a native workspace before creation and preserves the selected upstream reference',async()=>{
  await fixture();await click('新建独立会话');expect(creates()).toHaveLength(0);
  expect(host.textContent).toContain('先选择工作区');await click('空工作区');expect(creates()).toHaveLength(0);
  await click('在所选工作区新建会话');expect(creates()).toHaveLength(1);
  expect(creates()[0]![1]).toEqual({operationId:expect.any(String),workspaceId:'native-workspace'});
  expect(core.addCrossSessionReference).toHaveBeenCalledWith('new-native',expect.objectContaining({selectedText:'引用选区',expectedSourceVersionId:'v1'}),expect.anything());
  expect(knowledgeRequest).toHaveBeenCalledWith('write',expect.objectContaining({body:expect.objectContaining({logicalSessionId:'new-logical',source:expect.objectContaining({referenceId:'ref'})})}));
});
it('can still attach an existing session without creating one',async()=>{
  await fixture();await click('已有工作区');await click('已有会话');expect(creates()).toHaveLength(0);
  expect(knowledgeRequest).toHaveBeenCalledWith('resolve',{logicalSessionId:'existing-logical'});
});
it('retains selection and operation identity when creation fails and is retried',async()=>{
  await fixture();await click('新建独立会话');await click('空工作区');
  vi.mocked(knowledgeRequest).mockRejectedValueOnce(new Error('temporary failure'));
  await click('在所选工作区新建会话');expect(host.textContent).toContain('temporary failure');expect(host.textContent).toContain('引用选区');
  await click('在所选工作区新建会话');expect(creates()[0]![1]).toEqual(creates()[1]![1]);
});
it('does not create a session when cancelling workspace selection',async()=>{
  await fixture();await click('新建独立会话');await click('空工作区');await click('重新选择工作区');await click('选择已有会话');expect(creates()).toHaveLength(0);
});
