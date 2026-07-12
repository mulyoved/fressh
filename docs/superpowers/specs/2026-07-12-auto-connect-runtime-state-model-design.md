# Auto-Connect Runtime State Model Design

## Goal

Move automatic connection orchestration out of React into one explicit,
event-driven runtime. The runtime owns initial auto-connect, resume, shell-drop
reconnect, retry timing, foreground-service coverage, launch URL policy,
automatic Tailscale recovery, diagnostic trace lifetime, cancellation, and
navigation intents.

React becomes a thin platform adapter. It reports app, link, route, shell, and
connection changes to the runtime. It performs versioned navigation intents and
acknowledges them.

## Approved Product Decisions

- The runtime owns automatic flows only. Manual connections and manual
  diagnostics keep using shared lower-level connection helpers.
- Only one automatic connection run may exist at a time.
- Reconnect replaces an initial or resume auto-connect run.
- Duplicate initial and resume requests are merged.
- Tailscale Retry and Reset are higher priority than automatic work. They cancel
  the current run, perform the user action, then start one fresh reconnect.
- Missing Android foreground-service coverage does not cancel background work.
  The runtime records the failure, continues while the OS permits it, and
  reconciles immediately on resume.
- The special disable-auto-connect launch URL cancels automatic work and blocks
  later automatic attempts until the app runtime is recreated.
- Runtime state is temporary. It is never restored as an in-progress phase after
  an app restart.
- Navigation is a versioned intent. React executes and acknowledges it. Stale
  intents and acknowledgements are ignored.
- One diagnostic trace covers one logical initial or reconnect cycle, including
  retries, Tailscale work, cancellation, and final navigation.
- A missing or disabled auto-connect target is a normal skip. Every real
  connection failure publishes a host-page navigation intent.

## Current Problem

`apps/mobile/src/lib/auto-connect.tsx` is a 776-line React component. It owns
many overlapping mutable references and effects:

- active attempt and settlement promises;
- reconnect controller and reconnect context;
- app active/background status;
- current and previous shell/connection snapshots;
- foreground-service requests, retries, and background allowance;
- launch URL suppression;
- diagnostic trace lifetime;
- Tailscale recovery actions and attention state;
- navigation callbacks; and
- notification-bridge preservation policy.

The lower-level connection, Tailscale, cancellation, diagnostics, and
foreground-service modules already contain useful policy. The problem is the
top-level ownership: React effects observe partial state at different times and
coordinate through refs. The intended state machine exists only implicitly.

## Scope

In scope:

- cold-start and warm-resume auto-connect;
- shell-drop and resume reconnect;
- one active automatic run and its cancellation;
- reconnect retry window and backoff;
- Android foreground-service coverage and retry;
- app foreground/background observation;
- cold and warm launch URLs;
- automatic and user-requested Tailscale recovery actions;
- automatic diagnostic trace ownership;
- classified outcomes and navigation intents;
- Tailscale attention and public auto-connect state projections; and
- notification-bridge reconnect expectation projection.

Out of scope:

- manual host-form connection orchestration;
- manual connection diagnostic orchestration and prompt formatting;
- SSH, shell, tmux, Tailscale, or foreground-service native implementation;
- persistent recovery of an in-progress runtime after process death;
- a new state-machine dependency;
- user-interface redesign; and
- stored connection or key format changes.

## Chosen Approach

Use a pure reducer plus a small effect runner.

```ts
type AutoConnectTransition = Readonly<{
	state: AutoConnectRuntimeState;
	effects: readonly AutoConnectEffect[];
}>;

function reduceAutoConnectRuntime(
	state: AutoConnectRuntimeState,
	event: AutoConnectEvent,
): AutoConnectTransition;
```

The reducer is synchronous and deterministic. It does not import React, Expo
Router, React Native, Zustand, SSH, Tailscale, timers, or diagnostic sinks.

The runtime owns the current reducer state, executes effects through typed
ports, and turns effect results back into events. The runtime serializes event
processing so one effect completion cannot observe a half-applied transition.

No XState or other state-machine library is required. The state and event unions
are small enough to remain explicit in TypeScript.

