// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { StickerEditor } from '../src/client/overlay.tsx';
import type { StickerRecord } from '../src/protocol.ts';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const record: StickerRecord = { stickerId:'test',sessionId:'fixture',anchorId:'anchor',quote:'合成原文',quoteHash:'hash',role:'user',occurrence:0,markdown:'正文',tags:[],color:'yellow' };
const host = document.createElement('div'); document.body.append(host); let root = createRoot(host);
afterEach(async () => { await act(async () => root.unmount()); root = createRoot(host); vi.restoreAllMocks(); });
const click = async (label: string) => { await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click()); };
it('opens a compact palette and submits color with content only on explicit save', async () => {
 const save = vi.fn(), cancel = vi.fn();
 await act(async () => root.render(<StickerEditor record={record} point={{x:10,y:20}} isNew={false} error={null} onSave={save} onCancel={cancel}/>));
 expect(host.querySelector('[aria-label="选择高亮颜色"]')).toBeNull();
 await click('高亮颜色'); await click('绿色');
 expect(save).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
 expect(host.querySelector('[aria-label="高亮颜色"]')!.getAttribute('title')).toContain('绿色');
 await click('保存贴纸'); expect(save).toHaveBeenCalledWith({markdown:'正文',tags:[],color:'green'});
});
it('closes the palette with Escape and clears the nonpersistent color preview on unmount', async () => {
 const events: unknown[] = []; const listener = (event: Event) => events.push((event as CustomEvent).detail);
 window.addEventListener('dsh-sticker-color-preview', listener);
 try {
  await act(async () => root.render(<StickerEditor record={record} point={{x:10,y:20}} isNew={false} error={null} onSave={vi.fn()} onCancel={vi.fn()}/>));
  await click('高亮颜色');
  await act(async () => host.querySelector('[aria-label="高亮颜色"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  expect(host.querySelector('[aria-label="选择高亮颜色"]')).toBeNull();
  await act(async () => root.render(null)); expect(events.at(-1)).toEqual({stickerId:'test'});
 } finally { window.removeEventListener('dsh-sticker-color-preview',listener); }
});
