# Task 4 CE1 Wave 2 Fix Report

## Result

Both synthesized wave-2 findings are fixed with behavioral coverage. The RED
lifecycle command reported 49 passed and 3 failed. The repaired exact Task 4
Node lane reports 111 passed, and the exact Jest lane reports 9 passed.

## Finding Map

### CE1-T4-006 — Preserve unresolved timeout transaction identity

- `WisprStartProtocol.hasOutstandingNativeTransaction()` is the authoritative
  admission signal for a timed-out start that still owns its exact lease.
- The exported snapshot remains busy, `openTextEditor()` returns `superseded`,
  and auto-start re-enable performs no new request or native work while that
  transaction is unresolved.
- The guard does not classify ordinary recording leases or already-bound close
  cleanup as retry-blocking. Existing close-coordinator deferral remains intact.
- Late rejection releases the exact lease and republishes the unchanged failed
  automation as retryable. A subsequent retry starts and closes normally.
- Late success restores recording for the original request. Closing issues one
  compensating toggle, and a shared-authority successor starts only after that
  cleanup releases the lease.
- Fake native-active state returns false after every final close; no request
  marker, active native state, lease, or successor remains stranded.

### CE1-T4-007 — Split the lifecycle protocol suite

- Deleted the 1,118-line post-RED lifecycle monolith.
- Moved all cases into direct behavioral suites:
  - acquisition and supersession: 373 lines;
  - issued-start cleanup: 314 lines;
  - authority and successors: 424 lines.
- Shared native-control and blocked-cleanup fixtures live in
  `shell-wispr-controller-test-support.ts`.
- The focused files import production behavior directly. There is no empty
  facade, source-text assertion, skipped case, or duplicate registration.
- All 52 lifecycle cases pass after the move, including the 49 prior cases and 3
  new timeout-retry regressions.

## TDD Evidence

- RED: 49 passed, 3 failed.
  - Two opener cases created a second status request (`2 !== 1`) after timeout.
  - Auto-start re-enable replaced `failed` with `openingTextEntry`.
- GREEN before split: controller plus lifecycle lane 71 passed, 0 failed.
- GREEN after split: focused lifecycle lane 52 passed, 0 failed.

## Verification

- Exact Task 4 Node lane: 111 passed, 0 failed.
- Exact Task 4 Jest lane: 9 passed, 0 failed.
- Full mobile integration lane: 2,360 passed, 0 failed.
- Full mobile component lane: 24 passed, 0 failed.
- Mobile formatting, typecheck, scoped ESLint, and diff-check: exit 0.
