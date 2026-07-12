# Mobile Shell Focused Controllers Design

## Context

GitHub issue #83 tracks behavior-controller decomposition for
`apps/mobile/src/app/shell/detail.tsx`. The screen is currently 3,725 lines and
still coordinates browser requests, modal exclusivity, keyboard commands,
Workmux status cycling, scrollback, notification acknowledgement, terminal
lifecycle, and Wispr automation alongside rendering.

Issue #6 covered visual-component and xterm module extraction and is now closed.
The first decomposition pass from issue #71 also created
`useBrowserActionsController`, `useFeatureRequestController`,
`useSkillSelectorController`, and `useShellSimpleModals`, but placed them
together in a 1,308-line `shell-modals.tsx`. That pass reduced inline modal
logic without completing the narrower ownership and local lifecycle testing
required by issue #83.

This design is an umbrella for several independently shippable controller
extractions. It defines their final boundaries, shared contracts, dependency
direction, delivery order, and acceptance checks. It does not authorize one
giant implementation PR.

## Decisions

- Keep `detail.tsx` as the explicit composition root instead of replacing it
  with one shell-controller facade.
- Use dependency-injected controller cores with thin React hooks.
- Include full terminal lifecycle extraction in issue #83.
- Split and tighten the existing controllers in `shell-modals.tsx`.
- Keep Workmux status cycling in the keyboard-command domain.
- Exclude Wispr automation. Its future session-controller extraction is tracked
  by issue #130.
- Judge success by responsibility boundaries first, with a soft final
  `detail.tsx` size target of 1,400-1,800 lines.
- Preserve observable behavior and existing native, route, shell, and WebView
  contracts.

## Goals

- Move every workflow named by issue #83 behind a narrow controller API.
- Give each controller one clear source identity, request lifecycle, error
  policy, and cleanup owner.
- Make controller lifecycle behavior testable without rendering the full shell
  screen.
- Reduce direct state refs, effects, timers, listeners, and async generations in
  `detail.tsx`.
- Preserve cross-domain ordering where it matters, especially modal exclusivity,
  scrollback exit before input, and terminal-runtime reset.
- Ship five independently reviewable and revertible PRs.

## Non-goals

- Do not redesign the shell UI or change keyboard layouts.
- Do not change user-visible command, scrollback, notification, or terminal
  behavior.
- Do not introduce Redux, XState, an event bus, or another state-management
  dependency.
- Do not rewrite the SSH store, Workmux control channel, xterm WebView, or
  native notification module.
- Do not move all shell behavior behind one large facade.
- Do not extract or redesign Wispr automation in this issue.
- Do not preserve `shell-modals.tsx` as a compatibility wrapper after its
  controllers move.

## Architecture

### Composition root

`detail.tsx` continues to own:

- route parameters and connection/shell selection;
- Workmux/tmux configuration needed to construct controller inputs;
- controller construction and narrow port wiring;
- the excluded Wispr workflow;
- screen-level render composition and error boundaries.

It does not own request generations, command queues, retry timers, listener
ownership, scrollback state, notification acknowledgement state, or modal
workflow state for the extracted domains.

Controller dependencies are passed as typed ports. A controller must not import
another controller or reach into another controller's refs. The screen may
combine two returned callbacks where an event legitimately belongs to two
domains, but that composition must not reproduce workflow logic.

### Location and file shape

Place the extracted controller code under:

```text
apps/mobile/src/lib/shell-controllers/
```

Use focused kebab-case modules for activity, modal arbitration, browser actions,
feature requests, skill selection, simple modals, notifications, terminal
lifecycle, scrollback, and keyboard commands. Runtime-heavy domains may split
their core and hook into separate files. Do not add a barrel or a combined shell
facade; `detail.tsx` imports the controller hooks it composes.

Existing pure helpers such as `keyboard-actions.ts`,
`workmux-scrollback-executor.ts`, `terminal-fit-runner.ts`, and
`agent-notification-visibility.ts` remain separate. Controller cores compose
those helpers rather than duplicating them.

### Core and hook contract

Runtime-heavy controllers use a dependency-injected core with this common shape:

