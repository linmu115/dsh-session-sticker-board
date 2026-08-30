# 0.4.20 - Multiline sticker rendering and managed backlinks

- Read the Obsidian Web Viewer surface identity from the redirect-safe URL fragment while retaining rolling-update support for the former query parameter.
- Restore multiline Markdown selections through a whitespace-insensitive DOM character map that still creates a Range over the original text nodes.
- Wrap copied sticker links and reference callouts in managed Markdown boundaries.
- Delete every Obsidian backlink before committing sticker removal, with idempotent retries and legacy-link cleanup handled by Bridge 0.3.19.
