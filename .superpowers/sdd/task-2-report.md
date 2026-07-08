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

- `afa82b3` - `Fix reconnect timeout outcome classification`

## CE1 Fix

### Files Changed

- `apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`
- `.superpowers/sdd/task-2-report.md`

### Verification

Command:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/auto-connect-reconnect-controller.test.ts
```

Exact test output:

```text
✔ live input plan passes payload through when scrollback is inactive (2.408044ms)
✔ live input plan drops empty payload segments while inactive (0.292733ms)
✔ live input plan exits active scrollback without primary-shell cancel before payload (0.319438ms)
✔ live input plan drops the scrollback exit-key payload after cleanup (0.288087ms)
✔ live input runner starts cleanup for exit-key-only payload without sending bytes (0.410483ms)
✔ live input runner sends non-empty payload after successful cleanup (0.866585ms)
✔ live input runner suppresses deferred payload after request invalidation (0.348136ms)
✔ live input freshness requires the same terminal instance and writer (0.39917ms)
✔ live input runner blocks non-empty payload after failed cleanup (0.339418ms)
✔ live input runner blocks non-empty payload while remote copy mode is active without cleanup (0.364756ms)
✔ live input plan preserves multi-segment payload order after app-owned scrollback exit (0.238284ms)
✔ live input plan drops empty payload segments while preserving order (2.681901ms)
ℹ tests 1251
ℹ suites 1
ℹ pass 1251
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6933.196447
```
