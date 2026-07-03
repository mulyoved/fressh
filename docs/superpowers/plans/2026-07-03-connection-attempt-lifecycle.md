# Connection Attempt Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop each connection caller from reimplementing timeout, abort,
stale-run, recovery, and cleanup behavior.

**Architecture:** First add a small `connection-run-context.ts` helper that only
owns aborts, timeout signals, stale checks, and cleanup deadlines. Then add a
small `connection-attempt-lifecycle.ts` helper only if it removes duplicated
connection attempt code. Migrate manual diagnostics first; continue to
auto-connect and reconnect only if the earlier slices make the code clearer.

**Tech Stack:** TypeScript, Expo React Native, Node `tsx --test`, pnpm, current
mobile integration-test harness.

---

## Scope Check

This plan covers one subsystem: connection attempt lifecycle ownership. It
touches several files because the current contract is spread across
auto-connect, reconnect, manual diagnostics, diagnostic shell probes, SSH
lifecycle helpers, and saved-entry Tailscale recovery.

This is a guarded migration, not a mandate to build a framework. Each task must
make the code easier to reason about before the next caller is migrated.

Stop and revise the plan if any of these happen:

- `connection-run-context.ts` starts knowing about Tailscale, tmux, navigation,
  diagnostics prompts, or reconnect backoff.
- `connection-attempt-lifecycle.ts` becomes one generic function with many modes
  instead of two focused helpers.
- Manual diagnostics get more code without active timeout cancellation becoming
  clearer.
- Auto-connect migration requires caller-specific hacks in the lifecycle.
- Reconnect migration forces awkward behavior into the lifecycle just to remove
  one `Promise.race`.

The work remains one plan because each task moves one layer to a testable state:

1. Low-level run context.
2. Explicit SSH operation signals.
3. Higher-level lifecycle core.
4. Diagnostic cleanup under lifecycle cleanup signals.
5. Manual diagnostic migration.
6. Auto-connect migration.
7. Reconnect deadline migration.
8. Verification and issue cleanup notes.

## File Structure

Create:

- `apps/mobile/src/lib/connection-run-context.ts`
  - Owns run abort reasons, timeout timers, caller abort propagation, stale-run
    checks, derived operation/recovery/cleanup signals, late-result suppression,
    cleanup operation deadlines, and abort error classification.
- `apps/mobile/test/integration/connection-run-context.test.ts`
  - Focused tests for the run context without React Native dependencies.
- `apps/mobile/src/lib/connection-attempt-lifecycle.ts`
  - Owns saved-entry and active-shell attempt semantics, Tailscale recovery
    orchestration, retry execution, typed outcomes, timeout classification,
    late-success cleanup, and cleanup failure behavior.
- `apps/mobile/test/integration/connection-attempt-lifecycle.test.ts`
  - Focused tests for lifecycle behavior with injected fake SSH/Tailscale
    dependencies.

Modify:

- `apps/mobile/src/lib/ssh-connect-flow.ts`
  - Accept explicit connect signals for lifecycle-managed callers while keeping
    the existing timeout fallback for standalone manual connection.
- `apps/mobile/src/lib/ssh-shell-lifecycle.ts`
  - Accept lifecycle-provided connect and shell signals and preserve existing
    SSH diagnostic event emission.
- `apps/mobile/src/lib/connect-and-open-shell.ts`
  - Delegate lifecycle-managed saved-entry connection to the new lifecycle while
    preserving manual connect navigation and tmux error navigation behavior.
- `apps/mobile/src/lib/diagnostic-shell-probe.ts`
  - Use lifecycle cleanup signals for diagnostic disconnect and return typed
    cleanup failures through the lifecycle.
- `apps/mobile/src/lib/connection-diagnostic-runner.ts`
  - Replace the soft diagnostic timeout `Promise.race` with a run context that
    actively aborts underlying work.
- `apps/mobile/src/lib/auto-connect-attempt.ts`
  - Use the lifecycle for saved-entry auto-connect and active-connection shell
    reopen, while keeping latest-shell selection outside the lifecycle.
- `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`
  - Replace reconnect attempt timeout races with a run context deadline and
    explicit abort reasons for stop/replace.
- `apps/mobile/src/lib/auto-connect.tsx`
  - Create and pass run contexts at the auto-connect boundary.
- Existing integration tests under `apps/mobile/test/integration/`
  - Update assertions around abort, timeout, stale, cleanup, reconnect, manual
    diagnostic, and auto-connect behavior.

Shared commands:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/connection-run-context.test.ts
pnpm exec tsx --test test/integration/connection-attempt-lifecycle.test.ts
pnpm exec tsx --test test/integration/connection-diagnostic-runner.test.ts
pnpm exec tsx --test test/integration/auto-connect-attempt.test.ts
pnpm exec tsx --test test/integration/auto-connect-reconnect-controller.test.ts
pnpm --filter @fressh/mobile typecheck
pnpm exec prettier --write src/lib/connection-run-context.ts src/lib/connection-attempt-lifecycle.ts test/integration/connection-run-context.test.ts test/integration/connection-attempt-lifecycle.test.ts
```

## Task 1: Add Connection Run Context

**Files:**

- Create: `apps/mobile/src/lib/connection-run-context.ts`
- Create: `apps/mobile/test/integration/connection-run-context.test.ts`

- [ ] **Step 1: Write the failing run-context tests**

Create `apps/mobile/test/integration/connection-run-context.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ConnectionRunAbortedError,
	createConnectionRunContext,
} from '../../src/lib/connection-run-context';

type Timer = {
	id: number;
	delayMs: number;
	callback: () => void;
	cleared: boolean;
};

function flushPromises() {
	return new Promise<void>((resolve) => {
		setImmediate(resolve);
	});
}

function harness() {
	let nextId = 1;
	const timers: Timer[] = [];
	return {
		timers,
		createContext: (
			options: Parameters<typeof createConnectionRunContext>[0] = {},
		) =>
			createConnectionRunContext({
				...options,
				setTimeout: (callback, delayMs) => {
					const timer = {
						id: nextId,
						delayMs,
						callback,
						cleared: false,
					};
					nextId += 1;
					timers.push(timer);
					return timer;
				},
				clearTimeout: (timer) => {
					(timer as Timer).cleared = true;
				},
			}),
	};
}

void test('operation timeout aborts run and operation signal', async () => {
	const context = harness();
	const run = context.createContext({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});
	const signal = run.createOperationSignal('operation');

	assert.equal(signal.aborted, false);
	assert.equal(context.timers[0]?.delayMs, 50);

	context.timers[0]?.callback();

	assert.equal(run.signal.aborted, true);
	assert.equal(signal.aborted, true);
	assert.equal(run.abortReason, 'timeout');
	assert.equal(run.timeoutKind, 'operation');
	await assert.rejects(
		() => Promise.resolve().then(() => run.throwIfAborted()),
		{
			name: 'ConnectionRunAbortedError',
		},
	);
});

void test('recovery timeout is separate from operation timeout', async () => {
	const context = harness();
	const run = context.createContext({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});
	const signal = run.createOperationSignal('recovery');

	assert.equal(context.timers[0]?.delayMs, 80);
	context.timers[0]?.callback();

	assert.equal(signal.aborted, true);
	assert.equal(run.abortReason, 'timeout');
	assert.equal(run.timeoutKind, 'recovery');
});

void test('caller abort propagates to child operation signal', () => {
	const caller = new AbortController();
	const context = harness();
	const run = context.createContext({
		callerSignal: caller.signal,
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});
	const shellSignal = run.createOperationSignal('operation');

	caller.abort();

	assert.equal(run.signal.aborted, true);
	assert.equal(shellSignal.aborted, true);
	assert.equal(run.abortReason, 'caller-aborted');
});

void test('stale run suppresses late successful operation result', async () => {
	const context = harness();
	let current = true;
	const run = context.createContext({
		isCurrent: () => current,
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});
	let resolveOperation: (value: string) => void = () => {};

	const operation = run.runOperation('operation', () => {
		return new Promise<string>((resolve) => {
			resolveOperation = resolve;
		});
	});

	current = false;
	resolveOperation('late-success');

	assert.deepEqual(await operation, {
		status: 'aborted',
		reason: 'stale-run',
		timeoutKind: null,
	});
});

