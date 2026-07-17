# Task 4 CE1 Wave 1 Fix Report

## Result

All five synthesized wave-1 findings are fixed with behavioral coverage. The
focused RED command reported 61 passed and 6 failed. After the ownership repair,
the exact Task 4 Node lane reports 108 passed and the Jest lane reports 9
passed.

## Finding Map

### CE1-T4-001 — Issued-native deadlines survive UI disposal

- Added a separate native timer owner for compensating close transactions.
- `timerOwner.cancelAll()` continues to retire UI timers, but cannot cancel an
  already-issued close timeout.
- Fake-time late-resolve and late-reject cases dispose during an issued close,
  reach `blocked` at 750 ms, and prove late settlement is inert.

### CE1-T4-002 — Every issued start close obligation is bounded

- Every `close-after-start` request now binds the exact request/lease cleanup
  deadline after the coordinator records its pending obligation.
- Close, invalidation, and disposal before the 750 ms tap timeout all poison at
  the 5-second bound when the native start never settles.
- Each path covers both late resolve and late reject after expiry, with no state
  publication, authority release, re-poison, or compensating toggle.

### CE1-T4-003 — Cleanup scheduler failure fails closed

- A fake clock throws only for the 5-second cleanup deadline.
- The catch path immediately expires the exact pending request, poisons its
  lease, publishes the waiting successor as blocked, and blocks future acquire.

### CE1-T4-004 — Screen-prime native behavior

- The harness records `tapScreen` coordinates.
- Bounds `(10, 20, 100, 200)` at pixel ratio 2 assert the physical coordinate
  `(120, 136)`, including the 48-point vertical cap.
- A current screen-prime rejection records one warning and still issues the
  Wispr control start.

### CE1-T4-005 — Behavioral timer-owner test

- Removed the production-source read and regex assertion.
- Retained the public behavioral proof that clearing an ordinary timer prevents
  its callback and clears the injected handle exactly once.

## Verification

- Exact Task 4 Node lane: 108 passed, 0 failed.
- Exact Task 4 Jest lane: 9 passed, 0 failed.
- Broader mobile integration lane: 2,357 passed, 0 failed.
- Full mobile component lane: 24 passed, 0 failed.
- Mobile formatting, typecheck, scoped ESLint, and diff-check: exit 0.
