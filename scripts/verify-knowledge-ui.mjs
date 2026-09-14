// Packaged client + real authenticated Companion transport, with synthetic data only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(import.meta.dirname, '..');
const output = resolve(process.argv[2]); await mkdir(output, { recursive: true });
const browserRoot = resolve(process.argv[3] ?? 'D:/AI/DeepSeekHarness-Plugin/repositories/thoughtdag');
const require = createRequire(join(browserRoot, 'package.json'));
const { build } = require('esbuild'), { chromium } = require('playwright-core');
const companion = await realpath(join(root, '../obsidian-deepharness-bridge'));
const nodeEntry = `export {startBridgeServer} from ${JSON.stringify(join(companion,'src/bridge/server.ts'))};export {VaultKnowledgeStore} from ${JSON.stringify(join(companion,'src/vault/knowledge-store.ts'))};export {StickerLocalStore} from ${JSON.stringify(join(root,'src/host/local-store.ts'))};`;
await build({ stdin: { contents: nodeEntry, resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: join(output,'host.mjs') });
const { startBridgeServer, VaultKnowledgeStore, StickerLocalStore } = await import(pathToFileURL(join(output,'host.mjs')).href);
const local = new StickerLocalStore(join(output, 'synthetic-local'));
const notes = new Map([['合成笔记.md', '# 合成正文\n请保留这一段\n']]), ids = new Map(); let registry = null;
const vault = new VaultKnowledgeStore('synthetic-vault', { readState: async()=>registry, writeState: async value=>{registry=structuredClone(value)}, listPaths:()=>[...notes.keys()], readNoteId:async p=>ids.get(p), assignNoteId:async(p,id)=>{ids.set(p,id);return id}, pathsForNoteId:id=>[...ids].filter(([,v])=>v===id).map(([k])=>k), readLegacy:async()=>null, updateNote:async(p,fn)=>notes.set(p,fn(notes.get(p)??null)), openNote:async()=>{} });
await vault.load();
const objects = new Map(), actions = [], identities = [{logicalSessionId:'logical-source',nativeSessionId:'native-source',title:'来源讨论'},{logicalSessionId:'logical-target',nativeSessionId:'native-target',title:'目标讨论'}];
const resolveSession = input => { const s=identities.find(s=>s.logicalSessionId===input.logicalSessionId||s.nativeSessionId===input.nativeSessionId);assert.ok(s,'Unknown synthetic session');return s; };
async function knowledge(op,input) {
  actions.push(op);
  if(op==='status')return {instanceId:'synthetic-instance'};
  if(op==='directory')return {items:input.workspaceId?identities.map(s=>({...s,id:s.logicalSessionId})):[{id:'workspace',title:'合成工作区'}],nextCursor:null};
  if(op==='resolve')return resolveSession(input);
  if(op==='preview')return {...resolveSession(input),sourceVersionId:'version-1',items:[],capture:{sourceSessionId:'native-source',anchorId:'answer-1',messageId:'answer-1',role:'assistant',occurrence:0,selectedText:'重点'},nextCursor:null};
  if(op==='create-session'){const s={logicalSessionId:'logical-'+input.operationId,nativeSessionId:'native-'+input.operationId,title:'新建独立会话'};if(!identities.some(x=>x.nativeSessionId===s.nativeSessionId))identities.push(s);return s;}
  if(op==='list')return {items:[...objects.values()].filter(o=>o.scope.namespace===input.namespace&&(input.deleted==='all'||o.deleted===(input.deleted==='deleted'))&&(!input.logicalSessionId||o.content.body.logicalSessionId===input.logicalSessionId)),nextCursor:null};
  if(op==='get'){const o=objects.get(input.objectId);assert.ok(o);return o;}
  if(op==='write'){const old=objects.get(input.objectId);if((old?.revision??0)!==input.expectedRevision)return {status:'conflict'};const object={objectId:input.objectId,revision:input.expectedRevision+1,scope:{namespace:input.namespace},deleted:input.deleted??false,content:{title:input.title,body:input.body,references:[{logicalSessionId:input.body.logicalSessionId}]}};objects.set(input.objectId,object);return{status:'saved',object};}
  if(op==='migrate')return{object:{objectId:'migration-receipt'},mappings:[]};
  throw new Error('Unexpected operation '+op);
}
let bridge;
const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://fixture').pathname;
  if(path==='/'){res.setHeader('content-type','text/html;charset=utf-8');return res.end('<meta charset="utf-8"><div id="toolbar"></div><script src="/fixture.js"></script><script src="/client.js"></script>');}
  if(path==='/fixture.js'||path==='/client.js'){res.setHeader('content-type','text/javascript');return res.end(await readFile(path==='/fixture.js'?join(output,'fixture.js'):join(root,'lib/client.js')));}
  const chunks=[];for await(const c of req)chunks.push(c);const input=JSON.parse(Buffer.concat(chunks).toString()||'{}');let value;
  if(path==='/local/freeze')value=await local.freeze(input.sessionId);
  else if(path==='/local/activate'){await local.activate(input.sessionId,input.migrationId,input.receiptId);value={active:true};}
  else value=await knowledge(path.split('/').at(-1),input);
  res.setHeader('content-type','application/json');res.end(JSON.stringify(value));
}catch(e){res.writeHead(409,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:e.message}}));}});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
bridge=await startBridgeServer({port:0,allowedDshOrigins:[origin],onKnowledge:(op,input,instance)=>{assert.equal(instance,'synthetic-instance');return vault.dispatch(op,input,instance);}});
const req = createRequire(join(root,'package.json'));
const clientEntry=`import * as React from ${JSON.stringify(req.resolve('react'))};import * as ReactDOM from ${JSON.stringify(req.resolve('react-dom/client'))};import * as JSX from ${JSON.stringify(req.resolve('react/jsx-runtime'))};
window.fixture={draft:'用户原有草稿',opened:[],refs:[],errors:[]};let snapshot={current:'native-source',byId:{'native-source':{title:'来源讨论'},'native-target':{title:'目标讨论'}},phase:'ready'};const listeners=new Set();const chat={order:[],nodes:new Map()};
const sessions={list:{getSnapshot:()=>snapshot,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}},open:async id=>{fixture.opened.push(id);snapshot={...snapshot,current:id};for(const fn of listeners)fn()},binding:()=>undefined};
const remote={$mount:async()=>async()=>{}};const ok=value=>({ok:true,value});
const namespace={getBridgeConfig:async()=>ok({origin:${JSON.stringify(bridge.origin)},managed:true}),readLocalState:async id=>ok({document:{protocolVersion:1,type:'session-note',sessionId:id,revision:'sha256:empty',stickers:[]},pendingBacklinkDeletes:[]}),knowledgeOperation:async(op,input)=>{const r=await fetch('/local/'+op,{method:'POST',headers:{'content-type':'application/json'},body:input});return ok(JSON.stringify(await r.json()))}};
const annotation={addCrossSessionReference:async(target,capture,options)=>{fixture.refs.push({target,capture,options});return {referenceId:'ref-1'}}};
const ctx={sessions,uiConversation:{binding:()=>({target:()=>({getSnapshot:()=>chat,subscribe:()=>()=>{}})})},get:name=>({remote,'remote.stickerBoard':namespace,annotationCore:annotation})[name],effect:fn=>fn(),slots:{inject:(_name,fn)=>fn(),register:(_meta,Component)=>{const root=ReactDOM.createRoot(document.querySelector('#toolbar'));root.render(React.createElement(Component));return()=>root.unmount()}},inject:(names,fn)=>{if(!names.includes('betterSidebar'))Promise.resolve(fn(ctx)).catch(e=>fixture.errors.push(e.message));return{dispose:async()=>{}}}};
window.__ModuleLoader__={load:module=>module.factory(name=>({'react':React,'react-dom/client':ReactDOM,'react/jsx-runtime':JSX})[name]).apply(ctx)};`;
await build({stdin:{contents:clientEntry,resolveDir:root},bundle:true,platform:'browser',format:'iife',outfile:join(output,'fixture.js')});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const page=await browser.newPage({viewport:{width:1280,height:920}});const errors=[];page.on('pageerror',e=>errors.push(e.message));const checks=[];
try{
  await page.route('**/*',route=>[origin,bridge.origin].some(o=>route.request().url().startsWith(o+'/'))?route.continue():route.abort());
  await page.goto(origin);
  const header=()=>page.getByRole('button',{name:'会话贴纸',exact:true});await header().click();
  const dialog=page.getByRole('dialog',{name:'会话贴纸'});
  await dialog.getByRole('button',{name:'新建 / 挂接会话贴纸'}).click();await dialog.getByRole('button',{name:'合成工作区'}).click();await dialog.getByRole('button',{name:'目标讨论',exact:true}).click();
  await dialog.getByText('会话贴纸已建立，点击贴纸进入完整会话。').waitFor();assert.equal(identities.length,2);
  await dialog.getByRole('button',{name:'目标讨论',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.deepEqual(await page.evaluate(()=>fixture.opened),['native-target']);checks.push('existing session opens its full native page; no duplicate session');
  await header().click();await dialog.getByRole('button',{name:'删除对象',exact:true}).click();assert.equal(identities.length,2);await dialog.getByRole('button',{name:'已删除对象'}).click();await dialog.getByRole('button',{name:'恢复对象'}).click();await dialog.getByRole('button',{name:'返回当前对象'}).click();checks.push('delete and restore the sticker without deleting the real session');
  await dialog.getByRole('button',{name:'新建 / 挂接会话贴纸'}).click();await dialog.getByRole('button',{name:'新建独立会话',exact:true}).click();await dialog.getByRole('button',{name:'新建独立会话',exact:true}).waitFor();assert.equal(identities.length,3);checks.push('independent session creation');
  await dialog.getByText('迁移当前会话的旧贴纸',{exact:true}).click();await dialog.getByRole('button',{name:'迁移 / 继续上次迁移'}).click();await dialog.getByText('已迁移 0 张贴纸，后续由 Maintenance 保存。').waitFor();assert.equal((await local.ownership('native-target')).phase,'active');assert.equal(registry.fences[0].phase,'active');checks.push('packaged Lifecycle knowledge transport reaches authenticated real Companion; both durable fences activate');
  await dialog.getByText('当前会话的 Obsidian 双向链接',{exact:true}).click();await dialog.getByRole('button',{name:'查找可关联笔记'}).click();await dialog.getByRole('button',{name:'合成笔记.md ＋'}).click();await dialog.getByText('已关联',{exact:true}).waitFor();assert.match(notes.get('合成笔记.md'),/obsidian:\/\/deepharness-session/);
  await dialog.getByRole('button',{name:'解除此链接'}).click();await dialog.getByText('已解除',{exact:true}).waitFor();assert.ok(!notes.get('合成笔记.md').includes('dsh-session-link:'));assert.ok(notes.get('合成笔记.md').includes('请保留这一段'));checks.push('bidirectional note link, exact unlink, unrelated prose retained');
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();await page.evaluate(()=>window.dispatchEvent(new CustomEvent('dsh-session-sticker-open',{detail:{sessionId:'native-source',anchorId:'answer-1',selectedText:'换取显存'}})));
  await dialog.getByRole('button',{name:'合成工作区'}).click();await dialog.getByRole('button',{name:'目标讨论',exact:true}).click();await dialog.getByText('会话贴纸已建立，引用已加入目标会话输入框，发送后参与回答。').waitFor();
  assert.equal(await page.evaluate(()=>fixture.refs.length),1);assert.equal(await page.evaluate(()=>fixture.draft),'用户原有草稿');checks.push('selected completed source becomes a reference sticker, leaving draft and send under user control');
  assert.deepEqual(await page.evaluate(()=>fixture.errors),[]);assert.deepEqual(errors,[]);await page.screenshot({path:join(output,'session-stickers.png'),fullPage:true});
  await writeFile(join(output,'verification.json'),JSON.stringify({passed:true,userData:false,modelCalls:0,checks,bridgeOrigin:bridge.origin,actions},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,output}));
}catch(e){await page.screenshot({path:join(output,'failure.png'),fullPage:true});console.error(await page.evaluate(()=>fixture));throw e;}
finally{await browser.close();await bridge.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
