import { Context } from '@deepseek-ai/cordis';
import { expect, it, vi } from 'vitest';
import { apply } from '../src/index.ts';
import { StickerBoardRemoteService } from '../src/remote/service.ts';
import type { Context as StickerContext } from '../src/context-types.ts';

// Keep real Cordis service access rules while avoiding host I/O in this startup test.
vi.mock('../src/remote/service.ts', () => ({ StickerBoardRemoteService: vi.fn(function () {}) }));

it('starts its host fiber with no injected Bridge or Maintenance service', async () => {
  const ctx = new Context();
  const fiber = ctx.plugin({ inject: [], apply: context => {
    apply(context as unknown as StickerContext, { bridgeOrigin: '' });
  } });
  try {
    await expect(fiber.await()).resolves.toBeDefined();
    expect(StickerBoardRemoteService).toHaveBeenCalledWith(expect.anything(), 'http://127.0.0.1:18473', expect.anything());
  } finally {
    await fiber.dispose();
  }
});
