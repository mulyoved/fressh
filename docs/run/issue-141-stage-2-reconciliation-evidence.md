# Issue 141 Stage 2 Reconciliation Evidence

## Baselines

- Source branch expected final implementation: `0d54b653`
- Replacement base: `337b9d330ba07678d9e8ab728cdb471296eff76e`
- Immutable source: `5dab558e2770f2673ab583c1b51c984223835b6a`

## Slice Evidence

| Task   | RED command and failure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | GREEN command and result                                                                                                                                                                                                                                                                                                                                                                        | Source commits                                                                                    | Replacement commit                                                                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task 1 | `pnpm exec tsx --test test/integration/shell-route.test.ts` — exit 1, `ERR_MODULE_NOT_FOUND` for `shell-route`; `pnpm exec jest --config jest.config.cjs --runInBand test/components/shell-route-error-screen.test.tsx` — exit 1, could not locate `ShellRouteErrorScreen`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Parser: 11 passed; component: 1 passed; `pnpm run fmt:check`: exit 0; `pnpm run typecheck`: exit 0                                                                                                                                                                                                                                                                                              | `597a3b9c`, `f4ad565a`                                                                            | `a87f21f6159293d2848b49ee72d1ab19dda15efa`                                                                                                                           |
| Task 2 | Session Node: exit 1, missing `session-core` and `session-diagnostics`; session Jest: exit 1, missing `session`; typed controller group: 87 passed, 63 failed; Worktree typed adapter: 13 passed, 2 failed because it still read the raw channel; stable review successor exposure: 0 passed, 1 failed; stable review generation-bound diagnostics: 0 passed, 1 failed; stale architecture suites: 8 passed, 13 failed; stable re-review shell-only diagnostics: 0 passed, 1 failed; final stable successor-publication interleaving: 0 passed, 1 failed                                                                                                                                                                                                                           | Session Node: 33 passed; session/activity Jest: 11 passed; typed controllers: 174 passed; Worktree/keyboard: 28 passed; session/typed-terminal architecture: 8 passed; Worktree modal: 2 passed; retained-shell, replaced-channel, and deferred-retirement interleaving diagnostics: 3 passed; formatting, typecheck, scoped ESLint, and diff check: exit 0                                     | `68e60f0f..52347f98`, `a7a291b7..a7da6ebc`, selective `8c8e2b13` contract                         | `4faea527`, stable-review fixes `4ba4bde3`, `74ea1a9b`, `9a9210b3`                                                                                                   |
| Task 4 | Exact Node command: exit 1, five test files failed with `ERR_MODULE_NOT_FOUND` for the absent close coordinator, core, native-control authority, and timer owner; exact Jest command: exit 1, missing `shell-controllers/wispr`; stable-review fake-time cases: 38 passed, 2 failed because an uncertain native start had no cleanup deadline; CE1 wave 1: 61 passed, 6 failed on pre-timeout retirement, disposal-cancelled close deadlines, and scheduler failure; CE1 wave 2: 49 passed, 3 failed because opener retry created a second status request and auto-start re-enable replaced the unresolved transaction; CE1 wave 3: `cd apps/mobile && pnpm run typecheck` exited 2 with TS2322 because `Promise<unknown>` was not assignable to the wrapped object `Promise` type | Exact Node command after CE1 wave 3: 117 passed, 0 failed; exact Jest command: 9 passed, 0 failed; `pnpm run typecheck`: exit 0; full mobile integration: 2,360 passed; full mobile components: 24 passed; split lifecycle suites before wave 3: 52 passed; scoped Prettier, ESLint, and `git diff --check`: exit 0; modal composition: 2 passed; shell detail/component composition: 10 passed | `ad219e88..0d54b653`, with final cases from `5dc97c87` and authority hardening through `0d54b653` | `661dad8e`, `e5a986bc`, `06a41f3e`; CE1 wave-2 design `d7cadc6c`, plan `ff4ba887`, and repair commit containing `wave-2/fix-report.md`; CE1 wave-3 repair `91ca65a0` |

### Complete replacement commit ledger

The ranges below are contiguous and non-overlapping. Every replacement commit
after the recorded base is assigned to exactly one reconciliation slice; `HEAD`
in the final row also captures final-review-only evidence repairs whose commit
cannot self-reference its resulting SHA.

