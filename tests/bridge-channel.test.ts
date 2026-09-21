import { expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { ObsidianBridgeLifecycle } from 'dsh-obsidian-bridge/api';
import { createStickerBridgeChannel, type StickerBridgeChannel } from '../src/client/bridge-channel.ts';

/** Probe a kept member and widen the result so a stub can answer with a sentinel. */
const probe = (channel: StickerBridgeChannel): Promise<unknown> => channel.readSessionNote('session') as Promise<unknown>;

it('fails remote requests explicitly when Bridge is absent', async () => {
  const channel = createStickerBridgeChannel(() => undefined);
  await expect(probe(channel)).rejects.toMatchObject({ name: 'BridgeUnavailableError' });
  await expect(channel.openNote({ protocolVersion: 1, type: 'open-note', actionId: 'action', notePath: 'Note.md' })).rejects.toMatchObject({ name: 'BridgeUnavailableError' });
  expect(channel).not.toHaveProperty('dispose');
  expect(channel).not.toHaveProperty('nextActions');
  expect(channel).not.toHaveProperty('acknowledgeAction');
});

it('borrows the current service after a late mount, removal and replacement', async () => {
  let lifecycle: ObsidianBridgeLifecycle | undefined;
  const channel = createStickerBridgeChannel(() => lifecycle);
  const first = { readSessionNote: vi.fn(async () => 'first') };
  const next = { readSessionNote: vi.fn(async () => 'next') };
  lifecycle = { transport: first } as unknown as ObsidianBridgeLifecycle;
  await expect(probe(channel)).resolves.toBe('first');
  lifecycle = undefined;
  await expect(probe(channel)).rejects.toMatchObject({ name: 'BridgeUnavailableError' });
  lifecycle = { transport: next } as unknown as ObsidianBridgeLifecycle;
  await expect(probe(channel)).resolves.toBe('next');
  expect(first.readSessionNote).toHaveBeenCalledOnce();
});
it('resolves late and replaced services through real Cordis without owning their lifetime', async () => {
  const ctx = new Context();
  let channel: ReturnType<typeof createStickerBridgeChannel>;
  const consumer = await ctx.plugin(child => { channel = createStickerBridgeChannel(() => child.get('obsidianBridgeLifecycle') as ObsidianBridgeLifecycle | undefined); });
  const first = { readSessionNote: vi.fn(async () => 'first') }, replacement = { readSessionNote: vi.fn(async () => 'replacement') };
  try {
    await expect(probe(channel!)).rejects.toMatchObject({ name: 'BridgeUnavailableError' });
    const provider = await ctx.plugin(child => { child.provide('obsidianBridgeLifecycle', { transport: first } as unknown as ObsidianBridgeLifecycle); });
    await expect(probe(channel!)).resolves.toBe('first');
    await provider.dispose();
    await expect(probe(channel!)).rejects.toMatchObject({ name: 'BridgeUnavailableError' });
    const next = await ctx.plugin(child => { child.provide('obsidianBridgeLifecycle', { transport: replacement } as unknown as ObsidianBridgeLifecycle); });
    await expect(probe(channel!)).resolves.toBe('replacement');
    expect(first.readSessionNote).toHaveBeenCalledOnce();
    await consumer.dispose();
    expect(ctx.get('obsidianBridgeLifecycle')).toBeDefined();
    await next.dispose();
  } finally { await ctx.fiber.dispose(); }
});

it('delegates reference handoff intact and preserves service receiver', async () => {
  const input = { sessionId: 'session', operationId: 'operation', prepare: vi.fn(), commit: vi.fn(), assertCurrent: vi.fn() };
  const lifecycle = { handoffReference: vi.fn(async function(this: unknown, actual: unknown) {
    expect(this).toBe(lifecycle); expect(actual).toBe(input);
    return { setId: 'set', referenceId: 'reference' };
  }) } as unknown as ObsidianBridgeLifecycle;
  await expect(createStickerBridgeChannel(() => lifecycle).handoffReference(input)).resolves.toEqual({ setId: 'set', referenceId: 'reference' });
  expect(input.prepare).not.toHaveBeenCalled();
});

it('routes backlinks and note opens per Vault instead of a last-connected endpoint', async () => {
  const routes = Object.fromEntries(['a','b'].map(vaultId => [vaultId, { listBacklinks: vi.fn(async () => [{ notePath: 'Same.md', line: 0 }]), openNote: vi.fn(async () => {}) }]));
  const lifecycle = { listVaults: () => ['a','b'].map(vaultId => ({ vaultId, displayName: vaultId, state: 'bound' })), forVault: (id: string) => routes[id], transport: { listBacklinks: () => { throw new Error('ambiguous'); } } } as unknown as ObsidianBridgeLifecycle;
  const channel = createStickerBridgeChannel(() => lifecycle);
  const backlinks = await channel.listBacklinks({} as never);
  expect(backlinks.map(x => x.vaultId)).toEqual(['a','b']);
  expect(routes.a!.listBacklinks).toHaveBeenCalledOnce();
  expect(routes.b!.listBacklinks).toHaveBeenCalledOnce();
  await channel.openNote({ protocolVersion: 1, type: 'open-note', actionId: 'action', vaultId: 'b', notePath: 'Same.md' });
  expect(routes.b!.openNote).toHaveBeenCalledOnce();
  expect(routes.a!.openNote).not.toHaveBeenCalled();
});
