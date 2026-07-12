# Auto-Connect Runtime Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move automatic connection orchestration out of React into one tested,
event-driven runtime while preserving connection selection, reconnect,
Tailscale, foreground-service, diagnostics, notification, and navigation
behavior defined by the approved design.

**Architecture:** A pure reducer returns immutable state plus typed effects. A
small runtime serializes events and executes effects through mobile ports. The
React manager only publishes platform snapshots, registers UI actions, performs
versioned navigation intents, and renders the notification bridge.

**Tech Stack:** TypeScript 5.9, React 19, React Native 0.81, Expo Router 6,
Zustand 5, Node `tsx --test`, pnpm/Turbo, Prettier, ESLint.

## Prerequisite

Read
`docs/superpowers/specs/2026-07-12-auto-connect-runtime-state-model-design.md`
before implementation. That approved design is the behavior contract for this
plan.

## Global Constraints

- Start every production change with a focused failing test and observe the
  expected failure before editing production code.
- The runtime owns automatic flows only. Manual connection and manual diagnostic
  orchestration remain separate and keep using shared lower-level helpers.
- Only one automatic operation may exist at a time. Reconnect replaces initial
  or resume work; duplicate requests merge.
- Tailscale Retry and Reset replace lower-priority automatic work. Reset must
  settle before its fresh reconnect starts.
- Missing Android foreground-service coverage is diagnostic information, not a
  cancellation reason. Continue best-effort and reconcile on resume.
- The disable-auto-connect launch URL blocks automatic work until the runtime is
  recreated. The policy is not persisted.
- Runtime state is ephemeral. Do not add a persisted reducer snapshot or an
  in-progress recovery format.
- No eligible target is a normal skip. Every real initial or reconnect failure
  publishes a host-page navigation intent.
- Navigation uses increasing intent IDs. Only a matching acknowledgement clears
  the current intent; stale intents and acknowledgements do nothing.
- One diagnostic trace covers one logical cycle across retries, Tailscale work,
  cancellation, and final navigation.
- Do not add XState, another state-machine package, a compatibility facade, or a
  second reconnect scheduler.
- Keep `auto-connect.tsx` below 200 nonblank lines, each new production file
  below 400 nonblank lines, and each new test file below 550 nonblank lines.
- Keep reducer and policy tests free of React, React Native, Expo Router,
  Zustand, native modules, real timers, and live SSH objects.
- Before each task's GREEN check, run Prettier on only the production and test
  files listed by that task.
- Do not edit generated files, stored connection formats, private-key formats,
  or Android signing configuration.
- Use the local Android preview lane for the final on-device smoke test. Install
  only through the existing signing lane for `com.finalapp.vibe2`; do not
  uninstall the app or replace it with a differently signed build.
- Never clear `com.finalapp.vibe2` app data and never run
  `test:e2e:clear-state`.
- Run `$thermo-nuclear-code-quality-review` after automated verification and
  resolve every blocker before merge.

---

## Final File Shape

### New runtime units

- Create `apps/mobile/src/lib/auto-connect-runtime-contracts.ts` for state,
  event, effect, outcome, snapshot, and navigation types.
- Create `apps/mobile/src/lib/auto-connect-runtime-policy.ts` for request
  priority, reconnect context, retry deadlines, foreground desire, and clock
  selection.
- Create `apps/mobile/src/lib/auto-connect-runtime-reducer.ts` for the pure
  transition function.
- Create `apps/mobile/src/lib/auto-connect-runtime.ts` for the event queue,
  effect execution, active run, trace handles, one timer, subscriptions, and
  disposal.
- Create `apps/mobile/src/lib/auto-connect-runtime-ports.ts` for port contracts
  and the mobile adapters over connection attempts, foreground service,
  Tailscale, attention state, diagnostics, and logging.
- Create `apps/mobile/src/lib/auto-connect-environment.ts` for immutable shell
  and connection snapshots.
- Create `apps/mobile/src/lib/auto-connect-projection.ts` for public store and
  notification-bridge read models.

### Existing files retained with narrower ownership

- Rewrite `apps/mobile/src/lib/auto-connect.tsx` as the React/platform adapter.
- Change `apps/mobile/src/lib/auto-connect-attempt.ts` to return typed outcomes
  and never navigate.
- Change `apps/mobile/src/lib/auto-connect-saved-entry-attempt.ts` and
  `apps/mobile/src/lib/auto-connect-reconnect-saved-entry.ts` to return
  connected IDs instead of calling navigation.
- Change `apps/mobile/src/lib/auto-connect-store.ts` into a read-only projection
  store for existing consumers.
- Narrow `apps/mobile/src/lib/foreground-service-runtime.ts` to shared
  foreground and notification policy that remains in use.
- Remove host-page failure navigation ownership from
  `apps/mobile/src/app/shell/detail.tsx`; the runtime intent owns it.

### Legacy files deleted after cutover

- Delete `apps/mobile/src/lib/auto-connect-manager-helpers.ts`.
- Delete `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`.
- Delete `apps/mobile/src/lib/tailscale-recovery-actions.ts`.
- Delete their superseded integration tests after equivalent reducer/runtime
  coverage is green.

### Focused tests

- Create `apps/mobile/test/integration/auto-connect-runtime-test-support.ts`.
- Create `apps/mobile/test/integration/auto-connect-runtime-start.test.ts`.
- Create `apps/mobile/test/integration/auto-connect-runtime-priority.test.ts`.
- Create `apps/mobile/test/integration/auto-connect-runtime-platform.test.ts`.
- Create `apps/mobile/test/integration/auto-connect-runtime-outcomes.test.ts`.
- Create `apps/mobile/test/integration/auto-connect-runtime-effects.test.ts`.
- Create
  `apps/mobile/test/integration/auto-connect-runtime-integration.test.ts`.
- Create `apps/mobile/test/integration/auto-connect-architecture.test.ts`.

## Migration and Rollback Boundary

- Tasks 1-4 add the pure model without changing the live manager.
- Task 5 changes the attempt result contract but keeps the live manager working
  and covered until cutover.
- Tasks 6-8 add and verify the runner, mobile ports, and projections without
  making them the app owner.
- Task 9 is the single ownership cutover. Reverting that commit restores the
  legacy manager without touching stored connections or private keys.
- Task 10 deletes legacy orchestration only after cutover tests pass. Its commit
  can be reverted independently if an undeclared consumer is found.
- No task changes persisted data, so rollback requires no migration, export,
  import, or app-data reset.

---

### Task 1: Runtime Contracts, Cold Start, and Launch Policy

**Files:**

- Create: `apps/mobile/src/lib/auto-connect-runtime-contracts.ts`
- Create: `apps/mobile/src/lib/auto-connect-runtime-reducer.ts`
- Create: `apps/mobile/test/integration/auto-connect-runtime-test-support.ts`
- Create: `apps/mobile/test/integration/auto-connect-runtime-start.test.ts`
- Modify: `apps/mobile/src/lib/auto-connect-launch.ts`

