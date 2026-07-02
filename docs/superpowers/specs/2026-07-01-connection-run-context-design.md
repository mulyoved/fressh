# Connection Run Context Design

## Goal

Centralize cancellation ownership for connection runs so auto-connect,
reconnect, and manual connection diagnostics stop reimplementing abort,
timeout, stale-result, and late-cleanup behavior at each layer.

The current behavior works, but cancellation is spread through:

- `AutoConnectManager`
- `createAutoConnectReconnectController`
- `attemptAutoConnectSource`
- `attemptSavedEntryWithTailscaleRecovery`
- `connectAndOpenShell`
- `runDiagnosticShellProbe`
- SSH connect and shell lifecycle helpers

This design introduces one shared run context for the connection attempt while
leaving caller policy in the existing domain modules.

## Scope

In scope:

- Auto-connect cancellation and stale-result handling.
- Reconnect stop/replacement aborting in-flight attempts.
- Manual connection diagnostic timeout actively aborting SSH work.
- Saved-entry Tailscale readiness, first connect, recovery, and retry under one
  run context.
- Active-connection shell reopen using the shared context.
- SSH connect, shell start, and diagnostic cleanup receiving derived operation
  signals.
- Internal typed aborted outcomes.
- Stable public result shapes for manual diagnostics and auto-connect callers.

Out of scope:

- New user-facing diagnostic result statuses.
- Rewriting reconnect backoff policy.
- Rewriting Tailscale recovery policy.
- UI changes.
- Persistent trace storage changes.
- Changing command-menu behavior beyond better cancellation.

## Architecture

Add a focused module:

- `apps/mobile/src/lib/connection-run-context.ts`

The module owns cancellation mechanics:

- caller `AbortSignal`
- timeout/deadline abort signal
- current/stale run checks
- derived operation signals for connect, shell, and cleanup work
- typed cancellation reasons
- late-result suppression helpers
- cleanup timer disposal
- error classification for abort-like failures

It does not own domain policy:

- reconnect backoff stays in `auto-connect-reconnect-controller.ts`
- Tailscale readiness and recovery decisions stay in
  `auto-connect-saved-entry.ts`
- trace vocabulary stays in the diagnostics modules
- UI state, foreground-service state, and navigation stay in
  `AutoConnectManager`
- manual diagnostic prompt formatting stays in
  `connection-diagnostic-runner.ts`

The context answers "is this run still allowed to affect state?" Lower layers
can return a typed aborted outcome, but callers still decide whether that means
stop reconnecting, fail a manual diagnostic, preserve attention state, or skip a
late result.

## Core API

Expected exports:

```ts
type ConnectionRunAbortReason =
	| 'timeout'
	| 'caller-aborted'
	| 'replaced'
	| 'stopped'
	| 'stale-run'
	| 'unmounted';

type ConnectionRunOperationKind = 'connect' | 'shell' | 'cleanup';

type ConnectionRunOperationResult<T> =
	| { status: 'ok'; value: T }
	| { status: 'aborted'; reason: ConnectionRunAbortReason };

type ConnectionRunContext = {
	readonly id: string;
	readonly signal: AbortSignal;
	readonly deadlineMs: number | null;

	isCurrent(): boolean;
	throwIfAborted(): void;
	classifyError(error: unknown): 'aborted' | 'failed';
	createOperationSignal(kind: ConnectionRunOperationKind): AbortSignal;
	runOperation<T>(
		kind: ConnectionRunOperationKind,
		operation: (signal: AbortSignal) => Promise<T>,
	): Promise<ConnectionRunOperationResult<T>>;
	abort(reason: ConnectionRunAbortReason): void;
	finish(): void;
};

function createConnectionRunContext(options: {
	id?: string;
	timeoutMs?: number;
	cleanupTimeoutMs?: number;
	callerSignal?: AbortSignal;
	isCurrent?: () => boolean;
	now?: () => number;
	setTimeout?: (callback: () => void, delayMs: number) => unknown;
	clearTimeout?: (timer: unknown) => void;
}): ConnectionRunContext;
```

The concrete implementation can adjust names while preserving the contract:
context ownership of cancellation, derived signals, stale checks, and internal
aborted outcomes.

`cleanupTimeoutMs` bounds cleanup work separately from the main run timeout. If
the main run times out, connect and shell operation signals abort immediately.
Cleanup operations may still run, but only within the cleanup timeout. This
keeps manual diagnostic cleanup observable without letting cleanup replace the
timeout result or hang the runner.

## Data Flow

Auto-connect creates one context at the outer `attemptAutoConnect` boundary.
That context is passed through `attemptAutoConnectSource`.

Latest-shell selection uses the context only for stale checks before navigation
or attention cleanup. Active-connection shell reopen uses a shell operation
signal from the context instead of constructing its own timeout signal.

Saved-entry connection uses the same context for:

1. Tailscale readiness.
2. First SSH connect and shell start.
3. Tailscale recovery after a network-like failure.
4. Retry connect and shell start.

`connectAndOpenShell`, `connectAndRememberConnection`,
`connectWithoutRemembering`, and `runSshShellLifecycle` receive either the
context or operation signals derived from it. They stop creating local timeout
signals when a context is supplied.

