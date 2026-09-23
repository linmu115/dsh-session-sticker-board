// @vitest-environment jsdom
import { Context, type Fiber } from '@deepseek-ai/cordis';
import { afterEach, expect, it, vi } from 'vitest';
import { apply } from '../src/client/index.tsx';
import { mountStickerRemote } from '../src/client/remote.ts';
import { createRoot } from 'react-dom/client';
import { createStickerWorkspace } from '../src/client/sticker-workspace.ts';

vi.mock('../src/client/remote.ts', () => ({ mountStickerRemote: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: vi.fn() }));
vi.mock('../src/client/sticker-workspace.ts', () => ({ createStickerWorkspace: vi.fn() }));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const roots: Context[] = [];
afterEach(async () => { for (const ctx of roots.splice(0)) await ctx.fiber.dispose(); vi.resetAllMocks(); document.body.innerHTML = ''; });

async function setup() {
  const ctx = new Context(); roots.push(ctx);
  let startup!: Fiber;
  ctx.on('internal/plugin', fiber => { if (fiber.name === 'dsh-session-sticker-board:client-startup') startup = fiber; });
  for (const name of ['sessions', 'remote', 'uiConversation', 'annotationCore']) ctx.provide(name, {} as never);
  const health = vi.fn(), actions = vi.fn(), sync = vi.fn();
  const bridge = await ctx.plugin(child => child.provide('obsidianBridgeLifecycle', {
    runtimeIdentity: { profileId: 'web' },
    registerHealthSource: () => health,
    registerActionHandler: () => actions,
    mountWhenReady: () => sync,
  } as never));
  const unmount = vi.fn();
  vi.mocked(createRoot).mockReturnValue({ render: vi.fn(), unmount } as never);
  const disposeWorkspace = vi.fn();
  vi.mocked(createStickerWorkspace).mockReturnValue({ dispose: disposeWorkspace } as never);
  const plugin = await ctx.plugin(child => apply(child as never));
  await vi.waitFor(() => expect(mountStickerRemote).toHaveBeenCalledOnce());
  return { ctx, bridge, plugin, unmount, disposeWorkspace, health, actions, sync, get startup() { return startup; } };
}

it('cancels a late remote mount on dependency loss, awaits its disposal, and mounts only the replacement', async () => {
  const late = deferred<Awaited<ReturnType<typeof mountStickerRemote>>>();
  vi.mocked(mountStickerRemote).mockReturnValueOnce(late.promise);
  const state = await setup();
  let initialized = false;
  const initializedTask = state.startup.await().then(() => { initialized = true; });
  await Promise.resolve();
  expect(initialized).toBe(false);
  const signal = vi.mocked(mountStickerRemote).mock.calls[0]![1]!;
  const disposing = state.bridge.dispose();
  await vi.waitFor(() => expect(signal.aborted).toBe(true));
  const remoteCleanup = deferred<void>();
  const dispose = vi.fn(() => remoteCleanup.promise);
  late.resolve({ dispose } as never);
  await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
  expect(createRoot).not.toHaveBeenCalled();
  expect(document.querySelector('[data-dsh-sticker-board]')).toBeNull();
  remoteCleanup.resolve();
  await disposing;
  await initializedTask;
  const nextDispose = vi.fn(async () => {});
  vi.mocked(mountStickerRemote).mockResolvedValue({ dispose: nextDispose } as never);
  await state.ctx.plugin(child => child.provide('obsidianBridgeLifecycle', {
    registerHealthSource: () => () => {}, registerActionHandler: () => () => {}, mountWhenReady: () => () => {},
  } as never));
  await vi.waitFor(() => expect(createRoot).toHaveBeenCalledOnce());
  await state.plugin.dispose();
  expect(nextDispose).toHaveBeenCalledOnce();
  expect(state.unmount).toHaveBeenCalledOnce();
});

it('unloads React, registrations and workspace before the owning plugin finishes remote cleanup', async () => {
  const remoteCleanup = deferred<void>();
  const dispose = vi.fn(() => remoteCleanup.promise);
  vi.mocked(mountStickerRemote).mockResolvedValue({ dispose } as never);
  const state = await setup();
  await vi.waitFor(() => expect(createRoot).toHaveBeenCalledOnce());
  let finished = false;
  const disposing = state.plugin.dispose().then(() => { finished = true; });
  await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
  expect(finished).toBe(false);
  expect(state.unmount).toHaveBeenCalledOnce();
  expect(state.disposeWorkspace).toHaveBeenCalledOnce();
  expect(state.health).toHaveBeenCalledOnce();
  expect(state.actions).toHaveBeenCalledOnce();
  expect(state.sync).toHaveBeenCalledOnce();
  expect(document.querySelector('[data-dsh-sticker-board]')).toBeNull();
  remoteCleanup.resolve();
  await disposing;
  expect(finished).toBe(true);
});

it('rolls back the remote, workspace and host if React startup throws', async () => {
  const dispose = vi.fn(async () => {});
  vi.mocked(mountStickerRemote).mockResolvedValue({ dispose } as never);
  const state = await setup();
  // A replacement generation exercises a synchronous failure after acquisition.
  await state.bridge.dispose();
  vi.mocked(createRoot).mockImplementation(() => { throw new Error('synthetic React failure'); });
  const log = vi.spyOn(state.ctx.logger, 'error').mockImplementation(() => {});
  await state.ctx.plugin(child => child.provide('obsidianBridgeLifecycle', {} as never));
  await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(2));
  await expect(state.startup.await()).rejects.toThrow('synthetic React failure');
  expect(document.querySelector('[data-dsh-sticker-board]')).toBeNull();
  expect(state.disposeWorkspace).toHaveBeenCalledTimes(2);
  log.mockRestore();
});
