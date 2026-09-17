# Ordinary sticker creation and idle overlay work

The managed storage bridge rejected all unmigrated sessions, including empty ones,
with STICKER_MIGRATION_REQUIRED. The ordinary Create action had no recovery path.
It now uses the authenticated knowledge endpoint to retain the structured error
code, runs the existing freeze/merge/stage/activate migration on explicit save,
reloads the authoritative revision, and saves the draft. Browsing sessions never
starts migration. Conflicting legacy copies still require the user's choice;
unrelated failures never trigger migration. Obsidian bridge availability remains
required for this first migration so remote legacy records cannot be overwritten.

Both ordinary and source marker overlays previously observed every body mutation
even with no markers. They now attach geometry observers only when markers exist
or an ordinary text selection is active. Toolbar lookup is skipped without a
selection. Identical attribute writes no longer schedule geometry updates.
Scroll/resize and existing geometry caching remain active when needed.

Validation: TypeScript check, production build, full Vitest suite; new coverage
includes empty and existing legacy stores, serialized creation, migration
conflicts, unrelated read errors, empty overlays across session switches and
identical layout attribute writes. No browser interaction timing was available;
the tests establish removed idle work, not a measured end-to-end latency gain.

Deployment is a backed-up client-only local hotfix on 0.7.3-rc2.18. Source build
dependencies are pinned to the deployed Core 0.3.12-rc2.12 and Lifecycle
0.3.3-rc2.16 archives. Host bundle, database and Better Sidebar are unchanged.
