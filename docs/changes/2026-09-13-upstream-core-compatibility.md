# RC2 upstream reference cohort

Release 0.7.3-rc2.3 accepts Core 0.3.12-rc2.1 and Lifecycle 0.3.3-rc2.3 in the explicit peer ranges, preserving the previously accepted RC2 versions. The build uses the packaged Core 0.3.12-rc2.1 protocol so bundled validators include its additive upstream-reference metadata.

Runtime feature behavior, persisted object ownership and the existing Annotation 2 / Lifecycle 3 / Sticker 1 wire protocols remain unchanged. This release supplies compatibility for Session Maintenance P1; independent session stickers and the Obsidian extension-data migration remain later work.

Validation performed in the isolated session-context-graph-20260913 worktrees:

- Typecheck, package build and all 98 existing tests passed.
- Development Core dependency and lockfile identify the local 0.3.12-rc2.1 release archive.
- Test fixtures are synthetic. No user profile, Vault or canonical Maintenance state was changed by these checks.

The paired installation report records the final RC2-copy strict peer and host-identity checks separately. These source checks do not constitute manual UI or live-model acceptance.