```ts
type ControllerCore<State> = {
	getSnapshot(): State;
	subscribe(listener: () => void): () => void;
	invalidate(reason: ControllerInvalidationReason): void;
	dispose(): void;
};
```

Each core adds domain-specific commands. `invalidate` advances the domain's
generation and settles or suppresses obsolete work while leaving the core
available for its current source. `dispose` is final. Both operations are
idempotent.

The React hook:

- creates and disposes the core;
- updates live injected dependencies without rebuilding the core unnecessarily;
- translates the snapshot and commands into typed view props;
- forwards source and activity changes to `invalidate`;
- contains no second request, queue, retry, or cleanup protocol.

Simple synchronous state may use the same core contract without artificial async
machinery. Platform subscriptions in the activity hook may remain a thin React
adapter, but the resulting lifecycle transitions and invalidation decisions must
be testable as plain TypeScript.

### Identity keys

There is no universal source key because different lifecycle boundaries have
different meanings. Use three explicit identities:

- `ShellTransportKey`: connection ID plus channel ID. Terminal listener and
  transport ownership use this key.
- `ShellTargetKey`: transport key plus the effective tmux target. Browser,
  feature-request, keyboard/Workmux, scrollback, and notification visibility use
  this key where the target affects their work.
- `TerminalRuntimeKey`: transport key plus the current WebView instance ID.
  Terminal callbacks and scrollback acknowledgements use this key.

Changing a tmux target must not detach and rebuild an otherwise current shell
listener. Changing the transport must invalidate all target- and runtime-scoped
controllers. A WebView reload must invalidate runtime-scoped work without
pretending that the SSH connection changed.

## Controller Boundaries

### Activity signals

The activity unit owns navigation-focus and AppState subscriptions. It exposes
the current `{ focused, appActive }` snapshot and a generation that changes at
interactive lifecycle boundaries. It contains no domain cleanup itself.

Controllers receive activity as an input and decide which transition matters:

- browser, feature-request, keyboard, scrollback, and notification async work
  invalidate when the shell is no longer both focused and app-active;
- terminal lifecycle follows its existing detach/reload behavior and must not
  invent an extra disconnect merely because the app backgrounds;
- returning to active state does not resurrect requests invalidated while
  inactive.

### Modal arbitration and existing modal controllers

Delete `shell-modals.tsx` after moving its controllers into focused modules. The
browser-actions, feature-request, and skill-selector cores each own their
visible state, request generations, in-flight flags, errors, and disposal.
Simple modal state remains a separate focused unit.

A small modal arbiter preserves the existing rule that opening one shell modal
closes conflicting modals first. Controllers register narrow close commands;
they do not import each other. A close command may veto switching while a
non-cancelable submission is in flight. The arbiter uses deterministic order,
stops on a veto, and never opens the requested modal after a failed close.

Browser actions own Diffity, detected-open, GitHub target, and host URL request
lifecycle. Feature requests own repository resolution and issue submission. Both
use injected side-channel command ports and their existing parsing and
error-report helpers.

### Terminal lifecycle

The terminal controller owns:

- the xterm handle exposed to the rendered WebView;
- terminal-ready and has-rendered state;
- current WebView instance/runtime identity;
- listener owner, listener ID, attached shell key, and first-attach buffering;
- the ordered shell writer, send failure handling, and writer replacement when
  the transport changes;
- attach, detach, load-start, initialized, retry, and output-write callbacks;
- resize deduplication, PTY resize calls, fit waiters, and related timers;
- system-keyboard and selection-mode commands that directly target xterm;
- runtime invalidation and final disposal.

Listener removal always uses the recorded listener owner, not whichever shell is
currently rendered. A terminal reload detaches the old listener, clears waiters
and runtime identity, and creates a new runtime generation before a new listener
can attach.

The controller exposes a narrow terminal transport/view port used by rendering
and by scrollback. It does not own scrollback policy or keyboard intent.

### Scrollback

The scrollback controller composes the existing scrollback executor, batch
accumulator, local-exit tracking, cleanup barrier, event adapters, and live
input planner. It owns:

- local active/phase state and the current runtime ID;
- remote copy-mode activity and generation;
- enter-request generation and acknowledgement;
- bounded local-exit request IDs;
- batch accumulation and serialized Workmux commands;
- reset, jump-to-live, entry, batch, local mode-change, and cleanup commands;
- disposal rollback when remote copy mode has been acknowledged.

