import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { StickerLocalStore } from '../src/host/local-store.ts';
import { defaultStickerStorageDirectory, profileStickerStorageDirectory } from '../src/host/storage-scope.ts';
import { migrateStickerStorage } from '../src/host/migrate-storage.ts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sticker-profile-')); roots.push(root);
  const legacy = new StickerLocalStore(root);
  const empty = await legacy.read('shared-session');
  const pending = { stickerId: '9bb3a80e-230d-44d1-a37c-f7b79d2bf315', sessionId: 'shared-session', anchorId: 'message', role: 'user' as const, quote: 'synthetic', quoteHash: 'sha256:test', occurrence: 0, markdown: 'saved', tags: [], color: 'yellow' as const };
  const saved = await legacy.save({ expectedRevision: empty.document.revision, document: { ...empty.document, stickers: [pending] }, enqueueBacklinkDelete: { ...pending, pendingVaultIds: ['vault-one'] } });
  const scoped = (profileId: string) => new StickerLocalStore(profileStickerStorageDirectory(root, profileId), { root, profileId });
  return { root, legacy, saved, scoped };
}

it('isolates the same home and session across exact profile identities, including case and path separators', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sticker-profile-')); roots.push(root);
  const profiles = ['web', 'Web', '../web', 'a/b', 'a\\b'];
  const paths = profiles.map(profile => defaultStickerStorageDirectory(profile, { DSH_HOME: root }));
  expect(new Set(paths).size).toBe(profiles.length);
  const stores = paths.map(path => new StickerLocalStore(path));
  for (const [index, store] of stores.entries()) {
    const state = await store.read('same-session');
    await store.save({ expectedRevision: state.document.revision, document: { ...state.document, vaultId: `vault-${index}` } });
  }
  for (const [index, store] of stores.entries()) expect((await store.read('same-session')).document.vaultId).toBe(`vault-${index}`);
  expect(() => defaultStickerStorageDirectory('')).toThrow(/profile identity/);
});

it('requires explicit attribution, copies bytes/outbox/freeze markers with backup, and preserves explicit legacy reads', async () => {
  const { root, legacy, saved, scoped } = await fixture();
  const frozenName = createHash('sha256').update('frozen-session').digest('hex') + '.json.ownership';
  await writeFile(join(root, 'sessions', frozenName), JSON.stringify({ migrationId: 'migration', phase: 'frozen' }));
  for (const profile of ['web', 'other']) {
    await expect(scoped(profile).read('shared-session')).rejects.toMatchObject({ code: 'STICKER_STORAGE_SCOPE_REQUIRED' });
    await expect(scoped(profile).save({ expectedRevision: 'sha256:empty', document: saved.document })).rejects.toMatchObject({ code: 'STICKER_STORAGE_SCOPE_REQUIRED' });
    await expect(scoped(profile).ownership('frozen-session')).rejects.toMatchObject({ code: 'STICKER_STORAGE_SCOPE_REQUIRED' });
  }
  const receipt = await migrateStickerStorage({ sourceDirectory: root, profileId: 'web' });
  expect(receipt.completed).toBe(true);
  expect(await legacy.read('shared-session')).toEqual(saved);
  expect(await scoped('web').read('shared-session')).toEqual(saved);
  expect((await scoped('other').read('shared-session')).document.stickers).toEqual([]);
  expect(await scoped('web').ownership('frozen-session')).toMatchObject({ phase: 'frozen' });
  for (const file of receipt.files) {
    const original = await readFile(join(root, 'sessions', file.name));
    expect(await readFile(join(receipt.backupDirectory, file.name))).toEqual(original);
    expect(await readFile(join(receipt.targetDirectory, 'sessions', file.name))).toEqual(original);
  }
  expect(await migrateStickerStorage({ sourceDirectory: root, profileId: 'web' })).toEqual(receipt);
  await expect(migrateStickerStorage({ sourceDirectory: root, profileId: 'other' })).rejects.toThrow(/already assigned/);
});

it('refuses conflicting target data and concurrent assignments without deleting source data', async () => {
  const { root, saved, legacy, scoped } = await fixture();
  const target = profileStickerStorageDirectory(root, 'web');
  await mkdir(join(target, 'sessions'), { recursive: true });
  const name = (await readdir(join(root, 'sessions')))[0]!;
  await writeFile(join(target, 'sessions', name), 'conflicting target');
  await expect(migrateStickerStorage({ sourceDirectory: root, profileId: 'web' })).rejects.toThrow(/different data/);
  expect(await readFile(join(target, 'sessions', name), 'utf8')).toBe('conflicting target');
  expect(await legacy.read('shared-session')).toEqual(saved);
  await expect(scoped('web').read('shared-session')).rejects.toMatchObject({ code: 'STICKER_STORAGE_SCOPE_REQUIRED' });
  await expect(migrateStickerStorage({ sourceDirectory: root, profileId: 'other' })).rejects.toThrow(/already assigned/);
  const { root: otherRoot } = await fixture();
  const results = await Promise.allSettled(['web', 'other'].map(profileId => migrateStickerStorage({ sourceDirectory: otherRoot, profileId })));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
});

it('detects legacy writes after migration and never silently imports them again', async () => {
  const { root, legacy, saved, scoped } = await fixture();
  await migrateStickerStorage({ sourceDirectory: root, profileId: 'web' });
  await legacy.save({ expectedRevision: saved.document.revision, document: { ...saved.document, stickers: [] } });
  await expect(scoped('web').read('shared-session')).rejects.toThrow(/迁移后发生变化/);
  await expect(scoped('other').read('shared-session')).rejects.toThrow(/迁移后发生变化/);
  await expect(migrateStickerStorage({ sourceDirectory: root, profileId: 'web' })).rejects.toThrow(/changed/);
});
