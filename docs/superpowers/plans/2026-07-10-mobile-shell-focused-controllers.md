# Mobile Shell Focused Controllers Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver issue #83 as five ordered, independently reviewable
controller-extraction PRs that leave `detail.tsx` as a 1,400-1,800 line
composition root.

**Architecture:** Keep `detail.tsx` as the explicit composition root and add
dependency-injected controller cores with thin React hooks under
`apps/mobile/src/lib/shell-controllers/`. Execute the five child plans in order
because terminal ports feed scrollback and scrollback input feeds keyboard
dispatch; do not combine the child plans into one PR.

**Tech Stack:** TypeScript 5.9, React 19, Expo 54/React Native 0.81, Node
`tsx --test`, pnpm/Turbo, Prettier, ESLint.

## Global Constraints

- Preserve observable shell UI, route, native, Workmux, xterm, notification, and
  terminal-input behavior.
- Do not introduce Redux, XState, an event bus, or another state-management
  dependency.
- Do not rewrite the SSH store, Workmux control channel, xterm WebView, or
  native notification module.
- Do not create a combined shell-controller facade or a barrel under
  `shell-controllers/`.
- Do not extract Wispr automation; issue #130 owns that work.
- Use `apps/mobile/src/lib/shell-controllers/` for controller modules and
  kebab-case file names.
- Use dependency-injected cores for lifecycle tests and thin React hooks for
  platform/render integration.
- Every controller must expose typed state/view props, commands,
  `invalidate(reason)`, and idempotent `dispose()`.
- A stale completion must not mutate state, show alerts, clear newer work,
  acknowledge a request, or send follow-up commands.
- Use local Android preview builds for manual verification; do not use
  Metro/dev-client as the normal workflow.
- Preserve device data. Never clear `com.finalapp.vibe2` app data during
  verification.

---

## Child Plans and Required Order

1. [`2026-07-10-shell-modal-controllers.md`](./2026-07-10-shell-modal-controllers.md)
   - Establish shared controller lifecycle types.
   - Split and delete `shell-modals.tsx`.
   - Add modal arbitration and controller-core tests.
2. [`2026-07-10-shell-activity-notifications-controller.md`](./2026-07-10-shell-activity-notifications-controller.md)
   - Centralize focus/AppState observation.
   - Extract notification route and acknowledgement lifecycle.
3. [`2026-07-10-shell-terminal-controller.md`](./2026-07-10-shell-terminal-controller.md)
   - Extract ordered transport, runtime/listener ownership, and resize/fit
     lifecycle.
   - Publish the terminal ports required by scrollback.
4. [`2026-07-10-shell-scrollback-controller.md`](./2026-07-10-shell-scrollback-controller.md)
   - Compose the existing scrollback helpers into one controller.
   - Make its live-input command the only guarded user-input transport.
5. [`2026-07-10-shell-keyboard-controller.md`](./2026-07-10-shell-keyboard-controller.md)
   - Extract keyboard state, input adapters, Workmux/status commands, config
     reload, and Codex restart.
   - Complete the responsibility/line-count audit.

Each child plan starts from the committed result of the previous child plan. If
a child PR changes a published interface, update the next child plan before
starting its implementation rather than adding compatibility aliases.

## Program Completion Gate

- [ ] All five child plans are merged in order and each PR is independently
      revertible.
- [ ] `apps/mobile/src/app/shell/detail.tsx` contains composition/rendering and
      the explicitly excluded Wispr workflow, not extracted controller
      internals.
- [ ] `wc -l apps/mobile/src/app/shell/detail.tsx` reports 1,400-1,800 lines, or
      the final PR documents why a responsibility-complete result falls outside
      the soft range.
- [ ] `apps/mobile/src/lib/shell-modals.tsx` is deleted.
- [ ] No controller imports another controller; all cross-domain dependencies
      use typed ports wired in `detail.tsx`.
- [ ] `cd apps/mobile && pnpm run fmt:check && pnpm run lint:check && pnpm run typecheck && pnpm run test:integration`
      passes.
- [ ] Manual Android preview verification covers attach/reload/resize,
      configured and system keyboard input, scrollback entry/exit/live input,
      browser and feature request flows, Workmux navigation/status cycling, and
      notification acknowledgement.
- [ ] Issue #83 is updated with the five PRs, issue #6 remains closed, and issue
      #130 remains the Wispr follow-up.
