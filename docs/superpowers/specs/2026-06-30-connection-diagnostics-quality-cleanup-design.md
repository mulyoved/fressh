# Connection Diagnostics Quality Cleanup Design

## Goal

Restructure the connection diagnostics implementation so it keeps the current
user-visible behavior while removing avoidable indirection, generic event
handling, broad redaction machinery, and ShellDetail orchestration growth.

The cleanup is intentionally structural. It should make the diagnostics code
feel direct: producers emit typed events, the recorder stores typed events, and
the prompt formatter renders known event shapes without guessing.

## Scope

In scope:

- Replace stringly typed diagnostic events with typed event constructors and a
  discriminated event union.
- Reduce redaction to personal-use diagnostics requirements:
  - never include private key material
  - stringify errors safely
  - do not crash on circular or unserializable values
- Split Tailscale retry policy from UI/logging/trace side effects.
- Replace manual diagnostic module-global state with an isolated runner factory.
- Extract ShellDetail's debug-command wiring into a focused hook.
- Keep the existing command behavior:
  - `Debug connection in Codex` probes the latest auto-connect saved entry
  - a fresh trace is recorded for the diagnostic attempt
  - the Codex prompt is pasted into an active shell when available
  - clipboard fallback remains available

Out of scope:

- Changing the command label or command-menu placement.
- Changing the SSH/Rust connection APIs.
- Adding persistent trace storage beyond the current in-memory recorder.
- Reintroducing broad multi-user redaction guarantees.

## Architecture

Create a smaller diagnostics core with explicit contracts.

### Typed Events

Add `connection-diagnostic-events.ts` as the canonical event API. It should
export:

- a `ConnectionDiagnosticEvent` discriminated union
- small event constructors grouped by domain, for example:
  - `diagnosticEvents.savedEntrySelected(...)`
  - `diagnosticEvents.keyResolved(...)`
  - `diagnosticEvents.sshConnectStarted(...)`
  - `diagnosticEvents.tailscaleRecoveryResult(...)`
  - `diagnosticEvents.manualDiagnosticTimeout(...)`

Normal production code should not emit
`{ type: string, details: Record<string, unknown> }`. The event constructor is
the boundary that decides the event shape.

### Recorder

`connection-diagnostic-recorder.ts` should record typed events and add timing
metadata. It should not infer event shape or sanitize arbitrary event blobs in
the main path.

It may keep a small defensive clone/stringify helper for crash safety, but that
helper should not be the center of the event model.

### Prompt Formatter

`connection-diagnostic-prompt.ts` should switch on `event.kind` and format known
events directly. The prompt format may improve as part of this cleanup. It
should be organized around:

- header and app state
- selected connection
- timeline
- failure summary
- private-key-omitted footer

Unknown or malformed trace handling should be an internal fallback for old
stored traces or direct test injection, not the normal design.

### Redaction

`connection-diagnostic-redaction.ts` should shrink substantially.

Keep:

- private-key omission by construction
- safe error stringification
- circular/unserializable crash protection where still needed

Remove:

- broad secret-term regex filtering
- generic object-key redaction
- deep arbitrary object traversal as a normal event path

This is acceptable because these diagnostics are for personal use and the
runtime should never place private key material into event payloads.

## Connection Orchestration Boundaries

### Tailscale Retry

Split `attemptSavedEntryWithTailscaleRecovery` into a pure retry/recovery flow
and caller adapters.

The pure flow should return structured outcomes such as:

- `blocked`
- `connected`
- `tmuxAttachFailed`
- `retryFailed`
- `threw`

It should not require UI callbacks like `markTailscaleAttention` or
`clearTailscaleAttention`. Auto-connect and manual diagnostics can map the
outcome to UI attention, logs, and diagnostic events in their own layer.

### SSH Lifecycle

Keep `runSshShellLifecycle` as the shared SSH lifecycle. Replace ad hoc
diagnostic event construction with a typed lifecycle observer when possible.

The lifecycle should still support:

- remembered connections for normal saved-entry connect
- unremembered, unregistered diagnostic probes
- tmux attach failure results
- strict diagnostic cleanup failures

### Manual Diagnostic Runner

Replace module-global manual diagnostic state with
`createManualConnectionDiagnosticRunner()`.

The production command can use a singleton runner, but tests should create
isolated runner instances. The runner owns:

- single-flight state
- active trace handle
- timeout handling
- current-run token checks

Trace event failures remain non-fatal through one shared safe-emitter helper.

### ShellDetail Hook

Extract ShellDetail's debug command wiring into a hook, for example
`useConnectionDebugCommand`.

`ShellDetail` should only provide shell/UI dependencies:

- current shell availability
- raw terminal paste function
- clipboard writer
- alert function
- command-menu close function

The hook should own app-state snapshotting, saved connection loading, private
key resolution, diagnostic runner invocation, and prompt delivery wiring.

## Data Flow

1. A connection path starts a trace with `{ trigger, reason }`.
2. Producers emit typed events through `diagnosticEvents.*` constructors.
3. The recorder timestamps and stores the typed events.
4. The prompt formatter renders the typed timeline.
5. Manual diagnostic and auto-connect share lower-level SSH lifecycle events,
   but keep caller-specific wrapper events separate.

Manual diagnostic should not pretend to be an auto-connect caller. It can reuse
the pure Tailscale retry policy and SSH lifecycle without adapting itself into
auto-connect-shaped UI callbacks.

## Error Handling

- Manual diagnostic remains best-effort: trace failures do not block a prompt.
- Timeouts emit a typed timeout event and release runner state.
- Diagnostic shell cleanup remains strict: if a successful probe cannot
  disconnect, the diagnostic attempt reports cleanup failure.
- Tailscale retry failures are represented by structured outcomes, then mapped
  by callers to UI/log/trace behavior.
- Error serialization is safe and crash-resistant, but it does not attempt broad
  secret detection.

## Testing

Rewrite the diagnostic tests around typed contracts instead of generic sanitizer
survival.

Targeted test groups:

- recorder behavior
- event builders and typed event contracts
- prompt formatting
- minimal error serialization and crash safety
- auto-connect traces
- reconnect traces
- manual diagnostic single-flight and timeout
- diagnostic shell probe cleanup
- command delivery paste/copy fallback
- ShellDetail hook wiring
- Tailscale retry policy without UI callbacks

Regression checks should assert:

- normal diagnostic events do not use generic `details: Record<string, unknown>`
- broad secret-term redaction is removed
- private key material is still never included
- manual diagnostics use isolated runner instances in tests
- ShellDetail no longer owns debug-command orchestration inline

Verification for implementation:

- Prettier on changed files
- scoped ESLint with `--max-warnings 0`
- full changed diagnostic integration test set
- `pnpm --filter @fressh/mobile typecheck`

## Rollout Strategy

Implement in behavior-preserving slices:

1. Introduce typed events and migrate recorder/prompt tests.
2. Replace generic redaction/normalization with the smaller personal-use safety
   layer.
3. Split Tailscale retry policy from caller side effects.
4. Convert manual diagnostics to a runner factory.
5. Extract the ShellDetail command hook.
6. Delete obsolete generic tests and helpers after equivalent typed coverage is
   in place.

Each slice should keep the command working and keep diagnostics prompt output
useful. Prompt wording may change, but the prompt must still contain app state,
connection identity, event timeline, failure evidence, and the private-key
omission footer.