void test('cleanup operation remains bounded after operation timeout', async () => {
	const context = harness();
	const run = context.createContext({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	run.createOperationSignal('operation');
	context.timers[0]?.callback();

	let cleanupSignal: AbortSignal | null = null;
	const cleanup = run.runOperation('cleanup', (signal) => {
		cleanupSignal = signal;
		return Promise.resolve('cleaned');
	});

	assert.equal(cleanupSignal?.aborted, false);
	assert.equal(context.timers[1]?.delayMs, 25);
	assert.deepEqual(await cleanup, { status: 'ok', value: 'cleaned' });
});

void test('cleanup timeout aborts hanging cleanup operation', async () => {
	const context = harness();
	const run = context.createContext({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});
	let cleanupSignal: AbortSignal | null = null;

	const cleanup = run.runOperation('cleanup', (signal) => {
		cleanupSignal = signal;
		return new Promise<string>(() => undefined);
	});

	assert.equal(context.timers[0]?.delayMs, 25);
	context.timers[0]?.callback();
	await flushPromises();

	assert.equal(cleanupSignal?.aborted, true);
	assert.deepEqual(await cleanup, {
		status: 'aborted',
		reason: 'timeout',
		timeoutKind: 'cleanup',
	});
});

void test('finish clears timers and prevents late timeout abort', () => {
	const context = harness();
	const run = context.createContext({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	run.createOperationSignal('operation');
	run.finish();
	context.timers[0]?.callback();

	assert.equal(context.timers[0]?.cleared, true);
	assert.equal(run.signal.aborted, false);
});

void test('classifyError recognizes context and DOM-style aborts', () => {
	const context = harness();
	const run = context.createContext({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	const contextError = new ConnectionRunAbortedError('stopped', null);
	const domAbort = Object.assign(new Error('The operation was aborted.'), {
		name: 'AbortError',
	});
	const nativeAbort = new Error('operation aborted by signal');
	const networkError = new Error('No route to host');

	assert.equal(run.classifyError(contextError), 'aborted');
	assert.equal(run.classifyError(domAbort), 'aborted');
	assert.equal(run.classifyError(nativeAbort), 'aborted');
	assert.equal(run.classifyError(networkError), 'failed');
});
```

- [ ] **Step 2: Run the run-context test to verify it fails**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/connection-run-context.test.ts
```

Expected: FAIL with a module resolution error for
`../../src/lib/connection-run-context`.

- [ ] **Step 3: Add the run-context implementation**

Create `apps/mobile/src/lib/connection-run-context.ts`:

```ts
export type ConnectionRunAbortReason =
	| 'caller-aborted'
	| 'replaced'
	| 'stopped'
	| 'stale-run'
	| 'timeout'
	| 'unmounted';

export type ConnectionRunTimeoutKind = 'operation' | 'recovery' | 'cleanup';

export type ConnectionRunOperationKind = ConnectionRunTimeoutKind;

export type ConnectionRunOperationResult<T> =
	| { status: 'ok'; value: T }
	| {
			status: 'aborted';
			reason: ConnectionRunAbortReason;
			timeoutKind: ConnectionRunTimeoutKind | null;
	  };

export class ConnectionRunAbortedError extends Error {
	constructor(
		readonly reason: ConnectionRunAbortReason,
		readonly timeoutKind: ConnectionRunTimeoutKind | null,
	) {
		super(
			timeoutKind
				? `Connection run aborted: ${reason} (${timeoutKind})`
				: `Connection run aborted: ${reason}`,
		);
		this.name = 'ConnectionRunAbortedError';
	}
}

export type ConnectionRunTimeouts = {
	operationTimeoutMs: number;
	recoveryTimeoutMs: number;
	cleanupTimeoutMs: number;
};

export type ConnectionRunContext = {
	readonly id: string;
	readonly signal: AbortSignal;
	readonly abortReason: ConnectionRunAbortReason | null;
	readonly timeoutKind: ConnectionRunTimeoutKind | null;
	isCurrent: () => boolean;
	throwIfAborted: () => void;
	classifyError: (error: unknown) => 'aborted' | 'failed';
	createOperationSignal: (kind: ConnectionRunOperationKind) => AbortSignal;
	runOperation: <T>(
		kind: ConnectionRunOperationKind,
		operation: (signal: AbortSignal) => Promise<T>,
	) => Promise<ConnectionRunOperationResult<T>>;
	abort: (
		reason: ConnectionRunAbortReason,
		timeoutKind?: ConnectionRunTimeoutKind | null,
	) => void;
	finish: () => void;
};

type TimerApi = {
	setTimeout: (callback: () => void, delayMs: number) => unknown;
	clearTimeout: (timer: unknown) => void;
};

type CreateConnectionRunContextOptions = {
	id?: string;
	callerSignal?: AbortSignal;
	isCurrent?: () => boolean;
	timeouts: ConnectionRunTimeouts;
	setTimeout?: TimerApi['setTimeout'];
	clearTimeout?: TimerApi['clearTimeout'];
};

const defaultSetTimeout: TimerApi['setTimeout'] = (callback, delayMs) =>
	setTimeout(callback, delayMs);

const defaultClearTimeout: TimerApi['clearTimeout'] = (timer) => {
	clearTimeout(timer as ReturnType<typeof setTimeout>);
};

function timeoutForKind(
	kind: ConnectionRunOperationKind,
	timeouts: ConnectionRunTimeouts,
) {
	switch (kind) {
		case 'operation':
			return timeouts.operationTimeoutMs;
		case 'recovery':
			return timeouts.recoveryTimeoutMs;
		case 'cleanup':
			return timeouts.cleanupTimeoutMs;
	}
}

function isAbortLikeError(error: unknown) {
	if (error instanceof ConnectionRunAbortedError) return true;
	if (!(error instanceof Error)) return false;
	if (error.name === 'AbortError') return true;
	return /abort|aborted|cancel|cancelled|canceled/i.test(error.message);
}

export function createConnectionRunContext({
	id = `connection-run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	callerSignal,
	isCurrent = () => true,
	timeouts,
	setTimeout: scheduleTimeout = defaultSetTimeout,
	clearTimeout: clearScheduledTimeout = defaultClearTimeout,
}: CreateConnectionRunContextOptions): ConnectionRunContext {
	const controller = new AbortController();
	const timers = new Set<unknown>();
	let abortReason: ConnectionRunAbortReason | null = null;
	let timeoutKind: ConnectionRunTimeoutKind | null = null;
	let finished = false;

	const clearTimer = (timer: unknown) => {
		if (!timers.has(timer)) return;
		timers.delete(timer);
		clearScheduledTimeout(timer);
	};

	const abort = (
		reason: ConnectionRunAbortReason,
		nextTimeoutKind: ConnectionRunTimeoutKind | null = null,
	) => {
		if (finished) return;
		if (abortReason === null) {
			abortReason = reason;
			timeoutKind = nextTimeoutKind;
		}
		if (!controller.signal.aborted) {
			controller.abort(new ConnectionRunAbortedError(reason, nextTimeoutKind));
		}
	};

	const callerAbortListener = () => abort('caller-aborted');
	if (callerSignal?.aborted) {
		abort('caller-aborted');
	} else {
		callerSignal?.addEventListener('abort', callerAbortListener, {
			once: true,
		});
	}

	const context: ConnectionRunContext = {
		id,
		signal: controller.signal,
		get abortReason() {
			return abortReason;
		},
		get timeoutKind() {
			return timeoutKind;
		},
		isCurrent: () => !finished && abortReason === null && isCurrent(),
		throwIfAborted: () => {
			if (abortReason !== null) {
				throw new ConnectionRunAbortedError(abortReason, timeoutKind);
			}
			if (!isCurrent()) {
				throw new ConnectionRunAbortedError('stale-run', null);
			}
		},
		classifyError: (error) => (isAbortLikeError(error) ? 'aborted' : 'failed'),
		createOperationSignal: (kind) => {
			if (kind !== 'cleanup' && abortReason !== null) {
				const child = new AbortController();
				child.abort(new ConnectionRunAbortedError(abortReason, timeoutKind));
				return child.signal;
			}
			const child = new AbortController();
			const delayMs = timeoutForKind(kind, timeouts);
			const timer = scheduleTimeout(() => {
				timers.delete(timer);
				if (kind === 'cleanup') {
					child.abort(new ConnectionRunAbortedError('timeout', 'cleanup'));
					return;
				}
				abort('timeout', kind);
			}, delayMs);
			timers.add(timer);

			const parentAbortListener = () => {
				child.abort(
					new ConnectionRunAbortedError(abortReason ?? 'stopped', timeoutKind),
				);
				clearTimer(timer);
			};
			if (kind !== 'cleanup') {
				controller.signal.addEventListener('abort', parentAbortListener, {
					once: true,
				});
			}
			child.signal.addEventListener(
				'abort',
				() => {
					clearTimer(timer);
					controller.signal.removeEventListener('abort', parentAbortListener);
				},
				{ once: true },
			);
			return child.signal;
		},
		runOperation: async (kind, operation) => {
			if (kind !== 'cleanup' && abortReason !== null) {
				return {
					status: 'aborted',
					reason: abortReason,
					timeoutKind,
				};
			}
			const signal = context.createOperationSignal(kind);
			try {
				const value = await operation(signal);
				if (kind !== 'cleanup' && abortReason !== null) {
					return {
						status: 'aborted',
						reason: abortReason,
						timeoutKind,
					};
				}
				if (kind !== 'cleanup' && !isCurrent()) {
					return {
						status: 'aborted',
						reason: 'stale-run',
						timeoutKind: null,
					};
				}
				if (signal.aborted) {
					return {
						status: 'aborted',
						reason: 'timeout',
						timeoutKind: kind,
					};
				}
				return { status: 'ok', value };
			} catch (error) {
				if (error instanceof ConnectionRunAbortedError) {
					return {
						status: 'aborted',
						reason: error.reason,
						timeoutKind: error.timeoutKind,
					};
				}
				if (signal.aborted) {
					return {
						status: 'aborted',
						reason: kind === 'cleanup' ? 'timeout' : (abortReason ?? 'timeout'),
						timeoutKind: kind === 'cleanup' ? 'cleanup' : (timeoutKind ?? kind),
					};
				}
				if (context.classifyError(error) === 'aborted') {
					return {
						status: 'aborted',
						reason: abortReason ?? 'caller-aborted',
						timeoutKind,
					};
				}
				throw error;
			}
		},
		abort,
		finish: () => {
			finished = true;
			callerSignal?.removeEventListener('abort', callerAbortListener);
			for (const timer of [...timers]) {
				clearTimer(timer);
			}
		},
	};

	return context;
}
```

- [ ] **Step 4: Run the run-context test to verify it passes**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/connection-run-context.test.ts
```

Expected: PASS for all `connection-run-context` tests.

- [ ] **Step 5: Format and commit the run context**

Run:

```bash
cd apps/mobile
pnpm exec prettier --write src/lib/connection-run-context.ts test/integration/connection-run-context.test.ts
cd ../..
git add apps/mobile/src/lib/connection-run-context.ts apps/mobile/test/integration/connection-run-context.test.ts
git commit -m "Add connection run context"
```

Expected: commit succeeds with only the new run-context files staged.

## Task 2: Thread Explicit SSH Operation Signals

**Files:**

- Modify: `apps/mobile/src/lib/ssh-connect-flow.ts`
- Modify: `apps/mobile/src/lib/ssh-shell-lifecycle.ts`
- Test: `apps/mobile/test/integration/ssh-connect-flow.test.ts`
- Test:
  `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts`

- [ ] **Step 1: Add failing connect-signal tests**

Append this test to `apps/mobile/test/integration/ssh-connect-flow.test.ts`:

```ts
void test('connectWithoutRemembering uses explicit connect signal when provided', async () => {
	const explicitSignal = new AbortController().signal;
	const signals: AbortSignal[] = [];

	await connectWithoutRemembering({
		connectionDetails,
		connect: async (params) => {
			signals.push(params.abortSignal);
			return { connectionId: 'conn-1' };
		},
		onConnectionProgress: () => {},
		abortSignalTimeoutMs: 5,
		connectSignal: explicitSignal,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
	});

	assert.equal(signals[0], explicitSignal);
});
```

Append this test to
`apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts`:

```ts
void test('connectAndOpenShell accepts lifecycle operation signals', async () => {
	const connectSignal = new AbortController().signal;
	const shellSignal = new AbortController().signal;
	const connectSignals: AbortSignal[] = [];
	const shellSignals: AbortSignal[] = [];

	await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		operationSignals: {
			connect: connectSignal,
			shell: shellSignal,
		},
		connect: async (params) => {
			connectSignals.push(params.abortSignal);
			return {
				connectionId: 'conn-1',
				startShell: async (options: { abortSignal: AbortSignal }) => {
					shellSignals.push(options.abortSignal);
					return { channelId: 7 };
				},
			} as never;
		},
		saveConnection: async () => {},
		navigate: () => {},
	});

	assert.equal(connectSignals[0], connectSignal);
	assert.equal(shellSignals[0], shellSignal);
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/ssh-connect-flow.test.ts test/integration/connect-and-open-shell-diagnostics.test.ts
```

Expected: FAIL with TypeScript/runtime errors indicating `connectSignal` and
`operationSignals` are not accepted.

- [ ] **Step 3: Add explicit connect signal support**

In `apps/mobile/src/lib/ssh-connect-flow.ts`, add `connectSignal?: AbortSignal`
to both `connectAndRememberConnection()` and `connectWithoutRemembering()`
argument types. Pass it through from `connectAndRememberConnection()` to
`connectWithoutRemembering()`. Replace the final `abortSignal` expression in
`connectWithoutRemembering()` with this code:

```ts
		abortSignal:
			args.connectSignal ??
			AbortSignalAny([
				AbortSignalTimeout(args.abortSignalTimeoutMs),
				args.abortSignal,
			]),
```

The `connectAndRememberConnection()` call to `connectWithoutRemembering()` must
include:

```ts
		connectSignal: args.connectSignal,
```

- [ ] **Step 4: Add shell operation signal support**

In `apps/mobile/src/lib/ssh-shell-lifecycle.ts`, add this type near
`ShellLifecycleFailureContext`:

```ts
export type SshShellLifecycleOperationSignals = {
	connect?: AbortSignal;
	shell?: AbortSignal;
};
```

Add `operationSignals?: SshShellLifecycleOperationSignals;` to
`runSshShellLifecycle()` args. Destructure it:

```ts
		operationSignals,
```

Change `connectConnection` type to accept an optional signal:

```ts
connectConnection: (params: {
	onConnectionProgress?: (progressEvent: SshConnectionProgress) => void;
	connectSignal?: AbortSignal;
}) => Promise<ConnectedSshConnection>;
```

Change the `connectConnection()` call to:

```ts
connected = await connectConnection({
	connectSignal: operationSignals?.connect,
	onConnectionProgress: (progressEvent) => {
		traceEvent(
			sshEvents.connectProgress({
				source: 'saved-entry',
				connection: connectionIdentity,
				phase: readSshConnectionProgressPhase(progressEvent),
			}),
		);
		onConnectionProgress?.(progressEvent);
	},
});
```

Change the shell `abortSignal` assignment to:

```ts
			abortSignal:
				operationSignals?.shell ??
				AbortSignalAny([
					AbortSignalTimeout(abortSignalTimeoutMs),
					abortSignal,
				]),
```

- [ ] **Step 5: Pass operation signals through connect-and-open-shell**

In `apps/mobile/src/lib/connect-and-open-shell.ts`, import the signal type:

```ts
	type SshShellLifecycleOperationSignals,
```

Add this argument to `connectAndOpenShell()`:

```ts
	operationSignals?: SshShellLifecycleOperationSignals;
```

Destructure it:

```ts
		operationSignals,
```

Pass it to `runSshShellLifecycle()`:

```ts
		operationSignals,
```

Change the `connectConnection` callback to accept and forward the signal:

```ts
		connectConnection: async ({ onConnectionProgress, connectSignal }) =>
			await connectAndRememberConnection({
				connectionDetails,
				connect,
				onConnectionProgress,
				abortSignalTimeoutMs,
				abortSignal,
				connectSignal,
				resolvedSecurity: security,
				saveConnection,
			}),
```

- [ ] **Step 6: Run targeted tests to verify signal threading passes**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/ssh-connect-flow.test.ts test/integration/connect-and-open-shell-diagnostics.test.ts
```

Expected: PASS for both files.

- [ ] **Step 7: Format and commit explicit SSH operation signals**

Run:

```bash
cd apps/mobile
pnpm exec prettier --write src/lib/ssh-connect-flow.ts src/lib/ssh-shell-lifecycle.ts src/lib/connect-and-open-shell.ts test/integration/ssh-connect-flow.test.ts test/integration/connect-and-open-shell-diagnostics.test.ts
cd ../..
git add apps/mobile/src/lib/ssh-connect-flow.ts apps/mobile/src/lib/ssh-shell-lifecycle.ts apps/mobile/src/lib/connect-and-open-shell.ts apps/mobile/test/integration/ssh-connect-flow.test.ts apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts
git commit -m "Thread explicit SSH operation signals"
```

Expected: commit succeeds with the SSH signal-threading changes.

## Task 3: Add Connection Attempt Lifecycle Core

**Files:**

- Create: `apps/mobile/src/lib/connection-attempt-lifecycle.ts`
- Create: `apps/mobile/test/integration/connection-attempt-lifecycle.test.ts`
- Modify: `apps/mobile/src/lib/connect-and-open-shell.ts`

- [ ] **Step 1: Write failing lifecycle core tests**

Create `apps/mobile/test/integration/connection-attempt-lifecycle.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	runActiveShellReopenAttempt,
	runSavedEntryConnectionAttempt,
	type ConnectionAttemptTimeouts,
} from '../../src/lib/connection-attempt-lifecycle';
import { createConnectionRunContext } from '../../src/lib/connection-run-context';
import { type SavedEntryConnectResult } from '../../src/lib/auto-connect-saved-entry';

type Timer = {
	delayMs: number;
	callback: () => void;
	cleared: boolean;
};

const timeouts: ConnectionAttemptTimeouts = {
	operationTimeoutMs: 50,
	recoveryTimeoutMs: 80,
	cleanupTimeoutMs: 25,
};

function flushPromises() {
	return new Promise<void>((resolve) => {
		setImmediate(resolve);
	});
}

function runHarness() {
	const timers: Timer[] = [];
	const runContext = createConnectionRunContext({
		timeouts,
		setTimeout: (callback, delayMs) => {
			const timer = { delayMs, callback, cleared: false };
			timers.push(timer);
			return timer;
		},
		clearTimeout: (timer) => {
			(timer as Timer).cleared = true;
		},
	});
	return { runContext, timers };
}

function readyRecovery() {
	return {
		ensureReady: async () => ({
			kind: 'ready' as const,
			attempted: true as const,
			available: true as const,
		}),
		recoverAfterFailure: async () => ({
			kind: 'nonNetworkFailure' as const,
			attempted: false as const,
			networkLikeFailure: false as const,
			available: true,
		}),
	};
}

function connectedResult(): SavedEntryConnectResult {
	return {
		status: 'connected',
		connectionId: 'conn-1',
		channelId: 7,
	};
}

void test('saved-entry lifecycle returns connected outcome', async () => {
	const context = runHarness();
	const phases: string[] = [];

	const outcome = await runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'auto-connect',
		runContext: context.runContext,
		timeouts,
		recovery: readyRecovery(),
		connectSavedEntry: async ({ phase }) => {
			phases.push(phase);
			return connectedResult();
		},
		cleanupConnected: async () => {},
	});

	assert.deepEqual(outcome, {
		status: 'connected',
		connectionId: 'conn-1',
		channelId: 7,
	});
	assert.deepEqual(phases, ['initial']);
});

void test('saved-entry lifecycle maps Tailscale readiness block', async () => {
	const context = runHarness();
	let connectCount = 0;

	const outcome = await runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'manual-diagnostic',
		runContext: context.runContext,
		timeouts,
		recovery: {
			ensureReady: async () => ({
				kind: 'unavailable' as const,
				attempted: false as const,
				available: false as const,
			}),
			recoverAfterFailure: async () => {
				throw new Error('recovery should not run');
			},
		},
		connectSavedEntry: async () => {
			connectCount += 1;
			throw new Error('connect should not run');
		},
		cleanupConnected: async () => {},
	});

	assert.equal(outcome.status, 'blocked');
	assert.equal(connectCount, 0);
	if (outcome.status !== 'blocked') return;
	assert.match(outcome.attentionMessage ?? '', /Tailscale/i);
});

