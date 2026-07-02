# Connection Run Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize auto-connect, reconnect, and manual diagnostic cancellation in one connection run context while keeping existing user-facing result contracts stable.

**Architecture:** Add `connection-run-context.ts` as the owner of run aborts, derived operation signals, timeout disposal, stale checks, and abort classification. Thread it into manual diagnostics, diagnostic probes, SSH lifecycle helpers, saved-entry auto-connect, active shell reopen, and reconnect stop/replacement while leaving reconnect backoff, Tailscale recovery policy, tracing vocabulary, navigation, and prompt formatting in their current modules.

**Tech Stack:** TypeScript, Expo React Native mobile app, Node `tsx --test`, pnpm, React hooks, Zustand store, current integration test harness.

---

## Scope Check

The approved spec touches one subsystem: connection-run cancellation ownership.
It crosses several files because the current cancellation path is spread across
auto-connect, reconnect, manual diagnostics, saved-entry recovery, and SSH
lifecycle helpers. The plan keeps this as one implementation because each task
produces working software against the same shared run-context contract.

## File Structure

Create:

- `apps/mobile/src/lib/connection-run-context.ts`
  - Owns run timeout, caller abort propagation, explicit abort reasons, derived
    operation signals, stale checks, late-result suppression, and abort
    classification.
- `apps/mobile/test/integration/connection-run-context.test.ts`
  - Focused tests for the context without SSH or React dependencies.

Modify:

- `apps/mobile/src/lib/ssh-connect-flow.ts`
  - Accepts an explicit connect `AbortSignal` and keeps a fallback timeout for
    standalone callers.
- `apps/mobile/src/lib/ssh-shell-lifecycle.ts`
  - Uses run-context operations for SSH connect and shell start.
  - Returns an internal aborted lifecycle result.
- `apps/mobile/src/lib/connect-and-open-shell.ts`
  - Accepts optional `runContext`.
  - Creates a standalone context for normal user-initiated connection mutation
    when no context is supplied.
  - Returns an internal aborted result without navigating.
- `apps/mobile/src/lib/diagnostic-shell-probe.ts`
  - Accepts `runContext`.
  - Uses context-derived signals for connect, shell, and cleanup.
  - Preserves cleanup failure semantics.
- `apps/mobile/src/lib/connection-diagnostic-runner.ts`
  - Replaces `Promise.race` timeout with a run context.
  - Keeps public result statuses unchanged.
- `apps/mobile/src/lib/connection-debug-command.ts`
  - Passes the manual diagnostic run context into `runDiagnosticShellProbe`.
- `apps/mobile/src/lib/auto-connect-saved-entry.ts`
  - Accepts `runContext` and returns an aborted saved-entry outcome across
    readiness, connect, recovery, and retry.
- `apps/mobile/src/lib/auto-connect-attempt.ts`
  - Accepts `runContext`, checks staleness before stateful side effects, and
    uses context signals for active shell reopen and saved-entry connect.
- `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`
  - Tracks the active attempt abort callback so `stop()` and `replace()` abort
    in-flight work.
- `apps/mobile/src/lib/auto-connect.tsx`
  - Creates the auto-connect run context and bridges reconnect stop/replacement
    into abort.

Modify tests:

- `apps/mobile/test/integration/ssh-connect-flow.test.ts`
- `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts`
- `apps/mobile/test/integration/diagnostic-shell-probe.test.ts`
- `apps/mobile/test/integration/connection-diagnostic-runner.test.ts`
- `apps/mobile/test/integration/connection-debug-command.test.ts`
- `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`
- `apps/mobile/test/integration/auto-connect-attempt.test.ts`
- `apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`

## Shared Commands

Run targeted tests from `apps/mobile` unless a step says otherwise:

```bash
pnpm exec tsx --test test/integration/<file>.test.ts
```

Run typecheck:

```bash
pnpm --filter @fressh/mobile typecheck
```

Run formatting for touched files:

```bash
pnpm exec prettier --write <files>
```

---

### Task 1: Add The Connection Run Context

**Files:**

- Create: `apps/mobile/src/lib/connection-run-context.ts`
- Create: `apps/mobile/test/integration/connection-run-context.test.ts`

- [ ] **Step 1: Write the failing context tests**

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

void test('timeout aborts the run and connect operation signal', async () => {
	const context = harness();
	const run = context.createContext({ timeoutMs: 50 });
	const connectSignal = run.createOperationSignal('connect');

	assert.equal(run.signal.aborted, false);
	assert.equal(connectSignal.aborted, false);
	assert.equal(context.timers[0]?.delayMs, 50);

	context.timers[0]?.callback();

	assert.equal(run.signal.aborted, true);
	assert.equal(connectSignal.aborted, true);
	assert.equal(run.abortReason, 'timeout');
	await assert.rejects(() => Promise.resolve().then(() => run.throwIfAborted()), {
		name: 'ConnectionRunAbortedError',
	});
});

void test('caller abort propagates to operation signals', () => {
	const caller = new AbortController();
	const context = harness();
	const run = context.createContext({ callerSignal: caller.signal });
	const shellSignal = run.createOperationSignal('shell');

	caller.abort();

	assert.equal(run.signal.aborted, true);
	assert.equal(shellSignal.aborted, true);
	assert.equal(run.abortReason, 'caller-aborted');
});

void test('stopped run suppresses late successful operation result', async () => {
	const context = harness();
	const run = context.createContext();
	let resolveOperation: (value: string) => void = () => {};

	const operation = run.runOperation('connect', () => {
		return new Promise<string>((resolve) => {
			resolveOperation = resolve;
		});
	});

	run.abort('stopped');
	resolveOperation('connected-after-stop');

	assert.deepEqual(await operation, {
		status: 'aborted',
		reason: 'stopped',
	});
});

void test('cleanup operation is bounded separately after main timeout', async () => {
	const context = harness();
	const run = context.createContext({
		timeoutMs: 10,
		cleanupTimeoutMs: 25,
	});

	context.timers[0]?.callback();
	assert.equal(run.abortReason, 'timeout');

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
	const run = context.createContext({ cleanupTimeoutMs: 25 });
	let cleanupSignal: AbortSignal | null = null;

	const cleanup = run.runOperation('cleanup', (signal) => {
		cleanupSignal = signal;
		return new Promise<string>(() => undefined);
	});

	context.timers[0]?.callback();

	assert.equal(cleanupSignal?.aborted, true);
	assert.deepEqual(await cleanup, {
		status: 'aborted',
		reason: 'timeout',
	});
});

void test('finish clears timers and prevents late timeout abort', () => {
	const context = harness();
	const run = context.createContext({ timeoutMs: 10 });

	run.finish();
	context.timers[0]?.callback();

	assert.equal(context.timers[0]?.cleared, true);
	assert.equal(run.signal.aborted, false);
});

void test('classifyError recognizes context, DOM-style, and native abort errors', () => {
	const context = harness();
	const run = context.createContext();
	const domAbort = new Error('operation aborted');
	domAbort.name = 'AbortError';

	assert.equal(
		run.classifyError(new ConnectionRunAbortedError('stopped')),
		'aborted',
	);
	assert.equal(run.classifyError(domAbort), 'aborted');
	assert.equal(run.classifyError({ name: 'AbortError' }), 'aborted');
	assert.equal(run.classifyError(new Error('network unreachable')), 'failed');
});

