# Changelog

## 0.4.21 - 2026-08-31

- Persist Maintenance logical session and anchor identities in newly created stickers and Obsidian backlinks.
- Resolve a sticker or annotation link to the active Alpha2 or RC2 projection before navigation and deletion.
- Retain historical native IDs as aliases, so existing links remain usable across Launcher profile changes.
- Base this release on the verified Alpha.2 `0.4.20` tree, including the Web Viewer toolbar, composite anchor and backlink lifecycle fixes.

Focused verification: `tests/deep-link.test.ts`, typecheck and build.
