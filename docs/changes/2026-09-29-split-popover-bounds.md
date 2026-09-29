# Split chat popover bounds

Version: `0.7.4-dsh02.3`.

Split views use a full canvas iframe and clip each child to its own chat rectangle. Using `window.innerWidth` for Sticker editor/menu placement allowed the controls to extend into the native sidebar, where the right part was covered and save could not be clicked.

Chat-captured popovers now consume the split child geometry contract on `document.body`: `data-mv-mode="child"`, `--mv-left`, `--mv-width`, and `--mv-bottom`. Coordinates remain local to the iframe. Both axes are clamped to the chat rectangle, popup width shrinks to leave an 8px margin, and bottom-panel height is excluded. Open popovers observe only body geometry attributes and window resize; draft state survives repositioning. Outside a split child the normal viewport remains the bound. Sidebar detail forms are unchanged.

The measured D fixture (iframe 1086×862, chat x=315.5..626) places the 312px preferred editor at x=323.5 with width=294.5, ending at 618. Tests cover this measurement, narrow and bottom-panel layouts, ordinary viewport fallback, geometry updates, draft preservation and save dispatch. Actual browser clipping/click verification belongs to the parent-coordinated isolated UI run; unit tests do not claim that gate.

No storage, owner, protocol, public Core/Bridge SDK or dependency peer contract changes.
