# Task 6 Report: Herdr Keyboard Adapter

## Status

Implemented and verified. Herdr now has a provider-safe keyboard adapter that
routes terminal input through one byte port, keeps clipboard/selection/fit and
keyboard selection local, maps only Previous/Next Work actions to agent
navigation, and reports every other shell-specific action as exactly
`TBD for Herdr`.

## Implementation

- Added `createHerdrKeyboardAdapter()` with explicit terminal-input,
  clipboard, terminal-view, agent-navigation, and feedback ports. Its public
  input contract contains no Shell session, Workmux command port, tmux copy
  owner, generic host command, or resize authority.
- Added the explicit `HerdrKeyboardAction` classifier. Only
  `WORKMUX_NAV_PREV` and `WORKMUX_NAV_NEXT` navigate agents. Fit, copy, paste,
  configured keyboard targets, and rotation stay local. Every other known or
  unknown action returns the exact unsupported message.
- Reused runtime keyboard selection helpers, `runSlotItem()`, and the existing
  provider-independent modifier definitions. Moved only the pure command-step
  byte encoder to `keyboard-runtime.ts`, with a re-export from its previous
  shell support module so ordinary Shell call sites remain unchanged.
- Preserved UTF-8 text, all raw byte values, active modifier ordering, and
  ordered macro command/text/sequence/step emission through `sendInput()`.
  Missing macros emit the bounded local message `Keyboard macro unavailable.`
  and no terminal bytes.
- Added adapter snapshots/subscriptions and `getTerminalKeyboardProps()` for
  the later Herdr route. The returned keyboard props select
  `workKeyLongPressMode: 'configured'`.
- Added the provider-neutral `WorkKeyLongPressMode` presentation option. The
  shared default remains `workmux-scoped`; `configured` preserves exactly
  `Prev`, `Next`, `Active`, `+Busy`, and `All`, without the Workmux-generated
  duplicate scoped Previous option.
- Did not edit `apps/mobile/config/shell-config.json`, metadata, device state,
  publishing configuration, or OTA/native build state.

## Files

- `apps/mobile/src/lib/herdr/keyboard-adapter.ts` (new)
- `apps/mobile/test/integration/herdr-keyboard-adapter.test.ts` (new)
- `apps/mobile/src/app/shell/components/keyboard-component-props.ts`
- `apps/mobile/src/app/shell/components/TerminalKeyboard.tsx`
- `apps/mobile/src/app/shell/components/TerminalKeyboardLongPressController.ts`
- `apps/mobile/test/integration/terminal-keyboard-component.test.ts`
- `apps/mobile/src/lib/keyboard-runtime.ts`
- `apps/mobile/src/lib/shell-controllers/keyboard-input-support.ts`
- `.superpowers/sdd/task-6-report.md` (this report)

## RED Evidence

`pnpm --filter @fressh/mobile exec tsx --test
test/integration/herdr-keyboard-adapter.test.ts` exited 1. Node reported
`ERR_MODULE_NOT_FOUND` for `src/lib/herdr/keyboard-adapter`, which was the
expected missing-feature failure before production implementation.

## GREEN Evidence

- Focused adapter plus shared terminal-keyboard integration lane:
  `pnpm --filter @fressh/mobile exec tsx --test
  test/integration/herdr-keyboard-adapter.test.ts
  test/integration/terminal-keyboard-component.test.ts` exited 0 with 16 passed,
  0 failed.
- Existing shell keyboard input/repair integration lane exited 0 with the
  focused combined run reporting 46 passed, 0 failed.
- Full mobile integration:
  `pnpm --filter @fressh/mobile test:integration` exited 0 with 2,456 passed,
  0 failed, 0 skipped.
- Full mobile ESLint: `pnpm --filter @fressh/mobile lint:check` exited 0.
- Mobile TypeScript: `pnpm --filter @fressh/mobile typecheck` exited 0.
- Full mobile formatting was applied with
  `pnpm --filter @fressh/mobile fmt`; the final
  `pnpm --filter @fressh/mobile fmt:check` exited 0.
- `git diff --check` exited 0.
- The forbidden-boundary scan found no `ShellSession`, `ShellWorkmuxPort`,
  tmux/host command port, `runWorkmuxCommand`, or `shellSession` capability in
  the adapter.

## Self-review

Review target: the complete uncommitted Task 6 diff against `48a73a34`.

- Correctness/API: checked every classifier outcome, UTF-8/raw byte behavior,
  modifier order, macro operation order, active keyboard routing/rotation,
  clipboard selection/copy, fit-only behavior, and the configured Work list.
- Isolation: the adapter receives only the narrow ports named above. No
  unsupported action has a remote-command path; exhaustive coverage checks all
  currently known nonsupported action IDs plus an unknown ID.
- Ordinary Shell compatibility: the long-press mode is optional at both shared
  boundaries and defaults to `workmux-scoped`; the moved step helper is
  re-exported from its former location. Existing shell input and long-press
  tests pass.
- Reliability: byte inputs are copied before ownership transfer; macro
  operations are snapshotted before async step execution; presentation
  subscriber exceptions are contained.
- Maintainability/AI-slop: removed a needless self-referential adapter variable,
  exported the adapter input contract for Task 8, and kept action classification
  separate from execution.
- UI/React: the only shared component behavior change is the optional
  presentation mode; gesture timing, popup layout, ordinary scope badges, and
  default options are unchanged.
- Security/data: no authentication, credentials, persistence, migrations,
  storage, host commands, shell ownership, or remote config surfaces changed.
- Adapter ledger: core manual review ran. Bundled external-Codex, simplify, UI,
  React, and AI-slop adapters are absent in this worktree. Security and data
  adapters are not applicable. Mobile CI-equivalent gates pass.

No actionable correctness, ownership, API-contract, maintainability,
test-coverage, UI, security, or data finding remains in the Task 6 diff.

## Concerns

The repository-wide `pnpm exec turbo lint:check` gate exited 1 on inherited,
unrelated Prettier drift in 18 files under
`packages/react-native-xtermjs-webview` (including generated `dist` files and
existing source/README files). Turbo then cancelled concurrent Rust/native
jobs. Task 6 did not modify those files, and the failed root gate left the
worktree dirty only in the nine Task 6 paths listed above. All required mobile
integration, lint, typecheck, format, focused, and diff gates pass.
