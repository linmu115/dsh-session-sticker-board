import { Context } from '@deepseek-ai/cordis';
import { expect, it, vi } from 'vitest';
import { inject } from '../src/client/index.tsx';

it('waits for all ordinary Sticker providers and releases the feature fiber when one unloads', async () => {
  const ctx = new Context();
  const mounted = vi.fn(), unmounted = vi.fn();
  try {
    for (const name of ['sessions', 'remote', 'uiConversation']) ctx.provide(name, {} as never);
    const waiting = ctx.inject([...inject], child => { mounted(); child.effect(() => unmounted); });
    const core = await ctx.plugin(child => { child.provide('annotationCore', {} as never); });
    const sidebar = await ctx.plugin(child => { child.provide('betterSidebar', {} as never); });
    expect(mounted).not.toHaveBeenCalled();
    const bridge = await ctx.plugin(child => { child.provide('obsidianBridgeLifecycle', {} as never); });
    await waiting.await(); expect(mounted).toHaveBeenCalledTimes(1);
    await bridge.dispose(); expect(unmounted).toHaveBeenCalledTimes(1);
    const replacement = await ctx.plugin(child => { child.provide('obsidianBridgeLifecycle', {} as never); });
    await waiting.await(); expect(mounted).toHaveBeenCalledTimes(2);
    await core.dispose(); expect(unmounted).toHaveBeenCalledTimes(2);
    await waiting.dispose(); await replacement.dispose(); await sidebar.dispose();
  } finally { await ctx.fiber.dispose(); }
});
