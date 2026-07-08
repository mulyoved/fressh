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
