## Local RC2 candidate 0.7.3-rc2.1 (2026-09-12)

Based on installed 0.7.2 / c23bed0. Sidebar detail opens now await a committed session-scoped instance, update its metadata, and activate it before reporting success. A refused open leaves the overlay fallback usable. Removed the fake dsh-sticker file path; the detail remains a business tab. Existing sticker editing, local outbox, backlinks, sync conflict recovery, deletion and health panel remain.

The Bridge client forwards obsidianBridgeLifecycle.runtimeIdentity.dshInstanceId. New stickers retain the originating instance even if logical resolution is unavailable; copied deep links and managed backlink metadata retain it. Foreign scoped actions are rejected before reading local stickers or resolving/navigating. Scoped logical resolution failure cannot fall back to a colliding legacy session. Legacy unscoped data remains supported. Maintenance reference:resolve remains current-host scoped; no browser targetInstance is sent.

Reproducible dev dependencies are the checked-in .dev-packages archives for annotation-core 0.3.11-rc2.2 and bridge protocol/lifecycle 0.3.3-rc2.1, with lockfile integrity hashes. No other plugin source tree is modified. Typecheck, build, 97 tests and peer checks passed. Six added scope regressions cover instance handshake/echo, old handshake rejection, foreign scope rejection, failed logical resolution, legacy/current acceptance and copied scope retention. Existing Sidebar open/refusal tests and persistence/bundle contracts also pass. No live DSH home, Vault writes, profile deployment, browser E2E or upstream publication was performed.

# Release verification

This file records author-side release evidence. Workshop verification and Registry admission remain independent maintainer decisions.

## Supported baseline

- DeepSeek Harness client: `0.1.2-rc.1`
- Profile: `web`
- Annotation protocol: v2
- Sticker protocol: v1
- Public compile-only Annotation Core baseline:
  `de5c6d3e4784cfcfa4cc90b4e8c29d75a36a2161`
- Public compile-only Bridge lifecycle baseline:
  `bfe3582f52826b052cedf2ad7c5f24318fd64bdb`

The published Git baselines are used only for reproducible declarations in
this repository. The RC1 profile candidate must still install Annotation Core
0.3.7 and Bridge Lifecycle 0.3.1 before Sticker Board 0.7.1; they are not
bundled into Sticker Board as private runtime copies.

## Clean-checkout gate

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm pack --dry-run --json
```

Acceptance criteria:

- annotation core resolves from a public, full Git commit rather than a local path;
- all unit and bundle-contract tests pass;
- the packed tarball contains host, client, remote, declaration, patch, license, and README files;
- the packed bundle does not require a build script during consumer installation.

Failure-isolation, hot-reload, removal, and current Workshop-baseline evidence remain `null` until the Workshop harness records them.