**Interfaces:**

- Produces `createInitialAutoConnectRuntimeState(environment)`.
- Produces `reduceAutoConnectRuntime(state, event): AutoConnectTransition`.
- Produces the shared `AutoConnectRuntimeState`, `AutoConnectEvent`,
  `AutoConnectEffect`, `AutoConnectIntent`, `AutoConnectAttemptOutcome`, and
  `AutoConnectNavigationIntent` unions used by every later task.

- [ ] **Step 1: Write the failing cold-start and launch-policy tests**

Create a small `createEnvironment()` fixture in the test-support file. In
`auto-connect-runtime-start.test.ts`, assert these exact behaviors:

```ts
void test('normal cold start creates one initial cycle and one trace', () => {
	const state = createInitialAutoConnectRuntimeState(createEnvironment());
	const next = reduceAutoConnectRuntime(state, {
		type: 'runtime.started',
		initialUrl: null,
		nowMs: 100,
	});

	assert.equal(next.state.work.status, 'running');
	assert.equal(
		next.state.work.status === 'running' && next.state.work.intent.trigger,
		'cold-launch',
	);
	assert.deepEqual(
		next.effects.map((effect) => effect.type),
		['trace.start', 'run.start', 'state.publish'],
	);
});

void test('disable URL blocks work and publishes the host page once', () => {
	const state = createInitialAutoConnectRuntimeState(createEnvironment());
	const next = reduceAutoConnectRuntime(state, {
		type: 'runtime.started',
		initialUrl: 'fressh:///?fresshE2eDisableAutoConnect=1',
		nowMs: 100,
	});

	assert.equal(next.state.launchPolicy, 'disabled-until-restart');
	assert.deepEqual(next.state.work, { status: 'idle' });
	assert.equal(next.state.navigation?.destination, 'hostPage');
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-runtime-start.test.ts
```

Expected: FAIL because the runtime contracts and reducer do not exist.

- [ ] **Step 3: Add the exact domain contracts**

Define these central unions in `auto-connect-runtime-contracts.ts`; keep live
objects and callbacks out of them:

```ts
export type AppVisibility = 'active' | 'background';
export type AutoConnectCycleKind = 'initial' | 'reconnect';
export type AutoConnectCycleTrigger =
	| 'cold-launch'
	| 'resume'
	| 'shell-drop'
	| 'resume-no-shell'
	| 'user-tailscale-retry'
	| 'user-tailscale-reset';
export type AutoConnectCancelReason =
	| 'disposed'
	| 'launch-disabled'
	| 'replaced';
export type AutoConnectSkipReason =
	| 'no-eligible-target'
	| 'no-reconnect-target';
export type AutoConnectFailure = Readonly<{
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
export type AutoConnectAttemptOutcome =
	| { status: 'skipped'; reason: AutoConnectSkipReason }
	| { status: 'connected'; connectionId: string; channelId: number }
	| { status: 'failed'; failure: AutoConnectFailure; retryable: boolean }
	| { status: 'cancelled'; reason: AutoConnectCancelReason };

export type AutoConnectReconnectContext = Readonly<{
	pathname: string;
	droppedConnectionId?: string;
	droppedChannelId?: number;
	droppedStoredConnectionId?: string;
}>;
export type AutoConnectIntent = Readonly<{
	kind: AutoConnectCycleKind;
	trigger: AutoConnectCycleTrigger;
	reconnectContext: AutoConnectReconnectContext | null;
}>;
export type AutoConnectNavigationIntent = Readonly<{
	id: number;
	cycleId: number;
	destination: 'terminal' | 'hostPage';
	connectionId?: string;
	channelId?: number;
	storedConnectionId?: string;
	failure?: AutoConnectFailure;
}>;
```

Also define the complete environment, work, foreground coverage, final outcome,
navigation, state, event, effect, and transition unions from the approved
design. Add `hasStarted: boolean` and `clockDueAtMs: number | null` to runtime
state. Add `recoveryIntent: AutoConnectIntent | null` so Retry and Reset retain
the failed cycle's temporary target context without persisting it. Add `nowMs`
to events that create a cycle or reconcile deadlines. Add `requestId` to both
foreground start and stop completion events. Every run completion must carry
`cycleId` and `runId`.

- [ ] **Step 4: Implement the initial transition**

`createInitialAutoConnectRuntimeState()` must return an enabled, running,
idle-work state with `hasStarted: false`, all counters starting at `1`, no
navigation, no outcome, and `clockDueAtMs: null`. `runtime.started` sets
`hasStarted: true` and is ignored after that. It must use
`getAutoConnectLaunchActionForUrl()` for URL parsing, then either create the
cold-launch cycle or set the disabled policy and publish this intent:

```ts
{
	id: 1,
	cycleId: 0,
	destination: 'hostPage',
}
```

The reducer must return `{ state, effects }` without executing any effect.

- [ ] **Step 5: Run GREEN checks and commit**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-runtime-start.test.ts
pnpm --filter @fressh/mobile typecheck
git add apps/mobile/src/lib/auto-connect-launch.ts apps/mobile/src/lib/auto-connect-runtime-contracts.ts apps/mobile/src/lib/auto-connect-runtime-reducer.ts apps/mobile/test/integration/auto-connect-runtime-test-support.ts apps/mobile/test/integration/auto-connect-runtime-start.test.ts
git commit -m "Add auto-connect runtime contracts"
```

Expected: focused tests and typecheck PASS.

### Task 2: Environment Snapshots, Priority, and Single-Flight Replacement

**Files:**

- Create: `apps/mobile/src/lib/auto-connect-environment.ts`
- Create: `apps/mobile/src/lib/auto-connect-runtime-policy.ts`
- Modify: `apps/mobile/src/lib/auto-connect-runtime-reducer.ts`
- Modify: `apps/mobile/src/lib/auto-connect-runtime-contracts.ts`
- Create: `apps/mobile/test/integration/auto-connect-runtime-priority.test.ts`
- Modify: `apps/mobile/test/integration/auto-connect-runtime-test-support.ts`

**Interfaces:**

- Produces `buildAutoConnectEnvironment(input): AutoConnectEnvironment`.
- Produces `buildDroppedReconnectContext(previous, next)`.
- Produces `compareAutoConnectIntentPriority(left, right)`.
- Adds initial/resume merging and reconnect/user-action replacement to the
  reducer.

- [ ] **Step 1: Write failing snapshot and priority tests**

Cover all seven approved priority levels and these races:

```ts
void test('shell drop replaces initial work after cancellation settles', () => {
	const running = startColdCycle();
	const requested = reduceAutoConnectRuntime(running.state, {
		type: 'environment.changed',
		environment: createEnvironment({ shells: [] }),
		nowMs: 200,
	});

	assert.equal(requested.state.work.status, 'cancelling');
	assert.equal(
		requested.state.work.status === 'cancelling' &&
			requested.state.work.replacement?.trigger,
		'shell-drop',
	);
	assert.deepEqual(
		requested.effects.map((effect) => effect.type),
		['run.abort', 'trace.event', 'state.publish'],
	);
});

