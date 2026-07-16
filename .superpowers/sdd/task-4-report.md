# Task 4 Report: Session-Scoped Wispr Controller

## Status

Implemented the session-scoped Wispr controller, timer/tap/start/close owners,
process-wide native-control authority, and React adapter. The shell route now
composes the adapter and no longer owns Wispr request/timer refs. Simple modal
commands expose a committed snapshot instead of a render-time `openRef`.

## RED

- Node command from the brief exited 1. All five selected files failed because
  `wispr-close-coordinator`, `wispr-core`, `wispr-native-control-authority`, and
  `wispr-timer-owner` did not exist.
- Jest command from the brief exited 1 because `shell-controllers/wispr` did not
  exist.
- Production code was unchanged when these failures were recorded.

## GREEN

- Exact Node command: 111 passed, 0 failed.
- Exact Jest command: 9 passed, 0 failed.
- Full mobile integration command: 2,360 passed, 0 failed.
- Full mobile component command: 24 passed, 0 failed.
- `pnpm run fmt:check`: exit 0.
- `pnpm run typecheck`: exit 0.
- Scoped ESLint over every edited TypeScript/TSX file: exit 0.
- Current Task 2 modal composition: 2 passed, 0 failed.
- Shell detail route plus Wispr component composition: 10 passed, 0 failed.

## Source Fidelity

- Behavioral evidence came from `ad219e88` through `0d54b653`, including the
  final ownership cases in `5dc97c87` and process-wide authority poisoning in
  `16f00fc0` through `0d54b653`.
- Pure Wispr units and their tests retain the source behavior: one exact active
  lease, latest-waiter replacement, request-bound publication, idempotent timer
  cleanup, pending-start reconciliation, exact-lease release, and fail-closed
  poison after failed or uncertain cleanup.
- The source branch's later shell-view composition was not transferred. The
  current Task 2 session, keyboard, terminal, scrollback, and modal contracts
  remain authoritative; `detail.tsx` only replaces its inline Wispr machinery
  with `useShellWisprController`.
- No generated, config, storage, signing, or Task 5 view-composition files were
  changed.

## Additional Compile-Graph Repair

The expanded TypeScript compile surfaced a stale terminal-source test fixture.
Its production contract was unchanged. The fixture was narrowed to provide the
required diagnostics methods, use the current optional dropped range, and wrap
the maybe-promise buffer read before `assert.rejects`.

## Stable-Review Repair

The stable review found that a timed-out native start could remain unsettled
forever after close or disposal, retaining its exact authority lease and
stranding the latest waiter. Two fake-time tests first reproduced the issue: 38
lifecycle cases passed and the late-resolve/late-reject deadline cases failed
because the successor remained in `waitingForBubble`.

The close-after-uncertain-start obligation now binds a separate injected
5-second cleanup deadline after the coordinator records the matching request.
The deadline is intentionally outside ordinary UI timer cancellation. Expiry
removes only that pending request and settles its exact lease as `unknown`,
poisoning authority and publishing `blocked` to the current successor. Late
resolve or reject observes the retired request and cannot publish, release,
re-poison, or issue a cleanup toggle.

## Commit

Subject: `Rebuild serialized shell Wispr ownership`. The Git commit containing
the stable-review repair and this updated report follows that Task 4
implementation/evidence commit.

## CE1 Wave 1 Repair

CE1 wave 1 identified five follow-up issues. The repair separates compensating
close timers from UI cancellation, binds the cleanup deadline for every issued
start obligation (including close/invalidate/unmount before 750 ms), proves
deadline scheduling failure poisons immediately, adds physical screen-prime
coordinate and rejection-continuation coverage, and removes a source-text regex
test. The focused RED run reported 61 passed and 6 failed; the repaired exact
Node lane reports 108 passed.

The broader mobile verification reports 2,357 integration tests and 24 component
tests passed, with no failures.

Detailed mapping:
`.superpowers/ce1/issue141-stage2-ce1/task-4/wave-1/fix-report.md`.

## CE1 Wave 2 Repair

CE1 wave 2 found that the public failed state became retryable while an
uncertain native start still owned its exact authority lease. Retry could then
replace the only request identity able to reconcile that lease. The protocol now
exposes one authoritative outstanding-transaction signal for that timed-out
start. Snapshot busy state, public open admission, and auto-start re-enable all
use it without changing valid recording or already-bound cleanup behavior. Late
rejection releases and republishes retryability; late success restores the
original recording and serializes its close before a successor starts.

