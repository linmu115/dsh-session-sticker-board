# 0.4.6 — Maintenance logical sticker links

- New stickers resolve their current native session and anchor through Session Maintenance and persist the resulting logical identity plus legacy fallback IDs.
- Obsidian reference claims now carry the logical DSH session when Maintenance is available.
- Deep links resolve a logical target to the active DSH projection before opening the session; annotation opening uses the resolved session rather than the stale native ID.
- Old links and environments without an active Maintenance resolver continue to use their stored native target.

Focused verification: `tests/deep-link.test.ts`, typecheck and build.