void test('stale run check aborts operation completion as stale-run', async () => {
	const context = harness();
	const run = context.createContext({ isCurrent: () => false });

	const result = await run.runOperation('shell', async () => ({ channelId: 7 }));

	assert.deepEqual(result, {
		status: 'aborted',
		reason: 'stale-run',
	});
});
```

- [ ] **Step 2: Run the context tests to verify they fail**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/connection-run-context.test.ts
```

Expected: FAIL with a module resolution error for
`../../src/lib/connection-run-context`.

- [ ] **Step 3: Implement the connection run context**

Create `apps/mobile/src/lib/connection-run-context.ts`:

```ts
export type ConnectionRunAbortReason =
	| 'timeout'
	| 'caller-aborted'
	| 'replaced'
	| 'stopped'
	| 'stale-run'
	| 'unmounted';

export type ConnectionRunOperationKind = 'connect' | 'shell' | 'cleanup';

export type ConnectionRunOperationResult<T> =
	| { status: 'ok'; value: T }
	| { status: 'aborted'; reason: ConnectionRunAbortReason };

type TimerApi = {
	setTimeout: (callback: () => void, delayMs: number) => unknown;
	clearTimeout: (timer: unknown) => void;
};

export class ConnectionRunAbortedError extends Error {
	constructor(readonly reason: ConnectionRunAbortReason) {
		super(`Connection run aborted: ${reason}`);
		this.name = 'ConnectionRunAbortedError';
	}
}

export type ConnectionRunContext = {
	readonly id: string;
	readonly signal: AbortSignal;
	readonly deadlineMs: number | null;
	readonly abortReason: ConnectionRunAbortReason | null;
	isCurrent: () => boolean;
	throwIfAborted: () => void;
	classifyError: (error: unknown) => 'aborted' | 'failed';
	createOperationSignal: (kind: ConnectionRunOperationKind) => AbortSignal;
	runOperation: <T>(
		kind: ConnectionRunOperationKind,
		operation: (signal: AbortSignal) => Promise<T>,
	) => Promise<ConnectionRunOperationResult<T>>;
	abort: (reason: ConnectionRunAbortReason) => void;
	finish: () => void;
};

export function isConnectionRunAbortedError(
	error: unknown,
): error is ConnectionRunAbortedError {
	return error instanceof ConnectionRunAbortedError;
}

function isAbortLikeError(error: unknown) {
	if (error instanceof ConnectionRunAbortedError) return true;
	if (error instanceof Error && error.name === 'AbortError') return true;
	if (
		typeof error === 'object' &&
		error !== null &&
		'name' in error &&
		(error as { name?: unknown }).name === 'AbortError'
	) {
		return true;
	}
	return false;
}

function defaultTimerApi(): TimerApi {
	return {
		setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
		clearTimeout: (timer) => {
			clearTimeout(timer as ReturnType<typeof setTimeout>);
		},
	};
}

function nextRunId() {
	return `connection-run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createConnectionRunContext(options: {
	id?: string;
	timeoutMs?: number;
	cleanupTimeoutMs?: number;
	callerSignal?: AbortSignal;
	isCurrent?: () => boolean;
	now?: () => number;
	setTimeout?: (callback: () => void, delayMs: number) => unknown;
	clearTimeout?: (timer: unknown) => void;
} = {}): ConnectionRunContext {
	const timerApi = {
		...defaultTimerApi(),
		...(options.setTimeout && { setTimeout: options.setTimeout }),
		...(options.clearTimeout && { clearTimeout: options.clearTimeout }),
	};
	const now = options.now ?? (() => Date.now());
	const controller = new AbortController();
	const childControllers = new Set<{
		kind: ConnectionRunOperationKind;
		controller: AbortController;
	}>();
	let abortReason: ConnectionRunAbortReason | null = null;
	let finished = false;
	let timeoutTimer: unknown = null;
	const deadlineMs =
		options.timeoutMs === undefined ? null : now() + options.timeoutMs;

	const abortChildControllers = (reason: ConnectionRunAbortReason) => {
		for (const child of childControllers) {
			if (child.kind === 'cleanup' && reason === 'timeout') continue;
			if (!child.controller.signal.aborted) child.controller.abort();
		}
	};

	const abort = (reason: ConnectionRunAbortReason) => {
		if (finished || controller.signal.aborted) return;
		abortReason = reason;
		controller.abort();
		abortChildControllers(reason);
	};

	if (options.timeoutMs !== undefined) {
		timeoutTimer = timerApi.setTimeout(() => {
			timeoutTimer = null;
			abort('timeout');
		}, options.timeoutMs);
	}

	options.callerSignal?.addEventListener(
		'abort',
		() => {
			abort('caller-aborted');
		},
		{ once: true },
	);
	if (options.callerSignal?.aborted) abort('caller-aborted');

	const classifyError = (error: unknown): 'aborted' | 'failed' =>
		isAbortLikeError(error) ? 'aborted' : 'failed';

	const isCurrent = () =>
		!finished &&
		!controller.signal.aborted &&
		(options.isCurrent ? options.isCurrent() : true);

	const currentAbortReason = (): ConnectionRunAbortReason =>
		abortReason ?? (options.isCurrent?.() === false ? 'stale-run' : 'stopped');

	const createOperationSignal = (kind: ConnectionRunOperationKind) => {
		const child = new AbortController();
		childControllers.add({ kind, controller: child });
		if (kind !== 'cleanup' && controller.signal.aborted) {
			child.abort();
		}
		return child.signal;
	};

	const withCleanupTimeout = async <T>(
		signal: AbortSignal,
		operation: () => Promise<T>,
	): Promise<T> => {
		if (options.cleanupTimeoutMs === undefined) return await operation();
		let cleanupTimer: unknown = null;
		try {
			return await Promise.race([
				operation(),
				new Promise<never>((_, reject) => {
					cleanupTimer = timerApi.setTimeout(() => {
						cleanupTimer = null;
						const trackedChild = [...childControllers].find(
							(child) => child.kind === 'cleanup' && child.controller.signal === signal,
						);
						trackedChild?.controller.abort();
						reject(new ConnectionRunAbortedError('timeout'));
					}, options.cleanupTimeoutMs);
				}),
			]);
		} finally {
			if (cleanupTimer !== null) timerApi.clearTimeout(cleanupTimer);
		}
	};

	const context: ConnectionRunContext = {
		id: options.id ?? nextRunId(),
		signal: controller.signal,
		deadlineMs,
		get abortReason() {
			return abortReason;
		},
		isCurrent,
		throwIfAborted: () => {
			if (!isCurrent()) {
				throw new ConnectionRunAbortedError(currentAbortReason());
			}
		},
		classifyError,
		createOperationSignal,
		runOperation: async (kind, operation) => {
			const signal = createOperationSignal(kind);
			if (kind !== 'cleanup' && !isCurrent()) {
				return { status: 'aborted', reason: currentAbortReason() };
			}
			try {
				const value =
					kind === 'cleanup'
						? await withCleanupTimeout(signal, () => operation(signal))
						: await operation(signal);
				if (kind !== 'cleanup' && !isCurrent()) {
					return { status: 'aborted', reason: currentAbortReason() };
				}
				if (signal.aborted) {
					return { status: 'aborted', reason: currentAbortReason() };
				}
				return { status: 'ok', value };
			} catch (error) {
				if (classifyError(error) === 'aborted') {
					return { status: 'aborted', reason: currentAbortReason() };
				}
				throw error;
			}
		},
		abort,
		finish: () => {
			finished = true;
			if (timeoutTimer !== null) {
				timerApi.clearTimeout(timeoutTimer);
				timeoutTimer = null;
			}
		},
	};

	return context;
}
```

- [ ] **Step 4: Run the context tests to verify they pass**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/connection-run-context.test.ts
```