The lifecycle suite is also split into acquisition/supersession,
issued-start-cleanup, and authority/successor files of 373, 314, and 424 lines.
The focused RED run reported 49 passed and 3 failed. The repaired exact Node
lane reports 111 passed, the broader integration lane reports 2,360 passed, and
all 52 split lifecycle cases pass.

Detailed mapping:
`.superpowers/ce1/issue141-stage2-ce1/task-4/wave-2/fix-report.md`.

## Concerns

- Authority poisoning is intentionally permanent for the process after failed or
  uncertain native cleanup. This is fail-closed and requires process restart
  before another Wispr owner can acquire control.
- Native tap timeout remains an uncertainty boundary: late resolution is
  observed for native state only; authority poisons at the bounded timeout and
  cannot be released by that late result.
- Text-entry modal arbitration propagates refusal and includes the Task 2
  worktree workspace in its conflict set.
- No known Task 4 verification failures remain.

## CE1 Wave 3 Fix

Implemented the complete blocking queue `CE1-T4-008` through `CE1-T4-011`. The
timeout wrapper now preserves its wrapped resolved-value type with a generic
`Promise<T>` contract. Focused controller coverage now proves both Android
setup-required status variants, definitive retry exhaustion and exact shared
authority handoff, and active plus stale native-settings rejection outcomes.

Changed files:

- `apps/mobile/src/lib/wispr-automation.ts`
- `apps/mobile/test/integration/wispr-automation.test.ts`
- `apps/mobile/test/integration/shell-wispr-controller.test.ts`
- `apps/mobile/test/integration/shell-wispr-controller-authority.test.ts`
- `.superpowers/sdd/task-4-report.md`

RED evidence:

- `cd apps/mobile && pnpm run typecheck` exited 2 after the generic contract
  test was added and before production changed. TypeScript reported TS2322:
  `Promise<unknown>` was not assignable to the wrapped object `Promise` type at
  `test/integration/wispr-automation.test.ts`.
- The first focused Node execution exposed two test-construction mistakes rather
  than production defects: fake time advanced before the first rejected attempt
  had scheduled its retry, then the expected canonical failure copy was too
  specific. The test was corrected to settle the first attempt before advancing
  time and to assert the existing `Wispr bubble not found.` contract.

GREEN evidence:

- Focused new-coverage lane plus typecheck: 72 Node tests passed and mobile
  typecheck exited 0.
- Complete Task 4 Node controller/lifecycle lane: 117 passed, 0 failed.
- `pnpm exec jest --config jest.config.cjs --runInBand test/components/shell-wispr-controller.test.tsx`:
  9 passed, 0 failed.
- `pnpm run typecheck`: exit 0.
- Scoped Prettier, scoped ESLint, and `git diff --check`: exit 0.

Self-review:

- The production change is type-only and leaves timeout, late-settlement, and
  invocation behavior unchanged.
- Disabled and disconnected statuses are driven through the controller with
  auto-start enabled; both publish the precise setup-required snapshot, open the
  modal, remain non-busy, and issue no native control tap.
- Retry exhaustion uses repeated definitive native rejections through the full
  2.5-second window. It asserts the final non-busy failure and proves that the
  same process-wide authority grants the waiting successor its first native tap.
- Settings rejection tests distinguish an active typed failure plus warning from
  stale invalidation, which returns `superseded` without warning or
  current-state failure publication.
- No generated files or unrelated work were modified.
- Residual risks remain unchanged: hook-level `openTextEditor` is intentionally
  fire-and-forget, authority poison is process-lifetime permanent, and the
  diagnostic-only exception branches listed by the wave-3 testing reviewer
  remain outside the blocking queue.

## Stable review repair after CE1 wave 3

The stable review's two Task-4-owned Important findings are repaired. Focus and
screen-prime ownership moved into a dedicated protocol, reducing
`wispr-start-protocol.ts` from 372 to 344 nonblank lines while leaving native
authority acquisition, exact lease settlement, cleanup deadlines, and request
generation together in the start protocol. The reconciliation ledger now records
the exact CE1 wave-3 typecheck RED, 117-test/Jest/typecheck GREEN, and
replacement commit `91ca65a0`. The separately adjudicated `ShellDetail` and
`detail.tsx` caps remain Task 5 RED-to-GREEN work and were not changed here.

