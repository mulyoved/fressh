# Task 5 Report: ShellScreenView, Composition, and Worktree Port Boundary

## Status

Implemented and verified. `detail.tsx` is a composition root, the real render
tree is owned by `ShellScreenView`, Worktree modal rendering is view-owned, and
the existing Task 2 typed Worktree port boundary remains intact.

## Implementation

- Added `ShellScreenView`, overlay/state components, route-ready, manual-fit,
  and terminal-view-policy hooks.
- Moved terminal, keyboard, reconnect, overlay, and modal JSX out of
  `detail.tsx`; added view-owned `WorktreeWorkspaceModal` rendering with the
  shared platform bottom offset.
- Reduced `detail.tsx` to 498 nonblank lines and `ShellDetail` to 299 physical
  lines. It contains neither `useSshStore`, `createWorkmuxControlChannel`, nor
  `ref.current` assignments.
- Added focused session source, target, tmux-resolution, transport, and remote
  copy-mode owners from the approved Stage 2 source slice.
- Deleted the obsolete keyboard composition shim and its implementation-shaped
  integration test.
- Preserved the Task 2 Worktree contract: `connectionAvailable`, `tmuxEnabled`,
  `sessionName`, `ShellTargetKey`, and a
  `Pick<ShellWorkmuxPort, 'command' | 'operation'>`. Existing explicit
  completed/failed/superseded/unavailable mapping, timeout classification,
  stale-target suppression, invalid-response handling, and no-retry behavior
  remain covered by the Worktree integration lane.
- Preserved Task 4 Wispr controller semantics; the composition root continues to
  pass the activity and session generations and renders its existing modal props
  without adding native authority to the view.
- Updated connection diagnostic delivery to require the typed delivery union;
  the legacy `allowTerminalPaste` and `pasteIntoTerminal` fields are removed.
- Added direct Worktree action routing to the canonical keyboard controller
  adapter so the command-menu behavior remains unchanged after shim removal.

## Files

The Task 5 slice changes the requested shell view/hooks, focused owner modules,
connection diagnostic delivery boundary, keyboard adapter, terminal contract
consumer, component/integration tests, and reconciliation evidence. It deletes
only the two obsolete keyboard composition files named in the brief.

## RED Evidence

1. `pnpm exec tsx --test test/integration/shell-detail-boundary.test.ts` exited
   1: 2 passed, 4 failed. `detail.tsx` had 955 nonblank lines,
   `ShellScreenView.tsx` was absent (including the Worktree view assertion), and
   the terminal runtime duplicated the canonical view type.
2. The exact three-file Worktree lane exited 0 with 26 passed. This established
   that Task 2 had already completed the typed Worktree boundary and that Task 5
   must preserve it.
3. The exact four-file Jest lane exited 1: three suites failed and one passed.
   Failures covered the old shell composition shape, old debug-delivery shape,
   and missing lifetime owners.

## GREEN Evidence

- Exact shell composition Node lane: 86 passed, 0 failed.
- Exact Worktree/config Node lane: 66 passed, 0 failed.
- Exact component Jest lane: 4 suites, 13 tests passed.
- `pnpm run fmt:check`: exit 0.
- `pnpm run typecheck`: exit 0.
- Touched-file ESLint lane: exit 0.
- `git diff --check`: exit 0.
- Boundary measurements after formatting: 498 nonblank `detail.tsx` lines and
  299 physical `ShellDetail` lines.

## Source Reconciliation

Rebuilt from `8751a1d0`, `75aa4de1`, `cbbac86b`, `601d2230`, `8c8e2b13`, and
`73c7a20a`, adapted to the reconciled Task 2 ports and the #139 Worktree
Workspace feature. Direct Worktree actions and the final Advanced submenu are
covered by `command-menu.test.ts`, `keyboard-config.test.ts`, and
`shell-config-schema.test.ts` in the complete GREEN lane.

## Stable-review repair

- RED owner composition: the focused lifetime Jest lane reported 2 passed and 5
  failed. Production did not compose the five extracted owners, the target host
  adapter lacked the canonical error/output/no-detail mapping, and native
  diagnostics were absent.