Expected: PASS, including tests named `timeout aborts the run and connect
operation signal` and `cleanup operation is bounded separately after main
timeout`.

- [ ] **Step 5: Format and commit**

Run:

```bash
pnpm exec prettier --write apps/mobile/src/lib/connection-run-context.ts apps/mobile/test/integration/connection-run-context.test.ts
git add apps/mobile/src/lib/connection-run-context.ts apps/mobile/test/integration/connection-run-context.test.ts
git commit -m "Add connection run context"
```

Expected: commit succeeds with only the new context and test files staged.

---

### Task 2: Thread Context Through SSH Connect And Shell Lifecycle

**Files:**

- Modify: `apps/mobile/src/lib/ssh-connect-flow.ts`
- Modify: `apps/mobile/src/lib/ssh-shell-lifecycle.ts`
- Modify: `apps/mobile/src/lib/connect-and-open-shell.ts`
- Test: `apps/mobile/test/integration/ssh-connect-flow.test.ts`
- Test: `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts`

- [ ] **Step 1: Add failing SSH lifecycle and connect tests**

In `apps/mobile/test/integration/ssh-connect-flow.test.ts`, add:

```ts
void test('connectWithoutRemembering uses an explicit abort signal when supplied', async () => {
	const abortController = new AbortController();
	const signals: AbortSignal[] = [];

	await connectWithoutRemembering({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		abortSignal: abortController.signal,
		connect: async (params) => {
			signals.push(params.abortSignal);
			return { connectionId: 'conn-1' };
		},
	});

	assert.equal(signals[0], abortController.signal);
});
```

In `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts`,
add:

```ts
import { createConnectionRunContext } from '../../src/lib/connection-run-context';
```

Then add:

```ts
void test('connectAndOpenShell returns aborted without navigation when run is stopped during connect', async () => {
	const runContext = createConnectionRunContext();
	const navigations: unknown[] = [];
	let capturedSignal: AbortSignal | null = null;
	let resolveConnect: (value: never) => void = () => {};

	const resultPromise = connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		runContext,
		connect: async (params) => {
			capturedSignal = params.abortSignal;
			return new Promise<never>((resolve) => {
				resolveConnect = resolve;
			});
		},
		navigate: (params) => {
			navigations.push(params);
		},
	});

	runContext.abort('stopped');
	resolveConnect({} as never);

	const result = await resultPromise;
	assert.equal(result.status, 'aborted');
	assert.equal(result.reason, 'stopped');
	assert.equal(capturedSignal?.aborted, true);
	assert.deepEqual(navigations, []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/ssh-connect-flow.test.ts test/integration/connect-and-open-shell-diagnostics.test.ts
```

Expected: FAIL with TypeScript/runtime errors because `abortSignal` and
`runContext` are not accepted yet.

- [ ] **Step 3: Update `ssh-connect-flow.ts`**

In `apps/mobile/src/lib/ssh-connect-flow.ts`, import the new context type:

```ts
import { type ConnectionRunContext } from './connection-run-context';
```

Change `connectAndRememberConnection` args to include:

```ts
	runContext?: ConnectionRunContext;
	abortSignal?: AbortSignal;
	abortSignalTimeoutMs?: number;
```

Change the call into `connectWithoutRemembering` to:

```ts
	const sshConnection = await connectWithoutRemembering({
		connectionDetails: args.connectionDetails,
		connect: args.connect,
		onConnectionProgress: args.onConnectionProgress,
		runContext: args.runContext,
		abortSignal: args.abortSignal,
		abortSignalTimeoutMs: args.abortSignalTimeoutMs,
		resolvedSecurity: args.resolvedSecurity,
	});
```

Change `connectWithoutRemembering` args to include:

```ts
	runContext?: ConnectionRunContext;
	abortSignal?: AbortSignal;
	abortSignalTimeoutMs?: number;
```

Inside `connectWithoutRemembering`, replace the `abortSignal` field with:

```ts
		abortSignal:
			args.abortSignal ??
			args.runContext?.createOperationSignal('connect') ??
			AbortSignalTimeout(args.abortSignalTimeoutMs ?? 5_000),
```

- [ ] **Step 4: Update `ssh-shell-lifecycle.ts`**

Import context types:

```ts
import {
	type ConnectionRunAbortReason,
	type ConnectionRunContext,
} from './connection-run-context';
```

Extend `SshShellLifecycleResult` with:

```ts
	| {
			status: 'aborted';
			reason: ConnectionRunAbortReason;
	  };
```

Change `connectConnection` args to accept an operation signal:

```ts
	connectConnection: (params: {
		onConnectionProgress?: (progressEvent: SshConnectionProgress) => void;
		abortSignal: AbortSignal;
	}) => Promise<ConnectedSshConnection>;
```

Add optional `runContext` to `runSshShellLifecycle` args:

```ts
	runContext?: ConnectionRunContext;
```

Before the connect try block, create a helper:

```ts
	const runOperation =
		runContext?.runOperation ??
		(async <T>(
			_kind: 'connect' | 'shell' | 'cleanup',
			operation: (signal: AbortSignal) => Promise<T>,
		) => ({
			status: 'ok' as const,
			value: await operation(AbortSignalTimeout(abortSignalTimeoutMs)),
		}));
```

Replace the connect await with:

```ts
		const connectResult = await runOperation('connect', (abortSignal) =>
			connectConnection({
				abortSignal,
				onConnectionProgress: (progressEvent) => {
					traceEvent(
						diagnosticEvents.sshConnectProgress({
							source: 'saved-entry',
							connection: connectionIdentity,
							phase: readSshConnectionProgressPhase(progressEvent),
						}),
					);
					onConnectionProgress?.(progressEvent);
				},
			}),
		);
		if (connectResult.status === 'aborted') {
			return {
				status: 'aborted',
				reason: connectResult.reason,
			};
		}
		connected = connectResult.value;
```

Replace `sshConnection.startShell(startShellOptions)` with:

```ts
		const shellResult = await runOperation('shell', (abortSignal) => {
			const startShellOptions: RegisteredStartShellOptions = {
				term: 'Xterm',
				useTmux: connectionDetails.useTmux,
				tmuxSessionName: connectionDetails.tmuxSessionName,
				abortSignal,
			};
			if (registerInStore !== undefined) {
				startShellOptions.registerInStore = registerInStore;
			}
			return sshConnection.startShell(startShellOptions);
		});
		if (shellResult.status === 'aborted') {
			return {
				status: 'aborted',
				reason: shellResult.reason,
			};
		}
		shellHandle = shellResult.value;
```

Remove the old local `startShellOptions` block that created
`AbortSignalTimeout(abortSignalTimeoutMs)`.

- [ ] **Step 5: Update `connect-and-open-shell.ts`**

Import context utilities:

```ts
import {
	createConnectionRunContext,
	type ConnectionRunAbortReason,
	type ConnectionRunContext,
} from './connection-run-context';
```

Extend `ConnectAndOpenShellResult`:

```ts
	| {
			status: 'aborted';
			reason: ConnectionRunAbortReason;
	  };
```

Add `runContext?: ConnectionRunContext;` to args.

After destructuring args, create the context:

```ts
	const runContext =
		args.runContext ??
		createConnectionRunContext({ timeoutMs: abortSignalTimeoutMs });
	const ownsRunContext = args.runContext === undefined;
```

Pass `runContext` into `runSshShellLifecycle`, and pass operation signals into
`connectAndRememberConnection`:

