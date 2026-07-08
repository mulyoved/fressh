# Task 2 Report: Classified Reconnect Controller Outcomes

## Scope

Implemented Task 2 from `task-2-brief.md` only:

- Updated `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`
- Updated `apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`

No router work, saved-entry reconnect strategy changes, transport invalidation,
bridge runtime classification, UI routing, or trace export changes were made.

## TDD Record

### RED

Command:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/auto-connect-reconnect-controller.test.ts
```

Observed failure before implementation:

- `classified needs-attention attempt stops and records host-page completion`
- `classified connected attempt records terminal completion and stops`

Key failure details:

- needs-attention result was treated like a successful reconnect because the
  controller interpreted the returned object as truthy and emitted
  `reconnect.attempt.connected`
- `reconnect.completed` was not emitted for classified outcomes

### GREEN

Command:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/auto-connect-reconnect-controller.test.ts
```

Result:

- Pass: 1250
- Fail: 0

## Implementation Summary

### Controller

Added `AutoConnectReconnectAttemptResult` to represent reconnect attempt
classification:

- `connected`
- `retry`
- `needsAttention`
- `failedNetwork`
- `failedAuth`
- `failedTmuxAttach`
- `cleanupFailed`

Added compatibility handling so existing boolean return values still work:

- `true` normalizes to `{ status: 'connected' }`
- `false` normalizes to `{ status: 'retry' }`

Changed reconnect-controller handling so that:

- `retry` stays on the existing backoff path
- `connected` emits `reconnect.attempt.connected`, emits
  `reconnect.completed { outcome: 'connected', destination: 'terminal' }`, and
  stops
- non-retry terminal failures emit `reconnect.attempt.failed`, emit
  `reconnect.completed` with `destination: 'hostPage'`, and stop with the
  classified reason

### Tests

Added the two Task 2 classified-outcome tests and updated existing successful
reconnect expectations to include the new `reconnect.completed` event.

Adjusted the test harness typing to accept both legacy booleans and classified
result objects, matching the controller's backward-compatible input contract.

## Verification

Task verification command:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/auto-connect-reconnect-controller.test.ts
```

Final result: PASS (`1250` passing, `0` failing)

## Self-Review

- Change scope is limited to the reconnect controller and its integration tests
- The controller remains router-free
- Legacy boolean callers remain supported through normalization
- Event ordering matches the new contract for both connected and
  needs-attention outcomes

## Commit

Created after verification:

- `Classify reconnect controller outcomes`

## Fix After Stable Review

### Files Changed

- `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`
- `apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`
- `.superpowers/sdd/task-2-report.md` (local report updated, then removed from git tracking)

### Verification

Command:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/auto-connect-reconnect-controller.test.ts
```

Exact test output:

```text
> @fressh/mobile@0.0.5 test:integration /home/muly/code/fressh/.worktrees/feature-tailscale-reconnect-trace-flow/apps/mobile
> tsx --test test/integration/**/*.test.ts -- test/integration/auto-connect-reconnect-controller.test.ts

ℹ tests 1250
ℹ suites 1
ℹ pass 1250
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6888.843324
```

## Fix After Stable Re-Review

### Files Changed

- `apps/mobile/src/lib/connection-diagnostics/events/reconnect.ts`
- `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`
- `apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`
- `.superpowers/sdd/task-2-report.md`

### Verification

Command:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/auto-connect-reconnect-controller.test.ts
```

Exact test output:

```text
ℹ tests 1250
ℹ suites 1
ℹ pass 1250
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6850.11434
```

## Fix After Timeout Outcome Correction

### Files Changed

- `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`
- `apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`
- `.superpowers/sdd/task-2-report.md`

### Verification

Command:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/auto-connect-reconnect-controller.test.ts
```

Exact test output:

```text
> @fressh/mobile@0.0.5 test:integration /home/muly/code/fressh/.worktrees/feature-tailscale-reconnect-trace-flow/apps/mobile
> tsx --test test/integration/**/*.test.ts -- test/integration/auto-connect-reconnect-controller.test.ts

ℹ tests 1250
ℹ suites 1
ℹ pass 1250
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6822.941482
```

### Commit

- `d6d8454` - `Fix reconnect timeout outcome classification`