void test('saved-entry lifecycle retries after Tailscale recovery', async () => {
	const context = runHarness();
	const phases: string[] = [];

	const outcome = await runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'auto-connect',
		runContext: context.runContext,
		timeouts,
		recovery: {
			ensureReady: async () => ({
				kind: 'ready' as const,
				attempted: true as const,
				available: true as const,
			}),
			recoverAfterFailure: async () => ({
				kind: 'recovered' as const,
				attempted: true as const,
				networkLikeFailure: true,
				available: true,
			}),
		},
		connectSavedEntry: async ({ phase }) => {
			phases.push(phase);
			if (phase === 'initial') throw new Error('No route to host');
			return connectedResult();
		},
		cleanupConnected: async () => {},
	});

	assert.equal(outcome.status, 'connected');
	assert.deepEqual(phases, ['initial', 'retry']);
});

void test('saved-entry lifecycle returns operation timeout', async () => {
	const context = runHarness();

	const outcomePromise = runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'auto-connect',
		runContext: context.runContext,
		timeouts,
		recovery: readyRecovery(),
		connectSavedEntry: async () =>
			new Promise<SavedEntryConnectResult>(() => {}),
		cleanupConnected: async () => {},
	});
	await flushPromises();

	assert.equal(context.timers[0]?.delayMs, 80);
	assert.equal(context.timers[1]?.delayMs, 50);
	context.timers[1]?.callback();

	assert.deepEqual(await outcomePromise, {
		status: 'timedOut',
		timeoutKind: 'operation',
	});
});

