// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SourceMarkerOverlay } from '../src/client/source-marker-overlay.tsx';
import { StickerOverlay } from '../src/client/overlay.tsx';
import { knowledgeRequest } from '../src/client/knowledge.ts';
import { SOURCE_MARKERS_CHANGED } from '../src/client/source-markers.ts';
import type { SourceMarker } from '../src/client/source-markers.ts';

vi.mock('../src/client/knowledge.ts',()=>({knowledgeRequest:vi.fn()}));
let host:HTMLDivElement,article:HTMLElement,root:ReturnType<typeof createRoot>;
let rows:SourceMarker[];
const open=vi.fn();
const resolveReferenceLink=vi.fn(),deleteReferenceLink=vi.fn();
const core={resolveReferenceLink,deleteReferenceLink};
const marker:SourceMarker={objectId:'sticker-a',referenceId:'ref-a',sourceVersionId:'v1',sourceAnchorId:'saved-message-id',messageId:'saved-message-id',selectedText:'被引用的段落',occurrence:0,targetLogicalSessionId:'logical-y',targetTitle:'目标Y'};
const second:SourceMarker={...marker,objectId:'sticker-b',referenceId:'ref-b',targetLogicalSessionId:'logical-z',targetTitle:'目标Z'};
const snapshot={order:['current-render'],nodes:new Map([['current-render',{id:'step-4',kind:'assistant-step',data:{status:'settled',finalNode:{messageId:'saved-message-id'}}}]])};
const rect={left:30,top:40,right:130,bottom:60,width:100,height:20,x:30,y:40,toJSON:()=>({})};
const ordinarySticker={record:{stickerId:'ordinary',sessionId:'native-x',anchorId:'step-4',role:'assistant',quote:marker.selectedText,quoteHash:'sha256:ordinary',occurrence:0,markdown:'普通贴纸',tags:[],color:'pink'},displayNumber:1} as any;

beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  vi.stubGlobal('CSS',{escape:(value:string)=>value});
  vi.spyOn(window,'requestAnimationFrame').mockImplementation(()=>1);
  vi.spyOn(window,'cancelAnimationFrame').mockImplementation(()=>{});
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue(rect);
  Object.defineProperty(Range.prototype,'getClientRects',{configurable:true,value:()=>[rect]});
  Object.defineProperty(Range.prototype,'getBoundingClientRect',{configurable:true,value:()=>rect});
  article=document.createElement('article');article.dataset.chatAnchorKey='current-render';article.dataset.chatFlowKind='assistant-step';article.textContent='这里是被引用的段落。';document.body.append(article);
  host=document.createElement('div');document.body.append(host);root=createRoot(host);rows=[marker];
  resolveReferenceLink.mockImplementation(async(_sessionId,referenceId)=>({setId:'set-'+referenceId,referenceId,state:'sent'}));
  deleteReferenceLink.mockResolvedValue({deleted:true,scope:'sent'});
  vi.mocked(knowledgeRequest).mockImplementation(async(op,input)=>{
    if(op==='source-markers')return{items:rows.map(row=>({...row})),nextCursor:null};
    if(op==='revoke-source-reference'){rows=rows.filter(row=>row.referenceId!==input?.referenceId);return{state:'revoked'};}
    if(op==='resolve')return{nativeSessionId:input?.logicalSessionId==='logical-z'?'native-z':'native-y',logicalSessionId:input?.logicalSessionId,title:'目标'};
    throw new Error('unexpected operation: '+op);
  });
});
afterEach(async()=>{await act(()=>root.unmount());host.remove();article.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.clearAllMocks();});
async function render(ordinary=false){await act(async()=>root.render(<>
  {ordinary&&<StickerOverlay sessionId="native-x" sessionTitle="来源X" stickers={[ordinarySticker]}
    resolveAnchorId={value=>value} resolveAnchorKey={()=>'current-render'} onSave={vi.fn()} onDelete={vi.fn()} onOpenNote={vi.fn()} />}
  <SourceMarkerOverlay ctx={{sessions:{open},get:()=>core} as any} sessionId="native-x" snapshot={snapshot} ordinaryStickers={ordinary?[ordinarySticker]:[]}/>
</>));}
async function click(selector:string){await act(async()=>{const button=host.querySelector<HTMLButtonElement>(selector);expect(button).toBeTruthy();button!.click();});}
async function refresh(){await act(async()=>{window.dispatchEvent(new Event(SOURCE_MARKERS_CHANGED));});}
async function contextMenu(){await act(async()=>{const dot=host.querySelector('.dsh-source-reference-dot');expect(dot).toBeTruthy();expect(dot!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:80}))).toBe(false);});}
async function menuItem(label:string){await act(async()=>{const item=[...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button=>button.textContent===label);expect(item).toBeTruthy();item!.click();});}

