# Shell Runtime Ownership Design

## Context

`apps/mobile/src/app/shell/detail.tsx` is still the implicit owner whenever a
shell responsibility has no better home. It is 2,012 lines and directly handles
route parsing, shell lookup, missing-session navigation, tmux configuration,
Workmux channel construction, diagnostic wiring, controller composition, and
most Wispr automation.

The existing terminal, scrollback, keyboard, activity, notification, and modal
controllers are useful boundaries. The remaining problem is above and between
them: session lifetime is implicit, some cross-controller dependencies are
shared refs, and `ShellDetail` still supplies workflow and cleanup logic.

This design replaces that fallback ownership with layered lifetime owners. It
supersedes the parts of the July 10 focused-controller design that left route
selection, Workmux construction, diagnostics, and Wispr inside `ShellDetail`.
Breaking internal and public TypeScript APIs is allowed. No compatibility facade
or duplicate ownership period is required.

## Decisions

- Use layered lifetime owners rather than one large `ShellRuntime` facade.
- Parse route input through one pure, typed boundary.
- Give the screen session one controller keyed by connection and channel.
- Leave the actual SSH connection and shell lifetime with the connection store.
- Make the session controller own tmux configuration, the Workmux channel,
  diagnostic context, and missing-session navigation decisions.
- Keep terminal, scrollback, keyboard, and Wispr as separate runtime owners.
- Keep Wispr alive for the whole shell screen session, not only while its modal
  is visible.
- Pass capabilities through typed ports. Controllers do not import another
  controller or access another controller's refs.
- Make scrollback the only user-originated input gate before terminal transport.
- Render invalid route input as a small recoverable error screen with a Back
  action instead of throwing.
- Make the same owner create, replace, and dispose each resource.

## Goals

- Make every shell runtime responsibility have one named owner.
- Make connection, target, WebView, focus, and screen-unmount boundaries
  explicit and independently testable.
- Ensure Workmux disposal cannot race scrollback cleanup.
- Move all Wispr timers, request IDs, native calls, and state transitions out of
  `ShellDetail`.
- Reduce `ShellDetail` to controller construction, narrow port wiring, and view
  composition.
- Preserve the existing visible behavior except for the approved invalid-route
  error screen.

## Non-goals

- Do not move ownership of live SSH connections or shells out of the connection
  store.
- Do not merge the existing focused controllers into one facade.
- Do not add a global event bus or a new state-management dependency.
- Do not redesign the terminal, keyboard, modal, or Wispr user interface.
- Do not keep old hook signatures as compatibility wrappers.
- Do not use source-file size alone as proof of a clean boundary.

## Ownership Overview

```text
raw route params
  -> parseShellRoute
      -> invalid: ShellRouteErrorView
      -> valid: ShellRouteRequest
          -> ShellSessionController
              -> session snapshot and scoped ports
                  -> TerminalController
                  -> ScrollbackController
                  -> KeyboardController
                  -> WisprController
                  -> existing focused modal/notification controllers
                      -> ShellDetail composition
                          -> ShellScreenView rendering
```

The dependency direction is downward. A domain controller consumes session or
domain ports; it never imports a sibling controller. `ShellDetail` may connect a
returned port to another controller input, but it may not implement ordering,
retry, invalidation, or cleanup protocols while doing so.

## Route Boundary

Add a pure parser with a discriminated result:

```ts
type ShellRouteResult =
	| { status: 'valid'; request: ShellRouteRequest }
	| { status: 'invalid'; error: ShellRouteError };

type ShellRouteRequest = {
	connectionId: string;
	channelId: number;
	storedConnectionId?: string;
	agentRoute?: AgentNotificationRoute;
	tmuxAttach?: TmuxAttachRoute;
};
```

The parser trims optional text, rejects absent connection IDs and invalid
channel IDs, and normalizes agent-notification and tmux-attach inputs. It does
not read stores, navigate, log, or construct controller identities.