## Runtime State

```ts
type AppVisibility = 'active' | 'background';

type ForegroundCoverage =
	| { status: 'not-required' }
	| { status: 'stopped' }
	| {
			status: 'starting';
			requestId: number;
			key: string;
			failedAttempts: number;
	  }
	| { status: 'covered'; key: string }
	| {
			status: 'unavailable';
			key: string;
			failedAttempts: number;
			retryDueAtMs: number | null;
	  };

type LaunchPolicy = 'enabled' | 'disabled-until-restart';

type AutoConnectCycleKind = 'initial' | 'reconnect';

type AutoConnectCycleTrigger =
	| 'cold-launch'
	| 'resume'
	| 'shell-drop'
	| 'resume-no-shell'
	| 'user-tailscale-retry'
	| 'user-tailscale-reset';

type AutoConnectRunPhase =
	| 'preparing'
	| 'connecting'
	| 'tailscale-recovery'
	| 'tailscale-reset';

type AutoConnectIntent = Readonly<{
	kind: AutoConnectCycleKind;
	trigger: AutoConnectCycleTrigger;
	reconnectContext: AutoConnectReconnectContext | null;
}>;

type AutoConnectWork =
	| { status: 'idle' }
	| {
			status: 'running';
			cycleId: number;
			runId: number;
			traceId: string;
			intent: AutoConnectIntent;
			phase: AutoConnectRunPhase;
			attemptIndex: number;
			startedAtMs: number;
	  }
	| {
			status: 'waiting-retry';
			cycleId: number;
			traceId: string;
			intent: AutoConnectIntent;
			attemptIndex: number;
			startedAtMs: number;
			retryDueAtMs: number;
	  }
	| {
			status: 'cancelling';
			cycleId: number;
			runId: number;
			traceId: string;
			intent: AutoConnectIntent;
			reason: AutoConnectCancelReason;
			replacement: AutoConnectIntent | null;
	  };

type AutoConnectNavigationIntent = Readonly<{
	id: number;
	cycleId: number;
	destination: 'terminal' | 'hostPage';
	connectionId?: string;
	channelId?: number;
	failure?: AutoConnectFailure;
}>;

type AutoConnectRuntimeState = Readonly<{
	status: 'running' | 'disposed';
	environment: AutoConnectEnvironment;
	launchPolicy: LaunchPolicy;
	foregroundCoverage: ForegroundCoverage;
	work: AutoConnectWork;
	navigation: AutoConnectNavigationIntent | null;
	lastOutcome: AutoConnectFinalOutcome | null;
	nextCycleId: number;
	nextRunId: number;
	nextNavigationId: number;
}>;
```

The state contains only immutable, serializable observations and identifiers. It
does not contain promises, callbacks, controllers, AbortSignals, timer handles,
router objects, store actions, SSH objects, or trace handles.

## Environment Snapshot

The React/platform adapter reports a compact environment snapshot:

```ts
type AutoConnectEnvironment = Readonly<{
	platformOS: string;
	appVisibility: AppVisibility;
	pathname: string;
	shells: readonly AutoConnectShellSnapshot[];
	connections: readonly AutoConnectConnectionSnapshot[];
	foregroundServiceStarted: boolean;
}>;
```

Shell and connection snapshots contain only stable IDs, timestamps, stored
connection identity, and fields required to create a reconnect context. They do
not copy live SSH methods into reducer state. The attempt port reads the current
live stores when a start effect executes.

Every environment update replaces the complete observed snapshot. This avoids
separate shell-count, previous-shell, previous-connection, and pathname refs.
The reducer compares the previous and next snapshots to detect shell drop and
preserve the dropped identity.

## Events

