# 0.4.11 - Navigation queue backpressure

- On reconnect, Sticker Board consumes superseded Obsidian deep links without replaying them and applies only the latest live navigation intent.
- A reference-deletion request takes precedence over any queued link for that reference, preventing a deleted citation from reopening its former DSH session.
- One-shot acknowledgement races with another DSH surface are treated as success, including the historical Bridge 404 response.
- Durable capture and deletion retries remain unchanged.
