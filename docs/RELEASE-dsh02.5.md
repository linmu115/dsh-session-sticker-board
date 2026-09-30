# 0.7.4-dsh02.5

Fix the first sticker save racing with the background Vault ownership write.
Synchronization and local mutations now share the session queue. A fresh local
revision is adopted automatically only when sticker content is unchanged (including
the same Vault attribution); competing content edits remain explicit conflicts.
Host compare-and-swap, persistence format and peer versions are unchanged.

The first remote import retains proof that this synchronization observed a truly
never-written document before pinning its Vault. Previously saved empty documents,
including deletions followed by restart, do not qualify for that import.

Validation: TypeScript checks, both production bundles, and 141 tests passed.
New real-storage regressions cover delayed first Vault commit, stale second-client
metadata, genuine concurrent edits, and import/delete/restart behavior. Existing
conflict-choice, draft retention and disposal tests pass. Live UI installation and
interaction are delegated to the main task and are not claimed by this release.
