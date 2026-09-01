# Changelog

## 0.5.0 - 2026-09-01

- Move the `obsidian-note` Core adapter, reference capture and bidirectional reference deletion into the dedicated `dsh-obsidian-reference-adapter` package.
- Follow `dsh-obsidian-bridge-lifecycle` readiness for the online Sticker transport while leaving the Sticker UI mounted.
- Route only sticker-owned Bridge actions and skip sibling-adapter actions without acknowledging them globally.

Focused verification: 11 test files / 59 tests, typecheck, build and package dry run.

## 0.4.22 - 2026-09-01

- Treat `@deepseek-ai/schemastery` as a DSH host capability instead of a
  plugin-owned runtime dependency.
- Declare an open optional peer so installing Sticker Board cannot materialize
  a stale Schemastery/CosmoKit tree in the active Profile.
- Keep Alpha2 `3.18.2` as a development-only compiler and test dependency.

Focused verification: package manifest contract, typecheck, build and package
dry run.

## 0.4.21 - 2026-08-31

- Persist Maintenance logical session and anchor identities in newly created stickers and Obsidian backlinks.
- Resolve a sticker or annotation link to the active Alpha2 or RC2 projection before navigation and deletion.
- Retain historical native IDs as aliases, so existing links remain usable across Launcher profile changes.
- Base this release on the verified Alpha.2 `0.4.20` tree, including the Web Viewer toolbar, composite anchor and backlink lifecycle fixes.

Focused verification: `tests/deep-link.test.ts`, typecheck and build.
