# CE1 Task 2 Fix Report

## Status

DONE

## TDD Evidence

Focused tests were added before the first production changes. The initial
Workmux run exited 1 with 20 passing and 3 failing tests:

- an output-only failure produced an empty failure message (`CE1-T2-001`);
- a synchronous channel factory exception escaped owner construction
  (`CE1-T2-003`);
- a current-generation diagnostic event produced no persistent detailed log
  (`CE1-T2-002`).

The same suite finished with 24 passing tests after the repair, including the
additional successor-factory, typed stale-scroll, and retry coverage.

## Findings Resolved

- `CE1-T2-001`: host and Workmux command adapters now prefer actionable output
  when the raw error string is empty.
- `CE1-T2-002`: the generation-bound diagnostic port preserves both the active
  trace and the detailed persistent `Workmux diagnostic event` record, including
  connection, channel, typed fields, and current store counts.
- `CE1-T2-003`: initial and successor channel factory exceptions are contained,
  diagnosed, published as unavailable, and retryable. Both retirement settlement
  paths use one guarded continuation, so successor publication cannot pin drain.
- `CE1-T2-004`: replay-safe lifecycle disposal authority is registered in a
  layout effect before the layout effect that activates Workmux. A source-level
  ordering assertion prevents passive registration from returning.
- `CE1-T2-005`: public session contracts no longer export raw Workmux channel,
  connection, result, or owner-construction types. Scroll commands return the
  same typed outcomes as command and operation calls, including `superseded`.
- `CE1-T2-006`: keyboard target context now exposes the final
  `workmux: ShellWorkmuxPort` contract; compatibility vocabulary was removed
  from the public target and composition identity.
- `CE1-T2-007`: `terminal-contracts.ts` now owns the explicit terminal view port;
  the runtime implements that contract rather than defining it for consumers.
- `CE1-T2-008`: exact native, listener, and Xterm diagnostic composition was
  restored, including bigint string fidelity, snapshot freshness, and proof
  that output payload contents do not enter diagnostics.
- `CE1-T2-009`: architecture tests scan production sources for raw Workmux
  factory/diagnostic ownership and raw native `bufferStats()`/`currentSeq()`
  invocations. The native-call scan distinguishes calls from definitions and
  type declarations, with a committed offender fixture proving detection, and
  asserts the final public contract vocabulary.
- `CE1-T2-010`: the redundant terminal-hook payload clone was removed. The
  session/native boundary retains the ownership copy.
- `CE1-T2-011`: the 1,084-line lifecycle suite was split into controller,
  resilience, and disposal protocol suites with a shared 197-line harness. The
  test files are now 373, 420, and 175 lines.
- `CE1-T2-012`: outcome decoding is centralized in an exhaustive matcher and
  output unwrapper. Browser actions, notifications, skill discovery/selection,
  feature requests, host command routing, Worktree Workspace, terminal fit, and
  scrollback now use the shared decoder. The output helper accepts a typed
  failure-to-error mapper so Worktree preserves `failureClass` without a local
  decoder or compatibility facade.

## Stable Review Follow-up

- Restored focused typed-port tests proving Worktree admission closes all
  conflicting modals in order, stops at the first blocked close, and keeps hook
  ownership free of terminal-input escape hatches.
- Corrected the stale reconnect architecture assertion to require
  `lastReconnectOutcome`/recovery ownership in `session.tsx` and its absence
  from `detail.tsx`.
- Preserved the scrollback 650-line ownership ceiling by moving verified-runtime
  clear authority into `scrollback-clear-coordinator.ts` and context
  normalization/identity/replacement policy into the React-free
  `scrollback-context-identity.ts`; `scrollback-core.ts` is now 646 lines.

## Verification

- `pnpm run test:integration`: exit 0 (full mobile integration suite).
- Final full mobile integration result: 2259 passed, 0 failed.
- Focused outcome/architecture matrix: 87 passed, 0 failed.
- Stable follow-up ownership/outcome/Worktree matrix: 121 passed, 0 failed.
- Complete Task 2 integration matrix: 253 passed, 0 failed.
- Final affected architecture/Worktree/scrollback matrix: 110 passed, 0 failed.
- Focused scrollback decomposition matrix: 65 passed, 0 failed.
- Focused Workmux/keyboard/scrollback/runtime matrix: 141 passed, 0 failed.
- Split terminal lifecycle suites: 39 passed, 0 failed.
- Session/activity component boundary suites: 11 passed, 0 failed.
- `pnpm run typecheck`: exit 0.
- `pnpm run fmt:check`: exit 0.
- `pnpm run lint:check`: exit 0 with zero warnings.
- `git diff --cached --check`: exit 0 before commit.

## Commit

The stable-review follow-up implementation is commit `4d1bc1b8` (`Close Task 2
ownership review gaps`). This report update is committed as separate evidence
so it can name the exact implementation commit.

## Concerns

None.