Its public input command is the only user-originated terminal-write path:

```text
keyboard or modal intent
  -> scrollback live-input command
  -> ordered terminal/shell transport
```

When scrollback is active, input waits behind the current cleanup barrier. The
controller exits app-owned remote copy mode and clears local/WebView state
before forwarding payload segments. If safe cleanup cannot be guaranteed, it
fails closed and does not inject user text into copy mode.

### Keyboard, focus, and navigation commands

The keyboard controller owns:

- active/preferred keyboard selection and keyboard rotation;
- keyboard-switch flash state and view props;
- modifier state and modifier-aware byte/text encoding;
- system-keyboard and selection-mode user intent, delegated to the terminal view
  port;
- command step timeouts, presets, macros, clipboard, and text-entry payloads;
- slot intent dispatch and the keyboard action context;
- serialized Workmux navigation commands and stale-command invalidation;
- Workmux status cycling and its failure presentation;
- runtime shell-config reload and Codex restart request state reached through
  keyboard action slots.

It receives modal-opening commands, terminal UI commands, and the scrollback
live-input command as injected ports. It does not open modal state directly or
bypass scrollback for shell input. Existing pure keyboard action and runtime
helpers remain the source of command mapping behavior.

### Notifications

The notification controller owns:

- authorized route-token consumption and restoration on routing failure;
- the handled-route identity;
- visible connection, channel, and tmux-target observation;
- acknowledgement request generation and stale completion suppression;
- bridge acknowledgement and native cancellation orchestration;
- invalidation on activity, transport, target, and disposal boundaries.

Notification acknowledgement is best effort and cannot affect terminal or
keyboard availability. Workmux status cycling is explicitly not part of this
controller; it remains a user command in the keyboard controller.

## Data and Lifecycle Flow

### User input

Keyboard buttons, WebView/system-keyboard input, clipboard paste, text-entry
paste, commander actions, presets, and macros all enter through keyboard
controller adapters and use the scrollback controller's live-input command. This
keeps modifier and selection-mode behavior in the keyboard domain while giving
every user-input source the same history-mode guard. The scrollback controller
sequences any required exit and then forwards the segments through the ordered
shell transport. Caller-specific semantics remain unchanged, including which
actions append Enter.

### Terminal reset

WebView initialization creates a new terminal runtime identity. The terminal
controller publishes that identity through its returned port. The scrollback
controller observes it and resets stale acknowledgements, local-exit IDs, remote
copy-mode state, batches, and local UI state. Resize and listener callbacks
ignore events for older runtime identities.

### Modal commands

Keyboard action intent invokes typed modal commands. The modal arbiter first
closes conflicting controllers. If no controller vetoes, it invokes the target
controller's open command. Async modal requests capture their current source and
request generation before awaiting remote work.

### Notifications

The notification controller combines the current activity snapshot with the
visible target identity. Only a focused, app-active view of the matching
connection/channel/target may acknowledge an alert. Any identity transition
invalidates the previous acknowledgement before the next one begins.

## Error and Cleanup Semantics

Expected controller command outcomes are typed:

- `completed` for successful current work;
- `superseded` for work invalidated by a newer request or lifecycle boundary;
- `unavailable` when a required current dependency is absent;
- a domain-specific failure for current work that could not complete.

`superseded` is silent. A stale completion cannot update state, show an alert,
clear a newer in-flight flag, acknowledge a newer request, or send a follow-up
command.

User-facing failure ownership remains local:

- browser and feature-request failures stay in modal state or use the existing
  browser-action reporting path;
- keyboard and status-command failures use the existing Workmux presentation;
- scrollback failures clear unsafe local state, and live input fails closed when
  cleanup is not safe;
- terminal attach, listener, resize, and fit failures retain current logging and
  retry/navigation behavior;
- notification failures are logged and do not interrupt the shell.

Cleanup advances the relevant generation before resetting visible state. It
clears timers, waiters, pending batches, bounded request-ID sets, and listeners;
settles queued work as superseded; and is safe to call repeatedly. Notification
route tokens retain the existing consume/restore rules when routing fails.

