# 0.4.10 - One-shot durable sticker links

- Treat every accepted Obsidian navigation action as one-shot, including missing DOM and already-deleted annotation targets.
- Leave browser-owned navigation actions untouched by the background Host consumer.
- Preserve and resolve `stickerId` so backlinks open the exact sticker rather than guessing from the message text.
- Store native Conversation node IDs for new stickers and resolve them back to the current rendered anchor key.
- Stop swallowing corrupt session-note loads, preventing an invalid note from masquerading as a changed message.
