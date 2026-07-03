# Connection Attempt Lifecycle Design

## Goal

Unify connection attempt lifecycle semantics behind one higher-level API so
normal connection feature code no longer composes timeout, abort, stale-run,
cleanup, Tailscale recovery, retry, shell, and tmux behavior by hand.

This design addresses Issue 118 and builds on the existing
`connection-run-context` design from July 1, 2026. The run context remains the
low-level primitive for async validity and signals. The new lifecycle API owns
the connection attempt contract.

Related issues:

- #112: centralize auto-connect cancellation ownership.
- #117: replace manual diagnostic soft timeout with active cancellation.
- #118: unify connection attempt lifecycle semantics.

## Scope

In scope:

- A higher-level connection attempt lifecycle API for saved-entry attempts.
- Shared lifecycle behavior for saved-entry auto-connect and manual diagnostics.
- Active-connection shell reopen under the same operation and cleanup model.
- Explicit timeout classes:
  - `operationTimeoutMs` for SSH connect, shell start, and active shell reopen.
  - `recoveryTimeoutMs` for Tailscale readiness, recovery, and retry caps.
  - `cleanupTimeoutMs` for shell close and SSH disconnect.
- Typed outcomes for success, tmux attach failure, blocked readiness, failure,
  abort, timeout, and cleanup failure.
- Late-success cleanup and stale-result suppression.
- Reconnect attempt deadlines expressed through a run context instead of a local
  `Promise.race`.
- Tests for caller abort, operation timeout, recovery timeout, native failure,
  tmux/shell failure, stale run, and late success cleanup.

Out of scope:

- UI redesign.
- New user-facing diagnostic statuses.
- Rewriting reconnect backoff policy.
- Rewriting Tailscale recovery policy.
- Changing the Rust SSH API.
- Persistent trace storage changes.
- Broad refactors outside the connection attempt path.

## Architecture

Use a two-layer model.

`apps/mobile/src/lib/connection-run-context.ts` owns mechanics:

- caller abort propagation
- explicit run abort reasons
- operation, recovery, and cleanup signals
- deadline timers and timer disposal
- stale-run checks
- late-result suppression
- abort and timeout error classification

`apps/mobile/src/lib/connection-attempt-lifecycle.ts` owns connection attempt
semantics:

- active-connection shell reopen
- saved-entry SSH connect and shell start
- saved-entry Tailscale readiness and recovery
- retry decision execution after recovery
- shell/tmux outcome classification
- late-success cleanup
- diagnostic cleanup policy hooks
- typed lifecycle outcomes

Callers keep caller policy:

- `AutoConnectManager` owns UI state, foreground-service state, navigation, and
  Tailscale attention state.
- `connection-diagnostic-runner.ts` owns manual diagnostic single-flight, trace
  finishing, public result mapping, and prompt formatting.
- `auto-connect-reconnect-controller.ts` owns reconnect backoff and retry-loop
  policy.
- diagnostic event modules own trace vocabulary.

The boundary should stay strict: the run context answers "is this async work
still valid and what signal should it use?" The lifecycle answers "what happened
during this connection attempt?" The caller answers "what should the app do with
that outcome?"

## Lifecycle API Shape

The exact implementation names may evolve, but the stable contract should look
like this:

```ts
type ConnectionAttemptMode = 'auto-connect' | 'manual-diagnostic';

type ConnectionAttemptTimeouts = {
	operationTimeoutMs: number;
	recoveryTimeoutMs: number;
	cleanupTimeoutMs: number;
};

type ConnectionAttemptOutcome =
	| {
			status: 'connected';
			connectionId: string;
			channelId: number;
			storedConnectionId?: string;
	  }
	| {
			status: 'tmuxAttachFailed';
			connectionId: string;
			tmuxAttachFailureReason: string | null;
			tmuxSessionName: string;
			storedConnectionId: string;
	  }
	| {
			status: 'blocked';
			attentionMessage: string | null;
	  }
	| {
			status: 'failed';
			error: unknown;
			recoverable: boolean;
	  }
	| {
			status: 'aborted';
			reason: ConnectionRunAbortReason;
	  }
	| {
			status: 'timedOut';
			timeoutKind: 'operation' | 'recovery' | 'cleanup';
	  }
	| {
			status: 'cleanupFailed';
			error: unknown;
			priorOutcome?: Exclude<
				ConnectionAttemptOutcome,
				{ status: 'cleanupFailed' }
			>;
	  };

type RunConnectionAttemptLifecycleArgs = {
	mode: ConnectionAttemptMode;
	runContext: ConnectionRunContext;
	timeouts: ConnectionAttemptTimeouts;
	recovery: SavedEntryTailscaleRecovery;
	target: ConnectionAttemptTarget;
	trace?: ConnectionAttemptTrace;
};
```

The implementation should avoid a single oversized options object if the final
code reads better with focused entry points such as
`runSavedEntryConnectionAttempt()` and `runActiveShellReopenAttempt()`. What
must remain stable is the ownership boundary and typed outcome contract.

## Data Flow

Latest-shell selection stays outside the lifecycle. It is not a connection
attempt; it selects an already-open shell. The caller still uses the run context
to suppress stale navigation and attention changes.

Active-connection shell reopen uses the lifecycle with an operation signal for
`startShell()` and a cleanup signal for late-success close. It returns
`connected`, `tmuxAttachFailed`, `failed`, `aborted`, or `timedOut`.

Saved-entry connection uses one lifecycle for:

