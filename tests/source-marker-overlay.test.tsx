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
  vi.mocked(knowledgeRequest).mockImplementation(async(op,input)=>{
    if(op==='source-markers')return{items:rows.map(row=>({...row})),nextCursor:null};
    if(op==='resolve')return{nativeSessionId:input?.logicalSessionId==='logical-z'?'native-z':'native-y',logicalSessionId:input?.logicalSessionId,title:'目标'};
    throw new Error('unexpected operation: '+op);
  });
});
afterEach(async()=>{await act(()=>root.unmount());host.remove();article.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.clearAllMocks();});
async function render(ordinary=false){await act(async()=>root.render(<>
  {ordinary&&<StickerOverlay sessionId="native-x" sessionTitle="来源X" stickers={[ordinarySticker]}
    resolveAnchorId={value=>value} resolveAnchorKey={()=>'current-render'} onSave={vi.fn()} onDelete={vi.fn()} onOpenNote={vi.fn()} />}
  <SourceMarkerOverlay ctx={{sessions:{open}} as any} sessionId="native-x" snapshot={snapshot} ordinaryStickers={ordinary?[ordinarySticker]:[]}/>
</>));}
async function click(selector:string){await act(async()=>{const button=host.querySelector<HTMLButtonElement>(selector);expect(button).toBeTruthy();button!.click();});}
async function refresh(){await act(async()=>{window.dispatchEvent(new Event(SOURCE_MARKERS_CHANGED));});}

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
