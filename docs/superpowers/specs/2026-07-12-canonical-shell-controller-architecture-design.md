# Canonical Shell-Controller Architecture Design

## Context

The shell-controller directory currently contains 60 files and about 11,485
lines. The controllers do not share one understandable public shape. A simple
domain may have a hook, adapter, core, lifecycle helper, facade, and modal-props
builder, while a complex domain may spread one protocol across many
`coordinator`, `support`, and `hook-runtime` files.

The decomposition improved lifecycle ownership, but it also made callers and
reviewers cross several thin layers to understand one action. Browser actions
are the clearest example: the public hook builds an adapter, core, facade, and
three modal-prop bundles. Keyboard and scrollback have the opposite problem:
large files remain, surrounded by helpers whose names describe their technical
position rather than the behavior they own.

This design chooses one public controller pattern. It works with the approved
shell runtime ownership design and the ShellDetail/Wispr plan. It does not
change user-visible behavior.

## Decisions

- Every shell domain exposes the same public handle shape:
  `{ state, commands, view }`.
- Every domain has one public React hook file and one public type-only contracts
  file.
- Other domains may import only those public contracts and the public hook or
  handle type. They may not import another domain's model, runtime, policy, or
  helper.
- Tests may import private pure units directly.
- Complex domains may split private logic by owned protocol. They do not have to
  use the same private file layout as simple domains.
- Private file names describe owned behavior, such as `input-runtime`,
  `route-runtime`, `cleanup-runtime`, `model`, or `policy`.
- Facades, field-forwarding adapters, modal-props layers, generic hook-runtime
  layers, and generic controller lifecycle wrappers disappear.
- Shared controller infrastructure remains deliberately small: controller
  outcomes, publisher/subscriber behavior, replay-safe disposal, and source
  identity types.
- Hooks perform no external mutation during render.
- No barrel file or combined shell-controller facade is added.

## Canonical Public Shape

Add the shared structural type to `controller-core.ts`:

```ts
export type ControllerHandle<State, Commands, View> = Readonly<{
	state: State;
	commands: Commands;
	view: View;
}>;
```

Each domain gives the three sections domain-specific names and contracts:

```ts
export type BrowserActionsControllerHandle = ControllerHandle<
	BrowserActionsState,
	BrowserActionsCommands,
	BrowserActionsView
>;
```

### State

`state` is a read-only snapshot for composition, status display, and
diagnostics. It contains domain facts, not mutable refs, raw native resources,
or callbacks. Discriminated unions represent meaningful phases; unrelated
booleans do not accumulate to simulate a state machine.

### Commands

`commands` contains stable user and domain intents. Async commands return
`ControllerOutcome`: `completed`, `superseded`, `unavailable`, or `failed` with
a typed domain failure. Commands may expose a focused capability port, such as
terminal transport or guarded scrollback input, when another domain needs that
capability.

A consumer receives only the capability interface it needs. It does not receive
the full sibling handle. For example, skill selection consumes a guarded text
input command, not the keyboard controller, and scrollback consumes a Workmux
scroll port, not the session controller.

### View

`view` contains render-ready, component-specific props. A domain with several
components groups them by component:

```ts
type BrowserActionsView = {
	browserModal: BrowserActionsModalProps;
	hostUrlModal: HostUrlModalProps;
	detectedOpenModal: DetectedOpenPickerModalProps;
};
```

The public hook derives these props directly from the snapshot and stable
commands. A private view selector is allowed only when it performs substantial
derivation that deserves direct tests. It is named for the view it builds, not
`facade` or `modal-props`.

## Public Files

Each domain has these public files:

```text
<domain>.tsx
<domain>-contracts.ts
```

`<domain>.tsx` exports the hook and handle type. It is the only React entry
point. `<domain>-contracts.ts` has type-only imports and exports the input
ports, state, commands, view, failures, and focused capability ports needed by
callers. It must remain safe for Node controller tests.

There is no `index.ts`. Callers import the exact domain file so dependency
direction stays visible.

## Private Files

Simple domains normally need one private model:

```text
feature-request.tsx
feature-request-contracts.ts
feature-request-model.ts
```

Complex domains add only the protocols they actually own:

```text
keyboard.tsx
keyboard-contracts.ts
keyboard-model.ts
keyboard-input-runtime.ts
keyboard-remote-runtime.ts
keyboard-action-runtime.ts
keyboard-policy.ts
```

Private units have one reason to change:

- `model` owns the snapshot and synchronous transitions;
- `runtime` owns an async protocol, queue, retry loop, timer set, or cleanup;
- `policy` is pure decision or transformation code;
- a platform file owns a native or React Native boundary.