void test('saved-entry lifecycle cleans up stale late success', async () => {
	let current = true;
	const timers: Timer[] = [];
	const runContext = createConnectionRunContext({
		isCurrent: () => current,
		timeouts,
		setTimeout: (callback, delayMs) => {
			const timer = { delayMs, callback, cleared: false };
			timers.push(timer);
			return timer;
		},
		clearTimeout: (timer) => {
			(timer as Timer).cleared = true;
		},
	});
	let cleanupCount = 0;
	let resolveConnect: (value: SavedEntryConnectResult) => void = () => {};

	const outcomePromise = runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'auto-connect',
		runContext,
		timeouts,
		recovery: readyRecovery(),
		connectSavedEntry: async () =>
			new Promise<SavedEntryConnectResult>((resolve) => {
				resolveConnect = resolve;
			}),
		cleanupConnected: async () => {
			cleanupCount += 1;
		},
	});
	await flushPromises();

	current = false;
	resolveConnect(connectedResult());

	assert.deepEqual(await outcomePromise, {
		status: 'aborted',
		reason: 'stale-run',
	});
	assert.equal(cleanupCount, 1);
});

void test('saved-entry lifecycle returns diagnostic cleanup failure', async () => {
	const context = runHarness();
	const cleanupError = new Error('disconnect failed');

	const outcome = await runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'manual-diagnostic',
		runContext: context.runContext,
		timeouts,
		recovery: readyRecovery(),
		connectSavedEntry: async () => connectedResult(),
		cleanupConnected: async () => {
			throw cleanupError;
		},
	});

	assert.equal(outcome.status, 'cleanupFailed');
	if (outcome.status !== 'cleanupFailed') return;
	assert.equal(outcome.error, cleanupError);
	assert.deepEqual(outcome.priorOutcome, {
		status: 'connected',
		connectionId: 'conn-1',
		channelId: 7,
	});
});

void test('active shell reopen uses operation and cleanup lifecycle', async () => {
	const context = runHarness();
	const outcome = await runActiveShellReopenAttempt({
		runContext: context.runContext,
		timeouts,
		startShell: async () => ({
			connectionId: 'active-1',
			channelId: 9,
			close: async () => {},
		}),
		cleanupConnected: async () => {},
	});

	assert.deepEqual(outcome, {
		status: 'connected',
		connectionId: 'active-1',
		channelId: 9,
	});
});
```

- [ ] **Step 2: Run lifecycle tests to verify they fail**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/connection-attempt-lifecycle.test.ts
```

Expected: FAIL with a module resolution error for
`../../src/lib/connection-attempt-lifecycle`.

- [ ] **Step 3: Add lifecycle types and saved-entry orchestration**

Create `apps/mobile/src/lib/connection-attempt-lifecycle.ts`:

