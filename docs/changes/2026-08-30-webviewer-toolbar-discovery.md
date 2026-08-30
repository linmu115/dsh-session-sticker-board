# 0.4.16 - Web Viewer selection toolbar discovery

- Discover the current Sidechat selection toolbar through its accessible toolbar identity instead of the removed `data-dsh-sidechat` ancestor.
- Mount the native `添加贴纸` action whenever Sidechat exposes the selection toolbar, even if Obsidian Web Viewer did not deliver Sticker Board's own selection-state event.
- Re-capture the selected DSH message when the action is clicked and preserve the selection from `pointerdown` through `click`.

Verification: focused overlay and bundle-contract regressions, full typecheck, build, test suite, and package dry run.