Manual diagnostics create one context in the manual runner with the manual
diagnostic timeout. The timeout actively aborts underlying SSH connect and shell
work. `runDiagnosticShellProbe` uses the same saved-entry context through
readiness, connect, recovery, and retry. Cleanup after a successful or partially
successful diagnostic probe still runs, but it uses a bounded cleanup signal
owned by the context.

## Public Outcomes

Cancellation is a first-class internal outcome, not a new public status.

Lower layers should return typed internal results where practical:

- `connected`
- `tmux_attach_failed`
- `failed`
- `aborted`

Manual diagnostic public results stay:

- `connected`
- `failed`
- `skipped`
- `busy`

Auto-connect public behavior stays boolean-like at the existing boundaries.
Reconnect still owns whether a failed or aborted attempt schedules another
retry, stops the loop, or is ignored as stale.

Manual diagnostic timeout maps to a failed diagnostic result with explicit
timeout/cancellation trace information.

## Error Handling

Abort reasons are explicit:

- `timeout`
- `caller-aborted`
- `replaced`
- `stopped`
- `stale-run`
- `unmounted`

Rules:

- `AbortError`, context abort errors, and timeout-triggered aborts are
  classified by the context.
- Unexpected SSH, shell, Tailscale, and cleanup failures remain failures.
- Late successful results from stale or aborted contexts must not navigate,
  clear Tailscale attention, mark Tailscale attention, finish a newer trace, set
  reconnect state, or schedule reconnect retries.
- Trace sink failures remain best-effort and must not change connection
  behavior.
- If Tailscale recovery is in progress when the context aborts, the saved-entry
  attempt returns `aborted`; the caller decides whether to preserve or clear
  attention state.
- If diagnostic cleanup fails after an aborted or timed-out manual run, the
  trace records cleanup failure, but the user-facing result remains the timeout
  or canceled diagnostic failure.

## Contract Changes

Replace `abortSignalTimeoutMs` through the auto-connect/manual path with the run
context.

`abortSignalTimeoutMs` may remain only for standalone calls that create their
own context internally or for unrelated utilities not participating in
connection runs.

Expected contract updates:

- `attemptAutoConnectSource` accepts `runContext`.
- `attemptSavedEntryWithTailscaleRecovery` accepts `runContext` and returns an
  aborted outcome for readiness, connect, recovery, or retry aborts.
- `connectAndOpenShell` accepts `runContext`.
- `runDiagnosticShellProbe` accepts `runContext`.
- `runSshShellLifecycle` accepts operation signals or `runContext`.
- `connectAndRememberConnection` and `connectWithoutRemembering` accept a
  connect signal instead of creating their own timeout signal.
- active-connection `startShell` receives a shell operation signal from the
  context.
- reconnect controller `stop()` and `replace()` abort the active attempt, while
  keeping timer-loop generation checks for controller ownership.

## Testing

Add focused tests for the new context:

- timeout aborts the context and child operation signals
- caller abort propagates into operation signals
- `abort('stopped')` suppresses late successful operation results
- cleanup operation receives its own bounded signal
- `finish()` clears timers and prevents late timeout aborts
- `classifyError()` recognizes native/web abort errors and context abort errors

Add auto-connect and reconnect coverage:

- reconnect `stop()` aborts an in-flight auto-connect attempt
- replaced reconnect loop aborts the old attempt and lets the new one continue
- stale successful connect cannot navigate or clear Tailscale attention
- active-connection shell reopen uses the run context signal
- saved-entry readiness, connect, recovery, and retry return `aborted` when the
  run aborts

Add manual diagnostic coverage:

- manual timeout actively aborts the underlying connect and shell probe
- timeout releases single-flight state
- stale late success cannot finish the trace as connected
- diagnostic cleanup still runs with a bounded cleanup signal when possible
- cleanup failure after timeout is traced but does not replace the timeout
  result
- public result statuses remain `connected`, `failed`, `skipped`, and `busy`

Keep regression coverage for:

- successful auto-connect
- Tailscale attention behavior
- tmux attach failure behavior
- manual diagnostic prompt redaction

## Migration Order

1. Add `connection-run-context.ts` and focused unit tests.
2. Thread the context into manual diagnostics first, because timeout must now
   actively abort underlying SSH work.
3. Update `runDiagnosticShellProbe` and SSH lifecycle helpers to consume
   context-derived connect, shell, and cleanup signals.
4. Thread the context into `connectAndOpenShell` and saved-entry auto-connect.
5. Update active-connection shell reopen to use the context signal.
6. Teach `attemptSavedEntryWithTailscaleRecovery` to return aborted outcomes
   across readiness, connect, recovery, and retry.
7. Update reconnect controller ownership so stop and replace abort the active
   attempt while retaining generation checks for timers.
8. Remove now-redundant local timeout signal creation in the migrated path.
9. Run focused integration tests, mobile typecheck, formatting, and lint.

## Success Criteria

- Auto-connect, reconnect, and manual diagnostic cancellation mechanics are
  owned by one context abstraction.
- Manual diagnostic timeout aborts SSH work instead of only racing the public
  result.
- Reconnect stop and replacement abort in-flight work, not only ignore stale
  completion.
- Lower layers return typed aborted outcomes where practical.
- User-facing result contracts remain stable.
- Late stale successes cannot mutate navigation, attention, traces, or
  reconnect state.
- Existing connection, Tailscale, tmux attach failure, and prompt redaction
  behavior remains covered.
