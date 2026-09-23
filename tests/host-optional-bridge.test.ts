import { Context } from '@deepseek-ai/cordis';
import { expect, it, vi } from 'vitest';
import { apply } from '../src/index.ts';
import { StickerBoardRemoteService } from '../src/remote/service.ts';
import type { Context as StickerContext } from '../src/context-types.ts';
import { defaultStickerStorageDirectory } from '../src/host/local-store.ts';

// Keep real Cordis service access rules while avoiding host I/O in this startup test.
vi.mock('../src/remote/service.ts', () => ({ StickerBoardRemoteService: vi.fn(function () {}) }));

it('starts its host fiber with no remote knowledge service injected', async () => {
  const ctx = new Context();
  const fiber = ctx.plugin({ inject: [], apply: context => {
    apply(context as unknown as StickerContext, { bridgeOrigin: '', storageDirectory: 'synthetic-explicit-store' });
  } });
  try {
    await expect(fiber.await()).resolves.toBeDefined();
    expect(StickerBoardRemoteService).toHaveBeenCalledWith(expect.anything(), 'http://127.0.0.1:18473', expect.anything());
  } finally {
    await fiber.dispose();
  }
});

it('uses the current Bridge profile for default storage and preserves explicit storage paths', async () => {
  const ctx = new Context();
  ctx.provide('obsidianBridgeLifecycle', { bridgeOrigin: 'http://127.0.0.1:18473', runtimeIdentity: { profileId: 'named-profile' } } as never);
  try {
    const fiber = await ctx.plugin(context => apply(context as unknown as StickerContext, { bridgeOrigin: '' }));
    expect(StickerBoardRemoteService).toHaveBeenLastCalledWith(expect.anything(), 'http://127.0.0.1:18473', expect.objectContaining({ root: defaultStickerStorageDirectory('named-profile') }));
    await fiber.dispose();
    await ctx.plugin(context => apply(context as unknown as StickerContext, { bridgeOrigin: '', storageDirectory: 'explicit-legacy-directory' }));
    expect(StickerBoardRemoteService).toHaveBeenLastCalledWith(expect.anything(), 'http://127.0.0.1:18473', expect.objectContaining({ root: 'explicit-legacy-directory' }));
  } finally { await ctx.fiber.dispose(); }
});

it('refuses to guess the default storage profile when identity is unavailable', () => {
  expect(() => apply({ get: () => undefined } as never, { bridgeOrigin: '' })).toThrow(/profile identity/);
});
