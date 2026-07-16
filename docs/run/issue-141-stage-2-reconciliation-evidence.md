# Issue 141 Stage 2 Reconciliation Evidence

## Baselines

- Source branch expected final implementation: `0d54b653`
- Replacement base: `337b9d330ba07678d9e8ab728cdb471296eff76e`
- Immutable source: `5dab558e2770f2673ab583c1b51c984223835b6a`

## Slice Evidence

| Task   | RED command and failure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | GREEN command and result                                                                                                                                                                                                                                                                                                                                    | Source commits                                                            | Replacement commit                                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Task 1 | `pnpm exec tsx --test test/integration/shell-route.test.ts` — exit 1, `ERR_MODULE_NOT_FOUND` for `shell-route`; `pnpm exec jest --config jest.config.cjs --runInBand test/components/shell-route-error-screen.test.tsx` — exit 1, could not locate `ShellRouteErrorScreen`                                                                                                                                                                                                                                                                               | Parser: 11 passed; component: 1 passed; `pnpm run fmt:check`: exit 0; `pnpm run typecheck`: exit 0                                                                                                                                                                                                                                                          | `597a3b9c`, `f4ad565a`                                                    | `a87f21f6159293d2848b49ee72d1ab19dda15efa`                         |
| Task 2 | Session Node: exit 1, missing `session-core` and `session-diagnostics`; session Jest: exit 1, missing `session`; typed controller group: 87 passed, 63 failed; Worktree typed adapter: 13 passed, 2 failed because it still read the raw channel; stable review successor exposure: 0 passed, 1 failed; stable review generation-bound diagnostics: 0 passed, 1 failed; stale architecture suites: 8 passed, 13 failed; stable re-review shell-only diagnostics: 0 passed, 1 failed; final stable successor-publication interleaving: 0 passed, 1 failed | Session Node: 33 passed; session/activity Jest: 11 passed; typed controllers: 174 passed; Worktree/keyboard: 28 passed; session/typed-terminal architecture: 8 passed; Worktree modal: 2 passed; retained-shell, replaced-channel, and deferred-retirement interleaving diagnostics: 3 passed; formatting, typecheck, scoped ESLint, and diff check: exit 0 | `68e60f0f..52347f98`, `a7a291b7..a7da6ebc`, selective `8c8e2b13` contract | `4faea527`, stable-review fixes `4ba4bde3`, `74ea1a9b`, `9a9210b3` |
| Task 4 | Exact Node command: exit 1, five test files failed with `ERR_MODULE_NOT_FOUND` for the absent close coordinator, core, native-control authority, and timer owner; exact Jest command: exit 1, missing `shell-controllers/wispr`; stable-review fake-time cases: 38 passed, 2 failed because an uncertain native start had no cleanup deadline; CE1 wave 1: 61 passed, 6 failed on pre-timeout retirement, disposal-cancelled close deadlines, and scheduler failure; CE1 wave 2: 49 passed, 3 failed because opener retry created a second status request and auto-start re-enable replaced the unresolved transaction; CE1 wave 3: `cd apps/mobile && pnpm run typecheck` exited 2 with TS2322 because `Promise<unknown>` was not assignable to the wrapped object `Promise` type | Exact Node command after CE1 wave 3: 117 passed, 0 failed; exact Jest command: 9 passed, 0 failed; `pnpm run typecheck`: exit 0; full mobile integration: 2,360 passed; full mobile components: 24 passed; split lifecycle suites before wave 3: 52 passed; scoped Prettier, ESLint, and `git diff --check`: exit 0; modal composition: 2 passed; shell detail/component composition: 10 passed | `ad219e88..0d54b653`, with final cases from `5dc97c87` and authority hardening through `0d54b653` | `661dad8e`, `e5a986bc`, `06a41f3e`; CE1 wave-2 design `d7cadc6c`, plan `ff4ba887`, and repair commit containing `wave-2/fix-report.md`; CE1 wave-3 repair `91ca65a0` |

### Task 4 CE1 wave 4

- RED:
  `cd apps/mobile && pnpm exec tsx --test test/integration/shell-wispr-controller.test.ts test/integration/shell-wispr-controller-acquisition.test.ts test/integration/shell-wispr-controller-issued-cleanup.test.ts`
  exited 1 with 63 passed and 2 failed. Disposal removed the only pending
  screen-prime deadline (`0 !== 1` timer), and the never-settling status request
  still had no outcome after 750 ms. The two repeated-close exact-lease cases
  passed as characterization coverage.
- Focused GREEN: the same command reports 65 passed, 0 failed, and
  `pnpm run typecheck` exits 0.
- Complete GREEN: the exact Task 4 Node lane reports 121 passed, 0 failed; the
  Jest component lane reports 9 passed, 0 failed; mobile typecheck, scoped
  Prettier/ESLint, nonblank line caps, and `git diff --check` exit 0.
- Ownership result: issued screen-prime and status-discovery deadlines use the
  raw injected transaction timer boundary, while opening/retry timers remain
  cancellable UI work. Status completion still clears only its matching request,
  and repeated pending-start/recording closes settle one exact authority lease.

## Full Verification

## Thermo-Nuclear Review

## Android Preview

## Rollback
