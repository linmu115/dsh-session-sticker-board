# Route Obsidian references through Annotation Core

## Scope

`dsh-session-sticker-board` 0.2.0 replaces its private citation composer with the shared `dsh-annotation-core` reference pipeline while retaining stickers, highlights, session notes and Obsidian backlinks.

Baseline commit: `c1100e1` (`feat: emit native WikiLinks for stickers`).

## User-visible changes

- Obsidian selections now appear in the same annotation rail and detail bubble used by `dsh-sidechat`; no quote text, `@` marker or hidden token is inserted into the DSH draft.
- The Bridge capture is acknowledged only after Core has durably accepted the exact `referenceId` and full-note snapshot.
- Sent references keep their stable numbering, become durable conversation context and can write a backlink bound to the real DSH user-message ID and text hash.
- DSH deep links can carry `setId` and `referenceId`, locate the rc.2 input-message node and open the matching Core annotation detail.
- The Bridge origin is selected once by the Host and delivered to the Client through a profile-scoped Remote. Health and handshake responses must report the same origin before captures are polled.
- If Obsidian is offline, the plugin remains loaded and Core can prepare a saved snapshot. A protocol/port mismatch still blocks the integration instead of silently connecting to another local service.
- If Core is missing, ordinary stickers and highlights still load, while Obsidian annotation capture stays pending and the console reports the missing dependency.

## Removed implementation

- Deleted the private composer and composer tests.
- Removed the hidden `dsh-sticker-board-hidden` reference kind.
- Removed the old citation dock/card/tooltip CSS, private numbering and draft-submission detection path.
- Removed the build-time Bridge port token; runtime Host configuration is now authoritative.

## Package boundary

- Package version: `0.2.0`.
- Required peer: `dsh-annotation-core >=0.1.0 <0.2.0`.
- Added the `./typert` export and one `stickerBoard/getBridgeConfig` descriptor.
- Package metadata declares annotation protocol 2 and sticker protocol 1 for Maintenance preflight.
- Consumer bundles may inline the pure Core protocol only. Tests reject a copied Core store, Host service, submission coordinator or annotation UI, and reject unresolved runtime Core imports.
- README now lists compatible versions, dependencies, installation order, first-run configuration and normal usage.

## Verification

- `pnpm typecheck`
- `pnpm build`
- `pnpm test`: 12 files, 41 tests passed
- `pnpm pack`: generated `dsh-session-sticker-board-0.2.0.tgz`

## Rollback

Revert the commit that adds this report and reinstall the previous package. The 0.2.0 Obsidian protocol-v2 capture queue must not be consumed by the reverted private composer; leave captures pending until Core and this adapter are restored.
