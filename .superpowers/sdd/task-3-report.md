# Task 3 Report: Tmux-First Saved-Entry Reconnect Strategy

## Scope

Implemented Task 3 from `task-3-brief.md` in:

- `apps/mobile/src/lib/auto-connect-attempt.ts`
- `apps/mobile/src/lib/auto-connect.tsx`
- `apps/mobile/test/integration/auto-connect-attempt.test.ts`

## TDD Record

### RED

Added failing integration coverage for:

1. tmux reconnect bypassing stale active-shell reopen and reconnecting through the saved entry resolved from the dropped connection
2. Android tmux reconnect emitting Tailscale readiness tracing before saved-entry reconnect

Command:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/auto-connect-attempt.test.ts
```

Observed failure:

- reconnect still called `loadLatestSavedConnection` instead of resolving from the dropped connection path
- reconnect returned `true` instead of `{ status: 'connected' }`

### GREEN

Command:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/auto-connect-attempt.test.ts test/integration/auto-connect.test.ts
```

Result:

- `pass 1253`
- `fail 0`

## Implementation Summary

### `auto-connect-attempt.ts`

- Added `AutoConnectReconnectContext`
- Extended `AutoConnectAttemptSourceArgs` with:
  - `reconnectContext?`
  - `loadSavedConnectionByStoredId?`
- Updated `attemptAutoConnectSource(...)` return type to `Promise<AutoConnectReconnectAttemptResult | boolean>`
- Added reconnect-only resolver that:
  - prefers `getStoredConnectionId(activeConnection.connectionDetails)`
  - falls back to `loadLatestSavedConnection()` only when no stored-id entry resolves
- Added reconnect tmux path before active-shell reopen:
  - emits `reconnect.transport.invalidated`
  - skips reopening a stale active shell
  - reconnects through the saved entry
- Added reconnect saved-entry execution/classification path that:
  - traces Tailscale readiness before connect
  - emits reconnect-triggered saved-entry connect/retry events
  - returns classified reconnect results using `AutoConnectReconnectAttemptResult`
  - maps failures to `connected | retry | needsAttention | failedNetwork | failedAuth | failedTmuxAttach | cleanupFailed`

### `auto-connect.tsx`

- Added `pendingReconnectContextRef`
- Captures reconnect context on shell-count drop to zero before scheduling reconnect
- Threaded optional reconnect context through `attemptAutoConnectRef` and `attemptAutoConnect`
- Added `loadSavedConnectionByStoredId`
- Passed reconnect context and stored-id loader into `attemptAutoConnectSource`
- Consumed reconnect context once per reconnect-controller attempt
- Preserved reconnect-controller normalization by returning classified results when present

## Test Notes

- The brief’s sample reconnect fixture expected a lookup id of `stored-conn-1`.
- In this codebase, saved-entry lookup keys are derived by `getStoredConnectionId(details)` from username/host/port, so the new reconnect test uses the repo’s actual stored-id contract (`muly-100_64_0_10-22`).

## Self-Review

- Confirmed reconnect stays router-free.
- Confirmed reconnect does not filter recovery by `autoConnect`.
- Confirmed latest-saved-entry fallback only occurs when stored-id lookup cannot resolve.
- Confirmed tmux reconnect no longer reopens stale active shells.
- Confirmed targeted verification command from the brief passed after implementation.

## Commit

- Created after verification:
  - `Reconnect tmux sessions through saved entries`

## Stable Review Fix

### Files Changed

- `apps/mobile/src/lib/auto-connect-attempt.ts`
- `apps/mobile/src/lib/auto-connect-manager-helpers.ts`
- `apps/mobile/src/lib/auto-connect.tsx`
- `apps/mobile/test/integration/auto-connect-attempt.test.ts`
- `apps/mobile/test/integration/auto-connect.test.ts`

### Fix Summary

- Preserved dropped reconnect identity end to end by carrying the dropped
  connection id, channel id, and stored connection id from the manager into the
  reconnect attempt path.
- Made reconnect fallback use an unfiltered latest-saved-entry loader so recovery
  can reconnect entries with `autoConnect: false`.
- Added manager-level coverage for dropped reconnect context construction and
  reconnect fallback selection, plus an attempt-level regression proving the
  reconnect attempt prefers the dropped stored connection even after the dropped
  session is gone.

### Verification

Command:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/auto-connect-attempt.test.ts test/integration/auto-connect.test.ts
```

Exact test output:

```text
> @fressh/mobile@0.0.5 test:integration /home/muly/code/fressh/.worktrees/feature-tailscale-reconnect-trace-flow/apps/mobile
> tsx --test test/integration/**/*.test.ts -- test/integration/auto-connect-attempt.test.ts test/integration/auto-connect.test.ts

ℹ tests 1255
ℹ suites 1
ℹ pass 1255
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6889.267607
```

## Stable Re-review Fix

### Files Changed

- `apps/mobile/src/lib/auto-connect-attempt.ts`
- `apps/mobile/src/lib/auto-connect-manager-helpers.ts`
- `apps/mobile/src/lib/auto-connect.tsx`
- `apps/mobile/test/integration/auto-connect-attempt.test.ts`
- `apps/mobile/test/integration/auto-connect.test.ts`

### Fix Summary

- Changed reconnect saved-entry invalid tmux settings to return a classified
  Task 2 result (`failedTmuxAttach`) instead of bare `false`, so reconnect does
  not normalize the case into another retry.
- Added an attempt-level regression proving reconnect invalid tmux settings stay
  classified and do not reopen or retry through the boolean path.
- Added a narrow manager wiring adapter used by `AutoConnectManager` and tested
  it through the production call surface, proving reconnect attempts receive the
  dropped connection id, dropped channel id, dropped stored id, and the
  unfiltered reconnect fallback loader.

### Verification

Command:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/auto-connect-attempt.test.ts test/integration/auto-connect.test.ts
```

Exact test output:

```text
> @fressh/mobile@0.0.5 test:integration /home/muly/code/fressh/.worktrees/feature-tailscale-reconnect-trace-flow/apps/mobile
> tsx --test test/integration/**/*.test.ts -- test/integration/auto-connect-attempt.test.ts test/integration/auto-connect.test.ts

ℹ tests 1257
ℹ suites 1
ℹ pass 1257
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7003.570836
```
