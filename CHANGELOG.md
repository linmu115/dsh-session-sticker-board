# Changelog

## 0.7.4-rc2.1 — 2026-09-18

- Borrow the unified Bridge 0.4.0-rc2.1 transport and register ordinary sticker navigation with its shared action dispatcher.
- Pass validated linked-note prepare/commit callbacks through Bridge reference handoff; Core retains state and compensation ownership.
- Remove the sticker-owned action poller and general Bridge health tab. Preserve local ordinary stickers when Bridge is absent, managed ownership fencing, migration, note associations and native selection actions.
- See docs/changes/2026-09-18-shared-bridge-channel.md for local verification and rollout boundaries.

## 0.7.3-rc2.3 — 2026-09-13

- Accept Core 0.3.12-rc2.1 and Lifecycle 0.3.3-rc2.3 alongside the previous RC2 peers.
- Build with the Core 0.3.12-rc2.1 protocol while preserving the existing data formats.
- Keep existing runtime behavior; P2 session stickers and Obsidian data migration are not part of this release.
- Validation and its limits are recorded in docs/changes/2026-09-13-upstream-core-compatibility.md.

## 0.7.3-rc2.2 - Local RC2 candidate (2026-09-12)

- Pin Bridge Lifecycle 0.3.3-rc2.2, preserving every explicit stable Sticker target
  field for backlink lookup and deletion. Historical unscoped targets stay unscoped.
- Keep Core 0.3.11-rc2.2, Bridge Protocol 0.3.3-rc2.1 and the complete RC2 Sidebar
  compatibility integration. Replace the affected Lifecycle rc2.1 peer candidate
  with rc2.2; legacy stable peers remain supported.
- Verify the actual packaged transport with scoped and historical Sticker calls.
  This candidate is packaged locally; it is not deployed or published.

## 0.7.2 - Unreleased

- Share Protocol data schemas and Lifecycle's cancellable HTTP transport, using
  the Lifecycle-selected Bridge origin throughout the Suite.
- Keep revision conflicts visible until the user chooses DSH or Obsidian sticker
  content. Preserve queued deletions and edits during conflict recovery; offer
  retry and an Obsidian connection/synchronization tab in Better Sidebar.
- Bound synchronization to three sessions at a time and stop late polls,
  navigation, local saves and remote deletions after workspace disposal.
- Cache normalized text and quote ranges per message, invalidate only changed
  anchors, and calculate sticker ranges near the viewport. Synthetic 50/200/500
  anchor tests with ten visible anchors each perform ten text/range calculations.
- Preserve annotation 2, sticker 1 and lifecycle 3 wire formats.

This development combination is checked with the Suite workspace tools. Public
development dependency pins still identify the preceding release until the
coordinated source release; see the Suite README before rebuilding these changes.

## 0.7.1 - 2026-09-04

- Compile and package against the DSH 0.1.2-rc.1 Session, Gateway, and Typert
  contracts with no older Harness build path.
- Use the public full-commit Annotation Core RC1 baseline
  `de5c6d3e4784cfcfa4cc90b4e8c29d75a36a2161` and lifecycle baseline
  `bfe3582f52826b052cedf2ad7c5f24318fd64bdb` for clean-checkout type
  verification, and pin Zod 4.4.3 across the suite.
- Require the RC1 profile candidate to install Core 0.3.7 before Sticker 0.7.1;
  the Git dependencies are compile-only and are not bundled as runtime Core.
- Preserve sticker persistence, selection overlay, bidirectional navigation,
  targeted Web Viewer surfaces, immediate unlink, and post-answer visibility.

No sticker, Bridge, backlink, or deletion protocol was changed.

## 0.7.0 - 2026-09-01

- Declare Bridge lifecycle protocol v3 compatibility for the Suite's dynamic DSH Viewer target.
- Keep sticker creation and local persistence independent of Bridge availability.

## 0.6.0 - 2026-09-01

- Persist sticker notes under the active DSH home before attempting any Obsidian operation.
- Treat Obsidian session notes and backlinks as a reconnectable mirror, so creation, editing, and deletion remain available while the Bridge is offline.
- Import existing Vault-only sticker session notes on first successful reconnect and report the local versus Obsidian sync state in the sidebar.

## 0.5.0 - 2026-09-01

- Move the `obsidian-note` Core adapter, reference capture and bidirectional reference deletion into the dedicated `dsh-obsidian-reference-adapter` package.
- Follow `dsh-obsidian-bridge-lifecycle` readiness for the online Sticker transport while leaving the Sticker UI mounted.
- Route only sticker-owned Bridge actions and skip sibling-adapter actions without acknowledging them globally.

Focused verification: 11 test files / 59 tests, typecheck, build and package dry run.

## 0.4.22 - 2026-09-01

- Treat `@deepseek-ai/schemastery` as a DSH host capability instead of a
  plugin-owned runtime dependency.
- Declare an open optional peer so installing Sticker Board cannot materialize
  a stale Schemastery/CosmoKit tree in the active Profile.
- Keep Alpha2 `3.18.2` as a development-only compiler and test dependency.

Focused verification: package manifest contract, typecheck, build and package
dry run.

## 0.4.21 - 2026-08-31

- Persist Maintenance logical session and anchor identities in newly created stickers and Obsidian backlinks.
- Resolve a sticker or annotation link to the active Alpha2 or RC2 projection before navigation and deletion.
- Retain historical native IDs as aliases, so existing links remain usable across Launcher profile changes.
- Base this release on the verified Alpha.2 `0.4.20` tree, including the Web Viewer toolbar, composite anchor and backlink lifecycle fixes.

Focused verification: `tests/deep-link.test.ts`, typecheck and build.