| Slice                                                                                      | Replacement commits                                                  | Source rationale                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Task 1 route boundary                                                                      | `a87f21f6..0c088a35` (inclusive: `a87f21f6`, `7d49da64`, `0c088a35`) | Rebuild `597a3b9c` / `f4ad565a`, then close CE1 repeated-parameter behavior.                                                                                                         |
| Task 2 typed session, terminal, Workmux, diagnostics, and former Task 3 dependency closure | `25368a7f..6366345c` (inclusive)                                     | Reconcile `68e60f0f..52347f98`, `a7a291b7..a7da6ebc`, and the selective `8c8e2b13` contract; the range contains all stable and four CE1-wave repairs.                                |
| Task 4 serialized Wispr ownership (including former Task 6)                                | `661dad8e..081920e1` (inclusive)                                     | Reconcile `ad219e88..0d54b653`, including the final `5dc97c87` cases and all six CE1-wave repairs.                                                                                   |
| Task 5 shell view/lifetime and Worktree boundary (including former Task 7)                 | `914e05b1..40543ede` (inclusive)                                     | Reconcile `8751a1d0`, `75aa4de1`, `cbbac86b`, `601d2230`, `8c8e2b13`, and `73c7a20a`; includes stable integration/tmux fixes and the CE1 modal-contract repair.                      |
| Task 8 acceptance and final-review evidence                                                | `ca5cad3d..HEAD` (inclusive)                                         | Acceptance-only canonical adapter reuse, dead teardown removal, Workmux type-hole removal, shared test fixture extraction, verification evidence, and final review evidence closure. |

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

### Task 4 CE1 wave 5

- RED:
  `cd apps/mobile && pnpm exec tsx --test test/integration/shell-wispr-controller.test.ts`
  exited 1 with 24 passed and 4 failed. Both current settings launches remained
  unsettled after 750 ms, and both disposed launches had no transaction-owned
  timer or terminal outcome.
- Focused GREEN: the same command reports 28 passed, 0 failed, and
  `pnpm run typecheck` exits 0.
- Complete GREEN: the exact Task 4 Node lane reports 125 passed, 0 failed; the
  Jest component lane reports 9 passed, 0 failed; mobile typecheck, touched-file
  Prettier/ESLint, strict nonblank line caps, and `git diff --check` exit 0.
- Ownership result: a dedicated settings launcher owns its request generation
  and raw 750 ms transaction deadline. Current timeout returns the existing
  typed settings failure; disposal and replacement return `superseded`; late
  native resolve/reject cannot affect a newer independent launch.

### Task 5 ShellScreenView and Worktree port boundary

- Source reconciliation: rendering and focused-owner behavior was rebuilt from
  `8751a1d0`, `75aa4de1`, `cbbac86b`, `601d2230`, `8c8e2b13`, and `73c7a20a`.
  The #139 Worktree Workspace adaptation preserves the typed
  `ShellWorkmuxPort`/`ShellTargetKey` boundary already established by Task 2; no
  raw connection or `WorkmuxControlChannel` dependency was reintroduced.
- RED boundary command:
  `cd apps/mobile && pnpm exec tsx --test test/integration/shell-detail-boundary.test.ts`
  exited 1 with 2 passed and 4 failed: `detail.tsx` had 955 nonblank lines,
  `ShellScreenView.tsx` was absent (including the Worktree view assertion), and
  the terminal runtime still exported the duplicate view alias.
- RED Worktree command: the exact three-file Worktree lane exited 0 with 26
  passed, confirming Task 2's typed port behavior was already canonical.
- RED component command: the exact four-file Jest lane exited 1 with 3 failed
  suites and 1 passed suite. Failures covered the old shell composition shape,
  old connection-debug delivery shape, and absent target-lifetime owners.
- GREEN shell composition command: the exact eight-file Node lane reports 86
  passed and 0 failed. The boundary measures 498 nonblank `detail.tsx` lines and
  299 physical `ShellDetail` lines.
- GREEN Worktree/config command: the exact six-file Node lane reports 66 passed
  and 0 failed, including unchanged direct Worktree actions and the final
  Advanced submenu contract.
