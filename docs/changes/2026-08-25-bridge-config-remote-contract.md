# Fix the Bridge configuration Remote contract

## Symptom

The package appeared in the official DSH plugin graph and its browser bundle was materialized, but selecting message text never showed “添加贴纸”. Obsidian reference captures also remained absent from the DSH annotation rail.

The real rc.2 Client failure was:

```text
client api: stickerBoard/getBridgeConfig expected 1 argument(s), got 0
```

Because this exception happened before the overlay and Bridge poller were created, both user-facing entry points disappeared together without a normal plugin-load error banner.

## Cause

`getBridgeConfig` is profile-wide data, but its Typert descriptor incorrectly declared an Agent lookup parameter and Agent scope. The Client correctly called the method without business arguments, so the rc.2 API Gateway rejected it before the Host service ran.

## Fix

- Declare `stickerBoard/getBridgeConfig` as a direct, zero-argument profile-level Remote method.
- Remove the unused Agent lookup parameter and Agent scope.
- Make the Host service method zero-argument as well.
- Strengthen the contract test so the descriptor must have `parameters: []` and no `scope`.

## Verification

- Red test reproduced the descriptor mismatch.
- `pnpm typecheck` passed.
- `pnpm test`: 12 files, 41 tests passed.
- `pnpm build` passed.
- Formal verification after deployment must confirm the live page contains one `[data-dsh-sticker-board]` host and that an Obsidian capture creates a Core annotation chip.

## Rollback

Revert this change and reinstall the previous artifact. Doing so restores the known-broken rc.2 Remote contract, so it is not a usable runtime rollback for official DSH `0.1.1-rc.2`.
