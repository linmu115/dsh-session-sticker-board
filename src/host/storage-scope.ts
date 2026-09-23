import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function legacyStickerStorageDirectory(env: NodeJS.ProcessEnv = process.env, userHome = homedir()): string {
  return join(env.DSH_HOME?.trim() || join(userHome, '.dsh'), 'plugin-data', 'dsh-session-sticker-board');
}

export function profileStickerStorageDirectory(root: string, profileId: string): string {
  if (!profileId || profileId.trim() !== profileId) throw new Error('Sticker storage requires the current Bridge profile identity');
  // Hash the exact identity so case-insensitive filesystems and path separators
  // cannot merge distinct profiles or escape the storage root.
  return join(root, 'profiles', createHash('sha256').update(profileId).digest('hex'));
}

export function defaultStickerStorageDirectory(profileId: string, env: NodeJS.ProcessEnv = process.env, userHome = homedir()): string {
  return profileStickerStorageDirectory(legacyStickerStorageDirectory(env, userHome), profileId);
}

export const MIGRATION_RECEIPT = 'profile-migration.json';
export interface ProfileMigrationReceipt {
  schemaVersion: 1;
  profileId: string;
  sourceDirectory: string;
  targetDirectory: string;
  backupDirectory: string;
  files: Array<{ name: string; sha256: string }>;
  completed: boolean;
}

export function parseMigrationReceipt(raw: string): ProfileMigrationReceipt {
  const value = JSON.parse(raw) as ProfileMigrationReceipt;
  if (value.schemaVersion !== 1 || typeof value.profileId !== 'string' || !value.profileId
    || typeof value.sourceDirectory !== 'string' || typeof value.targetDirectory !== 'string'
    || typeof value.backupDirectory !== 'string' || typeof value.completed !== 'boolean'
    || !Array.isArray(value.files) || value.files.some(file => !/^[a-f0-9]{64}\.json(?:\.ownership)?$/.test(file.name) || !/^[a-f0-9]{64}$/.test(file.sha256))) {
    throw new Error('Sticker profile migration receipt is invalid');
  }
  return value;
}