it('restores the source highlight and a blue marker from durable data and opens the real target without sending',async()=>{
  await render();expect(host.querySelectorAll('.dsh-source-reference-highlight')).toHaveLength(1);
  expect(host.querySelector('.dsh-source-reference-dot')?.getAttribute('data-dsh-source-message-id')).toBe('saved-message-id');
  await click('.dsh-source-reference-dot');expect(open).toHaveBeenCalledWith('native-y');
  expect(vi.mocked(knowledgeRequest).mock.calls.map(([op])=>op)).toEqual(['source-markers','source-markers','resolve']);
  await act(()=>root.unmount());root=createRoot(host);await render();
  expect(host.querySelectorAll('.dsh-source-reference-dot')).toHaveLength(1);
});

it('presents target choices at a shared location, then revalidates the selected target',async()=>{
  rows=[marker,second];await render();expect(host.querySelectorAll('.dsh-source-reference-dot')).toHaveLength(1);
  await click('.dsh-source-reference-dot');expect(open).not.toHaveBeenCalled();
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('目标Y');expect(host.textContent).toContain('目标Z');
  await act(async()=>{[...host.querySelectorAll<HTMLButtonElement>('.dsh-source-reference-menu button')].find(button=>button.textContent==='目标Z')!.click();});
  expect(open).toHaveBeenCalledWith('native-z');
});

it('removes only revoked blue relationships while preserving other targets and ordinary red stickers',async()=>{
  rows=[marker,second];await render(true);
  expect(host.querySelectorAll('.dsh-sticker-board-dot:not(.dsh-source-reference-dot)')).toHaveLength(1);
  expect(host.querySelectorAll('.dsh-sticker-board-highlight-pink')).toHaveLength(1);
  rows=[second];await refresh();
  expect(host.querySelectorAll('.dsh-source-reference-highlight')).toHaveLength(0);
  expect(host.querySelector('.dsh-source-reference-dot')?.getAttribute('aria-label')).toContain('目标Z');
  rows=[];await refresh();expect(host.querySelectorAll('.dsh-source-reference-dot')).toHaveLength(0);
  expect(host.querySelectorAll('.dsh-source-reference-highlight')).toHaveLength(0);
  expect(host.querySelectorAll('.dsh-sticker-board-dot:not(.dsh-source-reference-dot)')).toHaveLength(1);
  expect(host.querySelectorAll('.dsh-sticker-board-highlight-pink')).toHaveLength(1);
});

it('does not follow a stale symbol after its authoritative relation is removed',async()=>{
  await render();rows=[];await click('.dsh-source-reference-dot');
  expect(open).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')?.textContent).toContain('已解除');
  expect(host.querySelectorAll('.dsh-source-reference-dot')).toHaveLength(0);
});

it('fails closed while the authority cannot verify source markers',async()=>{
  await render();vi.mocked(knowledgeRequest).mockRejectedValueOnce(new Error('temporarily unavailable'));
  await click('.dsh-source-reference-dot');expect(open).not.toHaveBeenCalled();
  expect(host.querySelectorAll('.dsh-source-reference-dot')).toHaveLength(0);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('temporarily unavailable');
});

it('does not navigate after the source is closed while target resolution is pending',async()=>{
  await render();let resolveTarget!:(value:unknown)=>void;
  const implementation=vi.mocked(knowledgeRequest).getMockImplementation()!;
  vi.mocked(knowledgeRequest).mockImplementation((op,input)=>op==='resolve'?new Promise(resolve=>{resolveTarget=resolve;}):implementation(op,input));
  await click('.dsh-source-reference-dot');await act(()=>root.unmount());root=createRoot(host);
  await act(async()=>{resolveTarget({nativeSessionId:'native-y',logicalSessionId:'logical-y',title:'目标Y'});});
  expect(open).not.toHaveBeenCalled();
});

