# Release verification

This file records author-side release evidence. Workshop verification and Registry admission remain independent maintainer decisions.

## Supported baseline

- DeepSeek Harness client: `0.1.2-alpha.1`
- Profile: `web`
- Annotation protocol: v2
- Sticker protocol: v1

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