- GREEN component command: the exact four-file Jest lane reports 4 suites and 13
  tests passed. `pnpm run fmt:check` and `pnpm run typecheck` both exit 0.
- Stable-review RED: the focused owner-composition Jest lane reported 2 passed
  and 5 failed because production did not compose the extracted owners, target
  host failure mapping was incomplete, and native transport diagnostics were
  absent. The scrollback boundary also failed while its standalone remote owner
  lifecycle cases passed because production retained inline ownership.
- Stable-review GREEN: the session lifetime/controller lane reports 2 suites and
  17 tests passed; the focused scrollback ownership lane reports 172 passed;
  strict diagnostic delivery reports 12 Node plus 2 Jest tests passed; modal
  composition reports 2 passed. The five owner modules are now the sole
  production paths, successor publication remains retirement-barrier ordered,
  transport diagnostics are generation-checked, target failure mapping preserves
  error/output/no-detail, and legacy diagnostic-delivery fields are removed.
- Final stable-review RED: the session component lane reported 11 passed and 2
  failed because same-target false-to-true tmux resolution remained publicly
  false and prevented the true-to-false prerequisite state. Its target-changing
  retirement-barrier control passed. The keyboard-hook lane reported 7 passed
  and 1 failed because both Worktree modal callbacks and calls were optional.
- Final stable-review GREEN: the session component lane reports 13 passed, with
  both same-target directions publishing immediately through the unchanged
  target key/Workmux port and target-changing publication still delayed until
  predecessor cleanup drains. The keyboard-hook lane reports 8 passed, with
  required direct new/close callbacks reaching their exact modal destinations
  once each; mobile typecheck exits 0.
- Complete final repair rerun: exact Task 5 shell composition reports 86 passed,
  Worktree/config reports 66 passed, and the combined component lane reports 5
  suites / 26 tests passed.
- CE1-T5-001 RED: mobile typecheck exited 2 with TS2344 because the modal test's
  ad-hoc `remoteTarget` did not extend `ShellKeyboardRemoteTargetContext`; the
  temporary unused type assertion also produced TS6196.
- CE1-T5-001 GREEN: the test capture derives from exported
  `UseShellKeyboardControllerInput`, its Workmux and host fixtures implement the
  canonical typed ports, focused modal components report 2 passed, typecheck
  exits 0, exact modal routing remains covered, and no `workmuxControlChannel`
  reference remains in the file.
- Complete CE1-T5-001 rerun: exact shell composition reports 86 passed,
  Worktree/config reports 66 passed, and exact components report 4 suites / 13
  tests passed.

## Full Verification

- Boundary and architecture gate: 22 tests passed. `detail.tsx` is 498 nonblank
  lines, `ShellDetail` is 299 physical lines, and `ShellScreenView.tsx` is 252
  nonblank lines. The forbidden raw `WorkmuxControlChannel` ownership and
  render-time `.current =` searches both returned no matches.
- Focused Stage 2 Node lane: 254 tests passed. Focused Stage 2 component lane: 8
  suites / 37 tests passed.
- Complete mobile gate after all review repairs: `pnpm run fmt:check`,
  `pnpm run lint:check`, and `pnpm run typecheck` exited 0;
  `pnpm run test:integration` passed 2,372 tests; and `pnpm run test:components`
  passed 9 suites / 38 tests.
- The repository `pnpm exec turbo lint:check` cannot execute its root Nix
  formatting task in this environment because `nix` is unavailable (exit 127).
  The requested `nix develop` lanes are blocked by the same missing executable.
  Direct non-Nix package checks passed: UniFFI Jest passed 2 suites / 6 tests
  (with its existing force-exit/open-handle notice), and xterm passed 64 tests.
- `pnpm exec jscpd .` completed its scan but exited 1 against the repository's
  zero-duplication threshold: 35 existing clone groups / 1.22%. No reported pair
  identifies the new shared scrollback fixture or new Stage 2 production
  duplication. This is recorded as repository baseline debt, not a passing
  duplication gate.
- `git diff --check` exits 0.

### Final CE1 repair closure

- Listener-retirement RED: the focused terminal-source suite reported 5/7. Stale
  post-registration cleanup exposed a native removal exception instead of the
  canonical superseded result, and ordinary removal discarded retry authority
  after the first native failure.
