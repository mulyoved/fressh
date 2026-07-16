# Issue 141 Stage 2 Thermo-Nuclear Maintainability Review

Range reviewed: `337b9d330ba07678d9e8ab728cdb471296eff76e` through the Task 8
acceptance snapshot.

## Blocking findings and repairs

1. `tmux-scrollback-cleanup.test.ts` crossed from 976 to 1,007 physical lines,
   while it and `tmux-scrollback-executor.test.ts` duplicated typed Workmux
   scroll-transport fixture construction. The canonical fixtures were extracted
   to `test/integration/helpers/workmux-scrollback-executor-fixtures.ts`. The
   cleanup suite is now 971 lines and the already-large executor suite decreased
   from 1,158 to 1,143 lines. Both suites pass 66/66.
2. `session-workmux.ts` initialized a required public port with
   `null as unknown as ShellWorkmuxPort` and assigned it later. Construction was
   reordered around a typed local `port` and a definite `OwnedWorkmux`
   assignment, deleting the production type hole. Focused Workmux/architecture
   tests pass 37/37.

## Structural checks

- `detail.tsx`: 514 physical / 498 nonblank lines.
- `ShellDetail`: 299 physical lines; below the strict `<300` guard, with no
  local growth headroom.
- `ShellScreenView.tsx`: 261 physical / 252 nonblank lines and remains
  view-only.
- Session/Wispr owner units remain below their binding 350-nonblank caps.
- No changed production file crossed 1,000 lines.
- The only changed test file that crossed 1,000 lines was repaired above.
- The changed production diff contains no `@ts-ignore`, `any`, compatibility
  fallback, raw Workmux ownership leak, or render-time `.current =` assignment.
- The global `jscpd` scan reports existing repository clones at 1.22%; none of
  its reported clone pairs identifies the new shared fixture or a new Stage 2
  production duplication.

## Result

Zero blocking maintainability findings remain. Residual observation:
`ShellDetail` deliberately sits at 299 lines, so future composition wiring
should begin with another extraction rather than local growth.
