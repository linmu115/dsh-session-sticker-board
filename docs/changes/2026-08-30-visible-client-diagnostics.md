# 0.4.17 - Temporary visible client diagnostics

- Adds a small non-interactive diagnostic panel to the DSH page while the
  Sticker Board client starts.
- Records base service injection, Remote mounting, Bridge preflight, Better
  Sidebar registration, React mounting, shared-toolbar discovery and native
  sticker-action mounting.
- Keeps initialization and render failures visible even when the regular
  browser console of an Obsidian Web Viewer cannot be inspected.
- This is a diagnostic build. It does not change sticker persistence, Bridge
  protocol semantics or selection eligibility.