void test('duplicate resume request does not create another cycle', () => {
	const running = startResumeCycle();
	const next = reduceAutoConnectRuntime(running.state, {
		type: 'initial.requested',
		trigger: 'resume',
		nowMs: 200,
	});
	assert.equal(next.state, running.state);
	assert.deepEqual(next.effects, []);
});
```

Also cover a warm disable URL cancelling current work without replacement, Retry
and Reset being ignored while disabled, and a newly created state starting
enabled after the old runtime is disposed.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-runtime-priority.test.ts
```

Expected: FAIL because snapshot comparison and replacement policy are missing.

- [ ] **Step 3: Implement immutable environment snapshots**

Use only these reducer-safe shapes:

```ts
export type AutoConnectShellSnapshot = Readonly<{
	connectionId: string;
	channelId: number;
	createdAtMs: number;
}>;

export type AutoConnectConnectionSnapshot = Readonly<{
	connectionId: string;
	connectedAtMs: number;
	storedConnectionId: string;
}>;
```

`buildAutoConnectEnvironment()` sorts both arrays by stable identity and derives
`storedConnectionId` with `getStoredConnectionId()`. The reducer compares the
previous complete snapshot with the next one. When the last shell disappears, it
captures the newest dropped shell and its stored connection ID in an
`AutoConnectReconnectContext` before replacing the environment.

- [ ] **Step 4: Implement request priority and cancellation acknowledgement**

Use this exact priority table in `auto-connect-runtime-policy.ts`:

```ts
export const AUTO_CONNECT_INTENT_PRIORITY = {
	'cold-launch': 1,
	resume: 2,
	'resume-no-shell': 3,
	'shell-drop': 4,
	'user-tailscale-retry': 5,
	'user-tailscale-reset': 6,
} as const;
```

Launch disable and disposal remain outside the table and always win. A
higher-priority request moves running work to `cancelling`, stores one
replacement, and emits one `run.abort`. `run.cancelled` or a current cancelled
completion finishes the old trace, then creates the replacement with new cycle
and run IDs. Same-identity reconnects and equivalent initial/resume requests
merge.