```ts
import {
	attemptSavedEntryWithTailscaleRecovery,
	type SavedEntryConnectAttemptPhase,
	type SavedEntryConnectResult,
	type SavedEntryTailscaleRecovery,
} from './auto-connect-saved-entry';
import {
	type ConnectionRunAbortReason,
	type ConnectionRunContext,
	type ConnectionRunTimeoutKind,
	type ConnectionRunOperationResult,
	type ConnectionRunTimeouts,
} from './connection-run-context';

export type ConnectionAttemptMode = 'auto-connect' | 'manual-diagnostic';

export type ConnectionAttemptTimeouts = ConnectionRunTimeouts;

export type ConnectionAttemptOutcome =
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
			timeoutKind: ConnectionRunTimeoutKind;
	  }
	| {
			status: 'cleanupFailed';
			error: unknown;
			priorOutcome?: Exclude<
				ConnectionAttemptOutcome,
				{ status: 'cleanupFailed' }
			>;
	  };

type SavedEntryConnectInput = {
	phase: SavedEntryConnectAttemptPhase;
	signal: AbortSignal;
};

export type RunSavedEntryConnectionAttemptArgs = {
	platformOS: string;
	mode: ConnectionAttemptMode;
	runContext: ConnectionRunContext;
	timeouts: ConnectionAttemptTimeouts;
	recovery: SavedEntryTailscaleRecovery;
	connectSavedEntry: (
		input: SavedEntryConnectInput,
	) => Promise<SavedEntryConnectResult>;
	shouldRecoverAfterFailure?: (error: unknown) => boolean;
	cleanupConnected: (
		outcome: Extract<ConnectionAttemptOutcome, { status: 'connected' }>,
	) => Promise<void>;
};

export type RunActiveShellReopenAttemptArgs = {
	runContext: ConnectionRunContext;
	timeouts: ConnectionAttemptTimeouts;
	startShell: (input: { signal: AbortSignal }) => Promise<{
		connectionId: string;
		channelId: number;
		close?: (opts?: { signal?: AbortSignal }) => Promise<void>;
	}>;
	cleanupConnected: (input: {
		connectionId: string;
		channelId: number;
		close?: (opts?: { signal?: AbortSignal }) => Promise<void>;
	}) => Promise<void>;
};

function mapAborted<T>(
	result: Extract<ConnectionRunOperationResult<T>, { status: 'aborted' }>,
): ConnectionAttemptOutcome {
	if (result.reason === 'timeout' && result.timeoutKind !== null) {
		return { status: 'timedOut', timeoutKind: result.timeoutKind };
	}
	return { status: 'aborted', reason: result.reason };
}

function mapSavedEntryResult(
	result: SavedEntryConnectResult,
): Extract<
	ConnectionAttemptOutcome,
	{ status: 'connected' | 'tmuxAttachFailed' }
> {
	if (result.status === 'tmux_attach_failed') {
		return {
			status: 'tmuxAttachFailed',
			connectionId: result.connectionId,
			tmuxAttachFailureReason: result.tmuxAttachFailureReason,
			tmuxSessionName: result.tmuxSessionName,
			storedConnectionId: result.storedConnectionId,
		};
	}
	return {
		status: 'connected',
		connectionId: result.connectionId,
		channelId: result.channelId,
	};
}

async function cleanupLateConnected(
	args: Pick<
		RunSavedEntryConnectionAttemptArgs,
		'runContext' | 'cleanupConnected'
	>,
	outcome: Extract<ConnectionAttemptOutcome, { status: 'connected' }>,
) {
	const cleanupResult = await args.runContext.runOperation(
		'cleanup',
		async () => {
			await args.cleanupConnected(outcome);
		},
	);
	if (cleanupResult.status === 'aborted') {
		return mapAborted(cleanupResult);
	}
	return null;
}

export async function runSavedEntryConnectionAttempt(
	args: RunSavedEntryConnectionAttemptArgs,
): Promise<ConnectionAttemptOutcome> {
	const readinessResult = await args.runContext.runOperation(
		'recovery',
		async () => await args.recovery.ensureReady(),
	);
	if (readinessResult.status === 'aborted') return mapAborted(readinessResult);

	const recovery = {
		...args.recovery,
		ensureReady: async () => readinessResult.value,
		recoverAfterFailure: async (error: unknown) => {
			const recoveryResult = await args.runContext.runOperation(
				'recovery',
				async () => await args.recovery.recoverAfterFailure(error),
			);
			if (recoveryResult.status === 'aborted') {
				throw new Error(
					recoveryResult.timeoutKind
						? `connection recovery ${recoveryResult.timeoutKind} timeout`
						: `connection recovery aborted: ${recoveryResult.reason}`,
				);
			}
			return recoveryResult.value;
		},
	};

	const savedEntryOutcome = await attemptSavedEntryWithTailscaleRecovery({
		platformOS: args.platformOS,
		recovery,
		shouldRecoverAfterFailure: args.shouldRecoverAfterFailure,
		connectSavedEntry: async (phase) => {
			const operation = await args.runContext.runOperation(
				'operation',
				async (signal) => await args.connectSavedEntry({ phase, signal }),
			);
			if (operation.status === 'aborted') {
				throw new Error(
					operation.timeoutKind
						? `connection operation ${operation.timeoutKind} timeout`
						: `connection operation aborted: ${operation.reason}`,
				);
			}
			return operation.value;
		},
	});

	switch (savedEntryOutcome.status) {
		case 'connected': {
			const outcome = mapSavedEntryResult(savedEntryOutcome.result);
			if (outcome.status !== 'connected') return outcome;
			if (!args.runContext.isCurrent()) {
				const cleanupOutcome = await cleanupLateConnected(args, outcome);
				return (
					cleanupOutcome ?? {
						status: 'aborted',
						reason: 'stale-run',
					}
				);
			}
			if (args.mode === 'manual-diagnostic') {
				try {
					const cleanupOutcome = await cleanupLateConnected(args, outcome);
					if (cleanupOutcome) return cleanupOutcome;
				} catch (error) {
					return {
						status: 'cleanupFailed',
						error,
						priorOutcome: outcome,
					};
				}
			}
			return outcome;
		}
		case 'tmuxAttachFailed':
			return mapSavedEntryResult(savedEntryOutcome.result);
		case 'blocked':
			return {
				status: 'blocked',
				attentionMessage: savedEntryOutcome.attentionMessage,
			};
		case 'recoveryNotAttempted':
		case 'retryFailed':
			return {
				status: 'failed',
				error: savedEntryOutcome.error,
				recoverable: savedEntryOutcome.status === 'retryFailed',
			};
		case 'threw': {
			const message =
				savedEntryOutcome.error instanceof Error
					? savedEntryOutcome.error.message
					: String(savedEntryOutcome.error);
			if (/timeout/i.test(message)) {
				return { status: 'timedOut', timeoutKind: 'operation' };
			}
			if (/aborted|stale/i.test(message)) {
				return {
					status: 'aborted',
					reason: args.runContext.abortReason ?? 'caller-aborted',
				};
			}
			return {
				status: 'failed',
				error: savedEntryOutcome.error,
				recoverable: false,
			};
		}
	}
}

export async function runActiveShellReopenAttempt({
	runContext,
	startShell,
	cleanupConnected,
}: RunActiveShellReopenAttemptArgs): Promise<ConnectionAttemptOutcome> {
	const result = await runContext.runOperation(
		'operation',
		async (signal) => await startShell({ signal }),
	);
	if (result.status === 'aborted') return mapAborted(result);

	const outcome = {
		status: 'connected' as const,
		connectionId: result.value.connectionId,
		channelId: result.value.channelId,
	};
	if (!runContext.isCurrent()) {
		const cleanupResult = await runContext.runOperation('cleanup', async () => {
			await cleanupConnected(result.value);
		});
		if (cleanupResult.status === 'aborted') return mapAborted(cleanupResult);
		return { status: 'aborted', reason: 'stale-run' };
	}
	return outcome;
}
```

- [ ] **Step 4: Run lifecycle tests to verify timeout mapping**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/connection-attempt-lifecycle.test.ts
```

Expected: PASS for lifecycle core tests, including the operation timeout test
returning `{ status: 'timedOut', timeoutKind: 'operation' }`.

- [ ] **Step 5: Format and commit lifecycle core**

Run:

```bash
cd apps/mobile
pnpm exec prettier --write src/lib/connection-attempt-lifecycle.ts test/integration/connection-attempt-lifecycle.test.ts
cd ../..
git add apps/mobile/src/lib/connection-attempt-lifecycle.ts apps/mobile/test/integration/connection-attempt-lifecycle.test.ts
git commit -m "Add connection attempt lifecycle core"
```

Expected: commit succeeds with the lifecycle core and tests.

## Task 4: Move Diagnostic Shell Probe Cleanup Onto Lifecycle Signals

**Files:**

- Modify: `apps/mobile/src/lib/diagnostic-shell-probe.ts`
- Test: `apps/mobile/test/integration/diagnostic-shell-probe.test.ts`

- [ ] **Step 1: Add a failing diagnostic cleanup signal test**

Append this test to
`apps/mobile/test/integration/diagnostic-shell-probe.test.ts`:

```ts
void test('diagnostic shell probe uses explicit cleanup signal when provided', async () => {
	const cleanupSignal = new AbortController().signal;
	const disconnectSignals: AbortSignal[] = [];

	const result = await runDiagnosticShellProbe({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		operationSignals: {
			cleanup: cleanupSignal,
		},
		connect: async () =>
			({
				connectionId: 'conn-1',
				startShell: async () => ({ channelId: 7 }),
				disconnect: async (opts?: { signal?: AbortSignal }) => {
					if (opts?.signal) disconnectSignals.push(opts.signal);
				},
			}) as never,
	});

	assert.equal(result.status, 'connected');
	assert.equal(disconnectSignals[0], cleanupSignal);
});
```

- [ ] **Step 2: Run diagnostic probe tests to verify failure**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/diagnostic-shell-probe.test.ts
```

Expected: FAIL because `operationSignals.cleanup` is not accepted.

- [ ] **Step 3: Add diagnostic probe operation signals**

In `apps/mobile/src/lib/diagnostic-shell-probe.ts`, import:

```ts
import { type SshShellLifecycleOperationSignals } from './ssh-shell-lifecycle';
```

Add this type near `ProbeTrace`:

```ts
type DiagnosticShellProbeOperationSignals =
	SshShellLifecycleOperationSignals & {
		cleanup?: AbortSignal;
	};
```

Add this arg to `runDiagnosticShellProbe()`:

```ts
	operationSignals?: DiagnosticShellProbeOperationSignals;
```

Destructure it:

```ts
		operationSignals,
```

Change diagnostic disconnect signal creation to:

```ts
await withDiagnosticDisconnectTimeout(
	Promise.resolve(
		sshConnection.disconnect?.({
			signal:
				operationSignals?.cleanup ?? AbortSignalTimeout(abortSignalTimeoutMs),
		}),
	),
	abortSignalTimeoutMs,
);
```