```ts
type AutoConnectEvent =
	| {
			type: 'runtime.started';
			environment: AutoConnectEnvironment;
			initialUrl: string | null;
	  }
	| { type: 'runtime.disposed' }
	| { type: 'environment.changed'; environment: AutoConnectEnvironment }
	| { type: 'launch-url.received'; url: string | null }
	| { type: 'initial.requested'; trigger: 'cold-launch' | 'resume' }
	| { type: 'reconnect.requested'; intent: AutoConnectIntent }
	| { type: 'tailscale.open.requested' }
	| { type: 'tailscale.retry.requested' }
	| { type: 'tailscale.reset.requested' }
	| {
			type: 'run.phase-changed';
			cycleId: number;
			runId: number;
			phase: AutoConnectRunPhase;
	  }
	| {
			type: 'run.completed';
			cycleId: number;
			runId: number;
			outcome: AutoConnectAttemptOutcome;
	  }
	| { type: 'run.cancelled'; cycleId: number; runId: number }
	| { type: 'clock.fired'; nowMs: number }
	| {
			type: 'foreground.start-completed';
			requestId: number;
			key: string;
			started: boolean;
	  }
	| { type: 'foreground.stop-completed'; requestId: number }
	| {
			type: 'tailscale.reset-completed';
			cycleId: number;
			runId: number;
			outcome: TailscaleResetOutcome;
	  }
	| { type: 'navigation.acknowledged'; intentId: number }
	| {
			type: 'effect.failed';
			ownerId: number;
			effect: AutoConnectEffectKind;
			error: unknown;
	  };
```

Every asynchronous run event carries both `cycleId` and `runId`. The reducer
accepts it only when both identify the current work. Results from aborted,
replaced, disposed, or older runs are ignored.

## Effects

```ts
type AutoConnectEffect =
	| {
			type: 'run.start';
			cycleId: number;
			runId: number;
			intent: AutoConnectIntent;
	  }
	| {
			type: 'run.abort';
			cycleId: number;
			runId: number;
			reason: AutoConnectCancelReason;
	  }
	| { type: 'clock.schedule'; dueAtMs: number }
	| { type: 'clock.cancel' }
	| {
			type: 'foreground.start';
			requestId: number;
			key: string;
			title: string;
			message: string;
	  }
	| { type: 'foreground.stop'; requestId: number }
	| { type: 'tailscale.open' }
	| { type: 'tailscale.reset'; cycleId: number; runId: number }
	| { type: 'attention.clear'; cycleId: number }
	| { type: 'attention.mark'; cycleId: number; message: string }
	| {
			type: 'trace.start';
			cycleId: number;
			traceId: string;
			intent: AutoConnectIntent;
	  }
	| {
			type: 'trace.event';
			cycleId: number;
			traceId: string;
			event: ConnectionDiagnosticEvent;
	  }
	| {
			type: 'trace.finish';
			cycleId: number;
			traceId: string;
			status: 'connected' | 'failed' | 'skipped';
	  }
	| { type: 'navigation.publish'; intent: AutoConnectNavigationIntent }
	| { type: 'state.publish' };
```

Effects describe work; they do not mutate reducer state. The effect runner owns
live AbortControllers, the one native clock timer, foreground-service request
promises, trace handles, and platform calls.

## Single-Flight and Replacement

Only `work.status === 'running'` owns an asynchronous automatic operation. The
operation is normally a connection run. During user-requested Tailscale Reset,
it is the reset action that must finish before the fresh connection run starts.

When higher-priority work arrives during a run:

1. The reducer changes `work` to `cancelling`.
2. It stores the replacement intent.
3. It emits `run.abort` for the current `runId`.
4. It waits for `run.cancelled` or the current `run.completed` cancellation
   outcome.
5. It starts the replacement with a new cycle and run identity.

The replacement never overlaps the cancelled run. A late success from the old
run cannot navigate, clear attention, finish the new trace, or schedule retry.
If a native Tailscale Reset cannot be physically aborted, cancellation waits for
that reset promise to settle, ignores its result, and only then starts the
replacement. This keeps Retry, Reset, and connection work single-flight.

Duplicate initial and resume requests are ignored while equivalent or
higher-priority work exists. Duplicate reconnect requests for the same dropped
identity are merged. A newer shell-drop identity replaces the older reconnect.

## Priority Order

From highest to lowest:

1. `runtime.disposed` or a disable-auto-connect launch URL;
2. user Tailscale Reset;
3. user Tailscale Retry;
4. shell-drop reconnect;
5. resume-no-shell reconnect;
6. normal resume auto-connect; and
7. cold-launch auto-connect.

