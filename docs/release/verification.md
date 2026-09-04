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
