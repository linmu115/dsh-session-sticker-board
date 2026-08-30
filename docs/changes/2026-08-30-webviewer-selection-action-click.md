# 0.4.14 - Web Viewer selection action click

- Keep the `添加贴纸` action inside the Sticker Board React root instead of portaling it into Sidechat's toolbar root.
- Use the Sidechat toolbar only as a geometry reference so the action remains nearby without crossing React event boundaries.
- Restore activation in Obsidian's embedded Web Viewer, where cross-root Portal buttons were visible but did not receive their React click handler.
