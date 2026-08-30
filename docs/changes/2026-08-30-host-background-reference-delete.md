# 0.4.8 — Background reference deletion

- Move Obsidian deletion-request consumption into the DSH host lifecycle.
- Keep the browser consumer as an idempotent fallback for older deployments.
- Detect the optional Core host-deletion capability at runtime instead of pinning a Core version.

Deleting an Obsidian reference no longer depends on an open or freshly reloaded DSH Web page.