Names such as `adapter`, `facade`, `support`, `coordinator`, and `hook-runtime`
are not architectural roles in the final system. Existing logic with real
behavior is renamed or merged into an owned protocol; forwarding-only logic is
deleted.

## Hook Lifecycle

Every public hook follows the same visible sequence:

1. Create the pure model and private runtimes once.
2. Read the model with `useSyncExternalStore`.
3. Commit changed input ports and identity in a layout effect.
4. Subscribe to external platform sources in passive effects.
5. Dispose the model and runtimes through replay-safe passive cleanup.
6. Return a memoized `{ state, commands, view }` handle.

The hook never assigns refs, publishes state, configures globals, or calls a
native/transport method during render. A layout commit advances identity before
new commands are admitted. Passive cleanup is idempotent.

The pure model exposes the existing common controller contract:

```ts
type ControllerCore<State> = {
	getSnapshot(): State;
	subscribe(listener: () => void): () => void;
	invalidate(reason: ControllerInvalidationReason): void;
	dispose(): void;
};
```

Each model adds its domain commands and an explicit `commit(input)` only when
its live ports can change without replacing the model. No generic adapter holds
"latest dependencies" on behalf of every domain.

## Identity and Async Work

Inputs identify the narrow lifetime a domain owns: session, target, terminal
runtime, activity generation, or modal request. A command captures that identity
and the exact capability ports it will use before its first await.

After every await, the runtime checks whether the capture is current. Stale work
returns `superseded` and cannot publish, show errors, navigate, acknowledge,
write input, or clean up a replacement resource. Missing current capability
returns `unavailable`. Only a current operation may return a domain failure.

The same unit creates, replaces, and disposes its resource. A sibling can
request cleanup through a typed command but cannot dispose the resource
directly.

## Domain-to-Domain Data Flow

```text
ShellDetail
  -> session/activity ports
  -> public domain hooks
  -> { state, commands, view }
  -> ShellScreenView

domain command
  -> injected focused capability port
  -> owning domain runtime
  -> typed ControllerOutcome
```

`ShellDetail` may select a state branch and pass one domain's focused command
port into another hook. It may not translate outcomes, sequence retries, build
queues, or coordinate cleanup.

## Existing Layers That Disappear

### Shared layers

- Delete `controller-lifecycle.ts`. Hooks perform their small commit and cleanup
  effects directly; replay-safe disposal remains in `controller-core.ts`.
- Delete `generation-request-gate.ts`. It has no production consumer. Domains
  that need admission own a named generation or queue inside their runtime.
- Keep `controller-core.ts` for the small common contract only:
  `ControllerHandle`, `ControllerCore`, `ControllerOutcome`,
  publisher/subscriber behavior, and replay-safe disposal.
- Keep `source-keys.ts` as the shared identity constructor module.

### Browser actions

- Delete `browser-actions-adapter.ts`.
- Delete `browser-actions-facade.ts`.
- Delete `browser-actions-modal-props.ts`.
- Keep one public `browser-actions.tsx`, one contracts file, and private model
  or request runtimes split from the current 631-line core.
- Build commands and the three view bundles in the public hook.

### Feature requests

- Delete `feature-request-adapter.ts`.
- Keep `feature-request.tsx`, a contracts file, and a focused model/runtime.
- Pass repository resolution, host command, modal arbitration, alert, and logger
  as typed ports directly to the model/runtime.

### Skill selector

- Delete `skill-selector-adapter.ts`.
- Keep `skill-selector.tsx`, a contracts file, and a focused model/runtime.
- Inject the host-project loader, modal arbitration, cache, and guarded text
  input ports directly.

### Keyboard

- Delete `keyboard-props.ts`; the hook builds its three view groups directly.
- Replace `keyboard-hook-contracts.ts` with the public `keyboard-contracts.ts`.
- Replace `keyboard-controller-adapter.ts` with a private
  `keyboard-action-runtime.ts`; retain its real action-routing behavior but
  remove the adapter role and ref-based publication.
- Split and absorb `keyboard-hook-runtime.ts` into the public hook and the
  private model/input/remote/action runtimes. No replacement file may inherit
  its 642-line mixed responsibility.
- Rename `keyboard-state-core.ts`, `keyboard-input-core.ts`, and
  `keyboard-remote-core.ts` to model/runtime names after their public types move
  to contracts.
- Rename or merge `keyboard-input-support.ts` and `keyboard-remote-support.ts`
  into focused policy/runtime files. Their real authority-copy and
  macro-planning logic remains tested; the generic `support` layer disappears.

### Scrollback

- Keep one public `scrollback.tsx` and one public contracts file.
- Replace the large `scrollback-core.ts` with a model plus three owned private
  protocols: remote-copy runtime, cleanup runtime, and guarded-input runtime.