Opening the Tailscale app is not a connection cycle. It emits `tailscale.open`
without replacing current work.

## Launch URL Policy

`getAutoConnectLaunchActionForUrl()` remains the pure parser.

When a launch URL disables auto-connect:

- set `launchPolicy` to `disabled-until-restart`;
- cancel active or waiting automatic work;
- clear any automatic replacement intent;
- publish a host-page navigation intent; and
- ignore later initial, resume, shell-drop, Retry, and Reset requests for this
  runtime instance.

The disabled policy is not persisted. A newly created runtime starts enabled and
evaluates its own initial URL.

Normal and malformed URLs do not alter policy.

## App Lifecycle and Best-Effort Background Work

App backgrounding does not cancel an active automatic run.

On Android, foreground-service coverage is desired whenever a live shell or an
automatic cycle exists. The runtime requests service start/update and records
one of `starting`, `covered`, or `unavailable`.

Foreground start and stop requests use increasing request IDs. A completion
changes coverage only when its request ID is current. This prevents a late stop
from clearing newer coverage or a late start from restoring obsolete coverage.

If service start fails:

- record the failure in the current trace;
- retain the automatic run or retry wait;
- retry service start with the existing 5-second delay and five-attempt budget
  while coverage remains desired; and
- do not claim background execution is guaranteed.

On iOS, there is no foreground-service effect. Work remains logically active
while the process runs, but the OS may suspend JavaScript and timers.

On every transition back to active, the adapter sends a complete environment
snapshot. The reducer then:

- accepts completed shell state if a late platform result already produced it;
- starts reconnect when a previously visible shell disappeared;
- starts normal resume auto-connect when no reconnect context exists; or
- leaves the current run alone when it is still current.

The reducer never infers elapsed time from timer callback counts. It compares
the injected `nowMs` with absolute deadlines, so delayed background timers
reconcile correctly on resume.

## One Clock Timer

Reconnect backoff and foreground-service retry can have separate deadlines in
state, but the effect runner owns only one native timer. After each transition,
the reducer schedules the earliest pending deadline.

`clock.fired` includes the current time. The reducer handles every deadline now
due, calculates the next deadline, and emits at most one new `clock.schedule`.
This prevents independent React timer refs and makes delayed background wakeups
deterministic.

## Initial Auto-Connect and Reconnect

Initial auto-connect uses the existing source policy:

1. reuse the latest active shell;
2. reopen from the latest active connection when valid; and
3. try the latest eligible saved key-based entry.

No eligible saved target, disabled auto-connect, or no target is `skipped`.
Those outcomes do not navigate.

Reconnect keeps the existing tmux durability rule. It uses the dropped stored
connection identity where available, replaces suspect SSH transport, runs
Tailscale readiness/recovery, reconnects through the saved entry, and reattaches
tmux.

The current reconnect delays remain 500 ms, 1 second, 2 seconds, 5 seconds, and
10 seconds, capped at 10 seconds, within a 2-minute reconnect window. Retryable
outcomes enter `waiting-retry`. A non-retryable failure or exhausted window
finishes the cycle.

## Tailscale Actions

Automatic Tailscale readiness and recovery remain lower-level attempt policy.
They report phase and classified results to the runtime.

User actions behave as follows:

- Open: call the native open action; do not replace work.
- Retry: cancel automatic work and start a fresh reconnect cycle with trigger
  `user-tailscale-retry`.
- Reset: cancel automatic work, create a fresh reconnect cycle in
  `tailscale-reset`, perform reset, then start the connection attempt if reset
  completes. Reset failure finishes as a classified host-page failure.

Only the current cycle may clear or mark Tailscale attention. Stale results are
ignored by cycle identity.

## Outcomes