`ShellDetail` calls the parser once per route-parameter snapshot. Invalid input
renders a recoverable route error view with a Back action. A valid request is
the only route shape accepted by the session controller and notification
controller.

## Shell Session Controller

`useShellSessionController()` is the owner of the screen's view of a shell
session. Its identity is `ShellTransportKey`, derived from the validated
connection ID and channel ID.

It owns:

- connection and shell observation for the current transport key;
- the screen session generation and invalidation state;
- stored-connection resolution;
- effective tmux enablement and target configuration;
- one Workmux control channel for the current connection and target;
- one session-scoped typed diagnostic port;
- reconnect-aware missing-session decisions;
- the navigation commands used by those decisions;
- Workmux shutdown registration and bounded disposal ordering.

It does not own:

- creation or destruction of the live SSH connection or shell;
- terminal WebView state or shell listener attachment;
- scrollback state;
- keyboard state or user input encoding;
- Wispr state;
- modal visibility.

The connection store remains the actual SSH resource owner. Leaving the shell
screen releases the screen session and all view-specific resources, but it does
not disconnect or delete the stored shell. Reconnect and connection teardown
remain store-level responsibilities.

The controller exposes a discriminated snapshot instead of nullable values:

```ts
type ShellSessionSnapshot =
	| { status: 'waiting'; reason: 'auto-connect' | 'reconnect' }
	| { status: 'attach-error'; error: TmuxAttachError }
	| { status: 'ready'; session: ReadyShellSession }
	| { status: 'leaving' };
```

`ReadyShellSession` contains stable typed ports for the current generation. It
does not expose mutable refs or the raw Workmux channel object.

When a shell is temporarily absent during auto-connect or reconnect, the
controller stays in `waiting`. When absence becomes definitive, the controller
owns the current navigation policy: return to the host editor after the
corresponding reconnect outcome, or navigate back when the connection is gone.
The router itself is an injected port so the decision is testable without Expo.

## Session Ports

The session publishes capabilities rather than implementation objects:

```ts
type ShellSessionPorts = {
	terminalSource: ShellTerminalSourcePort;
	workmux: ShellWorkmuxPort;
	diagnostics: ShellDiagnosticPort;
	activity: ShellActivityPort;
};
```

The terminal source port exposes the current shell operations required by the
terminal controller. The Workmux port exposes semantic command and scroll
operations, the current target identity, and shutdown registration. The
diagnostic port accepts typed events and provides the current trace context. The
existing activity controller still owns focus and AppState subscriptions; its
port is included in the session context without exposing React state.

Ports capture their session generation. Calls through an obsolete port return a
typed `superseded` or `unavailable` outcome and cannot act on the replacement
session.

## Workmux Ownership and Shutdown

The session controller creates and disposes the Workmux control channel. A tmux
target change invalidates the old target generation and replaces the channel,
matching the existing persistent-channel contract.

Scrollback must exit app-owned remote copy mode before that channel disappears.
React effect cleanup order is not used to guarantee this. The Workmux port
provides a generic, bounded before-dispose registration:

```ts
type WorkmuxShutdownRegistration = {
	registerBeforeDispose(
		owner: string,
		cleanup: (port: RetiringWorkmuxCleanupPort) => Promise<void>,
	): () => void;
};
```

The scrollback controller registers its cleanup while it owns remote copy mode.
`RetiringWorkmuxCleanupPort` permits only the bounded exit operation needed to
restore remote state. It cannot start new navigation, focus, browser, or scroll
work.

On target replacement or session disposal, the session owner performs this
order:

1. Stop accepting new Workmux operations for the old generation.
2. Run registered cleanup through the restricted retiring port while the old
   channel is still usable.
3. Wait for cleanup up to the existing bounded timeout.
4. Record cleanup failure through the diagnostic port.
5. Dispose the old Workmux channel exactly once.

The registration API is infrastructure, not knowledge of scrollback. Other
controllers cannot dispose or retain the raw channel.

## Domain Controllers

### Terminal

