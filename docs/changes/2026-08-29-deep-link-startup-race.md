# 0.4.5 - Reliable deep links during DSH startup

- Wait for the DSH 0.1.2-alpha.1 session catalog to leave its `pending` phase before deciding whether a linked session exists.
- Keep Obsidian deep-link actions from being acknowledged against an empty startup snapshot.
- Cover the startup race with a regression test that hydrates the catalog after the action arrives.