- [ ] **Step 5: Run GREEN checks and commit**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-runtime-start.test.ts test/integration/auto-connect-runtime-priority.test.ts
pnpm --filter @fressh/mobile typecheck
git add apps/mobile/src/lib/auto-connect-environment.ts apps/mobile/src/lib/auto-connect-runtime-contracts.ts apps/mobile/src/lib/auto-connect-runtime-policy.ts apps/mobile/src/lib/auto-connect-runtime-reducer.ts apps/mobile/test/integration/auto-connect-runtime-priority.test.ts apps/mobile/test/integration/auto-connect-runtime-test-support.ts
git commit -m "Add auto-connect priority transitions"
```

Expected: start, priority, and type checks PASS.

### Task 3: Reconnect Deadlines, One Clock, and Foreground Coverage

**Files:**

- Modify: `apps/mobile/src/lib/auto-connect-runtime-policy.ts`
- Modify: `apps/mobile/src/lib/auto-connect-runtime-reducer.ts`
- Modify: `apps/mobile/src/lib/auto-connect-runtime-contracts.ts`
- Create: `apps/mobile/test/integration/auto-connect-runtime-platform.test.ts`

**Interfaces:**

- Produces `getReconnectDelayMs(attemptIndex)`.
- Produces `isForegroundCoverageDesired(state)`.
- Produces `getNextAutoConnectDeadline(state)`.
- Adds `clock.fired`, foreground start/stop completion, background continuation,
  and resume reconciliation transitions.

- [ ] **Step 1: Write failing deadline and foreground tests**

Cover 500 ms, 1 s, 2 s, 5 s, and capped 10 s reconnect delays; the two-minute
window; five 5-second foreground retries; one earliest clock; and resume after a
delayed callback. Cover background-to-active with a remembered dropped shell,
background-to-active without reconnect context, and resume while the current run
is still valid. Include this approved failure case:

```ts
void test('missing foreground coverage does not cancel background work', () => {
	const running = startReconnectCycle({ appVisibility: 'background' });
	const next = reduceAutoConnectRuntime(running.state, {
		type: 'foreground.start-completed',
		requestId: currentForegroundRequestId(running.state),
		key: 'Fressh Terminal|Reconnecting...',
		started: false,
		nowMs: 1_000,
	});

	assert.equal(next.state.work.status, 'running');
	assert.equal(next.state.foregroundCoverage.status, 'unavailable');
	assert.ok(next.effects.some((effect) => effect.type === 'trace.event'));
	assert.ok(next.effects.every((effect) => effect.type !== 'run.abort'));
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-runtime-platform.test.ts
```

Expected: FAIL because deadline and coverage transitions are missing.

- [ ] **Step 3: Add exact timing policy**

Define:

```ts
export const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000] as const;
export const RECONNECT_WINDOW_MS = 2 * 60 * 1_000;
export const FOREGROUND_RETRY_DELAY_MS = 5_000;
export const FOREGROUND_MAX_ATTEMPTS = 5;
```

Store absolute `retryDueAtMs` values. `getNextAutoConnectDeadline()` returns the
minimum of the reconnect and foreground deadlines. Reconciliation emits at most
one `clock.cancel` followed by one `clock.schedule` when the selected deadline
changes.

- [ ] **Step 4: Implement best-effort platform transitions**

Coverage is desired on Android when at least one shell exists or work is
running, waiting, or cancelling. A failed start records `unavailable`, emits a
diagnostic event, and schedules the next coverage retry without changing work.
Late foreground completions are accepted only for the current request ID and
key. On resume, compare `nowMs` to absolute deadlines and process every due
deadline before scheduling the next one.

- [ ] **Step 5: Run GREEN checks and commit**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-runtime-start.test.ts test/integration/auto-connect-runtime-priority.test.ts test/integration/auto-connect-runtime-platform.test.ts
pnpm --filter @fressh/mobile typecheck
git add apps/mobile/src/lib/auto-connect-runtime-contracts.ts apps/mobile/src/lib/auto-connect-runtime-policy.ts apps/mobile/src/lib/auto-connect-runtime-reducer.ts apps/mobile/test/integration/auto-connect-runtime-platform.test.ts
git commit -m "Add reconnect and foreground deadlines"
```

Expected: all reducer tests and typecheck PASS.

### Task 4: Outcomes, Navigation Intents, Tailscale Actions, and Trace Effects

**Files:**

- Modify: `apps/mobile/src/lib/auto-connect-runtime-reducer.ts`
- Modify: `apps/mobile/src/lib/auto-connect-runtime-contracts.ts`
- Create: `apps/mobile/test/integration/auto-connect-runtime-outcomes.test.ts`

**Interfaces:**

- Completes `run.phase-changed`, `run.completed`, Retry, Reset, navigation
  acknowledgement, effect failure, and disposal transitions.
- Produces one trace lifetime and one versioned navigation intent per cycle.

- [ ] **Step 1: Write the failing outcome table**

Use one table row for every failure kind and assert all of them publish
`hostPage`. Add separate rows for skip, success, replacement cancellation, stale
IDs, Retry, Reset success/failure, navigation replacement, stale
acknowledgement, retained recovery intent, cleared recovery intent after
success/disable/disposal, and disposal.

```ts
for (const kind of failureKinds) {
	void test(`${kind} initial failure publishes host page`, () => {
		const running = startColdCycle();
		const next = completeCurrentRun(running.state, {
			status: 'failed',
			failure: { kind, message: `safe-${kind}` },
			retryable: false,
		});
		assert.equal(next.state.navigation?.destination, 'hostPage');
		assert.equal(next.state.lastOutcome?.status, 'failed');
	});
}
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-runtime-outcomes.test.ts
```

Expected: FAIL because final outcome and navigation transitions are incomplete.

- [ ] **Step 3: Implement final outcome and navigation rules**

Apply this table exactly:

| Attempt outcome                           | Runtime result                                | Navigation |
| ----------------------------------------- | --------------------------------------------- | ---------- |
| `skipped`                                 | finish trace `skipped`                        | none       |
| `connected`                               | clear attention, finish `connected`           | terminal   |
| initial `failed`                          | finish `failed`                               | host page  |
| reconnect retryable failure inside window | retain trace, wait retry                      | none yet   |
| reconnect terminal/exhausted failure      | finish `failed`                               | host page  |
| cancelled with replacement                | finish old `skipped`, start replacement trace | none       |
| cancelled without replacement             | finish `skipped`, idle                        | none       |

Allocate increasing navigation IDs. A matching acknowledgement clears the
intent. A stale acknowledgement does not change state. A newer final outcome
replaces an unacknowledged older intent. Emit trace events for navigation
publication, matching acknowledgement, and execution failure so the cycle trace
contains its final routing result.

`navigation.failed` leaves the current intent pending without immediately
republishing it. Retry that intent only after a later environment or lifecycle
reconciliation, preventing a tight failure loop. Auxiliary foreground,
diagnostic, logger, Tailscale Open, and navigation failures never replace the
connection outcome. A current attempt rejection maps to `unexpected`; a current
Reset rejection maps to `tailscale-reset`.

- [ ] **Step 4: Implement Tailscale and disposal transitions**

Open emits only `tailscale.open`. Retry requests a fresh high-priority
reconnect. Reset cancels current work, starts a user-reset cycle, emits
`attention.recovering` with `Resetting Tailscale...`, waits for the reset
effect, then starts its connection run. Retry and Reset rebuild a reconnect
intent from `recoveryIntent`; Tailscale-related failure retains it, while
success, launch disable, and disposal clear it. Reset failure is
`tailscale-reset` and navigates to the host page. Disposal aborts the current
run, cancels the clock, stops Android foreground service, finishes the trace as
skipped, publishes final state, and ignores later events.

- [ ] **Step 5: Run GREEN checks and commit**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-runtime-*.test.ts
pnpm --filter @fressh/mobile typecheck
git add apps/mobile/src/lib/auto-connect-runtime-contracts.ts apps/mobile/src/lib/auto-connect-runtime-reducer.ts apps/mobile/test/integration/auto-connect-runtime-outcomes.test.ts
git commit -m "Complete auto-connect state transitions"
```

Expected: every reducer test and typecheck PASS.

### Task 5: Outcome-Only Connection Attempt Pipeline

**Files:**

- Modify: `apps/mobile/src/lib/auto-connect-attempt.ts`
- Modify: `apps/mobile/src/lib/auto-connect-saved-entry-attempt.ts`
- Modify: `apps/mobile/src/lib/auto-connect-reconnect-saved-entry.ts`
- Modify: `apps/mobile/src/lib/auto-connect-saved-entry-cleanup.ts`
- Modify: `apps/mobile/src/lib/auto-connect-manager-helpers.ts`
- Modify: `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`
- Modify: `apps/mobile/src/lib/auto-connect.tsx`
- Modify: `apps/mobile/test/integration/auto-connect-attempt.test.ts`
- Modify: `apps/mobile/test/integration/auto-connect-reconnect-attempt.test.ts`
- Modify: `apps/mobile/test/integration/auto-connect.test.ts`
- Modify:
  `apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`

**Interfaces:**

- Changes `attemptAutoConnectSource(args)` to return
  `Promise<AutoConnectAttemptOutcome>`.
- Removes `navigateToShell` from lower-level attempt arguments.
- Makes every connected result carry `connectionId` and `channelId`.
- Keeps the legacy manager compiling until Task 9 by navigating once from the
  returned outcome; Task 10 deletes that temporary ownership.

- [ ] **Step 1: Change tests to demand typed outcomes and no navigation
      callback**

Update the shared attempt harness first. Replace boolean assertions with exact
objects:

```ts
assert.deepEqual(result, {
	status: 'connected',
	connectionId: 'connection-1',
	channelId: 7,
});
```

Assert no attempt function accepts `navigateToShell`. Add explicit cases for no
eligible target, missing key, network, authentication, timeout, tmux attach,
cleanup, Tailscale attention, unexpected rejection, and abort.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-attempt.test.ts test/integration/auto-connect-reconnect-attempt.test.ts
```

Expected: FAIL because current attempts return booleans or reconnect statuses
and perform navigation through callbacks.

- [ ] **Step 3: Return identities from saved-entry and active-shell attempts**

Remove each `navigateToShell` argument and call. Return connected IDs from the
existing lifecycle result. Map outcomes as follows:

```ts
const outcomeByStatus = {
	timedOut: { kind: 'timeout', retryable: true },
	tmuxAttachFailed: { kind: 'tmux-attach', retryable: false },
	cleanupFailed: { kind: 'cleanup', retryable: false },
	blocked: { kind: 'tailscale-needs-attention', retryable: false },
} as const;
```

Network failures are retryable for reconnect; authentication, tmux attach,
cleanup, and Tailscale attention are terminal. Missing or disabled saved targets
return `skipped/no-eligible-target`. A configured target whose key cannot be
loaded returns `failed/authentication`. Abort returns `cancelled/replaced` when
the caller signal aborts a current run.

Track whether any real source was attempted. If an active connection or saved
entry attempt fails and later fallback lookup finds no eligible source, return
the classified failure; never downgrade that cycle to `skipped`. The active run
wrapper records the exact abort reason supplied by the runtime, so launch
disable and disposal return their own cancellation reasons instead of
`replaced`.

- [ ] **Step 4: Keep the pre-cutover manager behavior compiling**

Update the temporary legacy manager boundary to call `router.replace()` only
after it receives a current `connected` outcome. Update the legacy reconnect
controller normalization so a retryable failed outcome schedules its existing
delay and every other failed outcome stops. Do not add a new adapter file; this
temporary code is deleted with the legacy controller in Task 10.

- [ ] **Step 5: Run GREEN checks and commit**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-attempt.test.ts test/integration/auto-connect-reconnect-attempt.test.ts test/integration/auto-connect.test.ts test/integration/auto-connect-reconnect-controller.test.ts
pnpm --filter @fressh/mobile typecheck
git add apps/mobile/src/lib/auto-connect-attempt.ts apps/mobile/src/lib/auto-connect-saved-entry-attempt.ts apps/mobile/src/lib/auto-connect-reconnect-saved-entry.ts apps/mobile/src/lib/auto-connect-saved-entry-cleanup.ts apps/mobile/src/lib/auto-connect-manager-helpers.ts apps/mobile/src/lib/auto-connect-reconnect-controller.ts apps/mobile/src/lib/auto-connect.tsx apps/mobile/test/integration/auto-connect-attempt.test.ts apps/mobile/test/integration/auto-connect-reconnect-attempt.test.ts apps/mobile/test/integration/auto-connect.test.ts apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts
git commit -m "Return typed auto-connect outcomes"
```

Expected: focused attempt, legacy wiring, and type checks PASS.

### Task 6: Serialized Effect Runner

**Files:**

- Create: `apps/mobile/src/lib/auto-connect-runtime.ts`
- Create: `apps/mobile/src/lib/auto-connect-runtime-ports.ts`
- Create: `apps/mobile/test/integration/auto-connect-runtime-effects.test.ts`
- Modify: `apps/mobile/test/integration/auto-connect-runtime-test-support.ts`

**Interfaces:**

- Produces `createAutoConnectRuntime(ports): AutoConnectRuntime`.
- Produces typed clock, attempt, foreground, Tailscale, attention, diagnostic,
  and logger ports.
- Owns live AbortControllers, promises, timer handles, and trace handles outside
  reducer state.

- [ ] **Step 1: Write a fake-port runner harness and failing tests**

The test support must expose deterministic `resolveRun`, `fireClock`,
`resolveForegroundStart`, and `resolveTailscaleReset` controls. Test event
serialization, reentrant dispatch, abort-before-replacement, late result
suppression, earliest timer replacement, port rejection isolation, trace
lifetime, subscription publication, and replay-safe disposal.

```ts
void test('replacement starts only after the aborted run settles', async () => {
	const harness = createRuntimeHarness();
	harness.runtime.start({ environment: createEnvironment(), initialUrl: null });
	harness.runtime.dispatch(shellDropEvent());

	assert.equal(harness.startedRuns.length, 1);
	assert.equal(harness.startedRuns[0]?.aborted, true);
	harness.settleCancelledRun(1);
	await harness.flush();
	assert.equal(harness.startedRuns.length, 2);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-runtime-effects.test.ts
```

Expected: FAIL because the runtime and port contracts do not exist.

- [ ] **Step 3: Define runtime and port contracts**

Use these exact public shapes:

```ts
export type AutoConnectRuntime = Readonly<{
	start: (input: {
		environment: AutoConnectEnvironment;
		initialUrl: string | null;
	}) => void;
	dispatch: (event: AutoConnectEvent) => void;
	getSnapshot: () => AutoConnectRuntimeState;
	getActiveTrace: () => ConnectionDiagnosticTraceHandle | null;
	subscribe: (listener: () => void) => () => void;
	dispose: () => void;
}>;

export type AutoConnectActiveRun = Readonly<{
	abort: (reason: AutoConnectCancelReason) => void;
	result: Promise<AutoConnectAttemptOutcome>;
}>;

export type AutoConnectAttemptInput = Readonly<{
	cycleId: number;
	runId: number;
	intent: AutoConnectIntent;
	reportPhase: (phase: AutoConnectRunPhase) => void;
	traceEvent: (event: ConnectionDiagnosticEvent) => void;
}>;

export type AutoConnectRuntimePorts = Readonly<{
	now: () => number;
	clock: {
		schedule: (dueAtMs: number, callback: () => void) => unknown;
		cancel: (handle: unknown) => void;
	};
	attempt: { start: (input: AutoConnectAttemptInput) => AutoConnectActiveRun };
	foregroundService: {
		start: (input: { title: string; message: string }) => Promise<boolean>;
		stop: () => Promise<boolean>;
	};
	tailscale: {
		open: () => Promise<void>;
		reset: () => Promise<TailscaleManualResetResult>;
		resetCooldown: () => void;
	};
	attention: {
		clear: () => void;
		mark: (message: string) => void;
		recovering: (message: string) => void;
	};
	diagnostics: {
		start: (input: {
			trigger: 'initial-auto-connect' | 'reconnect';
			reason: string;
		}) => ConnectionDiagnosticTraceHandle;
	};
	logger: {
		info: (message: string, context?: unknown) => void;
		warn: (message: string, context?: unknown) => void;
	};
}>;
```

`AutoConnectRuntimePorts` must contain `now`, `clock`, `attempt`,
`foregroundService`, `tailscale`, `attention`, `diagnostics`, and `logger`.
Ports receive only typed inputs; the reducer must not import this file. Import
`TailscaleManualResetResult` from `tailscale-recovery-core` and
`ConnectionDiagnosticEvent` and `ConnectionDiagnosticTraceHandle` from
`connection-diagnostic-types`; do not duplicate those contracts. The runner
fills `reportPhase` and `traceEvent` when it executes `run.start`, so the mobile
attempt port cannot dispatch arbitrary runtime events.

- [ ] **Step 4: Implement queued effect execution**

Use one synchronous FIFO event queue with a `processing` guard. Apply the
reducer, replace state, execute its effects in order, and notify subscribers on
`state.publish`. Store active runs by current run ID, one timer handle, pending
Reset promises by run ID, and trace handles by cycle ID. Promise completions
dispatch ID-bearing result events. If cancellation reaches a non-abortable
Reset, mark that run cancelled, wait for its promise to settle, dispatch
`run.cancelled`, and only then allow replacement work to start. Catch every port
rejection and dispatch `effect.failed`; never let an unhandled rejection escape.

- [ ] **Step 5: Run GREEN checks and commit**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-runtime-effects.test.ts test/integration/auto-connect-runtime-*.test.ts
pnpm --filter @fressh/mobile typecheck
git add apps/mobile/src/lib/auto-connect-runtime.ts apps/mobile/src/lib/auto-connect-runtime-ports.ts apps/mobile/test/integration/auto-connect-runtime-effects.test.ts apps/mobile/test/integration/auto-connect-runtime-test-support.ts
git commit -m "Add auto-connect effect runner"
```

Expected: reducer, runner, and type checks PASS with no unhandled rejection.

### Task 7: Mobile Attempt, Foreground, Tailscale, and Diagnostic Ports

**Files:**

- Modify: `apps/mobile/src/lib/auto-connect-runtime-ports.ts`
- Modify: `apps/mobile/src/lib/connection-diagnostics/events/auto-connect.ts`
- Modify: `apps/mobile/src/lib/connection-diagnostics/events/reconnect.ts`
- Modify: `apps/mobile/src/lib/foreground-service-runtime.ts`
- Create:
  `apps/mobile/test/integration/auto-connect-runtime-integration.test.ts`
- Modify:
  `apps/mobile/test/integration/connection-diagnostic-auto-connect-events.test.ts`
- Modify:
  `apps/mobile/test/integration/connection-diagnostic-reconnect-events.test.ts`

**Interfaces:**

- Produces `createMobileAutoConnectRuntimePorts(deps)`.
- Adapts current SSH and secrets stores only when a `run.start` effect executes.
- Uses the existing connection run context, foreground service, Tailscale
  recovery, diagnostic recorder, and attention store.

- [ ] **Step 1: Write failing port integration tests**

Use injected store readers and native functions; do not load React Native in the
Node test. Cover latest shell, active connection, saved entry, dropped stored
identity, key missing, abort, foreground start/stop, Tailscale Open/Reset,
attention state, trace event/finish failure, and redacted logger output.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-runtime-integration.test.ts
```

Expected: FAIL because the concrete port factory is missing.

- [ ] **Step 3: Build the attempt and platform adapters**

The attempt port creates one `ConnectionRunContext` with exact timeouts of 60
seconds operation, 60 seconds recovery, and 5 seconds cleanup. It reads the
latest live stores at start, calls `attemptAutoConnectSource()`, and returns an
active run whose `abort()` aborts that context and whose `result` always settles
to a typed outcome. It reports attempt phases and existing typed diagnostic
events only through the callbacks supplied in `AutoConnectAttemptInput`.

Foreground ports call `startForegroundService()` and `stopForegroundService()`.
Tailscale ports call `tailscaleRecovery.openApp()`, `reset()`, and
`resetCooldown()`. Attention ports call the existing UI store helpers. None of
these adapters imports React or Expo Router.

Only `kind: 'reset'` advances the user-reset cycle to connection. Every other
reset result and every reset rejection becomes a redacted `tailscale-reset`
failure for the current cycle.

- [ ] **Step 4: Build the diagnostic adapter**

Start one recorder trace with trigger `initial-auto-connect` or `reconnect` from
the cycle kind. Reuse existing typed auto-connect, reconnect, Tailscale, and
foreground event builders; add focused builders only for runtime transitions
that have no existing event. Store raw errors only through
`serializeConnectionDiagnosticError()`. Diagnostic and logger failures remain
best-effort and cannot produce a connection failure.

- [ ] **Step 5: Run GREEN checks and commit**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-runtime-integration.test.ts test/integration/connection-diagnostic-auto-connect-events.test.ts test/integration/connection-diagnostic-reconnect-events.test.ts
pnpm --filter @fressh/mobile typecheck
git add apps/mobile/src/lib/auto-connect-runtime-ports.ts apps/mobile/src/lib/connection-diagnostics/events/auto-connect.ts apps/mobile/src/lib/connection-diagnostics/events/reconnect.ts apps/mobile/src/lib/foreground-service-runtime.ts apps/mobile/test/integration/auto-connect-runtime-integration.test.ts apps/mobile/test/integration/connection-diagnostic-auto-connect-events.test.ts apps/mobile/test/integration/connection-diagnostic-reconnect-events.test.ts
git commit -m "Connect auto-connect runtime ports"
```

Expected: port, diagnostic, and type checks PASS.

### Task 8: Public Runtime Projection

**Files:**

- Create: `apps/mobile/src/lib/auto-connect-projection.ts`
- Modify: `apps/mobile/src/lib/auto-connect-store.ts`
- Modify:
  `apps/mobile/test/integration/auto-connect-runtime-integration.test.ts`

**Interfaces:**

- Produces `projectAutoConnectRuntime(state, activeTrace)`.
- Produces `publishAutoConnectProjection(projection)` as the runtime-to-Zustand
  write boundary.
- Keeps the current fields and legacy setters until the live cutover is green;
  Task 10 removes the setters and old trace-event writer.

- [ ] **Step 1: Write failing projection and ownership tests**

Assert exact projections for initial running, reconnect waiting, cancelling,
connected, failed, skipped, and disposed states. Assert publishing updates all
projection fields atomically and does not call any legacy setter.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-runtime-integration.test.ts
```

Expected: FAIL because the runtime projection and atomic publisher do not exist.

- [ ] **Step 3: Implement the read model**

Project this exact shape:

```ts
export type AutoConnectProjection = Readonly<{
	activeDiagnosticTrace: ConnectionDiagnosticTraceHandle | null;
	isAutoConnecting: boolean;
	isReconnecting: boolean;
	lastReconnectOutcome: null | {
		status: string;
		message?: string;
		destination: 'terminal' | 'hostPage';
	};
	preservePendingWithoutTarget: boolean;
}>;
```

Initial `running` or `cancelling` sets `isAutoConnecting`. Reconnect `running`,
`waiting-retry`, or `cancelling` sets `isReconnecting`. Only reconnect final
outcomes populate `lastReconnectOutcome`. Preserve pending notifications while a
reconnect cycle still owns the dropped shell identity.

- [ ] **Step 4: Add the temporary atomic publisher**

Add one `publishAutoConnectProjection()` store update that writes the complete
projection in one Zustand `set()`. Keep existing setters and
`handleAutoConnectReconnectTraceEvent()` unchanged so the legacy manager remains
runnable until Task 9. Mark their deletion in Task 10; new runtime files may use
only the atomic publisher.

- [ ] **Step 5: Run GREEN checks and commit**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-runtime-integration.test.ts
pnpm --filter @fressh/mobile typecheck
git add apps/mobile/src/lib/auto-connect-projection.ts apps/mobile/src/lib/auto-connect-store.ts apps/mobile/test/integration/auto-connect-runtime-integration.test.ts
git commit -m "Add auto-connect runtime projection"
```

Expected: projection and type checks PASS while the legacy manager remains
operational.

### Task 9: Thin React Manager Cutover

**Files:**

- Rewrite: `apps/mobile/src/lib/auto-connect.tsx`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Modify: `apps/mobile/src/lib/auto-connect-environment.ts`
- Modify: `apps/mobile/src/lib/auto-connect-runtime.ts`
- Modify: `apps/mobile/src/lib/auto-connect-projection.ts`
- Create: `apps/mobile/test/integration/auto-connect-architecture.test.ts`
- Modify: `apps/mobile/test/integration/tailscale-recovery-ui-store.test.ts`
- Modify: `apps/mobile/test/integration/tailscale-recovery-ui-placement.test.ts`
- Modify: `apps/mobile/test/integration/agent-notification-bridge.test.ts`
- Modify:
  `apps/mobile/test/integration/shell-detail-host-page-reconnect-route.test.ts`
- Modify:
  `apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts`

**Interfaces:**

- `AutoConnectManager` creates one runtime and only adapts platform
  observations, navigation, Tailscale UI actions, projections, and notification
  bridge props.
- Terminal intents route to `/shell/detail`; host-page intents route to `/`.
- Matching success or failure acknowledgement returns to the runtime.

- [ ] **Step 1: Write the failing architecture boundary test**

Read source files and assert:

```ts
assert.doesNotMatch(
	reducerSource,
	/react|expo-router|zustand|AppState|Linking|setTimeout|AbortController/,
);
assert.doesNotMatch(
	managerSource,
	/setTimeout|AbortController|ConnectionRunContext|ReconnectController|DiagnosticTraceHandle/,
);
assert.doesNotMatch(
	managerSource,
	/inFlightRef|previousShellsRef|allowBackgroundRef|foregroundKeyRef/,
);
assert.match(managerSource, /useSyncExternalStore/);
assert.match(managerSource, /navigation\.acknowledged/);
assert.ok(nonblankLines(managerSource) < 200);
```

Also assert only `auto-connect.tsx` imports Expo Router for automatic navigation
and every new production file stays below 400 nonblank lines. Assert the
reducer, runner, ports, and projection do not import the manual diagnostic
runner or debug command. Assert shell detail no longer owns host-page failure
navigation while it can still append Workmux events to the active trace.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-architecture.test.ts
```

Expected: FAIL because the current manager still owns attempts, timers,
cancellation, traces, and reconnect refs.

- [ ] **Step 3: Rewrite the manager as an adapter**

The manager may keep only one runtime ref plus platform subscription state. It
must:

1. build full snapshots from pathname, shells, connections, AppState, platform,
   and foreground-service state;
2. read the initial URL and call `runtime.start()` once;
3. dispatch complete environment snapshots after platform changes;
4. dispatch warm launch URLs;
5. register Open, Retry, and Reset handlers that dispatch runtime events;
6. use `useSyncExternalStore()` for runtime state;
7. publish the public projection;
8. perform the current navigation intent with `router.replace()` and dispatch a
   matching acknowledgement or navigation failure; and
9. render `AgentNotificationBridgeManager` with the projected preservation flag.

On unmount, remove every platform/UI subscription and call `runtime.dispose()`.
Keep the existing `useAutoConnectStore` re-export until Task 10 updates its two
consumers to import the store directly.

- [ ] **Step 4: Cover navigation and UI registration**

Terminal navigation must use:

```ts
router.replace({
	pathname: '/shell/detail',
	params: { connectionId: intent.connectionId, channelId: intent.channelId },
});
```

Host-page navigation must use `/` and include `editConnectionId` only when the
intent carries a stored connection ID. Wrap navigation in `Promise.resolve()`;
acknowledge only the same intent ID. Keep the inline Tailscale panel owned by
the Connect tab.

Delete shell detail's `lastReconnectOutcome.destination === 'hostPage'` router
branch in the same cutover commit. Keep its missing-shell wait while automatic
work is active and keep its projected trace for Workmux diagnostics.

- [ ] **Step 5: Run GREEN checks and commit**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-architecture.test.ts test/integration/auto-connect-runtime-*.test.ts test/integration/tailscale-recovery-ui-store.test.ts test/integration/tailscale-recovery-ui-placement.test.ts test/integration/agent-notification-bridge.test.ts test/integration/shell-detail-host-page-reconnect-route.test.ts test/integration/shell-detail-workmux-control-channel.test.ts
pnpm --filter @fressh/mobile typecheck
git add apps/mobile/src/lib/auto-connect.tsx apps/mobile/src/app/shell/detail.tsx apps/mobile/src/lib/auto-connect-environment.ts apps/mobile/src/lib/auto-connect-runtime.ts apps/mobile/src/lib/auto-connect-projection.ts apps/mobile/test/integration/auto-connect-architecture.test.ts apps/mobile/test/integration/tailscale-recovery-ui-store.test.ts apps/mobile/test/integration/tailscale-recovery-ui-placement.test.ts apps/mobile/test/integration/agent-notification-bridge.test.ts apps/mobile/test/integration/shell-detail-host-page-reconnect-route.test.ts apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts
git commit -m "Move auto-connect orchestration into runtime"
```

Expected: architecture, runtime, UI, bridge, and type checks PASS.

### Task 10: Race Matrix and Legacy Deletion

**Files:**

- Delete: `apps/mobile/src/lib/auto-connect-manager-helpers.ts`
- Delete: `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`
- Delete: `apps/mobile/src/lib/tailscale-recovery-actions.ts`
- Delete:
  `apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`
- Delete: `apps/mobile/test/integration/tailscale-recovery-actions.test.ts`
- Rewrite: `apps/mobile/test/integration/auto-connect.test.ts`
- Modify: `apps/mobile/src/lib/auto-connect.tsx`
- Modify: `apps/mobile/src/lib/auto-connect-store.ts`
- Modify: `apps/mobile/src/lib/use-connection-debug-command.ts`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Modify:
  `apps/mobile/test/integration/auto-connect-runtime-integration.test.ts`
- Modify: `apps/mobile/test/integration/auto-connect-architecture.test.ts`
- Modify: `apps/mobile/test/integration/connection-debug-command.test.ts`
- Modify: `apps/mobile/src/lib/foreground-service-runtime.ts`
- Modify: `apps/mobile/test/integration/foreground-service-runtime.test.ts`

**Interfaces:**

- Removes the old scheduler, mutable reconnect-context cycle, Tailscale action
  coordinator, and manager-only foreground cancellation policy.
- Leaves one runtime, one retry policy, and one navigation owner.

- [ ] **Step 1: Add failing race and deletion assertions**

Cover these races with fake clocks and deferred ports:

- initial success after shell-drop replacement;
- retry timer after Retry replacement;
- foreground start completion after stop request;
- Reset requested while reconnect is connecting;
- Retry requested while non-abortable Reset is settling;
- app background without coverage followed by resume;
- disposal before attempt, Reset, foreground, and navigation completion;
- old navigation acknowledgement after a newer host-page intent; and
- diagnostics/logger throws during every effect class.

Add architecture assertions that all three legacy files and their imports are
absent.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-runtime-integration.test.ts test/integration/auto-connect-architecture.test.ts
```

Expected: FAIL until the final races are covered and legacy files are removed.

- [ ] **Step 3: Delete replaced orchestration**

Move only still-used pure saved-entry selection into the attempt port and only
still-used shell snapshot logic into `auto-connect-environment.ts`. Delete the
legacy files, tests, exports, and imports. Remove foreground helpers used only
to cancel background reconnect or coordinate the old independent timer. Keep
notification-bridge helpers that still have consumers.

Remove the store's legacy setters, `handleAutoConnectReconnectTraceEvent()`, and
`lastReconnectDestination`. Remove the `useAutoConnectStore` re-export from
`auto-connect.tsx`; update shell detail and `use-connection-debug-command.ts` to
import it directly from `auto-connect-store.ts`.

- [ ] **Step 4: Reorganize surviving behavior tests**

Keep `auto-connect.test.ts` focused on launch parsing and end-to-end runtime
behavior. Move reducer-only assertions to the four reducer test files and port
assertions to the integration file. Keep each new test file below 550 nonblank
lines. Do not weaken the existing latest-shell, dropped stored ID, tmux,
Tailscale, diagnostics, or foreground assertions.

- [ ] **Step 5: Run GREEN checks and commit**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect*.test.ts test/integration/foreground-service-runtime.test.ts test/integration/tailscale-recovery-ui-*.test.ts test/integration/shell-detail-host-page-reconnect-route.test.ts test/integration/shell-detail-workmux-control-channel.test.ts test/integration/connection-debug-command.test.ts
pnpm --filter @fressh/mobile typecheck
git add -A apps/mobile/src/lib/auto-connect-manager-helpers.ts apps/mobile/src/lib/auto-connect-reconnect-controller.ts apps/mobile/src/lib/tailscale-recovery-actions.ts apps/mobile/src/lib/auto-connect.tsx apps/mobile/src/lib/auto-connect-store.ts apps/mobile/src/lib/use-connection-debug-command.ts apps/mobile/src/app/shell/detail.tsx apps/mobile/src/lib/auto-connect-environment.ts apps/mobile/src/lib/auto-connect-runtime-ports.ts apps/mobile/src/lib/foreground-service-runtime.ts apps/mobile/test/integration/auto-connect.test.ts apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts apps/mobile/test/integration/tailscale-recovery-actions.test.ts apps/mobile/test/integration/auto-connect-runtime-integration.test.ts apps/mobile/test/integration/auto-connect-architecture.test.ts apps/mobile/test/integration/connection-debug-command.test.ts apps/mobile/test/integration/foreground-service-runtime.test.ts
git commit -m "Remove legacy auto-connect orchestration"
```

Expected: focused auto-connect and foreground tests plus typecheck PASS, and
`rg` finds no deleted imports.

### Task 11: Full Verification and Maintainability Gate

**Files:**

- Modify only files required to fix failures or maintainability blockers found
  by the checks below.

**Interfaces:**

- Verifies the complete mobile behavior and architecture without changing
  storage formats or requiring a device-data reset.

- [ ] **Step 1: Run the complete mobile integration suite**

```bash
pnpm --filter @fressh/mobile test:integration
```

Expected: every integration test PASS with zero failures and zero unhandled
rejections.

- [ ] **Step 2: Run formatting, lint, and TypeScript checks**

```bash
pnpm exec prettier --write apps/mobile/src/lib/auto-connect.tsx "apps/mobile/src/lib/auto-connect-*.ts" apps/mobile/src/lib/foreground-service-runtime.ts apps/mobile/src/lib/connection-diagnostics/events/auto-connect.ts apps/mobile/src/lib/connection-diagnostics/events/reconnect.ts apps/mobile/src/app/shell/detail.tsx "apps/mobile/test/integration/auto-connect*.ts" apps/mobile/test/integration/foreground-service-runtime.test.ts apps/mobile/test/integration/shell-detail-host-page-reconnect-route.test.ts apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts apps/mobile/test/integration/tailscale-recovery-ui-store.test.ts apps/mobile/test/integration/tailscale-recovery-ui-placement.test.ts apps/mobile/test/integration/agent-notification-bridge.test.ts
pnpm --filter @fressh/mobile fmt:check
pnpm --filter @fressh/mobile lint:check
pnpm --filter @fressh/mobile typecheck
pnpm exec turbo lint:check
```

Expected: Prettier formats only listed files, then all four checks exit 0 with
no warnings treated as errors.

- [ ] **Step 3: Run source ownership and size checks**

```bash
if rg -n "createAutoConnectReconnectController|createReconnectContextCycleState|createTailscaleRecoveryActions|shouldStopReconnectOnBackground|shouldWaitForForegroundServiceCoverage" apps/mobile/src apps/mobile/test; then exit 1; fi
if rg -n "setTimeout|AbortController|ConnectionDiagnosticTraceHandle|router\.replace" apps/mobile/src/lib/auto-connect-runtime-reducer.ts; then exit 1; fi
if rg -n "setTimeout|AbortController|ConnectionDiagnosticTraceHandle" apps/mobile/src/lib/auto-connect.tsx; then exit 1; fi
rg -n "router\.replace" apps/mobile/src/lib/auto-connect.tsx
awk 'NF { count++ } END { print count }' apps/mobile/src/lib/auto-connect.tsx
git diff --check
```

Expected: the three absence checks exit 0, `router.replace` is present only at
the manager navigation boundary, the manager count is below 200, and
`git diff --check` exits 0.

- [ ] **Step 4: Verify the approved behavior checklist**

Re-read the approved design and point each item to a passing test:
automatic-only scope, one run, replacement priority, duplicate merging,
best-effort background, runtime-scoped disable URL, ephemeral restart, versioned
navigation, one trace, skip semantics, every real failure to host, Tailscale
Open/Retry/Reset, stale result suppression, notification preservation, and
disposal. Add a focused failing test before fixing any uncovered requirement.

- [ ] **Step 5: Run the thermo-nuclear review**

Invoke `$thermo-nuclear-code-quality-review` on the complete implementation
diff. It must specifically inspect reducer size, conditional growth, duplicated
priority/timing policy, port boundaries, React ownership, test-file size, and
legacy compatibility code. Resolve every blocker through a new red-green cycle,
then repeat Steps 1-3.

- [ ] **Step 6: Build and smoke-test the local Android preview**

Run:

```bash
cd apps/mobile && ANDROID_HOME=/home/muly/Android/Sdk ANDROID_SDK_ROOT=/home/muly/Android/Sdk EAS_SKIP_AUTO_FINGERPRINT=1 pnpm exec eas build --local --profile preview --platform android
```

Install only through the existing signing lane for `com.finalapp.vibe2`. Without
uninstalling or clearing data, verify:

```text
[ ] cold-start automatic connection reaches a usable terminal
[ ] reconnect replaces lower-priority work and leaves one usable terminal
[ ] background and foreground transitions resume best-effort work
[ ] Tailscale Open, Retry, and Reset follow the approved priority rules
[ ] every forced real connection failure reaches the correct host page
[ ] stale results do not replace the current screen
[ ] terminal input and output continue after connect and reconnect
[ ] existing connection, key, and notification state remains present
```

Record the preview artifact path, device/build identity, and observations in the
pull request. A failed item blocks merge and must be reproduced in a focused
failing automated test before its production fix.

- [ ] **Step 7: Confirm the verified branch state**

```bash
git status --short
git diff --stat
```

Expected: no uncommitted implementation changes remain. Each blocker fix from
Steps 5 or 6 must have its own test-first commit before this check. Record the
integration count, lint/typecheck results, architecture limits, preview
evidence, and thermo-nuclear result in the pull request. Broader physical-device
rollout, OTA updates, and app-data changes remain outside this plan.
