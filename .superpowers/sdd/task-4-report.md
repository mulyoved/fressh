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

- Exact Node command: 97 passed, 0 failed.
- Exact Jest command: 9 passed, 0 failed.
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