it('opens the DSH-style context menu and revokes one exact relation while preserving shared highlights and red stickers',async()=>{
  rows=[marker,second];await render(true);await contextMenu();
  expect(host.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('会话引用操作');
  expect(open).not.toHaveBeenCalled();
  const changed=vi.fn();window.addEventListener(SOURCE_MARKERS_CHANGED,changed);
  try {
    await menuItem('删除引用：目标Y');
    expect(knowledgeRequest).toHaveBeenCalledWith('revoke-source-reference',{nativeSessionId:'native-x',referenceId:'ref-a'});
    expect(deleteReferenceLink).toHaveBeenCalledWith('native-y','set-ref-a','ref-a');
    expect(changed).toHaveBeenCalled();
    expect(host.querySelector('.dsh-source-reference-dot')?.getAttribute('aria-label')).toContain('目标Z');
    expect(host.querySelectorAll('.dsh-sticker-board-dot:not(.dsh-source-reference-dot)')).toHaveLength(1);
    expect(host.querySelectorAll('.dsh-sticker-board-highlight-pink')).toHaveLength(1);
    expect(open).not.toHaveBeenCalled();
  } finally {window.removeEventListener(SOURCE_MARKERS_CHANGED,changed);}
});

it('keeps separately deletable references to the same target while navigation remains deduplicated',async()=>{
  rows=[marker,{...marker,referenceId:'ref-c',objectId:'sticker-c'},second];await render();await contextMenu();
  await menuItem('删除引用：目标Y（引用 2）');
  expect(knowledgeRequest).toHaveBeenCalledWith('revoke-source-reference',{nativeSessionId:'native-x',referenceId:'ref-c'});
  expect(deleteReferenceLink).toHaveBeenCalledWith('native-y','set-ref-c','ref-c');
  expect(rows.map(row=>row.referenceId)).toEqual(['ref-a','ref-b']);
  expect(host.querySelectorAll('.dsh-source-reference-highlight')).toHaveLength(1);
  await click('.dsh-source-reference-dot');
  expect([...host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].map(button=>button.textContent)).toEqual(['目标Y','目标Z','关闭']);
});

it('keeps the marker, highlight and menu when the authoritative revoke fails, then allows retry',async()=>{
  await render();await contextMenu();
  const implementation=vi.mocked(knowledgeRequest).getMockImplementation()!;
  vi.mocked(knowledgeRequest).mockImplementationOnce(async()=>{throw new Error('撤销事务暂不可用');});
  const changed=vi.fn();window.addEventListener(SOURCE_MARKERS_CHANGED,changed);
  try {
    await menuItem('删除引用');
    expect(host.querySelectorAll('.dsh-source-reference-dot')).toHaveLength(1);
    expect(host.querySelectorAll('.dsh-source-reference-highlight')).toHaveLength(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('撤销事务暂不可用');
    expect(host.querySelector('[role="menu"]')).toBeTruthy();
    expect(deleteReferenceLink).not.toHaveBeenCalled();expect(changed).not.toHaveBeenCalled();
    vi.mocked(knowledgeRequest).mockImplementation(implementation);
    await menuItem('删除引用');
    expect(host.querySelectorAll('.dsh-source-reference-dot')).toHaveLength(0);
    expect(host.querySelectorAll('.dsh-source-reference-highlight')).toHaveLength(0);
  } finally {window.removeEventListener(SOURCE_MARKERS_CHANGED,changed);}
});

it('does not hide a pending revoke or dispatch a success event before the authority acknowledges it',async()=>{
  await render();await contextMenu();let acknowledge!:(value:unknown)=>void;
  const implementation=vi.mocked(knowledgeRequest).getMockImplementation()!;
  vi.mocked(knowledgeRequest).mockImplementation((op,input)=>op==='revoke-source-reference'?new Promise(resolve=>{acknowledge=resolve;}):implementation(op,input));
  const changed=vi.fn();window.addEventListener(SOURCE_MARKERS_CHANGED,changed);
  try {
    await menuItem('删除引用');await menuItem('删除引用');
    expect(vi.mocked(knowledgeRequest).mock.calls.filter(([op])=>op==='revoke-source-reference')).toHaveLength(1);
    expect(host.querySelectorAll('.dsh-source-reference-dot')).toHaveLength(1);expect(changed).not.toHaveBeenCalled();
    await act(async()=>{rows=[];acknowledge({state:'revoked'});});
    expect(host.querySelectorAll('.dsh-source-reference-dot')).toHaveLength(0);expect(changed).toHaveBeenCalled();
  } finally {window.removeEventListener(SOURCE_MARKERS_CHANGED,changed);}
});

it('finishes authoritative deletion when local annotation metadata is absent',async()=>{
  resolveReferenceLink.mockResolvedValue(null);await render();await contextMenu();await menuItem('删除引用');
  expect(host.querySelectorAll('.dsh-source-reference-dot')).toHaveLength(0);
  expect(host.querySelector('[role="alert"]')).toBeNull();expect(deleteReferenceLink).not.toHaveBeenCalled();
});

it('reports pending bubble synchronization without reviving an authoritatively revoked marker',async()=>{
  deleteReferenceLink.mockRejectedValue(new Error('local offline'));await render();await contextMenu();await menuItem('删除引用');
  expect(host.querySelectorAll('.dsh-source-reference-dot')).toHaveLength(0);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('引用已解除');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('气泡暂未同步');
  await refresh();expect(host.querySelectorAll('.dsh-source-reference-dot')).toHaveLength(0);
});

it('supports keyboard context menus and preserves loaded markers on an idle connection failure',async()=>{
  await render();
  await act(async()=>host.querySelector('.dsh-source-reference-dot')!.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true})));
  expect(host.querySelector('[role="menu"]')).toBeTruthy();
  await act(async()=>host.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true})));
  expect(document.activeElement?.textContent).toBe('删除引用');
  await act(async()=>host.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  expect(host.querySelector('[role="menu"]')).toBeNull();
  vi.mocked(knowledgeRequest).mockRejectedValueOnce(new Error('temporarily offline'));
  await refresh();expect(host.querySelectorAll('.dsh-source-reference-dot')).toHaveLength(1);
});
