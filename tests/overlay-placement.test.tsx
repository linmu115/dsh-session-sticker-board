// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { readOverlayBounds, placeOverlay } from '../src/client/overlay-placement.ts';
import { StickerEditor } from '../src/client/overlay.tsx';
import type { StickerRecord } from '../src/protocol.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const record: StickerRecord = { stickerId: 'geometry', sessionId: 'D', anchorId: 'a', quote: 'synthetic', quoteHash: 'hash', role: 'user', occurrence: 0, markdown: 'draft preserved', tags: [], color: 'yellow' };
afterEach(() => { document.body.removeAttribute('style'); delete document.body.dataset.mvMode; vi.restoreAllMocks(); });
function child(left = 315.5, width = 310.5, bottom = 0) {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1086);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(862);
  document.body.dataset.mvMode = 'child';
  document.body.style.setProperty('--mv-left', `${left}px`);
  document.body.style.setProperty('--mv-width', `${width}px`);
  document.body.style.setProperty('--mv-bottom', `${bottom}px`);
}

it('fits the measured D chat slice instead of the full iframe and right sidebar', () => {
  child();
  const bounds = readOverlayBounds();
  expect(bounds).toEqual({ left: 315.5, top: 0, right: 626, bottom: 862 });
  const editor = placeOverlay(bounds, { x: 504.677, y: 125.333 }, 312, 330);
  expect(editor.left).toBe(323.5);
  expect(editor.width).toBe(294.5);
  expect(editor.left + editor.width).toBe(618);
  expect(editor.top).toBeCloseTo(109.333);
  const menu = placeOverlay(bounds, { x: 622, y: 850 }, 216, 220);
  expect(menu.left + menu.width).toBeLessThanOrEqual(618);
  expect(menu.top + menu.maxHeight).toBe(854);
});

it('excludes the shared bottom panel and clamps both edges in a narrow chat', () => {
  child(315.5, 160, 180);
  const bounds = readOverlayBounds();
  const value = placeOverlay(bounds, { x: -100, y: 850 }, 312, 330);
  expect(value).toEqual({ left: 323.5, top: 344, width: 144, maxHeight: 330 });
  expect(value.top + value.maxHeight).toBe(862 - 180 - 8);
});

it('uses the ordinary viewport outside a split child and bounds malformed geometry', () => {
  child(); delete document.body.dataset.mvMode;
  expect(readOverlayBounds()).toEqual({ left: 0, top: 0, right: 1086, bottom: 862 });
  document.body.dataset.mvMode = 'child';
  document.body.style.setProperty('--mv-left', '-20px');
  document.body.style.setProperty('--mv-width', 'invalid');
  document.body.style.setProperty('--mv-bottom', '9999px');
  expect(readOverlayBounds()).toEqual({ left: 0, top: 0, right: 1086, bottom: 0 });
});

it('repositions an open editor on parent geometry changes without losing its draft or save action', async () => {
  child();
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), save = vi.fn();
  try {
    await act(async () => root.render(<StickerEditor record={record} point={{ x: 504.677, y: 125.333 }} isNew error={null} onSave={save} onCancel={vi.fn()} />));
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.style.left).toBe('323.5px'); expect(dialog.style.width).toBe('294.5px');
    await act(async () => {
      document.body.style.setProperty('--mv-left', '100px');
      document.body.style.setProperty('--mv-width', '190px');
      await Promise.resolve();
    });
    expect(dialog.style.left).toBe('108px'); expect(dialog.style.width).toBe('174px');
    expect(host.querySelector('textarea')!.value).toBe('draft preserved');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="保存贴纸"]')!.click());
    expect(save).toHaveBeenCalledExactlyOnceWith({ markdown: 'draft preserved', tags: [], color: 'yellow' });
    await act(async () => { delete document.body.dataset.mvMode; window.dispatchEvent(new Event('resize')); });
    expect(dialog.style.width).toBe('312px');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