```ts
	const result = await runSshShellLifecycle({
		connectionDetails,
		abortSignalTimeoutMs,
		runContext,
		traceEvent,
		onConnectionProgress: (progressEvent) => {
			logger.info('SSH connect progress event', progressEvent);
			onConnectionProgress?.(progressEvent);
		},
		connectConnection: async ({ onConnectionProgress, abortSignal }) =>
			await connectAndRememberConnection({
				connectionDetails,
				connect,
				onConnectionProgress,
				abortSignal,
				runContext,
				resolvedSecurity: security,
				saveConnection,
			}),
	});
	if (ownsRunContext) runContext.finish();
```

Immediately after that block, add:

```ts
	if (result.status === 'aborted') {
		return result;
	}
```

If the function currently returns inside the `try`, use `finally` instead:

```ts
	try {
		// existing connect flow
	} finally {
		if (ownsRunContext) runContext.finish();
	}
```

- [ ] **Step 6: Run the targeted tests**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/ssh-connect-flow.test.ts test/integration/connect-and-open-shell-diagnostics.test.ts
```

Expected: PASS.

- [ ] **Step 7: Format and commit**

Run:

```bash
pnpm exec prettier --write apps/mobile/src/lib/ssh-connect-flow.ts apps/mobile/src/lib/ssh-shell-lifecycle.ts apps/mobile/src/lib/connect-and-open-shell.ts apps/mobile/test/integration/ssh-connect-flow.test.ts apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts
git add apps/mobile/src/lib/ssh-connect-flow.ts apps/mobile/src/lib/ssh-shell-lifecycle.ts apps/mobile/src/lib/connect-and-open-shell.ts apps/mobile/test/integration/ssh-connect-flow.test.ts apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts
git commit -m "Thread run context through SSH lifecycle"
```

Expected: commit succeeds.

---

### Task 3: Migrate Diagnostic Shell Probe And Manual Diagnostic Timeout

**Files:**

- Modify: `apps/mobile/src/lib/diagnostic-shell-probe.ts`
- Modify: `apps/mobile/src/lib/connection-diagnostic-runner.ts`
- Modify: `apps/mobile/src/lib/connection-debug-command.ts`
- Test: `apps/mobile/test/integration/diagnostic-shell-probe.test.ts`
- Test: `apps/mobile/test/integration/connection-diagnostic-runner.test.ts`
- Test: `apps/mobile/test/integration/connection-debug-command.test.ts`

- [ ] **Step 1: Add failing manual timeout and probe signal tests**

In `apps/mobile/test/integration/diagnostic-shell-probe.test.ts`, add:

```ts
import { createConnectionRunContext } from '../../src/lib/connection-run-context';
```

Then add:

```ts
void test('diagnostic probe uses run context connect and cleanup signals', async () => {
	const runContext = createConnectionRunContext({ cleanupTimeoutMs: 25 });
	const signals: { connect?: AbortSignal; cleanup?: AbortSignal } = {};

	const result = await runDiagnosticShellProbe({
		connectionDetails,
		runContext,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		connect: async (params) => {
			signals.connect = params.abortSignal;
			return {
				connectionId: 'conn-1',
				disconnect: ({ signal }: { signal?: AbortSignal } = {}) => {
					signals.cleanup = signal;
				},
				startShell: async () => ({ channelId: 7 }),
			} as never;
		},
	});

	assert.equal(result.status, 'connected');
	assert.ok(signals.connect);
	assert.ok(signals.cleanup);
	assert.notEqual(signals.connect, signals.cleanup);
});
```

In `apps/mobile/test/integration/connection-diagnostic-runner.test.ts`, add:

```ts
void test('manual diagnostic timeout aborts the underlying probe signal', async () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	let capturedSignal: AbortSignal | null = null;

	const result = await runManualConnectionDiagnostic({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolveKeySecurity: async () => ({ type: 'key', privateKey: 'secret' }),
		connectSavedEntry: async ({ runContext }) => {
			capturedSignal = runContext.createOperationSignal('connect');
			await new Promise<void>((resolve) => {
				capturedSignal?.addEventListener('abort', () => resolve(), {
					once: true,
				});
			});
			return {
				status: 'aborted',
				reason: runContext.abortReason ?? 'timeout',
			} as never;
		},
		recovery: readyRecovery,
		formatPrompt: formatConnectionDiagnosticPrompt,
		timeoutMs: 5,
	});

	assert.equal(result.status, 'failed');
	assert.equal(capturedSignal?.aborted, true);
	assert.match(result.prompt, /timed out|aborted|timeout/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/diagnostic-shell-probe.test.ts test/integration/connection-diagnostic-runner.test.ts test/integration/connection-debug-command.test.ts
```

Expected: FAIL because `runContext` is not threaded through these APIs.

- [ ] **Step 3: Update `diagnostic-shell-probe.ts`**

Import the context type and creation helper:

```ts
import {
	createConnectionRunContext,
	type ConnectionRunAbortReason,
	type ConnectionRunContext,
} from './connection-run-context';
```

Extend `DiagnosticShellProbeResult`:

```ts
export type DiagnosticShellProbeResult =
	| SavedEntryConnectResult
	| { status: 'aborted'; reason: ConnectionRunAbortReason };
```

Add `runContext?: ConnectionRunContext;` to `runDiagnosticShellProbe` args.

After destructuring args, create:

```ts
	const runContext =
		args.runContext ??
		createConnectionRunContext({
			timeoutMs: abortSignalTimeoutMs,
			cleanupTimeoutMs: abortSignalTimeoutMs,
		});
	const ownsRunContext = args.runContext === undefined;
```

Replace diagnostic disconnect logic with a context cleanup operation:

```ts
	const cleanupDiagnosticConnection = async (sshConnection: SshConnection) => {
		const connectedIdentity = {
			...getSshShellLifecycleConnectionIdentity(connectionDetails),
			connectionId: sshConnection.connectionId,
		};
		try {
			const cleanupResult = await runContext.runOperation(
				'cleanup',
				async (signal) => {
					await withDiagnosticDisconnectTimeout(
						Promise.resolve(sshConnection.disconnect?.({ signal })),
						abortSignalTimeoutMs,
					);
					return null;
				},
			);
			if (cleanupResult.status === 'aborted') {
				throw new Error(`Diagnostic SSH disconnect aborted: ${cleanupResult.reason}`);
			}
			traceEvent(
				diagnosticEvents.diagnosticDisconnected({
					source: 'saved-entry',
					connection: connectedIdentity,
				}),
			);
			return null;
		} catch (error) {
			traceEvent(
				diagnosticEvents.diagnosticDisconnectFailed({
					source: 'saved-entry',
					connection: connectedIdentity,
					error: serializeConnectionDiagnosticError(error),
				}),
			);
			return error;
		}
	};
```

Pass `runContext` into `runSshShellLifecycle`, and pass `abortSignal` into
`connectWithoutRemembering`:

```ts
	const result = await runSshShellLifecycle({
		connectionDetails,
		abortSignalTimeoutMs,
		runContext,
		registerInStore: false,
		traceEvent,
		onConnectionProgress,
		connectConnection: async ({ onConnectionProgress, abortSignal }) => {
			const sshConnection = await connectWithoutRemembering({
				connectionDetails,
				connect,
				onConnectionProgress,
				abortSignal,
				runContext,
				resolvedSecurity,
			});
			return { sshConnection, storedConnectionId };
		},
		afterShellFailure: async ({ sshConnection }) => {
			await cleanupDiagnosticConnection(sshConnection);
		},
	});
	if (ownsRunContext) runContext.finish();
	if (result.status === 'aborted') return result;
```

Wrap the main flow in `try/finally` if needed so `runContext.finish()` always
runs for owned contexts.

- [ ] **Step 4: Update `connection-diagnostic-runner.ts`**

Import context utilities:

```ts
import {
	createConnectionRunContext,
	type ConnectionRunContext,
} from './connection-run-context';
```

Delete `ManualDiagnosticTimeoutError` and `withManualDiagnosticTimeout`.

Change the `connectSavedEntry` arg type to include `runContext`:

```ts
	connectSavedEntry: (args: {
		connectionDetails: InputConnectionDetails;
		resolvedSecurity: ResolvedKeySecurity;
		trace: ConnectionDiagnosticTraceHandle;
		runContext: ConnectionRunContext;
	}) => Promise<DiagnosticShellProbeResult>;
```

Add `runContext` to `ManualConnectionDiagnosticAttemptContext`:

```ts
	runContext: ConnectionRunContext;
```

After each awaited boundary in `runManualConnectionDiagnosticAttempt`, replace
`ensureCurrentRun()` with:

```ts
	ensureCurrentRun();
	runContext.throwIfAborted();
```

Pass `runContext` into saved-entry recovery:

```ts
	const result = await attemptSavedEntryWithTailscaleRecovery({
		platformOS: args.appState.platformOS,
		recovery: args.recovery,
		runContext,
		connectSavedEntry: () =>
			Promise.resolve()
				.then(ensureCurrentRun)
				.then(() => {
					runContext.throwIfAborted();
					return args.connectSavedEntry({
						connectionDetails: normalizedDetails,
						resolvedSecurity,
						trace: traceHandle,
						runContext,
					});
				}),
		shouldRecoverAfterFailure: (error) => !isDiagnosticShellCleanupError(error),
		onEvent: (event) => safeTraceEvent(traceHandle, event),
	});
```

Handle aborted recovery in the switch:

```ts
		case 'aborted':
			safeTraceEvent(
				traceHandle,
				diagnosticEvents.manualDiagnosticTimeout({
					timeoutMs: args.timeoutMs ?? DEFAULT_MANUAL_DIAGNOSTIC_TIMEOUT_MS,
					message: `Connection diagnostic aborted: ${result.reason}`,
				}),
			);
			return finish(traceHandle, 'failed', args);
```

In `runManualConnectionDiagnosticWithState`, create the context before the
attempt:

```ts
	const runContext = createConnectionRunContext({
		timeoutMs: args.timeoutMs ?? DEFAULT_MANUAL_DIAGNOSTIC_TIMEOUT_MS,
		cleanupTimeoutMs: 5_000,
		isCurrent: () => state.activeRunToken === runToken,
	});
```

Replace the `withManualDiagnosticTimeout(...)` call with:

```ts
		return await runManualConnectionDiagnosticAttempt(args, state, {
			setHandle: (next) => {
				handle = next;
			},
			ensureCurrentRun,
			runContext,
		});
```

In `catch`, replace the timeout branch with:

```ts
		if (runContext.classifyError(error) === 'aborted') {
			safeTraceEvent(
				handle,
				diagnosticEvents.manualDiagnosticTimeout({
					timeoutMs: args.timeoutMs ?? DEFAULT_MANUAL_DIAGNOSTIC_TIMEOUT_MS,
					message:
						error instanceof Error
							? error.message
							: `Connection diagnostic aborted: ${runContext.abortReason ?? 'timeout'}`,
				}),
			);
			return finish(handle, 'failed', args);
		}
```

In `finally`, call:

```ts
		runContext.finish();
```

- [ ] **Step 5: Update `connection-debug-command.ts`**

Replace the `connectSavedEntry` callback in
`apps/mobile/src/lib/connection-debug-command.ts` with:

```ts
		connectSavedEntry: ({
			connectionDetails,
			resolvedSecurity,
			trace,
			runContext,
		}) =>
			args.runDiagnosticShellProbe({
				connectionDetails,
				resolvedSecurity,
				trace,
				runContext,
				connect: args.connect,
			}),
```

Do not create a second context in `connection-debug-command.ts`; it should use
the context supplied by the manual diagnostic runner.

- [ ] **Step 6: Run the manual diagnostic and probe tests**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/diagnostic-shell-probe.test.ts test/integration/connection-diagnostic-runner.test.ts test/integration/connection-debug-command.test.ts
```

Expected: PASS. Existing tests for cleanup failure, tmux attach failure, prompt
redaction, and single-flight state remain passing.

- [ ] **Step 7: Format and commit**

Run:

```bash
pnpm exec prettier --write apps/mobile/src/lib/diagnostic-shell-probe.ts apps/mobile/src/lib/connection-diagnostic-runner.ts apps/mobile/src/lib/connection-debug-command.ts apps/mobile/test/integration/diagnostic-shell-probe.test.ts apps/mobile/test/integration/connection-diagnostic-runner.test.ts apps/mobile/test/integration/connection-debug-command.test.ts
git add apps/mobile/src/lib/diagnostic-shell-probe.ts apps/mobile/src/lib/connection-diagnostic-runner.ts apps/mobile/src/lib/connection-debug-command.ts apps/mobile/test/integration/diagnostic-shell-probe.test.ts apps/mobile/test/integration/connection-diagnostic-runner.test.ts apps/mobile/test/integration/connection-debug-command.test.ts
git commit -m "Abort manual diagnostics with run context"
```

Expected: commit succeeds.

---

### Task 4: Add Aborted Outcomes To Saved-Entry Recovery

**Files:**

- Modify: `apps/mobile/src/lib/auto-connect-saved-entry.ts`
- Test: `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`

- [ ] **Step 1: Add failing saved-entry abort tests**

In `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`, add:

```ts
import { createConnectionRunContext } from '../../src/lib/connection-run-context';
```

Then add:

```ts
void test('saved-entry recovery returns aborted when run stops before readiness completes', async () => {
	const runContext = createConnectionRunContext();
	let resolveReady: (value: TailscaleReadyResult) => void = () => {};

	const resultPromise = attemptSavedEntryWithTailscaleRecovery({
		platformOS: 'android',
		runContext,
		recovery: {
			ensureReady: async () =>
				new Promise<TailscaleReadyResult>((resolve) => {
					resolveReady = resolve;
				}),
			recoverAfterFailure: async () => {
				throw new Error('recovery should not run');
			},
		},
		connectSavedEntry: async () => {
			throw new Error('connect should not run');
		},
	});

	runContext.abort('stopped');
	resolveReady({ kind: 'ready', attempted: true, available: true });

	assert.deepEqual(await resultPromise, {
		status: 'aborted',
		reason: 'stopped',
	});
});

void test('saved-entry recovery returns aborted when run stops before retry completes', async () => {
	const runContext = createConnectionRunContext();
	let connectCalls = 0;
	let resolveRetry: (value: SavedEntryConnectResult) => void = () => {};

	const resultPromise = attemptSavedEntryWithTailscaleRecovery({
		platformOS: 'android',
		runContext,
		recovery: {
			ensureReady: async () => ({
				kind: 'ready',
				attempted: true,
				available: true,
			}),
			recoverAfterFailure: async () => ({
				kind: 'recovered',
				attempted: true,
				networkLikeFailure: true,
				available: true,
			}),
		},
		connectSavedEntry: async () => {
			connectCalls += 1;
			if (connectCalls === 1) throw new Error('No route to host');
			return new Promise<SavedEntryConnectResult>((resolve) => {
				resolveRetry = resolve;
			});
		},
	});

	await new Promise((resolve) => setImmediate(resolve));
	runContext.abort('replaced');
	resolveRetry({ status: 'connected', connectionId: 'conn-1', channelId: 1 });

	assert.deepEqual(await resultPromise, {
		status: 'aborted',
		reason: 'replaced',
	});
});
```

- [ ] **Step 2: Run the saved-entry tests to verify they fail**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/auto-connect-saved-entry.test.ts
```

Expected: FAIL because `runContext` and `aborted` outcomes are not supported.

- [ ] **Step 3: Update saved-entry recovery types**

In `apps/mobile/src/lib/auto-connect-saved-entry.ts`, import:

```ts
import {
	type ConnectionRunAbortReason,
	type ConnectionRunContext,
} from './connection-run-context';
```

Extend `SavedEntryConnectResult`:

```ts
	| {
			status: 'aborted';
			reason: ConnectionRunAbortReason;
	  };
```

Extend `SavedEntryRecoveryOutcome`:

```ts
	| { status: 'aborted'; reason: ConnectionRunAbortReason };
```

Add to `AttemptSavedEntryWithTailscaleRecoveryArgs`:

```ts
	runContext?: ConnectionRunContext;
```

- [ ] **Step 4: Add abort checks in saved-entry recovery**

Inside `attemptSavedEntryWithTailscaleRecovery`, add:

```ts
	const abortIfNeeded = () => {
		if (!runContext) return null;
		if (runContext.isCurrent()) return null;
		return {
			status: 'aborted' as const,
			reason: runContext.abortReason ?? 'stale-run',
		};
	};
```

After each awaited boundary, check:

```ts
	const aborted = abortIfNeeded();
	if (aborted) return aborted;
```

Apply that check after:

- `recovery.ensureReady()`
- first `connectSavedEntry()`
- `recovery.recoverAfterFailure(error)`
- retry `connectSavedEntry()`

Update `handleConnectResult` so an aborted connect result stays aborted:

```ts
	const handleConnectResult = (
		result: SavedEntryConnectResult,
	): SavedEntryRecoveryOutcome => {
		if (result.status === 'aborted') return result;
		if (result.status === 'tmux_attach_failed') {
			// existing tmux attach failure trace and return
		}
		// existing connected trace and return
	};
```

In the catch blocks, before tracing a thrown failure, add:

```ts
		if (runContext?.classifyError(error) === 'aborted') {
			return {
				status: 'aborted',
				reason: runContext.abortReason ?? 'stale-run',
			};
		}
```

Repeat the same classification for `retryError`.

- [ ] **Step 5: Run the saved-entry tests**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/auto-connect-saved-entry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Format and commit**

Run:

```bash
pnpm exec prettier --write apps/mobile/src/lib/auto-connect-saved-entry.ts apps/mobile/test/integration/auto-connect-saved-entry.test.ts
git add apps/mobile/src/lib/auto-connect-saved-entry.ts apps/mobile/test/integration/auto-connect-saved-entry.test.ts
git commit -m "Return aborted saved-entry outcomes"
```

Expected: commit succeeds.

---

### Task 5: Migrate Auto-Connect Attempt Sources To Run Context

**Files:**

- Modify: `apps/mobile/src/lib/auto-connect-attempt.ts`
- Test: `apps/mobile/test/integration/auto-connect-attempt.test.ts`

- [ ] **Step 1: Add failing auto-connect attempt tests**

In `apps/mobile/test/integration/auto-connect-attempt.test.ts`, add:

```ts
import { createConnectionRunContext } from '../../src/lib/connection-run-context';
```

Then add:

```ts
void test('active connection shell reopen uses run context signal', async () => {
	const runContext = createConnectionRunContext();
	let capturedSignal: AbortSignal | null = null;
	const { logger } = createLogger();

	const connected = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/(tabs)',
		runContext,
		latestShell: null,
		connections: {
			active: {
				connectionId: 'active-1',
				connectedAtMs: 20,
				connectionDetails: baseDetails,
				startShell: async (args) => {
					capturedSignal = args.abortSignal;
					return { channelId: 44 };
				},
			},
		},
		openSavedEntryShell: async () => {
			throw new Error('saved entry should not run');
		},
		loadLatestSavedConnection: async () => null,
		loadTmuxSettings: async () => ({ useTmux: true, tmuxSessionName: 'main' }),
		resolveKeySecurity: async () => null,
		navigateToShell: () => {},
		recovery: readyRecovery,
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logger,
	});

	assert.equal(connected, true);
	assert.ok(capturedSignal);
	runContext.abort('stopped');
	assert.equal(capturedSignal.aborted, true);
});

