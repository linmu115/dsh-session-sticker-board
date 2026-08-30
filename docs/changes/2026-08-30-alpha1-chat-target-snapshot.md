# 0.4.18 - DSH alpha.1 Chat target snapshot

- Reads Chat `order` and `nodes` from the `uiConversation` Chat target introduced
  by DeepSeek Harness 0.1.2-alpha.1 instead of the lifecycle-only Session
  snapshot.
- Keeps durable sticker IDs mapped to the current rendered Chat keys when saved
  stickers are restored, so an existing sticker cannot crash and clear the
  shared selection toolbar.
- Uses the same Chat target for Obsidian-to-DSH deep-link lookup and older-history
  pagination.
- Removes the temporary visible startup diagnostic panel added in 0.4.17.
