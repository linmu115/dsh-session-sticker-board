// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StickerDetailForm } from '../src/client/sticker-sidebar.tsx';
import type { StickerSyncStatus, StickerWorkspace } from '../src/client/sticker-workspace.ts';
import type { StickerRecord } from '../src/protocol.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const CONFLICT_TEXT = 'Obsidian 笔记在同步期间发生修改，请选择要保留的贴纸内容';

const record: StickerRecord = {
  stickerId: '9bb3a80e-230d-44d1-a37c-f7b79d2bf315',
  sessionId: 'session-demo',
  anchorId: 'message:user-2',
  role: 'user',
  quote: '合成原文',
  quoteHash: 'sha256:quote',
  occurrence: 0,
  markdown: '正文',
  tags: [],
  color: 'yellow',
};

const boundVaultId = 'ee267892-2bae-4658-bbaf-7e0d448d59b7';
const boundVault = {
  vaultId: boundVaultId,
  displayName: 'testvault',
  origin: 'http://127.0.0.1:18473',
  binding: {
    bindingProtocolVersion: 1,
    vaultId: boundVaultId,
    revision: 3,
    target: { instanceId: 'i-27c4d5a7-bdb5-4b8a-8d95-6267f47499c5', profileId: 'web' },
    updatedAt: 1,
    lastOperationId: 'operation',
  },
  state: 'bound',
};

function workspace(syncStatus: StickerSyncStatus, syncIssue?: string): StickerWorkspace {
  return {
    syncStatus: () => syncStatus,
    syncIssue: () => syncIssue,
    vaults: () => [boundVault],
    selectVault: vi.fn(async () => undefined),
    sync: vi.fn(async () => undefined),
    resolveConflict: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    list: () => [],
  } as unknown as StickerWorkspace;
}

const host = document.createElement('div');
document.body.append(host);
let root = createRoot(host);

afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  vi.restoreAllMocks();
});

async function render(syncStatus: StickerSyncStatus, syncIssue?: string): Promise<StickerWorkspace> {
  const target = workspace(syncStatus, syncIssue);
  await act(async () => root.render(
    <StickerDetailForm
      record={record}
      workspace={target}
      openNote={async () => undefined}
      listBacklinks={async () => []}
      close={() => undefined}
    />,
  ));
  return target;
}

const recovery = (): HTMLElement | null => host.querySelector<HTMLElement>('.dsh-sticker-sidebar-sync-recovery');
const vaultSelect = (): HTMLSelectElement | null => host.querySelector<HTMLSelectElement>('select[aria-label="旧贴纸所在 Vault"]');
const button = (label: string): HTMLButtonElement | null => [...host.querySelectorAll<HTMLButtonElement>('button')]
  .find(node => node.textContent === label) ?? null;
const status = (): string => host.querySelector('.dsh-sticker-sidebar-status')?.textContent ?? '';

describe("sticker sidebar sync recovery presentation", () => {
  it("shows no Vault target and no recovery action while the session is only local", async () => {
    await render('local-only');

    expect(recovery()).toBeNull();
    expect(vaultSelect()).toBeNull();
    expect(button('保存目标')).toBeNull();
    expect(button('使用 DSH 贴纸内容')).toBeNull();
    expect(button('使用 Obsidian 贴纸内容')).toBeNull();
    expect(button('重试同步')).toBeNull();
    expect(host.textContent).not.toContain('旧贴纸所在 Vault');
    expect(host.textContent).not.toContain(CONFLICT_TEXT);
    expect(status()).toBe('已保存到 DSH；Obsidian 双链待连接');
  });

  it("keeps a recorded local-only sync issue readable without any recovery control", async () => {
    await render('local-only', 'Bridge 暂不可用');

    expect(recovery()).not.toBeNull();
    expect(vaultSelect()).toBeNull();
    expect(button('保存目标')).toBeNull();
    expect(button('重试同步')).toBeNull();
    expect(button('使用 DSH 贴纸内容')).toBeNull();
    expect(recovery()?.querySelector('details')?.textContent).toContain('Bridge 暂不可用');
  });

  it("keeps the conflict copy, both conflict choices and the bound Vault target on a revision conflict", async () => {
    const target = await render('conflict', 'Expected sha256:a, found sha256:b');

    expect(status()).toBe(CONFLICT_TEXT);
    expect(button('使用 DSH 贴纸内容')).not.toBeNull();
    expect(button('使用 Obsidian 贴纸内容')).not.toBeNull();
    expect(vaultSelect()).not.toBeNull();
    expect(button('保存目标')).not.toBeNull();
    expect(button('重试同步')).toBeNull();
    expect([...vaultSelect()!.querySelectorAll('option')].map(option => option.textContent))
      .toEqual(['请选择 Vault', `testvault · ${boundVaultId}`]);
    expect(recovery()?.querySelector('details')?.textContent).toContain('Expected sha256:a, found sha256:b');

    await act(async () => button('使用 DSH 贴纸内容')!.click());
    expect(target.resolveConflict).toHaveBeenCalledWith(record.sessionId, 'keep-local');
  });

  it("offers retry for a failed sync and keeps the conflict copy out of that state", async () => {
    const target = await render('error', 'bridge offline');

    expect(status()).toBe('已保存到 DSH；Obsidian 同步未完成');
    expect(host.textContent).not.toContain(CONFLICT_TEXT);
    expect(button('重试同步')).not.toBeNull();
    expect(button('使用 DSH 贴纸内容')).toBeNull();
    expect(button('使用 Obsidian 贴纸内容')).toBeNull();
    expect(vaultSelect()).not.toBeNull();
    expect(recovery()?.querySelector('details')?.textContent).toContain('bridge offline');

    await act(async () => button('重试同步')!.click());
    expect(target.sync).toHaveBeenCalledWith(record.sessionId);
  });

  it("renders no recovery block once the Obsidian backlinks are synced", async () => {
    await render('synced');

    expect(recovery()).toBeNull();
    expect(host.textContent).not.toContain(CONFLICT_TEXT);
    expect(host.textContent).not.toContain('旧贴纸所在 Vault');
  });
});
