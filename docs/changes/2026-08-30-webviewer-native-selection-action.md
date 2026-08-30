# 0.4.15 - Web Viewer native selection action

- Restore the `添加贴纸` action after refreshing Obsidian Web Viewer.
- Mount the action directly into the shared selection toolbar instead of an independent overlay root.
- Handle the action with native DOM events so Obsidian cannot drop a cross-React-root click.
- Remove the native action and its listeners when the selection or toolbar is disposed.
