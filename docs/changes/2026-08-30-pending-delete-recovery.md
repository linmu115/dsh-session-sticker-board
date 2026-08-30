# 0.4.9 — Pending deletion recovery

- After Core confirms a reference had pending scope, send an idempotent pending-discard acknowledgement directly to Bridge.
- Drain deletion requests left behind by older Core/Bridge combinations that already persisted a Core tombstone.
- Keep sent-reference cleanup on Core's durable committed-deletion outbox.
