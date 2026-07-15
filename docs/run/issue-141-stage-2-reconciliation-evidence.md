# Issue 141 Stage 2 Reconciliation Evidence

## Baselines

- Source branch expected final implementation: `0d54b653`
- Replacement base: `337b9d330ba07678d9e8ab728cdb471296eff76e`
- Immutable source: `5dab558e2770f2673ab583c1b51c984223835b6a`

## Slice Evidence

| Task   | RED command and failure                                                                                                                                                                                                                                                    | GREEN command and result                                                                                                                                                                                                        | Source commits                                                            | Replacement commit                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ |
| Task 1 | `pnpm exec tsx --test test/integration/shell-route.test.ts` — exit 1, `ERR_MODULE_NOT_FOUND` for `shell-route`; `pnpm exec jest --config jest.config.cjs --runInBand test/components/shell-route-error-screen.test.tsx` — exit 1, could not locate `ShellRouteErrorScreen` | Parser: 11 passed; component: 1 passed; `pnpm run fmt:check`: exit 0; `pnpm run typecheck`: exit 0                                                                                                                              | `597a3b9c`, `f4ad565a`                                                    | `a87f21f6159293d2848b49ee72d1ab19dda15efa` |
| Task 2 | Session Node: exit 1, missing `session-core` and `session-diagnostics`; session Jest: exit 1, missing `session`; typed controller group: 87 passed, 63 failed; Worktree typed adapter: 13 passed, 2 failed because it still read the raw channel                           | Session Node: 32 passed; session/activity Jest: 9 passed; typed controllers: 174 passed; Worktree/keyboard: 28 passed; detail composition: 1 passed; Worktree modal: 2 passed; formatting, typecheck, and scoped ESLint: exit 0 | `68e60f0f..52347f98`, `a7a291b7..a7da6ebc`, selective `8c8e2b13` contract | `4faea527`                                 |

## Full Verification

## Thermo-Nuclear Review

## Android Preview

## Rollback