- Merge the current entry, mode, batch, operation-owner, and failure
  coordinators into the remote-copy runtime.
- Merge cleanup, clear, callback-safety, and channel-teardown coordinators into
  the cleanup runtime.
- Keep pure scrollback policy as a policy file.
- Delete the old coordinator files after their behavior tests target the three
  final runtimes.

### Terminal

- Keep one public `terminal.tsx` and one public contracts file.
- Keep lifecycle, ordered transport, and size as separate private runtimes; each
  owns a real resource protocol.
- Fold or rename `terminal-hook-runtime.ts` into a focused terminal runtime. It
  must not remain an extra public-looking lifecycle layer.

### Notifications

- Keep `notifications-route-coordinator.ts` behavior as a private
  `notifications-route-runtime.ts`; it owns a real queued authorization
  protocol.
- Fold simple activity and pending-subscription setup from
  `notifications-lifecycle.ts` into the public hook.
- Keep automatic acknowledgement as model logic, not a separate lifecycle layer.

### Modals and activity

- Keep `modal-arbiter.ts`; it owns real modal exclusion policy.
- Modal controllers use the same `{ state, commands, view }` handle and stop
  exposing separate prop facades.
- Keep activity platform subscription and activity state as private owned units,
  but expose one canonical activity handle.
- Merge retained-domain bridges that only call sibling invalidation commands
  into the owning hook or replace them with focused command ports. Activity does
  not become a cross-domain workflow coordinator.

## Size and Shape Guardrails

- A public hook file should stay below 250 nonblank lines.
- A private model/runtime/policy should stay below 350 nonblank lines.
- A file over the guardrail requires a split by owned protocol, not by generic
  technical layer.
- One-field adapters, unchanged object spreads, callback renaming facades, and
  modules used only to move types between layers are forbidden.
- A domain may have fewer files than the canonical examples. Empty symmetry is
  not a goal.

The line limits are review triggers and source tests, not proof of good design.
Ownership, dependency direction, and meaningful interfaces remain the primary
checks.

## Error Handling

Expected command results use `ControllerOutcome`. `superseded` and `unavailable`
are normal control flow and do not alert. A current domain failure is mapped to
user copy by the owning domain. Logger, trace, clipboard, and alert failures
cannot change resource ownership or allow stale follow-up work.

Cleanup advances identity before clearing state. Cleanup and disposal are
idempotent, catch diagnostic failures, and never dispose a replacement resource.

## Testing

Behavior tests import private pure models and runtimes. They cover state
transitions, identity replacement, every awaited stale boundary, repeated
invalidation/disposal, resource cleanup, and current failure mapping with fake
ports and clocks.

Public contracts are checked through TypeScript and focused hook composition
tests. One architecture test scans the shell-controller directory and enforces:

- every public controller handle has exactly `state`, `commands`, and `view`;
- production domains do not import another domain's private file;
- deleted adapter/facade/modal-props/lifecycle files do not return;
- public hooks and private units stay within their line guardrails;
- `detail.tsx` does not reach into private controller files;
- behavioral tests no longer search `detail.tsx` for controller internals.

Source tests are limited to these architecture rules. They do not assert
implementation strings, callback order, or local variable names.

## Migration Order

1. Add `ControllerHandle` and the architecture test.
2. Convert a small domain, preferably skill selector, to prove the shape.
3. Convert feature request and browser actions; delete their explicit thin
   layers.
4. Convert terminal and notifications while preserving their real private
   runtimes.
5. Convert keyboard and scrollback by protocol, deleting old mixed and
   coordinator files only as their final runtime tests pass.
6. Convert modal and activity handles.
7. Remove the shared lifecycle wrapper and unused request gate.
8. Run a final import, file-shape, size, duplicate-code, and thermo-nuclear
   review.

Each domain conversion is one reviewable, test-first slice. A slice deletes its
old public shape and tests in the same change; there are no compatibility
aliases or dual public APIs.

## Acceptance Criteria

- Every shell domain exposes one `{ state, commands, view }` public handle.
- Every domain has one public hook file and one public type-only contracts file.
- Other domains import only public contracts and focused capability ports.
- Facade, forwarding adapter, modal-props, generic hook-runtime, generic
  lifecycle, and unused generation-gate layers are gone.
- Complex keyboard, scrollback, terminal, and notification protocols remain in
  focused private runtimes rather than being collapsed into giant hook files.
- No render-time external mutation or sibling ref access remains.
- Async commands use typed outcomes and stale-generation checks.
- Tests exercise behavior at the owning model/runtime and reserve source scans
  for architecture rules.
- File guardrails and dependency direction are enforced automatically.
- The resulting controller consolidation plan can name exact create, merge,
  rename, and delete steps without another architecture decision.