## Testing Strategy

Use the existing `tsx --test` integration runner. Controller cores receive fake
clocks, transports, native/bridge calls, loggers, and state listeners as
dependencies, so tests do not render `detail.tsx` or require a device.

Every runtime-heavy controller covers:

- normal commands and state transitions;
- replacement of the identity key it owns;
- focus or AppState invalidation where relevant;
- stale completion after each awaited boundary;
- repeated `invalidate` and `dispose` calls;
- domain-specific failure presentation and cleanup;
- protection against an older request clearing or mutating newer state.

Retain and extend the existing browser, feature-request, keyboard, scrollback,
notification, terminal-listener, and fit/resize suites. Add a focused source or
composition contract test in each PR that proves `detail.tsx` imports the new
controller and no longer declares the extracted legacy refs, effects, or
constructors. These tests are narrow architectural guards, not a substitute for
behavior tests.

Each PR runs mobile formatting, lint, typecheck, and its affected integration
suites. The final PR runs the full mobile integration suite. Manual Android
preview checks cover:

- terminal first attach, WebView reload, reconnect, rotation, and PTY resize;
- system keyboard, configured keyboard input, modifiers, macros, and presets;
- scrollback entry, batching, jump-to-live, cleanup, and live input;
- browser actions, Diffity, detected open, host URL editing, and feature
  requests;
- Workmux navigation and status cycling;
- notification routing and acknowledgement for the visible target.

## Staged Delivery

### PR 1: Modal controllers

- Split `shell-modals.tsx` into focused controller modules.
- Add the modal arbiter and preserve close-veto behavior.
- Tighten public APIs and remove the old combined file in the same PR.
- Add controller-core lifecycle tests and preserve existing modal suites.

This is the lowest-risk extraction and establishes the core/hook convention.

### PR 2: Activity and notifications

- Centralize navigation-focus and AppState observation.
- Extract route consumption, visible-target acknowledgement, invalidation, and
  notification cleanup.
- Keep status cycling in keyboard code until PR 5.

This establishes shared lifecycle inputs without changing terminal ownership.

### PR 3: Terminal lifecycle

- Extract xterm readiness/runtime identity, listener attach/detach, output
  delivery, reload, retry, resize, fit waiters, and disposal.
- Expose narrow ports for rendering and downstream scrollback composition.
- Preserve shell buffering and platform keyboard behavior.

This creates the terminal boundary required by the scrollback extraction.

### PR 4: Scrollback

- Compose existing scrollback helpers behind one controller.
- Move all local/remote state, generations, accumulators, cleanup barriers,
  handlers, and disposal out of `detail.tsx`.
- Make its live-input command the only shell input port used by user actions.

This is the most lifecycle-sensitive extraction and builds on the terminal
runtime port from PR 3.

### PR 5: Keyboard commands and final coordinator audit

- Extract keyboard selection, modifiers, command steps, slot dispatch, Workmux
  navigation, focus commands, status cycling, runtime config reload, and Codex
  restart orchestration.
- Inject modal, terminal UI, and scrollback input ports.
- Remove residual duplicated workflow refs/effects from `detail.tsx`.
- Verify the responsibility boundary and the 1,400-1,800 soft line target.
- Record issue #6 as closed and issue #130 as the remaining Wispr extraction.

No PR may leave a temporary compatibility controller, duplicate state owner, or
partially migrated command path for a later PR to clean up.

## Acceptance Criteria Mapping

- **Materially less shell workflow logic:** all named domains move behind
  controllers; `detail.tsx` is expected to finish around 1,400-1,800 lines.
- **Clear controller interfaces:** every domain documents identity inputs, view
  state, commands, typed outcomes, invalidation, and disposal.
- **Behavior compatibility:** current UI, route, native, Workmux, xterm, and
  terminal-input semantics remain unchanged.
- **Local controller tests:** dependency-injected cores cover lifecycle and
  error edges without rendering the full shell screen.
- **Issue #6 relationship:** issue #6 is already closed for its extraction
  scope; issue #83 owns the remaining behavior-controller work.
- **Wispr scope:** issue #130 tracks the explicitly excluded Wispr session
  controller.
