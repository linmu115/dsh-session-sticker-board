# 0.4.12 - Web Viewer selection and one-shot navigation

- Claim Obsidian deep-link navigation before changing the current DSH session, so a later anchor, DOM, or Annotation Core failure cannot replay the same navigation and lock the UI to an old session.
- Capture message selections synchronously on mouseup, before an embedded Obsidian Web Viewer can clear the native selection.
- Mount `添加贴纸` directly into Sidechat's visible selection toolbar when available, with the standalone overlay retained as a fallback.
- Raise the fallback action above application chrome and add regression coverage for failed one-shot navigation and embedded selection timing.