Pass operation signals to `runSshShellLifecycle()`:

```ts
		operationSignals,
```

Change the `connectConnection` callback to accept and forward `connectSignal`:

```ts
		connectConnection: async ({ onConnectionProgress, connectSignal }) => {
			const sshConnection = await connectWithoutRemembering({
				connectionDetails,
				connect,
				onConnectionProgress,
				abortSignalTimeoutMs,
				connectSignal,
				resolvedSecurity,
			});
			return { sshConnection, storedConnectionId };
		},
```

- [ ] **Step 4: Run diagnostic probe tests to verify pass**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/diagnostic-shell-probe.test.ts
```

Expected: PASS for diagnostic shell probe tests.

- [ ] **Step 5: Format and commit diagnostic cleanup signal support**

Run:

```bash
cd apps/mobile
pnpm exec prettier --write src/lib/diagnostic-shell-probe.ts test/integration/diagnostic-shell-probe.test.ts
cd ../..
git add apps/mobile/src/lib/diagnostic-shell-probe.ts apps/mobile/test/integration/diagnostic-shell-probe.test.ts
git commit -m "Use lifecycle cleanup signal in diagnostics"
```

Expected: commit succeeds with diagnostic probe cleanup signal support.

## Task 5: Migrate Manual Diagnostics To Active Cancellation

**Files:**

- Modify: `apps/mobile/src/lib/connection-diagnostic-runner.ts`
- Modify: `apps/mobile/src/lib/use-connection-debug-command.ts`
- Test: `apps/mobile/test/integration/connection-diagnostic-runner.test.ts`

- [ ] **Step 1: Add failing manual diagnostic abort-propagation test**

Append this test to
`apps/mobile/test/integration/connection-diagnostic-runner.test.ts`:

```ts
void test('manual diagnostic timeout aborts underlying saved-entry work', async () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	let observedSignal: AbortSignal | null = null;
	let resolveConnectStarted: () => void = () => {};
	const connectStarted = new Promise<void>((resolve) => {
		resolveConnectStarted = resolve;
	});

	const resultPromise = createManualConnectionDiagnosticRunner().run({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolveKeySecurity: async () => ({ type: 'key', privateKey: 'secret' }),
		connectSavedEntry: async ({ signal }) => {
			observedSignal = signal;
			resolveConnectStarted();
			return new Promise<DiagnosticShellProbeResult>(() => undefined);
		},
		recovery: readyRecovery,
		timeoutMs: 5,
	});

	await connectStarted;
	const result = await resultPromise;

	assert.equal(result.status, 'failed');
	assert.equal(observedSignal?.aborted, true);
	assert.match(result.prompt, /timed out/i);
});
```

This test requires changing the manual diagnostic `connectSavedEntry` callback
type from no signal to `{ signal: AbortSignal }`.

- [ ] **Step 2: Run manual diagnostic tests to verify failure**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/connection-diagnostic-runner.test.ts
```

Expected: FAIL because `connectSavedEntry` receives no lifecycle signal.

- [ ] **Step 3: Change manual diagnostic callback type**

In `apps/mobile/src/lib/connection-diagnostic-runner.ts`, change
`ManualConnectionDiagnosticArgs['connectSavedEntry']` to:

```ts
connectSavedEntry: (args: {
	connectionDetails: InputConnectionDetails;
	resolvedSecurity: ResolvedKeySecurity;
	trace: ConnectionDiagnosticTraceHandle;
	signal: AbortSignal;
}) => Promise<DiagnosticShellProbeResult>;
```

In `apps/mobile/src/lib/use-connection-debug-command.ts`, update the call to
`runDiagnosticShellProbe()` so it forwards the signal:

```ts
			connectSavedEntry: async ({
				connectionDetails,
				resolvedSecurity,
				trace,
				signal,
			}) =>
				await runDiagnosticShellProbe({
					connectionDetails,
					connect,
					resolvedSecurity,
					trace,
					operationSignals: {
						connect: signal,
						shell: signal,
						cleanup: signal,
					},
				}),
```

- [ ] **Step 4: Replace manual diagnostic soft timeout with run context**

In `apps/mobile/src/lib/connection-diagnostic-runner.ts`, import:

```ts
import {
	createConnectionRunContext,
	type ConnectionRunContext,
} from './connection-run-context';
```

Delete `ManualDiagnosticTimeoutError` and `withManualDiagnosticTimeout()`.

Add this constant below `DEFAULT_MANUAL_DIAGNOSTIC_TIMEOUT_MS`:

```ts
const DEFAULT_MANUAL_DIAGNOSTIC_CLEANUP_TIMEOUT_MS = 5_000;
```

Add `runContext` to `ManualConnectionDiagnosticAttemptContext`:

```ts
runContext: ConnectionRunContext;
```

When calling `args.connectSavedEntry()`, pass the operation signal:

```ts
					args.connectSavedEntry({
						connectionDetails: normalizedDetails,
						resolvedSecurity,
						trace: traceHandle,
						signal: runContext.createOperationSignal('operation'),
					}),
```

In `runManualConnectionDiagnosticWithState()`, replace the
`withManualDiagnosticTimeout()` call with:

```ts
const timeoutMs = args.timeoutMs ?? DEFAULT_MANUAL_DIAGNOSTIC_TIMEOUT_MS;
const runContext = createConnectionRunContext({
	callerSignal: undefined,
	isCurrent: () => state.activeRunToken === runToken,
	timeouts: {
		operationTimeoutMs: timeoutMs,
		recoveryTimeoutMs: timeoutMs,
		cleanupTimeoutMs: DEFAULT_MANUAL_DIAGNOSTIC_CLEANUP_TIMEOUT_MS,
	},
});

try {
	const result = await runManualConnectionDiagnosticAttempt(args, state, {
		setHandle: (next) => {
			handle = next;
		},
		ensureCurrentRun,
		runContext,
	});
	if (runContext.abortReason === 'timeout') {
		throw new Error(`Connection diagnostic timed out after ${timeoutMs}ms`);
	}
	return result;
} catch (error) {
	if (!handle) {
		throw error;
	}
	const isTimeout =
		runContext.abortReason === 'timeout' ||
		(error instanceof Error && /timed out/i.test(error.message));
	if (isTimeout) {
		safeTraceEvent(
			handle,
			manualDiagnosticEvents.timeout({
				timeoutMs,
				message: `Connection diagnostic timed out after ${timeoutMs}ms`,
			}),
		);
		return finish(handle, 'failed', args);
	}
	safeTraceEvent(
		handle,
		manualDiagnosticEvents.failed({
			source: 'manual-diagnostic',
			error,
		}),
	);
	return finish(handle, 'failed', args);
} finally {
	runContext.finish();
	if (state.activeRunToken === runToken) {
		state.activeTraceHandle = null;
		state.activeRunToken = null;
		state.running = false;
	}
}
```

Keep the existing stale-run token checks; the run context now uses them as its
`isCurrent()` source.

- [ ] **Step 5: Run manual diagnostic tests**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/connection-diagnostic-runner.test.ts
```

Expected: PASS. Existing timeout tests should still report public status
`failed` and include `manual-diagnostic.timeout` in the prompt.

- [ ] **Step 6: Format and commit manual diagnostic migration**

Run:

```bash
cd apps/mobile
pnpm exec prettier --write src/lib/connection-diagnostic-runner.ts src/lib/use-connection-debug-command.ts test/integration/connection-diagnostic-runner.test.ts
cd ../..
git add apps/mobile/src/lib/connection-diagnostic-runner.ts apps/mobile/src/lib/use-connection-debug-command.ts apps/mobile/test/integration/connection-diagnostic-runner.test.ts
git commit -m "Actively cancel manual diagnostics"
```

Expected: commit succeeds with manual diagnostics using run-context signals.

- [ ] **Step 7: Check whether the extraction paid for itself**

Run:

```bash
git show --stat --oneline HEAD
git diff HEAD~1..HEAD -- apps/mobile/src/lib/connection-diagnostic-runner.ts apps/mobile/src/lib/diagnostic-shell-probe.ts apps/mobile/src/lib/connection-run-context.ts
```

Expected: the code now clearly shows one owner for manual diagnostic timeout and
abort behavior. If the diff makes manual diagnostics harder to understand, stop
before Task 6 and simplify the run-context API before migrating auto-connect.

## Task 6: Migrate Auto-Connect Attempts To Lifecycle Outcomes

**Files:**

- Modify: `apps/mobile/src/lib/auto-connect-attempt.ts`
- Modify: `apps/mobile/src/lib/auto-connect.tsx`
- Test: `apps/mobile/test/integration/auto-connect-attempt.test.ts`

- [ ] **Step 1: Add failing stale late-success cleanup test**

Append this test to `apps/mobile/test/integration/auto-connect-attempt.test.ts`:

```ts
void test('auto-connect cleans up stale saved-entry late success without navigation', async () => {
	const abortController = new AbortController();
	const navigations: unknown[] = [];
	let cleanupCount = 0;
	const { logger } = createLogger();

	const resultPromise = attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/shell',
		latestShell: null,
		connections: {},
		openSavedEntryShell: async ({ abortSignal }) => {
			abortController.abort();
			assert.equal(abortSignal?.aborted, true);
			cleanupCount += 1;
			return {
				status: 'connected',
				connectionId: 'conn-1',
				channelId: 7,
			};
		},
		loadLatestSavedConnection: async () => createSavedEntry(),
		resolveKeySecurity: async () => ({ type: 'key', privateKey: 'secret' }),
		navigateToShell: (connectionId, channelId) => {
			navigations.push({ connectionId, channelId });
		},
		recovery: readyRecovery,
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logger,
		abortSignal: abortController.signal,
	});

	assert.equal(await resultPromise, false);
	assert.deepEqual(navigations, []);
	assert.equal(cleanupCount, 1);
});
```

- [ ] **Step 2: Run auto-connect attempt tests to verify failure**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/auto-connect-attempt.test.ts
```