- Retry-bookkeeping RED: the follow-up suite reported 7/8 because cleanup
  retried during a later add but did not complete the original registration,
  allowing a third native removal.
- Stable re-review RED: a production hook-runtime replacement test observed one
  native removal attempt instead of two because the retired port would receive
  no future call to drain its pending cleanup.
- GREEN: pending native listener IDs retain an optional registration-completion
  callback until cleanup succeeds. Stale cleanup retries within the boundary
  while preserving the superseded result; ordinary cleanup owns one bounded
  retry in the same call, remains retryable after two failures, and becomes
  idempotent after direct or deferred success.
- Maintainability closure: the duplicated raw-source terminal publication guard
  and redundant suite were removed; behavioral publication coverage remains in
  the hook-runtime suite. Three partial double-asserted terminal source ports
  were replaced by one complete fixture checked with
  `satisfies ShellTerminalSourcePort`.
- Focused terminal closure: 171/171. Complete mobile closure: formatting,
  ESLint, TypeScript, 2,373 integration tests, and 9 component suites / 38 tests
  passed. `git diff --check` exits 0.

### Final CE1 wave 2 closure

- RED: the production hook-runtime replacement test reported 1/7 because two
  native removal failures left retry state only in the obsolete port; it
  observed two attempts instead of a lifecycle-independent third attempt.
- GREEN: retirement is capped at three attempts—the initial call, one immediate
  retry, and one queued microtask retry that captures the native owner and ID.
  Final success or failure always clears the pending record and completes
  registration bookkeeping, so no unreachable retry authority remains after
  replacement.
- The production replacement test proves deferred third-attempt success without
  revisiting the old port. A terminal-failure test proves three failures are
  capped and later removal is inert.
- The last partial diagnostic native-source assertion was replaced by a shared
  complete fixture checked with `satisfies ShellTerminalNativeSource`.
- Focused terminal closure: 175/175. Complete mobile closure: formatting,
  ESLint, TypeScript, 2,374 integration tests, and 9 component suites / 38 tests
  passed. `git diff --check` exits 0.

## Thermo-Nuclear Review

- Review artifact: `docs/run/issue-141-stage-2-thermo-nuclear-review.md`.
- Final result: zero blocking maintainability findings after extracting the
  duplicated typed scrollback fixture and removing the production Workmux type
  hole. Focused repair lanes passed 66/66 and 37/37 respectively, followed by
  the complete mobile gate above.

## Android Preview

- Exact local `preview` EAS command completed again after final CE1 production
  repairs at source head `ed5f10af378ebd32f9296ef8967e336c2546dafd` and produced
  `apps/mobile/build-1784192322073.apk` (164,955,109 bytes).
- APK SHA-256:
  `3709c06a67ff50c19456b38a8b56d15737e183213e2bff9c604194e46e6e3afc`.
- Manifest identity: `com.finalapp.vibe2`, version code 5, version name 0.0.5,
  compile SDK 36. APK signer certificate SHA-256:
  `f3ae9ba5f33128ddd74a416da68209a1ca1fba79e2e0c520443e5a6b080e0b41`.
- EAS selected the configured default credential `Build Credentials F9ztIHqDIB`.
  Expo Doctor reported the installed `expo` and `expo-updates` patch versions
  behind its recommendations; the advisory check did not prevent the signed
  Gradle release artifact.
- `adb connect 100.113.210.6:5555` returned `Connection refused`, and
  `adb devices -l` listed no device. Therefore the existing-installation smoke
  matrix, saved connection/private-key preservation, and installed certificate
  comparison are **not verified** in this run.
- No APK was installed, no app was uninstalled, no app data was cleared, and no
  Worktree close or other device mutation was attempted. Every manual smoke item
  remains pending until the existing signed device is reachable and its current
  backup/signing continuity can be checked safely.

## Rollback

- Stage 2 changes no stored-data format and does not migrate saved connections,
  private keys, or Worktree state.
- Screen unmount no longer defines ownership of the live SSH resource; rolling
  back the UI/controller slice does not require a data conversion.
- The replacement branch can be abandoned without changing the immutable source
  branch.
- If Stage 2 is merged, revert it before beginning Stage 3 or any later shell
  stage that depends on these typed ownership boundaries.