The terminal controller owns the WebView runtime identity, terminal handle,
shell listener, first-attach buffering, output delivery, ordered writes, resize,
fit waiters, terminal UI commands, and final listener cleanup.

It consumes `ShellTerminalSourcePort` and exposes separate view and transport
ports. A connection or channel change replaces its transport source. A WebView
reload replaces only `TerminalRuntimeKey` and invalidates runtime-scoped work.

### Scrollback

The scrollback controller owns local and remote copy-mode state, batching,
cleanup barriers, local-exit IDs, acknowledgements, and safe live-input
sequencing. It consumes terminal view/transport ports and the session Workmux
port.

Its live-input command is the only user-originated write path. It exits copy
mode safely before forwarding input. If cleanup cannot be guaranteed, it fails
closed and does not write user text into copy mode.

### Keyboard

The keyboard controller owns keyboard authority, active keyboard selection,
modifiers, encoded input, macros, presets, command sequencing, and semantic
Workmux navigation or focus intents. It consumes modal commands, terminal UI
commands, the Workmux command port, and the scrollback live-input command.

It never receives the raw shell writer, raw Workmux channel, or another
controller's ref. Runtime replacement is delivered through a typed input update
or generation change.

### Wispr

Add a session-scoped Wispr controller. It owns automation enablement,
availability, reducer state, all request and attempt IDs, retry and fallback
timers, pending auto-close requests, native tap calls, deferred starts, and
unmount cleanup.

It consumes a small native automation port, activity, and typed text-entry modal
commands. It exposes view state and commands such as `setAutoStart`,
`onTextEntryFocus`, `onTextChanged`, `openEditor`, and `closeTextEntry`. Modal
components never manipulate automation refs.

The controller remains alive for the full shell screen session so close-after-
start and native cleanup have one owner even when the text-entry modal closes.
It resets on session replacement and disposes all pending native work on screen
unmount.

### Diagnostics

The session controller owns creation of the diagnostic context because it is
keyed by the same connection and channel identity as the session. The context
contains the current typed trace sink, safe logging metadata, and generation.

Domain controllers emit typed diagnostic events through `ShellDiagnosticPort`.
They do not reach into the auto-connect store or hold a mutable trace ref. The
existing manual debug command remains a focused controller or hook that consumes
the session diagnostic port and current shell dependencies; it does not move
back into `ShellDetail`.

## ShellDetail Boundary

`ShellDetail` may:

- read route parameters and call the pure parser;
- construct the session and domain controller hooks;
- connect narrow returned ports to narrow controller inputs;
- choose a view from discriminated controller snapshots;
- render screen components, modals, and error boundaries.

`ShellDetail` may not:

- own timers, request IDs, generations, mutable workflow refs, or queues;
- call native Wispr, SSH, Workmux, or terminal methods directly;
- decide retry, stale-completion, or cleanup behavior;
- build ad hoc diagnostic events or read the active trace directly;
- reproduce a controller workflow in callback composition.

Move pure view code into `ShellScreenView` and focused error or loading
components where that keeps the composition root readable. The final
`ShellDetail` component should stay below 300 lines and the route file below 650
nonblank lines. These are guardrails, not substitutes for the responsibility
rules above.

## Identity and Invalidation

| Boundary                         | Replaced owner or state                                                  | Preserved state                                                  |
| -------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Route connection/channel changes | Entire screen session and every child runtime                            | Connection-store resources not explicitly removed by their owner |
| Connection object replacement    | Session generation, Workmux channel, transport-dependent work            | Valid route request and view preferences                         |
| Tmux target changes              | Target generation, Workmux channel, target-scoped controller work        | SSH shell and terminal listener for the same transport           |
| WebView reload                   | Terminal runtime, scrollback acknowledgements, keyboard runtime bindings | Screen session and Workmux channel                               |
| Focus or AppState loss           | Activity-sensitive async generations                                     | SSH shell and terminal transport unless their own source changes |
| Text-entry modal closes          | Visible text-entry state                                                 | Wispr controller until pending cleanup settles                   |
| Screen unmount                   | All screen-session and child-controller resources                        | Live SSH resources owned by the connection store                 |

