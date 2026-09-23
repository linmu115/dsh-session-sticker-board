import { migrateStickerStorage } from '../lib/migrate-storage.js';

const args = process.argv.slice(2);
if (args.length !== 5 || args[0] !== '--source' || args[2] !== '--profile' || args[4] !== '--offline-confirmed' || !args[1] || !args[3]) {
  console.error('Usage: node scripts/migrate-storage.mjs --source <legacy-root> --profile <verified-profile-id> --offline-confirmed');
  process.exitCode = 1;
} else {
  try {
    const receipt = await migrateStickerStorage({ sourceDirectory: args[1], profileId: args[3] });
    console.log(JSON.stringify({ profileId: receipt.profileId, sourceDirectory: receipt.sourceDirectory, targetDirectory: receipt.targetDirectory, backupDirectory: receipt.backupDirectory, fileCount: receipt.files.length, completed: receipt.completed }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Sticker storage migration failed');
    process.exitCode = 1;
  }
}