Expected: FAIL because auto-connect still checks only the plain abort signal and
does not use lifecycle cleanup outcomes.

- [ ] **Step 3: Create a run context in AutoConnectManager**

In `apps/mobile/src/lib/auto-connect.tsx`, import:

```ts
import { createConnectionRunContext } from './connection-run-context';
```

Add constants near the reconnect constants:

```ts
const AUTO_CONNECT_OPERATION_TIMEOUT_MS = 5_000;
const AUTO_CONNECT_RECOVERY_TIMEOUT_MS = 60_000;
const AUTO_CONNECT_CLEANUP_TIMEOUT_MS = 5_000;
```

Inside `attemptAutoConnect`, after the early abort checks and before setting
`inFlightRef.current = true`, create:

```ts
const runContext = createConnectionRunContext({
	callerSignal: signal,
	isCurrent: () => inFlightRef.current,
	timeouts: {
		operationTimeoutMs: AUTO_CONNECT_OPERATION_TIMEOUT_MS,
		recoveryTimeoutMs: AUTO_CONNECT_RECOVERY_TIMEOUT_MS,
		cleanupTimeoutMs: AUTO_CONNECT_CLEANUP_TIMEOUT_MS,
	},
});
```

Pass `runContext` into `attemptAutoConnectSource()`:

```ts
				runContext,
```

In the `finally` block, call:

```ts
runContext.finish();
```

- [ ] **Step 4: Accept run context in auto-connect attempt args**

In `apps/mobile/src/lib/auto-connect-attempt.ts`, import:

```ts
import {
	runActiveShellReopenAttempt,
	runSavedEntryConnectionAttempt,
	type ConnectionAttemptTimeouts,
} from './connection-attempt-lifecycle';
import { type ConnectionRunContext } from './connection-run-context';
```

Add constants near the type definitions:

```ts
const DEFAULT_AUTO_CONNECT_TIMEOUTS: ConnectionAttemptTimeouts = {
	operationTimeoutMs: 5_000,
	recoveryTimeoutMs: 60_000,
	cleanupTimeoutMs: 5_000,
};
```

Add these fields to `AutoConnectAttemptSourceArgs`:

```ts
	runContext?: ConnectionRunContext;
	timeouts?: ConnectionAttemptTimeouts;
```

Inside `attemptAutoConnectSource()`, add:

```ts
const timeouts = args.timeouts ?? DEFAULT_AUTO_CONNECT_TIMEOUTS;
```

If the function currently destructures args directly, include `runContext` and
`timeouts: providedTimeouts` in that destructure and define:

```ts
const timeouts = providedTimeouts ?? DEFAULT_AUTO_CONNECT_TIMEOUTS;
```

- [ ] **Step 5: Use lifecycle for active-connection shell reopen**

Replace the active connection `startShell()` block in
`attemptAutoConnectSource()` with lifecycle execution:

```ts
const result = runContext
	? await runActiveShellReopenAttempt({
			runContext,
			timeouts,
			startShell: async ({ signal }) => {
				const shellHandle = await activeConnection.startShell({
					term: 'Xterm',
					useTmux,
					tmuxSessionName,
					abortSignal: signal,
				});
				return {
					connectionId: activeConnection.connectionId,
					channelId: shellHandle.channelId,
					close: shellHandle.close,
				};
			},
			cleanupConnected: async ({ close }) => {
				await close?.({ signal: runContext.createOperationSignal('cleanup') });
			},
		})
	: null;
if (result) {
	if (result.status === 'connected') {
		logger.info('Reconnected by reopening shell on active connection', {
			connectionId: activeConnection.connectionId,
			channelId: result.channelId,
		});
		traceEvent(
			autoConnectEvents.activeConnectionShellConnected({
				source: 'active-connection',
				connection: activeConnectionIdentity,
				channelId: result.channelId,
				pathname,
			}),
		);
		navigateToShell(activeConnection.connectionId, result.channelId);
		clearTailscaleAttention();
		return true;
	}
	if (result.status === 'aborted' || result.status === 'timedOut') {
		return false;
	}
}
```

Keep the existing fallback path for the no-`runContext` case until all callers
pass a context.

- [ ] **Step 6: Use lifecycle for saved-entry auto-connect**

Replace the direct `attemptSavedEntryWithTailscaleRecovery()` call with:

```ts
const result = runContext
	? await runSavedEntryConnectionAttempt({
			platformOS,
			mode: 'auto-connect',
			runContext,
			timeouts,
			recovery: tracedRecovery,
			connectSavedEntry: async ({ phase, signal }) =>
				await tracedConnectSavedEntry(phase, signal),
			cleanupConnected: async () => {
				clearTailscaleAttention();
			},
		})
	: await attemptSavedEntryWithTailscaleRecovery({
			platformOS,
			recovery: tracedRecovery,
			connectSavedEntry: tracedConnectSavedEntry,
			shouldRecoverAfterFailure: () => true,
		});
```

Change `tracedConnectSavedEntry` to accept the signal:

```ts
	const tracedConnectSavedEntry = async (
		phase: SavedEntryConnectAttemptPhase,
		signal?: AbortSignal,
	) => {
```

Change `connectSavedEntry()` to accept the signal:

```ts
const connectSavedEntry = (signal?: AbortSignal) =>
	openSavedEntryShell({
		connectionDetails: normalizedDetails,
		resolvedSecurity,
		navigate: ({ connectionId, channelId }) => {
			if (isAborted()) return;
			navigateToShell(connectionId, channelId);
		},
		abortSignal: signal ?? abortSignal,
	});
```

Then call `connectSavedEntry(signal)`.

Add a small adapter function below the lifecycle call if keeping both old and
new result shapes in the same switch:

```ts
const normalizedResult =
	'status' in result && result.status === 'tmuxAttachFailed' ? result : result;
```

During implementation, prefer splitting the switch into two explicit switches if
TypeScript narrowing becomes unclear. Both switches must map public auto-connect
behavior to `true` or `false` exactly as before.

- [ ] **Step 7: Run auto-connect tests**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/auto-connect-attempt.test.ts test/integration/connect-and-open-shell-diagnostics.test.ts
```

Expected: PASS. Existing auto-connect success, Tailscale attention, tmux
failure, and abort tests keep the same public boolean behavior.

- [ ] **Step 8: Format and commit auto-connect lifecycle migration**

Run:

```bash
cd apps/mobile
pnpm exec prettier --write src/lib/auto-connect-attempt.ts src/lib/auto-connect.tsx test/integration/auto-connect-attempt.test.ts
cd ../..
git add apps/mobile/src/lib/auto-connect-attempt.ts apps/mobile/src/lib/auto-connect.tsx apps/mobile/test/integration/auto-connect-attempt.test.ts
git commit -m "Use lifecycle for auto-connect attempts"
```

Expected: commit succeeds with auto-connect using run contexts and lifecycle
outcomes.

- [ ] **Step 9: Check auto-connect complexity before touching reconnect**

Run:

```bash
git show --stat --oneline HEAD
git diff HEAD~1..HEAD -- apps/mobile/src/lib/auto-connect-attempt.ts apps/mobile/src/lib/auto-connect.tsx apps/mobile/src/lib/connection-attempt-lifecycle.ts
```

Expected: auto-connect no longer owns saved-entry retry, stale late-success
cleanup, and operation timeout wiring directly. If the lifecycle now contains
auto-connect-specific UI behavior, stop before Task 7 and move that behavior
back to `auto-connect-attempt.ts`.

## Task 7: Replace Reconnect Attempt Promise.race With Run Context

**Files:**

- Modify: `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`
- Test: `apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`

- [ ] **Step 1: Add failing reconnect explicit abort reason test**

Append this test to
`apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`:

```ts
void test('replace aborts active reconnect attempt before starting new loop', async () => {
	const abortStates: boolean[] = [];
	const context = harness({
		attemptAutoConnect: async (signal) => {
			abortStates.push(signal.aborted);
			signal.addEventListener('abort', () => {
				abortStates.push(signal.aborted);
			});
			return new Promise<boolean>(() => undefined);
		},
	});

	assert.equal(context.controller.start('shell-drop'), true);
	await flushPromises();
	assert.equal(context.controller.replace('manual-reset'), true);
	await flushPromises();

	assert.deepEqual(abortStates.slice(0, 2), [false, true]);
	assert.equal(context.controller.isRunning(), true);
});
```

- [ ] **Step 2: Run reconnect tests to verify existing behavior**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/auto-connect-reconnect-controller.test.ts
```

