import { useEffect, useState } from 'react';

export interface OverlayBounds { left: number; top: number; right: number; bottom: number }

/** Split children retain a full-width iframe; only their chat rectangle is visible. */
export function readOverlayBounds(view: Window = window, body: HTMLElement = document.body): OverlayBounds {
  const width = view.innerWidth, height = view.innerHeight;
  if (body.dataset.mvMode !== 'child') return { left: 0, top: 0, right: width, bottom: height };
  const value = (name: string, fallback: number): number => {
    const raw = body.style.getPropertyValue(name).trim();
    const parsed = raw ? Number(raw.replace(/px$/, '')) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const left = Math.max(0, Math.min(width, value('--mv-left', 0)));
  return {
    left, top: 0,
    right: Math.max(left, Math.min(width, left + Math.max(0, value('--mv-width', width)))),
    bottom: Math.max(0, height - Math.max(0, value('--mv-bottom', 0))),
  };
}

export function placeOverlay(bounds: OverlayBounds, point: { x: number; y: number }, preferredWidth: number, preferredHeight: number) {
  const gapX = Math.min(8, (bounds.right - bounds.left) / 2);
  const gapY = Math.min(8, (bounds.bottom - bounds.top) / 2);
  const width = Math.max(0, Math.min(preferredWidth, bounds.right - bounds.left - 2 * gapX));
  const height = Math.max(0, Math.min(preferredHeight, bounds.bottom - bounds.top - 2 * gapY));
  const left = Math.max(bounds.left + gapX, Math.min(bounds.right - gapX - width, point.x + 14));
  const top = Math.max(bounds.top + gapY, Math.min(bounds.bottom - gapY - height, point.y - 16));
  return { left, top, width, maxHeight: Math.max(0, bounds.bottom - gapY - top) };
}

/** Only mounted popovers observe geometry; empty session overlays remain idle. */
export function useOverlayPlacement(point: { x: number; y: number }, width: number, height: number) {
  const [bounds, setBounds] = useState(() => readOverlayBounds());
  useEffect(() => {
    const update = () => {
      const next = readOverlayBounds();
      setBounds(current => current.left === next.left && current.right === next.right && current.top === next.top && current.bottom === next.bottom ? current : next);
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, attributeFilter: ['style', 'data-mv-mode'] });
    window.addEventListener('resize', update);
    update();
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  return placeOverlay(bounds, point, width, height);
}
