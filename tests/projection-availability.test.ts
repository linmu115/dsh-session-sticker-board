import { afterEach, expect, it, vi } from 'vitest';
import { resolveMaintenanceProjection } from '../src/client/deep-link.ts';
import { knowledgeRequest } from '../src/client/knowledge.ts';
const input = { referenceType: 'sticker' as const, legacySessionId: 'synthetic-session', legacyAnchorId: 'synthetic-anchor' };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function controlledTimeout() {
  vi.useFakeTimers();
  return vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Synthetic deadline', 'TimeoutError')), ms);
    return controller.signal;
  });
}
function delayedFetch() {
  return vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
  }));
}
it('bounds a stalled projection lookup so its optional caller can release the selection menu', async () => {
  const deadline = controlledTimeout(), request = delayedFetch();
  let completed = false;
  const pending = resolveMaintenanceProjection({ ...input, fetchImpl: request }).catch(() => undefined).then(value => { completed = true; return value; });
  await vi.advanceTimersByTimeAsync(15000);
  expect(completed).toBe(true);
  await expect(pending).resolves.toBeUndefined();
  expect(deadline).toHaveBeenCalledWith(15000);
  expect(request).toHaveBeenCalledOnce();
  expect(JSON.parse(request.mock.calls[0]![1]!.body as string).operation).toBe('reference:resolve');
});
it('preserves caller cancellation before the lookup deadline', async () => {
  controlledTimeout(); const controller = new AbortController(), request = delayedFetch();
  const pending = resolveMaintenanceProjection({ ...input, fetchImpl: request, signal: controller.signal });
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await rejected;
  expect(request).toHaveBeenCalledOnce();
});
it('keeps a successful delayed identity and never replays the lookup', async () => {
  controlledTimeout();
  const request = vi.fn<typeof fetch>(() => new Promise(resolve => setTimeout(() => resolve(new Response(JSON.stringify({ referenceResolution: { status: 'resolved', nativeSessionId: 'synthetic-session', logicalSessionId: 'logical', logicalAnchorId: 'anchor', nativeAnchorId: 'synthetic-anchor' } }))), 100)));
  const pending = resolveMaintenanceProjection({ ...input, fetchImpl: request });
  await vi.advanceTimersByTimeAsync(100);
  await expect(pending).resolves.toMatchObject({logicalSessionId:'logical',logicalAnchorId:'anchor'});
  expect(request).toHaveBeenCalledOnce();
});
it('distinguishes the separately bounded initial legacy-state load from projection lookup', async () => {
  controlledTimeout(); const request = delayedFetch(); vi.stubGlobal('fetch', request);
  const rejected = expect(knowledgeRequest('legacy-state', {nativeSessionId:'synthetic-session'})).rejects.toMatchObject({code:'MAINTENANCE_UNAVAILABLE'});
  await vi.advanceTimersByTimeAsync(15000); await rejected;
  expect(request.mock.calls[0]![0]).toBe('/maintenance-knowledge/api/legacy-state');
  expect(request).toHaveBeenCalledOnce();
});