- RED scrollback composition: the boundary assertion failed because scrollback
  still used inline remote-copy-mode ownership. The focused owner lifecycle
  cases themselves passed.
- GREEN owner composition: the session lifetime/controller Jest lane reports 2
  suites and 17 tests passed. Source, target, tmux-resolution, transport, and
  remote-copy-mode owners are now the sole production paths; target successor
  publication remains withheld until the retirement barrier drains.
- GREEN scrollback ownership: the focused boundary, lifecycle, cleanup, event,
  live-input, and executor lane reports 172 passed and 0 failed.
- GREEN diagnostics: the strict delivery and debug-command Node lane reports 12
  passed, and its hook Jest lane reports 2 passed. Transport diagnostic
  snapshots are generation-checked for current and superseded publications.
- GREEN modal composition: 2 passed. The regression guard now follows the
  focused controller composition and typed `ports.workmux`/`remoteTarget`
  contracts instead of the deleted keyboard shim.

### Stable-review publication and Worktree-command repair

- RED tmux publication: the session component lane reported 11 passed and 2
  failed. Same-normalized-target false-to-true resolution remained publicly
  false, which also prevented the true-to-false case from establishing its
  prerequisite state. The target-changing retirement-barrier control passed.
- GREEN tmux publication: the same lane reports 13 passed. Both same-target
  directions publish immediately while preserving the exact target key and
  Workmux port; a target-changing resolution remains withheld until predecessor
  cleanup drains.
- RED Worktree command contract: the keyboard-hook lane reported 7 passed and 1
  failed because both modal callbacks and both calls were optional.
- GREEN Worktree command contract: the same lane reports 8 passed. Both
  callbacks are required, invoked directly, and the new/close actions each reach
  their exact modal destination once. Mobile typecheck exits 0 with every
  production and test harness supplying the required contract.
- Complete repair verification: the exact Task 5 shell lane reports 86 passed,
  the Worktree/config lane reports 66 passed, and the combined Task 5 plus
  session-lifecycle component lane reports 5 suites / 26 tests passed.

## Self-review

Review target: the complete uncommitted Task 5 diff against `081920e1`.

- Correctness/API: checked view props, session/terminal generation flow,
  diagnostic delivery compatibility, Worktree outcome mapping, modal
  arbitration, and direct keyboard actions. No actionable finding remained.
- Reliability/races: the existing Worktree lifecycle suite covers stale source,
  invalidation, disposal, double submission, retry policy, and late results.
- UI/React: `ShellScreenView` imports controller types only; no store, native
  adapter, timer, factory, or controller hook enters the view. Existing safe
  area and bottom-offset behavior is shared by all modals.
- Maintainability/AI-slop: the obsolete shim and static composition assertions
  were removed; the binding AST guard prevents workflow ownership from drifting
  back into the view or oversized detail root.
- Security/data: no authentication, persistence, migration, or secret-handling
  surface changed.
- Adapter ledger: core manual review ran; external-codex, simplify, UI, and
  React-specific bundled adapters were absent in this worktree; security and
  data adapters were not applicable; CI-equivalent focused checks passed.

The stable-review repair received a second complete diff review after all owner
integrations. It found one dropped Task 2 static composition test whose module
references had become obsolete; the test was restored against the canonical
target/remote-copy owners, typed ports, terminal policy, and view-owned Worktree
modal, and passes 4 cases. No actionable correctness, race, API-contract,
maintainability, test-coverage, UI, security, or data finding remained. The
final combined component rerun included the session controller and reports 5
suites / 23 tests passed; the additional scrollback/diagnostic lane reports 166
passed, complementing the exact Task 5 lanes above.

The final publication/command repair received a fresh diff review. Same-key
metadata publication cannot expose a future target port, while the owner
subscription remains the only key-changing publication path; stale tmux
resolution remains generation-guarded. Required modal callbacks resolve from
current ports for every action and have both adapter-level and ShellDetail
destination coverage. No additional finding remained. Core review ran;
external Codex, simplify, UI, React, and AI-slop adapters are absent; security
and data review are not applicable; CI-equivalent focused checks pass.

## Concerns

None blocking. Task 2 had already migrated Worktree Workspace to typed ports, so
Task 5 intentionally preserved rather than rewrote that implementation.