Invalidation advances the affected generation before cleanup begins. A stale
completion cannot update state, display an error, navigate, acknowledge a newer
request, or dispose a replacement resource. Cleanup and disposal are idempotent.

## Data Flows

All user input follows one path:

```text
keyboard, paste, macro, commander, or text-entry intent
  -> keyboard/input adapter
  -> scrollback live-input gate
  -> terminal ordered transport
  -> SSH shell writer
```

Workmux commands use semantic intent:

```text
keyboard, notification, browser, or scrollback intent
  -> typed Workmux session port
  -> current Workmux control channel
  -> mdev bridge or optimized scroll transport
```

Diagnostics stay observational:

```text
session or domain event
  -> typed diagnostic port
  -> current trace and logger
```

A diagnostic failure never changes terminal, keyboard, or navigation behavior.

## Error Handling

Expected commands return typed outcomes: `completed`, `superseded`,
`unavailable`, or a domain-specific current failure. `superseded` is silent.

Route parsing failures render the route error view. Session absence follows the
reconnect-aware navigation policy. Terminal, scrollback, keyboard, modal, and
Wispr errors remain owned by their domain controllers. Workmux shutdown errors
are recorded, the bounded timeout still guarantees channel disposal, and a
cleanup failure cannot dispose a replacement channel.

## Testing

Use dependency-injected TypeScript cores with fake stores, clocks, ports, native
calls, and routers. Tests do not need to render the full shell screen.

Required coverage includes:

- route parsing and recoverable invalid-route rendering;
- session waiting, ready, attach-error, and leaving transitions;
- missing connection and reconnect navigation decisions;
- connection, target, runtime, activity, and unmount invalidation;
- Workmux cleanup-before-dispose ordering, timeout, repeated disposal, and
  replacement safety;
- connection-store ownership of the live shell after screen unmount;
- terminal listener and ordered transport replacement;
- scrollback as the only user-input gate;
- keyboard commands using typed ports rather than raw channel or shell access;
- Wispr retry, timeout, pending close, stale native completion, modal close, and
  unmount cleanup;
- diagnostic generation changes and best-effort failure behavior;
- source contracts that prohibit workflow refs, direct native/SSH/Workmux calls,
  and inline diagnostic construction in `ShellDetail`;
- the component and file size guardrails.

## Migration Shape

Implement the design in dependency order without compatibility wrappers:

1. Add the typed route parser, route error view, and session identity contracts.
2. Add the session core and hook around existing store behavior.
3. Move Workmux construction, diagnostic context, and missing-session navigation
   into the session owner.
4. Replace raw Workmux and shell dependencies with session ports.
5. Extract the session-scoped Wispr controller.
6. Remove shared controller refs by publishing typed runtime updates and input
   ports.
7. Reduce `ShellDetail` to composition and pure rendering.
8. Delete obsolete helpers and old signatures in the same slices that replace
   them.

Each slice uses test-driven changes and preserves a working shell route. The
later implementation plan should split the work into reviewable tasks with
explicit verification commands and no period of dual resource ownership.

## Acceptance Criteria

- Route parsing has one pure typed entry point and invalid routes do not throw.
- The screen session has one explicit owner keyed by connection and channel.
- The connection store remains the only owner of live SSH resource lifetime.
- Workmux has one creator and disposer, with bounded registered cleanup before
  disposal.
- Terminal, scrollback, keyboard, and Wispr have separate explicit owners.
- Scrollback is the only user-originated shell-input gate.
- Diagnostics use a session-scoped typed port.
- Controllers communicate only through typed ports and generations.
- `ShellDetail` contains no workflow timers, request IDs, native/SSH/Workmux
  calls, cleanup protocols, or diagnostic event construction.
- The `ShellDetail` component is below 300 lines and its route file is below 650
  nonblank lines.
- Focused lifecycle and source-boundary tests enforce the model.