```ts
type AutoConnectFinalOutcome =
	| { status: 'skipped'; reason: AutoConnectSkipReason }
	| { status: 'connected'; connectionId: string; channelId: number }
	| { status: 'failed'; failure: AutoConnectFailure }
	| { status: 'cancelled'; reason: AutoConnectCancelReason };

type AutoConnectFailure = Readonly<{
	kind:
		| 'network'
		| 'authentication'
		| 'timeout'
		| 'tmux-attach'
		| 'cleanup'
		| 'tailscale-needs-attention'
		| 'tailscale-reset'
		| 'unexpected';
	message: string;
}>;
```

Messages are redacted and safe for UI display.

Outcome rules:

- `skipped`: finish the trace as skipped; no navigation.
- `connected`: clear current automatic attention, finish the trace as connected,
  and publish a terminal intent.
- `failed`: mark attention when classified as Tailscale-related, finish the
  trace as failed, and publish a host-page intent.
- `cancelled` with replacement: finish the old trace as skipped, then start the
  replacement.
- `cancelled` without replacement: finish the trace as skipped and become idle.

Every real initial or reconnect failure goes to the host page. This
intentionally changes the current silent initial-failure behavior.

## Navigation Intents

The runtime never imports Expo Router.

On a terminal or host-page outcome, the reducer allocates a monotonically
increasing navigation ID, stores the intent, and emits `navigation.publish`. The
React adapter performs `router.replace()` and dispatches
`navigation.acknowledged`.

An acknowledgement clears navigation only when its ID matches the current
intent. A stale acknowledgement cannot clear a newer intent. A newer outcome
replaces any older unacknowledged intent.

Navigation execution failure leaves the intent pending and records a diagnostic
event. A later adapter reconciliation can try the current intent again. The
navigation callback cannot change the connection outcome.

## Diagnostics

Each cycle receives one `traceId` when created. The same trace covers:

- intent and environment at start;
- source selection;
- every reconnect attempt and deadline;
- foreground-service coverage changes;
- Tailscale readiness, recovery, Retry, or Reset;
- cancellation and replacement;
- classified final outcome; and
- navigation publication and acknowledgement.

Trace handles live only in the effect runner. The reducer stores the trace ID.
Trace sink and logging failures are caught and reported best-effort; they never
dispatch a connection failure or alter retry policy.

Manual diagnostics continue creating their own connection run context and trace.
They reuse lower-level connection and recovery modules but do not enter this
runtime state.

## Runtime Ports

```ts
type AutoConnectRuntimePorts = Readonly<{
	now: () => number;
	clock: {
		schedule: (dueAtMs: number, callback: () => void) => unknown;
		cancel: (handle: unknown) => void;
	};
	attempt: {
		start: (input: AutoConnectAttemptInput) => AutoConnectActiveRun;
	};
	foregroundService: {
		start: (input: { title: string; message: string }) => Promise<boolean>;
		stop: () => Promise<void>;
	};
	tailscale: {
		open: () => Promise<void>;
		reset: () => Promise<TailscaleResetOutcome>;
	};
	attention: {
		clear: () => void;
		mark: (message: string) => void;
		recovering: (message: string) => void;
	};
	diagnostics: AutoConnectDiagnosticPort;
	logger: AutoConnectLoggerPort;
}>;

type AutoConnectActiveRun = Readonly<{
	abort: (reason: AutoConnectCancelReason) => void;
	result: Promise<AutoConnectAttemptOutcome>;
}>;
```

The attempt port adapts the existing `createConnectionRunContext`,
`attemptAutoConnectSource`, saved-entry reconnect, SSH store, and secrets
manager. The reducer does not absorb those lower-level algorithms.

## React Adapter

`AutoConnectManager` becomes a small component that:

- creates or receives one runtime instance;
- sends the initial environment and URL;
- subscribes to Linking, AppState, route, shell, connection, and
  foreground-service observations;
- sends complete environment updates;
- reads the current navigation intent;
- executes `router.replace()` and acknowledges it;
- projects runtime state to the existing public stores and notification bridge;
  and
- disposes subscriptions and the runtime on unmount.

It must not own connection attempts, AbortControllers, retry timers, foreground
service retry counts, reconnect context cycles, launch suppression, diagnostic
trace handles, Tailscale coordination, previous shell snapshots, or stale-result
guards.

One React ref containing the runtime instance is acceptable. Mutable workflow
state inside React is not.

