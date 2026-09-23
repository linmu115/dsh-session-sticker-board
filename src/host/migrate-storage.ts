import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, rename, rmdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { MIGRATION_RECEIPT, parseMigrationReceipt, profileStickerStorageDirectory, type ProfileMigrationReceipt } from './storage-scope.ts';

const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

/** Offline operation: the caller must stop every profile sharing this home first. */
export async function migrateStickerStorage(input: { sourceDirectory: string; profileId: string }): Promise<ProfileMigrationReceipt> {
  const sourceDirectory = resolve(input.sourceDirectory);
  const targetDirectory = profileStickerStorageDirectory(sourceDirectory, input.profileId);
  const lock = join(sourceDirectory, '.profile-migration-lock');
  // Never create a missing source or silently recover a lock left by a crash.
  if (!(await lstat(sourceDirectory)).isDirectory()) throw new Error('Sticker migration source must be a directory');
  await mkdir(lock);
  try {
    const receiptFile = join(sourceDirectory, MIGRATION_RECEIPT);
    let receipt: ProfileMigrationReceipt | undefined;
    try { receipt = parseMigrationReceipt(await readFile(receiptFile, 'utf8')); } catch (error) { if (!missing(error)) throw error; }
    if (receipt && (receipt.profileId !== input.profileId || receipt.sourceDirectory !== sourceDirectory || receipt.targetDirectory !== targetDirectory)) {
      throw new Error('Legacy Sticker storage is already assigned to another profile or location');
    }
    if (!receipt) {
      const names = (await readdir(join(sourceDirectory, 'sessions'))).sort();
      if (names.some(name => !/^[a-f0-9]{64}\.json(?:\.ownership)?$/.test(name))) throw new Error('Unexpected legacy session file; inspect the source before migrating');
      const files: ProfileMigrationReceipt['files'] = [];
      for (const name of names) {
        const source = join(sourceDirectory, 'sessions', name);
        if (!(await lstat(source)).isFile()) throw new Error('Legacy session source must be a regular file');
        files.push({ name, sha256: digest(await readFile(source)) });
      }
      const backupDirectory = join(sourceDirectory, 'migration-backups', randomUUID());
      await mkdir(backupDirectory, { recursive: true });
      for (const file of files) {
        const backup = join(backupDirectory, file.name);
        await copyFile(join(sourceDirectory, 'sessions', file.name), backup, constants.COPYFILE_EXCL);
        if (digest(await readFile(backup)) !== file.sha256) throw new Error('Legacy data changed during backup; stop all profiles before migration');
      }
      receipt = { schemaVersion: 1, profileId: input.profileId, sourceDirectory, targetDirectory, backupDirectory, files, completed: false };
      await writeFile(receiptFile, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    }
    // Verify the source on retries too. Never attribute new legacy writes using
    // an old receipt, and never overwrite a target that has subsequently changed.
    const names = (await readdir(join(sourceDirectory, 'sessions'))).sort();
    if (JSON.stringify(names) !== JSON.stringify(receipt.files.map(file => file.name).sort())) throw new Error('Legacy file list changed after migration backup');
    for (const file of receipt.files) {
      if (digest(await readFile(join(sourceDirectory, 'sessions', file.name))) !== file.sha256
        || digest(await readFile(join(receipt.backupDirectory, file.name))) !== file.sha256) throw new Error('Legacy source or backup changed after the migration receipt');
    }
    if (receipt.completed) return receipt;
    await mkdir(join(targetDirectory, 'sessions'), { recursive: true });
    // Preflight conflicts before copying any additional file on this attempt.
    for (const file of receipt.files) {
      try {
        if (digest(await readFile(join(targetDirectory, 'sessions', file.name))) !== file.sha256) throw new Error('Sticker migration target already contains different data');
      } catch (error) { if (!missing(error)) throw error; }
    }
    for (const file of receipt.files) {
      const target = join(targetDirectory, 'sessions', file.name);
      try { await copyFile(join(receipt.backupDirectory, file.name), target, constants.COPYFILE_EXCL); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      if (digest(await readFile(target)) !== file.sha256) throw new Error('Sticker migration target failed verification');
    }
    receipt.completed = true;
    const pending = `${receiptFile}.${randomUUID()}.tmp`;
    await writeFile(pending, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    await rename(pending, receiptFile);
    return receipt;
  } finally {
    await rmdir(lock);
  }
}
