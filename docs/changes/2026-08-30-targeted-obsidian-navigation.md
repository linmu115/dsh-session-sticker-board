# 0.4.19 - Targeted Obsidian navigation

- Reads the dedicated surface ID placed on Obsidian's DSH Web Viewer URL and binds it to the Bridge handshake.
- Receives Obsidian deep links only on the intended Web Viewer, preventing visible Edge tabs and other DSH surfaces from stealing the action.
- Applies the navigation before acknowledging the one-shot request; acknowledgement retries no longer reopen the target session.
- Polls immediately when the embedded viewer becomes visible instead of waiting for the three-second background interval.
