# 0.4.13 - Web Viewer selection fallback

- Keep the synchronous mouseup capture used by embedded Obsidian Web Viewer surfaces.
- Preserve the pending delayed selection recompute so a Web Viewer that finalizes its native selection after mouseup still exposes `添加贴纸`.
- Add regression coverage for the selectionchange-then-mouseup event order instead of treating cancellation of the fallback as correct behavior.
