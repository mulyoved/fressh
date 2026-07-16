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
- Preserved the Task 2 Worktree contract:
  `connectionAvailable`, `tmuxEnabled`, `sessionName`, `ShellTargetKey`, and a
  `Pick<ShellWorkmuxPort, 'command' | 'operation'>`. Existing explicit
  completed/failed/superseded/unavailable mapping, timeout classification,
  stale-target suppression, invalid-response handling, and no-retry behavior
  remain covered by the Worktree integration lane.
- Preserved Task 4 Wispr controller semantics; the composition root continues
  to pass the activity and session generations and renders its existing modal
  props without adding native authority to the view.
- Updated connection diagnostic delivery to the typed delivery union while
  retaining compatibility for existing direct callers during reconciliation.
- Added direct Worktree action routing to the canonical keyboard controller
  adapter so the command-menu behavior remains unchanged after shim removal.

## Files

The Task 5 slice changes the requested shell view/hooks, focused owner modules,
connection diagnostic delivery boundary, keyboard adapter, terminal contract
consumer, component/integration tests, and reconciliation evidence. It deletes
only the two obsolete keyboard composition files named in the brief.

## RED Evidence

1. `pnpm exec tsx --test test/integration/shell-detail-boundary.test.ts`
   exited 1: 2 passed, 4 failed. `detail.tsx` had 955 nonblank lines,
   `ShellScreenView.tsx` was absent, focused owners were absent, and the
   terminal runtime duplicated the canonical view type.
2. The exact three-file Worktree lane exited 0 with 26 passed. This established
   that Task 2 had already completed the typed Worktree boundary and that Task
   5 must preserve it.
3. The exact four-file Jest lane exited 1: three suites failed and one passed.
   Failures covered the old shell composition shape, old debug-delivery shape,
   and missing lifetime owners.

## GREEN Evidence

- Exact shell composition Node lane: 83 passed, 0 failed.
- Exact Worktree/config Node lane: 66 passed, 0 failed.
- Exact component Jest lane: 4 suites, 8 tests passed.
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

## Concerns

None blocking. Task 2 had already migrated Worktree Workspace to typed ports,
so Task 5 intentionally preserved rather than rewrote that implementation.