Expected: Existing tests may pass, but the new test should expose whether
replace aborts and restarts deterministically. If it passes before code changes,
keep the test as regression coverage and continue to Step 3.

- [ ] **Step 3: Import and use connection run context**

In `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`, import:

```ts
import {
	createConnectionRunContext,
	type ConnectionRunContext,
} from './connection-run-context';
```

Delete the `ReconnectAttemptTimeoutError` class.

Replace:

```ts
let attemptAbortController: AbortController | null = null;
let attemptDeadlineTimer: unknown = null;
```

with:

```ts
let activeRunContext: ConnectionRunContext | null = null;
```

Replace `runAttemptWithDeadline()` with:

```ts
const runAttemptWithDeadline = async (
	timeoutMs: number,
	loopGeneration: number,
) => {
	const runContext = createConnectionRunContext({
		isCurrent: () => isCurrentLoop(loopGeneration),
		timeouts: {
			operationTimeoutMs: timeoutMs,
			recoveryTimeoutMs: timeoutMs,
			cleanupTimeoutMs: 5_000,
		},
		setTimeout,
		clearTimeout,
	});
	activeRunContext = runContext;
	try {
		const success = await attemptAutoConnect(runContext.signal);
		if (runContext.abortReason === 'timeout') {
			return { status: 'timedOut' as const };
		}
		if (!runContext.isCurrent()) {
			return { status: 'aborted' as const };
		}
		return { status: 'completed' as const, success };
	} finally {
		runContext.finish();
		if (activeRunContext === runContext) {
			activeRunContext = null;
		}
	}
};
```

Change `stop()` abort cleanup to:

```ts
activeRunContext?.abort(reason.includes('restart') ? 'replaced' : 'stopped');
activeRunContext = null;
```

Remove the old `attemptDeadlineTimer` clearing block.

- [ ] **Step 4: Update reconnect attempt result handling**

In `attemptWithBackoff()`, replace:

```ts
success = await runAttemptWithDeadline(windowMs - elapsedMs);
```

with:

```ts
const attemptResult = await runAttemptWithDeadline(
	windowMs - elapsedMs,
	loopGeneration,
);
if (attemptResult.status === 'timedOut') {
	logger.warn('Reconnect attempt timed out', {
		timeoutMs: windowMs - elapsedMs,
	});
	traceEvent(
		reconnectEvents.timeout({
			source: 'reconnect-controller',
			reconnectElapsedMs: windowMs,
			windowMs,
		}),
	);
	stop('retry-timeout');
	return;
}
if (attemptResult.status === 'aborted') {
	return;
}
success = attemptResult.success;
```

Delete the catch branch that checks
`error instanceof ReconnectAttemptTimeoutError`.

- [ ] **Step 5: Run reconnect tests**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/auto-connect-reconnect-controller.test.ts
```

Expected: PASS. The existing hung reconnect test should still trace
`reconnect.timeout` and `reconnect.stopped`.

- [ ] **Step 6: Format and commit reconnect migration**

Run:

```bash
cd apps/mobile
pnpm exec prettier --write src/lib/auto-connect-reconnect-controller.ts test/integration/auto-connect-reconnect-controller.test.ts
cd ../..
git add apps/mobile/src/lib/auto-connect-reconnect-controller.ts apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts
git commit -m "Use run context for reconnect attempts"
```

Expected: commit succeeds with reconnect using the shared run-context deadline.

## Task 8: Verification, Typecheck, And Issue Cleanup Notes

**Files:**

- Modify: `docs/superpowers/plans/2026-07-03-connection-attempt-lifecycle.md`
  only if execution notes need to be appended by the worker.

- [ ] **Step 1: Run the lifecycle and connection integration slice**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test \
  test/integration/connection-run-context.test.ts \
  test/integration/connection-attempt-lifecycle.test.ts \
  test/integration/ssh-connect-flow.test.ts \
  test/integration/connect-and-open-shell-diagnostics.test.ts \
  test/integration/diagnostic-shell-probe.test.ts \
  test/integration/connection-diagnostic-runner.test.ts \
  test/integration/auto-connect-attempt.test.ts \
  test/integration/auto-connect-reconnect-controller.test.ts
```

Expected: PASS for all listed test files.

- [ ] **Step 2: Run mobile typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run Prettier on touched files**

Run:

```bash
cd apps/mobile
pnpm exec prettier --write \
  src/lib/connection-run-context.ts \
  src/lib/connection-attempt-lifecycle.ts \
  src/lib/ssh-connect-flow.ts \
  src/lib/ssh-shell-lifecycle.ts \
  src/lib/connect-and-open-shell.ts \
  src/lib/diagnostic-shell-probe.ts \
  src/lib/connection-diagnostic-runner.ts \
  src/lib/use-connection-debug-command.ts \
  src/lib/auto-connect-attempt.ts \
  src/lib/auto-connect.tsx \
  src/lib/auto-connect-reconnect-controller.ts \
  test/integration/connection-run-context.test.ts \
  test/integration/connection-attempt-lifecycle.test.ts \
  test/integration/ssh-connect-flow.test.ts \
  test/integration/connect-and-open-shell-diagnostics.test.ts \
  test/integration/diagnostic-shell-probe.test.ts \
  test/integration/connection-diagnostic-runner.test.ts \
  test/integration/auto-connect-attempt.test.ts \
  test/integration/auto-connect-reconnect-controller.test.ts
```

Expected: Prettier reports each touched file written or unchanged.

- [ ] **Step 4: Run final git status check**

Run:

```bash
git status --short
```

Expected: clean worktree after the task commits, or only intentional uncommitted
notes if the worker has been told not to commit.

- [ ] **Step 5: Record issue disposition**

After tests pass, update the implementation summary with this exact disposition:

```md
Issue disposition:

- #118 is implemented by the shared run context plus connection attempt
  lifecycle.
- #112 can be closed if auto-connect stop/replace aborts in-flight work and
  stale results cannot mutate UI.
- #117 can be closed if manual diagnostic timeout aborts the underlying
  connect/shell/probe work.
```

If any condition is not true, write the narrowed follow-up as a concrete issue
title and body before closing the implementation session:

```md
Follow-up issue title: Finish <specific remaining behavior> Follow-up issue
body: The connection attempt lifecycle migration left one behavior out of scope:
<specific remaining behavior>. Acceptance: <observable passing condition>.
```

- [ ] **Step 6: Commit final verification notes only if files changed**

If Step 5 caused a tracked documentation change, run:

```bash
git add docs/superpowers/plans/2026-07-03-connection-attempt-lifecycle.md
git commit -m "Document connection lifecycle verification"
```

Expected: commit succeeds only if the plan or implementation notes changed.

## Self-Review

Spec coverage:

- Two-layer architecture is covered by Tasks 1 and 3.
- Operation, recovery, and cleanup timeouts are covered by Tasks 1, 3, 4, 5,
  and 7.
- Saved-entry auto-connect and manual diagnostics using one lifecycle model are
  covered by Tasks 5 and 6.
- Active-connection shell reopen lifecycle coverage is in Task 6.
- Reconnect deadline migration away from `Promise.race` is in Task 7.
- Late-success cleanup and stale suppression are covered by Tasks 1, 3, and 6.
- Caller abort, native failure, tmux/shell failure, stale run, and cleanup
  failure coverage are included in Tasks 2 through 7.
- #112 and #117 disposition is covered by Task 8.

Placeholder scan:

- The plan contains no placeholder markers, no empty task shells, and no
  references to undefined task names.

Type consistency:

- `ConnectionRunAbortReason`, `ConnectionRunTimeoutKind`,
  `ConnectionRunTimeouts`, `ConnectionRunContext`, `ConnectionAttemptTimeouts`,
  and `ConnectionAttemptOutcome` are introduced before later tasks reference
  them.
- The lifecycle uses `operation`, `recovery`, and `cleanup` operation kinds
  consistently across tests and implementation.
- Manual diagnostic and auto-connect migrations both pass `AbortSignal` values
  under the same lifecycle signal vocabulary.