Changed files:

- `apps/mobile/src/lib/shell-controllers/wispr-focus-protocol.ts`
- `apps/mobile/src/lib/shell-controllers/wispr-start-protocol.ts`
- `docs/run/issue-141-stage-2-reconciliation-evidence.md`
- `.superpowers/sdd/task-4-report.md`

Commands and results:

- Pre-refactor exact Task 4 Node lane: 117 passed, 0 failed.
- Pre-refactor Jest component lane: 9 passed, 0 failed.
- Post-extraction focused controller/lifecycle lane: 76 passed, 0 failed.
- Post-extraction mobile typecheck: exit 0.
- Final exact Task 4 Node lane: 117 passed, 0 failed.
- Final Jest component lane: 9 passed, 0 failed.
- Final mobile typecheck, touched-file Prettier, touched-file ESLint, and
  `git diff --check`: exit 0.
- Nonblank line verification: `wispr-start-protocol.ts` 344 and
  `wispr-focus-protocol.ts` 90, both within the 350-line cap.

## CE1 wave 4 fix

Implemented the complete blocking queue `CE1-T4-012` through `CE1-T4-014`.
Issued screen priming now retains a bounded transaction-owned deadline when UI
timer disposal runs. Native status discovery has the same 750 ms owned bound,
clears only the current request through the existing identity checks, publishes
the existing unavailable failure, and admits a fresh same-session retry.
Repeated-close coverage proves idempotent cleanup for both an in-flight start
and an established recording.

Changed files:

- `apps/mobile/src/lib/shell-controllers/wispr-core.ts`
- `apps/mobile/src/lib/shell-controllers/wispr-focus-protocol.ts`
- `apps/mobile/src/lib/shell-controllers/wispr-start-protocol.ts`
- `apps/mobile/src/lib/shell-controllers/wispr-status-request.ts`
- `apps/mobile/test/integration/shell-wispr-controller.test.ts`
- `apps/mobile/test/integration/shell-wispr-controller-acquisition.test.ts`
- `apps/mobile/test/integration/shell-wispr-controller-issued-cleanup.test.ts`
- `docs/run/issue-141-stage-2-reconciliation-evidence.md`
- `.superpowers/sdd/task-4-report.md`

RED evidence:

- Focused command:
  `pnpm exec tsx --test test/integration/shell-wispr-controller.test.ts test/integration/shell-wispr-controller-acquisition.test.ts test/integration/shell-wispr-controller-issued-cleanup.test.ts`.
- Result: exit 1, 63 passed and 2 failed. The pending screen-prime timer count
  became zero on disposal, and the hung status admission outcome remained
  `undefined` after 750 ms. Both repeated-close tests passed before production
  changes and therefore characterize the existing idempotent behavior.

GREEN evidence:

- Focused command: 65 passed, 0 failed; mobile typecheck exited 0.
- Exact Task 4 Node lane: 121 passed, 0 failed.
- Jest component lane: 9 passed, 0 failed.
- Final mobile typecheck, touched-file Prettier, touched-file ESLint, nonblank
  line verification, and `git diff --check`: exit 0.

Self-review:

- Raw injected timers now own the two issued transaction deadlines; ordinary UI
  fallback and retry timers remain under idempotent `cancelAll()` ownership.
- Screen-prime timeout completion rechecks lifecycle/request identity and cannot
  issue `tapControl` after disposal.
- Status timeout reuses the established unavailable/failure publication and
  warning path. A stale native completion cannot clear or publish over a newer
  request, and deadline cleanup exceptions cannot turn a successful status into
  failure.
- Repeated pending-start and recording closes each produce at most one
  compensating native close, one exact lease release, and no delayed extra tap.
- Public types, exact lease identity, request generation, and process-lifetime
  poison behavior are unchanged.
- Residual risks and diagnostic-only gaps from wave 4 remain recorded: hook
  admission is intentionally fire-and-forget, authority poison requires process
  restart, and defensive modal/timer exception branches remain outside the
  blocking queue.