void test('stale saved-entry success cannot navigate or clear attention', async () => {
	const runContext = createConnectionRunContext({ isCurrent: () => false });
	const navigations: unknown[] = [];
	let clearAttentionCount = 0;
	const { logger } = createLogger();

	const connected = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/(tabs)',
		runContext,
		latestShell: null,
		connections: {},
		openSavedEntryShell: async () => ({
			status: 'connected',
			connectionId: 'conn-2',
			channelId: 3,
		}),
		loadLatestSavedConnection: async () => createSavedEntry(),
		resolveKeySecurity: async () => ({ type: 'key', privateKey: 'secret' }),
		navigateToShell: (connectionId, channelId) => {
			navigations.push([connectionId, channelId]);
		},
		recovery: readyRecovery,
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {
			clearAttentionCount += 1;
		},
		logger,
	});

	assert.equal(connected, false);
	assert.deepEqual(navigations, []);
	assert.equal(clearAttentionCount, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/auto-connect-attempt.test.ts
```

Expected: FAIL because `runContext` is not accepted and active shell reopen uses
`AbortSignalTimeout`.

- [ ] **Step 3: Update `auto-connect-attempt.ts` contracts**

Import:

```ts
import { type ConnectionRunContext } from './connection-run-context';
```

Add `runContext: ConnectionRunContext;` to `OpenSavedEntryShell` args and
`AutoConnectAttemptSourceArgs`.

Change `OpenSavedEntryShell` to:

```ts
type OpenSavedEntryShell = (args: {
	connectionDetails: InputConnectionDetails;
	resolvedSecurity: ResolvedKeySecurity;
	navigate: (params: { connectionId: string; channelId: number }) => void;
	runContext: ConnectionRunContext;
}) => Promise<SavedEntryConnectResult>;
```

Add local helper near `traceEvent`:

```ts
	const canMutateRunState = () => runContext.isCurrent();
```

- [ ] **Step 4: Guard stateful side effects and active shell reopen**

Before each navigation or Tailscale attention mutation, check:

```ts
	if (!canMutateRunState()) return false;
```

Apply that before:

- latest-shell `navigateToShell`
- latest-shell `clearTailscaleAttention`
- active-connection `navigateToShell`
- active-connection `clearTailscaleAttention`
- saved-entry connected `clearTailscaleAttention`
- saved-entry attention marking

Replace active connection shell signal:

```ts
			const shellHandle = await activeConnection.startShell({
				term: 'Xterm',
				useTmux,
				tmuxSessionName,
				abortSignal: runContext.createOperationSignal('shell'),
			});
```

After the `await activeConnection.startShell(...)`, add:

```ts
			if (!canMutateRunState()) return false;
```

- [ ] **Step 5: Pass context through saved-entry recovery**

Change saved-entry opener:

```ts
	const connectSavedEntry = () =>
		openSavedEntryShell({
			connectionDetails: normalizedDetails,
			resolvedSecurity,
			navigate: ({ connectionId, channelId }) => {
				if (!canMutateRunState()) return;
				navigateToShell(connectionId, channelId);
			},
			runContext,
		});
```

Pass `runContext` into recovery:

```ts
	const result = await attemptSavedEntryWithTailscaleRecovery({
		platformOS,
		recovery,
		runContext,
		connectSavedEntry,
		onEvent: traceEvent,
	});
```

Handle aborted outcomes in the result switch:

```ts
		case 'aborted':
			return false;
```

- [ ] **Step 6: Run the auto-connect attempt tests**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/auto-connect-attempt.test.ts
```

Expected: PASS.

- [ ] **Step 7: Format and commit**

Run:

```bash
pnpm exec prettier --write apps/mobile/src/lib/auto-connect-attempt.ts apps/mobile/test/integration/auto-connect-attempt.test.ts
git add apps/mobile/src/lib/auto-connect-attempt.ts apps/mobile/test/integration/auto-connect-attempt.test.ts
git commit -m "Use run context in auto-connect attempts"
```

Expected: commit succeeds.

---

### Task 6: Wire AutoConnectManager And Reconnect Stop/Replace Abort

**Files:**

- Modify: `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`
- Modify: `apps/mobile/src/lib/auto-connect.tsx`
- Test: `apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`

- [ ] **Step 1: Add failing reconnect abort tests**

In `apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`,
add:

```ts
void test('stop aborts an in-flight reconnect attempt', async () => {
	const aborts: string[] = [];
	let resolveAttempt: (value: boolean) => void = () => {};
	const context = harness({
		attemptAutoConnect: ({ signal }) => {
			signal.addEventListener('abort', () => {
				aborts.push('aborted');
			});
			return new Promise<boolean>((resolve) => {
				resolveAttempt = resolve;
			});
		},
	});

	assert.equal(context.controller.start('shell-drop'), true);
	context.controller.stop('test-stop');
	resolveAttempt(false);
	await flushPromises();

	assert.deepEqual(aborts, ['aborted']);
	assert.equal(context.controller.isRunning(), false);
	assert.equal(context.timers.length, 0);
});

void test('replace aborts the old reconnect attempt and starts a new one', async () => {
	const aborts: number[] = [];
	let callIndex = 0;
	const context = harness({
		attemptAutoConnect: ({ signal }) => {
			callIndex += 1;
			const current = callIndex;
			signal.addEventListener('abort', () => {
				aborts.push(current);
			});
			return new Promise<boolean>(() => undefined);
		},
	});

	assert.equal(context.controller.start('shell-drop'), true);
	assert.equal(context.controller.replace('tailscale-reset-action'), true);

	assert.deepEqual(aborts, [1]);
	assert.equal(callIndex, 2);
	assert.equal(context.controller.isRunning(), true);
});
```

Update the `harness` type for `attemptAutoConnect`:

```ts
		attemptAutoConnect?: (args: { signal: AbortSignal }) => Promise<boolean>;
```

Update the default attempt implementation:

```ts
		attemptAutoConnect:
			opts.attemptAutoConnect ??
			(async () => {
				attempts.push(nowMs);
				return attemptResults.shift() ?? false;
			}),
```

- [ ] **Step 2: Run reconnect tests to verify they fail**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/auto-connect-reconnect-controller.test.ts
```

Expected: FAIL because `attemptAutoConnect` does not receive a signal and stop
does not abort in-flight work.

- [ ] **Step 3: Update reconnect controller contract**

In `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`, change:

```ts
	attemptAutoConnect: () => Promise<boolean>;
```

to:

```ts
	attemptAutoConnect: (args: { signal: AbortSignal }) => Promise<boolean>;
```

Add near controller state:

```ts
	let activeAttemptAbortController: AbortController | null = null;
```

In `stop`, before `clearTimer()`:

```ts
		activeAttemptAbortController?.abort();
		activeAttemptAbortController = null;
```

In `attemptWithBackoff`, before calling `attemptAutoConnect`, create:

```ts
			const attemptAbortController = new AbortController();
			activeAttemptAbortController = attemptAbortController;
```

Replace the attempt call:

```ts
			const success = await attemptAutoConnect({
				signal: attemptAbortController.signal,
			});
			if (activeAttemptAbortController === attemptAbortController) {
				activeAttemptAbortController = null;
			}
```

Also clear `activeAttemptAbortController` in a `finally`:

```ts
			let success = false;
			try {
				success = await attemptAutoConnect({
					signal: attemptAbortController.signal,
				});
			} finally {
				if (activeAttemptAbortController === attemptAbortController) {
					activeAttemptAbortController = null;
				}
			}
```

- [ ] **Step 4: Update `auto-connect.tsx` run context creation**

Import:

```ts
import { createConnectionRunContext } from './connection-run-context';
```

Change `attemptAutoConnectRef` type:

```ts
	const attemptAutoConnectRef = React.useRef<
		((args?: { signal?: AbortSignal }) => Promise<boolean>) | null
	>(null);
```

Change `attemptAutoConnect` signature:

```ts
	const attemptAutoConnect = React.useCallback(
		async (opts?: { signal?: AbortSignal }) => {
```

After trace creation, create:

```ts
		const runContext = createConnectionRunContext({
			timeoutMs: 5_000,
			cleanupTimeoutMs: 5_000,
			callerSignal: opts?.signal,
			isCurrent: () => inFlightRef.current,
		});
```

Pass `runContext` into `attemptAutoConnectSource` and `connectAndOpenShell`:

```ts
			const connected = await attemptAutoConnectSource({
				platformOS: Platform.OS,
				pathname,
				runContext,
				latestShell,
				connections,
				openSavedEntryShell: ({
					connectionDetails,
					resolvedSecurity,
					navigate,
					runContext,
				}) =>
					connectAndOpenShell({
						connectionDetails,
						resolvedSecurity,
						connect,
						navigate,
						trace,
						runContext,
					}),
				loadLatestSavedConnection,
				resolveKeySecurity,
				navigateToShell,
				recovery: tailscaleRecovery,
				markTailscaleAttention,
				clearTailscaleAttention,
				logger,
				trace,
			});
```

In `finally`, call:

```ts
			runContext.finish();
```

Update reconnect controller creation:

```ts
			attemptAutoConnect: async ({ signal }) =>
				(await attemptAutoConnectRef.current?.({ signal })) ?? false,
```

Update direct calls:

```ts
		await attemptAutoConnect();
```

No signal is needed for non-reconnect direct calls.

- [ ] **Step 5: Run reconnect tests**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/auto-connect-reconnect-controller.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run auto-connect attempt tests**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/auto-connect-attempt.test.ts
```

Expected: PASS after the manager contract changes.

- [ ] **Step 7: Format and commit**

Run:

```bash
pnpm exec prettier --write apps/mobile/src/lib/auto-connect-reconnect-controller.ts apps/mobile/src/lib/auto-connect.tsx apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts
git add apps/mobile/src/lib/auto-connect-reconnect-controller.ts apps/mobile/src/lib/auto-connect.tsx apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts
git commit -m "Abort reconnect attempts on stop"
```

Expected: commit succeeds.

---

### Task 7: Remove Redundant Timeout Creation From Migrated Paths

**Files:**

- Modify: `apps/mobile/src/lib/auto-connect-attempt.ts`
- Modify: `apps/mobile/src/lib/diagnostic-shell-probe.ts`
- Modify: `apps/mobile/src/lib/ssh-shell-lifecycle.ts`
- Modify: `apps/mobile/src/lib/ssh-connect-flow.ts`
- Test: existing targeted tests

- [ ] **Step 1: Search for migrated `AbortSignalTimeout` use**

Run:

```bash
rg -n "AbortSignalTimeout|abortSignalTimeoutMs" apps/mobile/src/lib/auto-connect-attempt.ts apps/mobile/src/lib/diagnostic-shell-probe.ts apps/mobile/src/lib/ssh-shell-lifecycle.ts apps/mobile/src/lib/ssh-connect-flow.ts apps/mobile/src/lib/connect-and-open-shell.ts
```

Expected: remaining matches are only fallback paths for standalone callers or
disconnect timeout compatibility.

- [ ] **Step 2: Remove migrated local timeout imports and arguments**

Apply these exact removals where the previous tasks made them unused:

```ts
// apps/mobile/src/lib/auto-connect-attempt.ts
import { queryClient } from './utils';
```

Keep `AbortSignalTimeout` imported in files that still create standalone
fallback contexts. Remove it only from files where TypeScript reports it unused.

In `auto-connect-attempt.ts`, ensure the active shell reopen block still uses:

```ts
abortSignal: runContext.createOperationSignal('shell'),
```

In `ssh-connect-flow.ts`, keep fallback timeout only in:

```ts
args.abortSignal ??
	args.runContext?.createOperationSignal('connect') ??
	AbortSignalTimeout(args.abortSignalTimeoutMs ?? 5_000)
```

- [ ] **Step 3: Run migrated-path tests**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/connection-run-context.test.ts test/integration/ssh-connect-flow.test.ts test/integration/connect-and-open-shell-diagnostics.test.ts test/integration/diagnostic-shell-probe.test.ts test/integration/connection-diagnostic-runner.test.ts test/integration/auto-connect-saved-entry.test.ts test/integration/auto-connect-attempt.test.ts test/integration/auto-connect-reconnect-controller.test.ts
```

Expected: PASS.

- [ ] **Step 4: Typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS.

- [ ] **Step 5: Format and commit**

Run:

```bash
pnpm exec prettier --write apps/mobile/src/lib/auto-connect-attempt.ts apps/mobile/src/lib/diagnostic-shell-probe.ts apps/mobile/src/lib/ssh-shell-lifecycle.ts apps/mobile/src/lib/ssh-connect-flow.ts apps/mobile/src/lib/connect-and-open-shell.ts
git add apps/mobile/src/lib/auto-connect-attempt.ts apps/mobile/src/lib/diagnostic-shell-probe.ts apps/mobile/src/lib/ssh-shell-lifecycle.ts apps/mobile/src/lib/ssh-connect-flow.ts apps/mobile/src/lib/connect-and-open-shell.ts
git commit -m "Clean up migrated connection timeouts"
```

Expected: commit succeeds. If a listed file has no diff, leave it unstaged.

---

### Task 8: Final Verification

**Files:**

- Verify all files touched in Tasks 1-7.

- [ ] **Step 1: Run focused connection-run test slice**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/connection-run-context.test.ts test/integration/ssh-connect-flow.test.ts test/integration/connect-and-open-shell-diagnostics.test.ts test/integration/diagnostic-shell-probe.test.ts test/integration/connection-diagnostic-runner.test.ts test/integration/connection-debug-command.test.ts test/integration/auto-connect-saved-entry.test.ts test/integration/auto-connect-attempt.test.ts test/integration/auto-connect-reconnect-controller.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run broader related integration tests**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/tailscale-recovery-actions.test.ts test/integration/tailscale-recovery.test.ts test/integration/connection-diagnostic-recorder.test.ts test/integration/connection-diagnostic-prompt.test.ts test/integration/connection-diagnostic-delivery.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run mobile typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS.

- [ ] **Step 4: Run formatting check on touched files**

Run:

```bash
pnpm exec prettier --check apps/mobile/src/lib/connection-run-context.ts apps/mobile/src/lib/ssh-connect-flow.ts apps/mobile/src/lib/ssh-shell-lifecycle.ts apps/mobile/src/lib/connect-and-open-shell.ts apps/mobile/src/lib/diagnostic-shell-probe.ts apps/mobile/src/lib/connection-diagnostic-runner.ts apps/mobile/src/lib/connection-debug-command.ts apps/mobile/src/lib/auto-connect-saved-entry.ts apps/mobile/src/lib/auto-connect-attempt.ts apps/mobile/src/lib/auto-connect-reconnect-controller.ts apps/mobile/src/lib/auto-connect.tsx apps/mobile/test/integration/connection-run-context.test.ts apps/mobile/test/integration/ssh-connect-flow.test.ts apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts apps/mobile/test/integration/diagnostic-shell-probe.test.ts apps/mobile/test/integration/connection-diagnostic-runner.test.ts apps/mobile/test/integration/connection-debug-command.test.ts apps/mobile/test/integration/auto-connect-saved-entry.test.ts apps/mobile/test/integration/auto-connect-attempt.test.ts apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run mobile lint**

Run:

```bash
pnpm --filter @fressh/mobile lint:check
```

Expected: PASS. If lint fails because of pre-existing unrelated files, capture
the exact output and run lint against the touched files with the same ESLint
config before continuing.

- [ ] **Step 6: Inspect remaining cancellation ownership**

Run:

```bash
rg -n "AbortSignalTimeout\\(|Promise\\.race|activeRunToken|abortSignalTimeoutMs" apps/mobile/src/lib/auto-connect.tsx apps/mobile/src/lib/auto-connect-attempt.ts apps/mobile/src/lib/auto-connect-reconnect-controller.ts apps/mobile/src/lib/auto-connect-saved-entry.ts apps/mobile/src/lib/connect-and-open-shell.ts apps/mobile/src/lib/connection-diagnostic-runner.ts apps/mobile/src/lib/diagnostic-shell-probe.ts apps/mobile/src/lib/ssh-connect-flow.ts apps/mobile/src/lib/ssh-shell-lifecycle.ts
```

Expected:

- no `Promise.race` in `connection-diagnostic-runner.ts`
- no active shell reopen `AbortSignalTimeout` in `auto-connect-attempt.ts`
- no local SSH connect/shell timeout creation in migrated run-context paths
- fallback timeout creation remains only for standalone callers or bounded
  diagnostic disconnect compatibility

- [ ] **Step 7: Commit final verification cleanup if needed**

If verification required formatting, lint, or small test-name cleanup changes,
run:

```bash
git add apps/mobile/src/lib apps/mobile/test/integration
git commit -m "Verify connection run context migration"
```

Expected: commit succeeds only if files changed. If no files changed, do not
create an empty commit.

## Self-Review

Spec coverage:

- Auto-connect cancellation and stale-result handling: Tasks 5 and 6.
- Reconnect stop/replacement aborting in-flight attempts: Task 6.
- Manual diagnostic timeout actively aborting SSH work: Task 3.
- One saved-entry run across readiness, connect, recovery, and retry: Task 4.
- Active-connection shell reopen using shared context: Task 5.
- SSH connect, shell start, and cleanup derived signals: Tasks 2 and 3.
- Internal typed aborted outcomes: Tasks 1, 2, 3, and 4.
- Stable public manual diagnostic statuses: Task 3 tests.
- Stable standalone connection behavior: Task 2 keeps standalone fallback.
- Verification: Task 8.

Red-flag scan:

- The plan contains no deferred-work markers, vague future-work phrasing, or
  omitted test-code steps.

Type consistency:

- The plan uses `ConnectionRunContext`, `ConnectionRunAbortReason`,
  `ConnectionRunAbortedError`, `createConnectionRunContext`,
  `runContext`, and `abortReason` consistently across tasks.
