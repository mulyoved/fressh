# Issue 116 Closure Review Design

## Goal

Close GitHub issue 116, "Give connectAndOpenShell an explicit aborted
outcome," if the current merged code and tests satisfy the issue contract.

The issue asked for aborted late-success behavior to be visible at the
`connectAndOpenShell` type boundary instead of being implied by cleanup side
effects. A later issue comment narrowed the remaining work to either exposing
an explicit public aborted outcome or moving cleanup deep enough that callers
never see a connected-shaped result after abort cleanup.

## Current State

The current `dev` branch matches `origin/main` for the reviewed files and the
working tree is clean.

The relevant implementation is already present:

- `ConnectAndOpenShellResult` includes `{ status: 'aborted'; reason: unknown }`.
- `connectAndOpenShell` returns `aborted` after it cleans up a late successful
  shell when the active shell lifecycle signal is aborted.
- `cleanupOnAbort: false` still lets callers own cleanup and receive the
  connected result.
- Saved-entry adapter code preserves `aborted` instead of casting it to
  `tmux_attach_failed`.
- Saved-entry recovery, connection-attempt lifecycle, and manual diagnostics
  each handle the explicit aborted result at their own boundary.

## Reviewed Evidence

The closure review checked these files:

- `apps/mobile/src/lib/connect-and-open-shell.ts`
- `apps/mobile/src/lib/auto-connect-saved-entry.ts`
- `apps/mobile/src/lib/auto-connect-saved-entry-cleanup.ts`
- `apps/mobile/src/lib/connection-attempt-lifecycle.ts`
- `apps/mobile/src/lib/connection-diagnostic-runner.ts`
- `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts`
- `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`
- `apps/mobile/test/integration/connection-attempt-lifecycle.test.ts`
- `apps/mobile/test/integration/connection-diagnostic-runner.test.ts`

The relevant history is:

- `b000c6b` designed the aborted outcome.
- `964bcfa` added aborted outcome tests.
- `daa8ae8` exposed the aborted connect shell outcome.
- `f6a1bb1` preserved aborted saved-entry connect results.

## Verification

Fresh verification commands run during closure review:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/connect-and-open-shell-diagnostics.test.ts test/integration/auto-connect-saved-entry.test.ts test/integration/connection-attempt-lifecycle.test.ts test/integration/connection-diagnostic-runner.test.ts
```

Result: 95 tests passed, 0 failed.

```bash
pnpm --filter @fressh/mobile typecheck
```

Result: TypeScript completed successfully.

## Decision

Issue 116 is satisfied by the current code and tests. No additional app code,
tests, or implementation plan are needed for the issue itself.

The remaining action is GitHub issue hygiene:

1. Add a closure comment to issue 116 summarizing the explicit aborted result,
   downstream handling, and verification commands.
2. Close issue 116.

## Out Of Scope

- Changing abort cleanup behavior.
- Moving cleanup deeper into `runSshShellLifecycle`.
- Adding more lifecycle statuses.
- Running Android preview builds or device tests.
- Changing reconnect or diagnostic policy beyond the existing explicit aborted
  contract.
