import { expect, it, vi } from 'vitest';
import type { ObsidianBridgeLifecycle } from 'dsh-obsidian-bridge-lifecycle/api';
import { createStickerBridgeChannel } from '../src/client/bridge-channel.ts';

it('fails remote requests explicitly when Bridge is absent', async () => {
  const channel = createStickerBridgeChannel(() => undefined);
  await expect(channel.readSessionNote('session')).rejects.toMatchObject({ name: 'BridgeUnavailableError' });
  await expect(channel.knowledge('note-open', {})).rejects.toMatchObject({ name: 'BridgeUnavailableError' });
  expect(channel).not.toHaveProperty('dispose');
  expect(channel).not.toHaveProperty('nextActions');
  expect(channel).not.toHaveProperty('acknowledgeAction');
});

it('borrows the current service after a late mount, removal and replacement', async () => {
  let lifecycle: ObsidianBridgeLifecycle | undefined;
  const channel = createStickerBridgeChannel(() => lifecycle);
  const first = { knowledge: vi.fn(async () => 'first') };
  const next = { knowledge: vi.fn(async () => 'next') };
  lifecycle = { transport: first } as unknown as ObsidianBridgeLifecycle;
  await expect(channel.knowledge('note-open', { noteId: 'note' })).resolves.toBe('first');
  lifecycle = undefined;
  await expect(channel.knowledge('note-open', {})).rejects.toMatchObject({ name: 'BridgeUnavailableError' });
  lifecycle = { transport: next } as unknown as ObsidianBridgeLifecycle;
  await expect(channel.knowledge('note-open', {})).resolves.toBe('next');
  expect(first.knowledge).toHaveBeenCalledOnce();
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