## Public Projections

Existing consumers can keep a small Zustand projection during migration:

- `isAutoConnecting` is true for initial running/cancelling work;
- `isReconnecting` is true for reconnect running, waiting, or cancelling work;
- active trace is projected from the current cycle;
- last reconnect failure is projected from the final outcome; and
- notification bridge preservation is derived from current environment and
  reconnect work.

These stores are read models, not command owners. Store setters used by the
current manager are removed after migration.

## Error Handling

- Expected connection outcomes are data, not thrown control flow.
- Unexpected attempt rejection maps to `failed/unexpected` only when its cycle
  and run IDs are current.
- Abort-like errors map to `cancelled` or a retry outcome according to current
  ownership.
- Foreground-service failure updates coverage and diagnostics only.
- Tailscale open failure records diagnostics and leaves current work unchanged.
- Tailscale reset failure completes the user-reset cycle as failed.
- Trace and logger failures are swallowed after best-effort reporting.
- Navigation failure leaves the current intent pending.
- Runtime disposal aborts the current run, cancels the clock, stops the Android
  foreground service, finishes the current trace as skipped, and ignores every
  later completion.

## Testing Strategy

### Reducer tests

Use transition tables for:

- cold start, normal URL, disable URL, and malformed URL;
- initial request, duplicate request, skip, success, and every failure class;
- shell drop and reconnect context capture;
- reconnect backoff and 2-minute deadline;
- priority replacement and cancellation acknowledgement;
- background, missing coverage, delayed clock, and resume reconciliation;
- foreground-service success, failure, retry, and no-longer-required state;
- Tailscale Open, Retry, Reset success, and Reset failure;
- navigation replacement and stale acknowledgement; and
- disposal and late async events.

### Invariants

Assert after every transition:

- at most one connection run is owned;
- at most one native clock schedule effect is current;
- one cycle owns one trace ID;
- running/cancelling work has valid cycle and run IDs;
- waiting work has one absolute retry deadline;
- disabled launch policy cannot start automatic work;
- disposed state cannot emit new connection work;
- only current IDs can change outcome, attention, trace, or navigation; and
- navigation IDs increase monotonically.

### Effect runner tests

Use fake clocks and typed ports to cover:

- event serialization;
- start, abort, and late result suppression;
- earliest-deadline clock scheduling;
- foreground-service requests that overlap connection work;
- trace lifetime across retries;
- Tailscale action replacement;
- port rejection isolation; and
- replay-safe disposal.

### Integration tests

Preserve and reorganize existing coverage for:

- latest shell, active connection, and saved entry selection;
- dropped stored connection identity;
- active transport replacement and tmux reattach;
- Tailscale readiness and recovery;
- reconnect replacement, backoff, timeout, and background work;
- foreground-service retry;
- launch URL suppression;
- notification bridge reconnect expectation;
- every classified failure navigating to the host page; and
- successful terminal navigation.

### Architecture test

Add a source-boundary test that requires:

- reducer, runtime, effects, ports, and React adapter in separate files;
- no React, router, Zustand, AppState, Linking, or native service import in the
  reducer;
- no timers, AbortControllers, diagnostic handles, or connection workflow refs
  in `auto-connect.tsx`;
- no direct router import outside the React adapter;
- no boolean combination replacing the discriminated work union; and
- focused file-size limits chosen in the migration plan.

## Success Criteria

- The complete automatic workflow is visible in one typed state and event model.
- React contains platform subscriptions and navigation rendering only.
- Initial, resume, reconnect, Retry, and Reset work never overlap.
- Reconnect replaces lower-priority auto-connect cleanly.
- Background work remains best-effort when foreground coverage fails and
  reconciles on resume.
- Late completions cannot navigate, mutate attention, finish a newer trace, or
  schedule retries.
- One logical cycle produces one complete diagnostic trace.
- No eligible target is a skip; every real failure goes to the host page.
- Navigation intents survive callback failure and require matching
  acknowledgement.
- Existing lower-level connection, cancellation, Tailscale, and diagnostic
  modules remain reusable rather than being copied into the reducer.
