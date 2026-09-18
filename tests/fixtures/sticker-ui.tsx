import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StickerEditor } from '../../src/client/overlay.tsx';
import { StickerDetailForm } from '../../src/client/sticker-sidebar.tsx';
import type { StickerRecord } from '../../src/protocol.ts';
import type { StickerWorkspace } from '../../src/client/sticker-workspace.ts';
import '../../src/client/styles.css';
const initial: StickerRecord = { stickerId:'synthetic',sessionId:'fixture',anchorId:'anchor',quote:'这是用于界面检查的合成原文。',quoteHash:'fixture',role:'user',occurrence:0,markdown:'正文直接写在面板里。',tags:['示例'],color:'yellow' };
function App() {
 const [record,setRecord] = useState(initial), [saved,setSaved] = useState('');
 const workspace = { save:async (next: StickerRecord) => { setRecord(next); setSaved('已保存：'+next.color) },syncStatus:()=> 'synced',syncIssue:()=>null } as unknown as StickerWorkspace;
 return <><p>真实贴纸编辑组件 · 合成数据</p><p role="status">{saved}</p><StickerEditor key={record.markdown+record.color} record={record} point={{x:16,y:130}} isNew={false} error={null} onSave={draft=>{setRecord({...record,...draft});setSaved('已保存：'+draft.color)}} onCancel={()=>{setRecord({...initial});setSaved('已取消')}} /><div id="sidebar"><StickerDetailForm record={record} workspace={workspace} openNote={async()=>{}} listBacklinks={async()=>[]} close={()=>{}} /></div></>;
}
createRoot(document.querySelector('#app')!).render(<App/>);
