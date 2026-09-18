// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { StickerOverlay } from '../src/client/overlay.tsx';
it('does not observe or scan the page for empty overlays during session switches', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const observe = vi.spyOn(MutationObserver.prototype, 'observe');
  const query = vi.spyOn(document, 'querySelector');
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    for (const sessionId of ['a', 'b', 'c']) {
      await act(async () => root.render(<>
        <StickerOverlay sessionId={sessionId} sessionTitle={sessionId} stickers={[]} onSave={async () => {}} onDelete={async () => {}} onOpenNote={async () => {}} resolveAnchorId={key => key} resolveAnchorKey={key => key} />
      </>));
      await act(async () => { const panel = document.createElement('aside'); document.body.append(panel); panel.remove(); });
    }
    expect(observe).not.toHaveBeenCalled();
    expect(query.mock.calls.filter(([selector]) => selector.includes('toolbar'))).toHaveLength(0);
  } finally { await act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); }
});
