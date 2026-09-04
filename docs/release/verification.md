# Release verification

This file records author-side release evidence. Workshop verification and Registry admission remain independent maintainer decisions.

## Supported baseline

- DeepSeek Harness client: `0.1.2-rc.1`
- Profile: `web`
- Annotation protocol: v2
- Sticker protocol: v1
- Public compile-only Annotation Core baseline:
  `d7b0de917c7673d06dbd30790f7eed960ae82915`

The published Core baseline is used only for reproducible protocol declarations
in this repository. The RC1 profile candidate must install Annotation Core
0.3.7 before Sticker Board 0.7.1; the public baseline itself is not the RC1
runtime implementation.

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