1. Tailscale readiness.
2. First SSH connect and shell start.
3. Tailscale recovery after a recoverable network-like failure.
4. Retry connect and shell start when recovery says retry is valid.
5. Shell/tmux classification.
6. Late-success cleanup when the run becomes stale or aborted.

Manual diagnostics use the same saved-entry lifecycle with diagnostic-mode
dependencies:

- no navigation
- no active store registration
- strict cleanup after probe success
- cleanup failure maps to diagnostic failure
- public diagnostic result statuses remain `connected`, `failed`, `skipped`, and
  `busy`

Reconnect passes a run context whose deadline is bounded by the remaining
reconnect window. The reconnect controller keeps its loop generation and backoff
rules, but it stops wrapping attempts in its own timeout `Promise.race`.

## Error Handling

Timeouts and aborts must be explicit.

Timeout kinds:

- `operation`: SSH connect, shell start, active shell reopen.
- `recovery`: Tailscale readiness, recovery, and retry cap.
- `cleanup`: shell close, SSH disconnect, diagnostic cleanup.

Abort reasons:

- `caller-aborted`
- `replaced`
- `stopped`
- `stale-run`
- `timeout`
- `unmounted`

Rules:

- Native SSH errors remain failures unless the run context classifies them as
  abort-like.
- Tmux attach failure is not a generic failure. It carries metadata for manual
  connection navigation and diagnostic reporting.
- Late successful results after abort or staleness must not navigate, clear
  Tailscale attention, mark Tailscale attention, finish a newer trace, set
  reconnect state, or schedule reconnect retries.
- Late successful SSH connections or shells must be cleaned up with
  `cleanupTimeoutMs`.
- Manual diagnostic cleanup failure is a real diagnostic failure and should
  produce `cleanupFailed`.
- Auto-connect cleanup failure is logged and traced but should not replace a
  prior abort, timeout, or stale outcome.
- Tailscale attention messages are returned in outcomes. Caller adapters decide
  whether to show, clear, or preserve attention UI.
- Trace sink failures remain best-effort and must not change connection
  behavior.

## Contract Changes

Expected call-site changes:

- `attemptAutoConnectSource` receives a lifecycle or run context instead of a
  plain `abortSignal`.
- saved-entry auto-connect calls the lifecycle for saved-entry attempts instead
  of calling `attemptSavedEntryWithTailscaleRecovery` directly.
- manual diagnostics call the lifecycle instead of wrapping the entire attempt
  in a soft timeout `Promise.race`.
- active-connection shell reopen uses lifecycle operation and cleanup signals.
- `connectAndOpenShell`, `runDiagnosticShellProbe`, and `runSshShellLifecycle`
  accept lifecycle-provided operation signals or a run context and stop creating
  normal attempt timeout signals themselves.
- `connectAndRememberConnection` and `connectWithoutRemembering` accept an
  explicit connect signal for lifecycle-managed calls.
- reconnect stop and replace abort the active run context with explicit reasons.

Lower-level helpers can remain for standalone manual connect and tests, but
normal auto-connect and diagnostic feature code should use the lifecycle API.

## Migration Plan

Implement in layers:

1. Add or finish `ConnectionRunContext`.
2. Add `ConnectionAttemptLifecycle` with injected dependencies and focused
   tests.
3. Move manual diagnostics to the lifecycle first because the current soft
   timeout leaves underlying work running.
4. Move saved-entry auto-connect to the lifecycle.
5. Move active-connection shell reopen to the lifecycle.
6. Replace reconnect attempt timeout `Promise.race` with a run context deadline.
7. Narrow or close #112 and #117 based on the migrated behavior.
8. Keep low-level helpers private by default, or document them as explicit
   escape hatches.

This order keeps behavior observable at each step and avoids mixing lifecycle
ownership with unrelated UI or diagnostic prompt changes.

## Testing

Add focused `connection-run-context` coverage:

- caller abort propagates into operation signals
- operation timeout aborts active operations
- recovery timeout is separate from operation timeout
- cleanup timeout is separate and usable after operation abort
- stale run suppresses late success
- `finish()` clears timers
- abort and native errors classify consistently

Add `connection-attempt-lifecycle` coverage:

- saved-entry success
- caller abort
- operation timeout
- recovery timeout
- native SSH failure
- shell failure
- tmux attach failure
- Tailscale blocked readiness
- Tailscale recovery retry success
- Tailscale retry failure
- stale run late success cleanup
- diagnostic cleanup failure

Add caller integration coverage:

- auto-connect uses the lifecycle for active shell reopen and saved-entry
  connect
- manual diagnostics no longer use soft timeout behavior
- reconnect no longer wraps attempts in its own timeout race
- navigation, attention, and trace side effects do not happen after stale or
  aborted outcomes
- existing public result shapes remain stable

Verification target:

- targeted integration tests for changed connection modules
- `pnpm --filter @fressh/mobile typecheck`
- Prettier on touched files
- broader mobile test slice if lifecycle changes cross several modules

## Success Criteria

- Saved-entry auto-connect and manual diagnostics use the same lifecycle model
  where appropriate.
- Normal connection attempt callers no longer hand-roll timeout or cancellation
  races.
- Timeout names distinguish operation, recovery, and cleanup deadlines.
- Stale runs and late successes are handled consistently.
- Tailscale recovery and retry decisions are represented by typed lifecycle
  outcomes, not caller-specific ad hoc state.
- #112 and #117 can be closed or narrowed to concrete follow-up subtasks.
