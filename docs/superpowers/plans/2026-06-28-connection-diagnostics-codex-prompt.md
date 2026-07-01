# Connection Diagnostics Codex Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build local connection diagnostics that capture reconnect failures, run a fresh diagnostic attempt, and paste or copy a Codex-ready debugging prompt.

**Architecture:** Add a pure TypeScript diagnostics core for trace recording and prompt formatting, then thread optional trace hooks through reconnect and auto-connect. Keep the manual diagnostic runner dependency-injected so Node integration tests do not load React Native. Add one `DEBUG_CONNECTION_IN_CODEX` action that runs the diagnostic and delivers the prompt through the existing terminal or clipboard paths.

**Tech Stack:** Expo React Native, TypeScript, Zustand, Node `tsx --test`, existing mobile command menu/action system, existing auto-connect/Tailscale recovery modules.

---

## Scope Check

This is one implementation plan because the work produces one testable feature:
connection diagnostics from capture through command delivery. The work is split
into small commits so the tracing core, passive instrumentation, manual
diagnostic runner, and UI action can each be reviewed independently.

## File Structure

- Create `apps/mobile/src/lib/connection-diagnostics.ts`
  - Owns trace event types, in-memory recorder, error serialization, and prompt
    formatting. It must stay free of React Native imports.
- Create `apps/mobile/src/lib/connection-diagnostic-runner.ts`
  - Owns the manual diagnostic workflow with injected dependencies for saved
    connection loading, key resolution, Tailscale recovery, and connection
    probing/opening. It must stay free of React Native imports.
- Create `apps/mobile/src/lib/connection-diagnostic-delivery.ts`
  - Owns paste/copy/alert fallback behavior as a pure dependency-injected
    helper. It must stay free of React Native imports.
- Modify `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`
  - Adds optional trace events for reconnect lifecycle decisions.
- Modify `apps/mobile/src/lib/auto-connect-attempt.ts`
  - Adds optional trace events for source selection and active/saved path
    outcomes.
- Modify `apps/mobile/src/lib/auto-connect-saved-entry.ts`
  - Adds optional trace events for Tailscale recovery and saved-entry retries.
- Modify `apps/mobile/src/lib/query-fns.ts`
  - Adds optional tracing at the connect and shell-open boundary and supports
    diagnostic cleanup through the returned `sshConnection`.
- Modify `apps/mobile/src/lib/keyboard-actions.ts`
  - Adds `DEBUG_CONNECTION_IN_CODEX` and an action-context callback.
- Modify `apps/mobile/src/app/shell/detail.tsx`
  - Wires the recorder, manual diagnostic runner, prompt delivery, and action
    context.
- Modify `apps/mobile/config/shell-config.json`
  - Adds the command menu entry.
- Add/modify integration tests under `apps/mobile/test/integration`.

## Task 1: Diagnostics Core

**Files:**
- Create: `apps/mobile/src/lib/connection-diagnostics.ts`
- Create: `apps/mobile/test/integration/connection-diagnostics.test.ts`

- [ ] **Step 1: Write failing trace and prompt tests**

Create `apps/mobile/test/integration/connection-diagnostics.test.ts` with:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createConnectionDiagnosticRecorder,
	formatConnectionDiagnosticPrompt,
	serializeConnectionDiagnosticError,
	type ConnectionDiagnosticTrace,
} from '../../src/lib/connection-diagnostics';

void test('recorder keeps latest trace and bounded history', () => {
	const recorder = createConnectionDiagnosticRecorder({
		now: () => 1000,
		maxHistory: 2,
	});

	const first = recorder.startTrace({
		trigger: 'initial-auto-connect',
		reason: 'app-start',
	});
	first.event({
		type: 'connection.selected',
		source: 'saved-entry',
		connection: {
			savedConnectionId: 'muly-dev-box-22',
			username: 'muly',
			host: 'dev.tailnet.ts.net',
			port: 22,
			keyId: 'key-1',
		},
	});
	first.finish('failed');

	const second = recorder.startTrace({
		trigger: 'reconnect',
		reason: 'shell-drop',
	});
	second.finish('skipped');

	const third = recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'command-menu',
	});
	third.finish('connected');

	assert.equal(recorder.getLatestTrace()?.id, third.trace.id);
	assert.deepEqual(
		recorder.getHistory().map((trace) => trace.id),
		[second.trace.id, third.trace.id],
	);
	assert.equal(first.trace.events[0]?.elapsedMs, 0);
});

void test('prompt includes connection identity and omits private key material', () => {
	const trace: ConnectionDiagnosticTrace = {
		id: 'trace-1',
		trigger: 'manual-diagnostic',
		reason: 'command-menu',
		status: 'failed',
		startedAtMs: 10,
		finishedAtMs: 20,
		events: [
			{
				atMs: 10,
				elapsedMs: 0,
				type: 'connection.selected',
				source: 'saved-entry',
				connection: {
					savedConnectionId: 'muly-dev-box-22',
					username: 'muly',
					host: 'dev.tailnet.ts.net',
					port: 22,
					keyId: 'key-1',
				},
			},
			{
				atMs: 11,
				elapsedMs: 1,
				type: 'ssh.connect.failed',
				source: 'saved-entry',
				error: {
					name: 'Error',
					message: 'network unreachable',
					stack: 'Error: network unreachable',
				},
				details: { privateKey: 'SECRET_KEY_MATERIAL' },
			},
		],
	};

	const prompt = formatConnectionDiagnosticPrompt(trace, {
		appState: {
			platformOS: 'android',
			pathname: '/shell/detail',
			isAutoConnecting: false,
			isReconnecting: true,
			foregroundServiceStarted: true,
			backgroundWorkAllowed: true,
		},
	});

	assert.match(prompt, /Debug this Fressh mobile SSH connection failure/);
	assert.match(prompt, /muly@dev\.tailnet\.ts\.net:22/);
	assert.match(prompt, /muly-dev-box-22/);
	assert.match(prompt, /network unreachable/);
	assert.match(prompt, /Private key material has been omitted/);
	assert.doesNotMatch(prompt, /SECRET_KEY_MATERIAL/);
});

void test('error serializer preserves useful non-secret details', () => {
	const error = new Error('connection timed out');
	error.name = 'TimeoutError';

	assert.deepEqual(
		{
			...serializeConnectionDiagnosticError(error),
			stack: 'present',
		},
		{
			name: 'TimeoutError',
			message: 'connection timed out',
			stack: 'present',
		},
	);
	assert.deepEqual(serializeConnectionDiagnosticError('plain failure'), {
		name: 'NonError',
		message: 'plain failure',
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/connection-diagnostics.test.ts
```

Expected: FAIL with an import error for `../../src/lib/connection-diagnostics`.

- [ ] **Step 3: Implement diagnostics core**

Create `apps/mobile/src/lib/connection-diagnostics.ts` with:

```ts
export type ConnectionDiagnosticTrigger =
	| 'initial-auto-connect'
	| 'reconnect'
	| 'manual-diagnostic'
	| 'command-menu';

export type ConnectionDiagnosticStatus =
	| 'running'
	| 'connected'
	| 'failed'
	| 'skipped';

export type ConnectionDiagnosticSource =
	| 'latest-shell'
	| 'active-connection'
	| 'saved-entry'
	| 'tailscale-recovery'
	| 'reconnect-controller'
	| 'manual-diagnostic'
	| 'foreground-service'
	| 'command-menu';

export type ConnectionDiagnosticConnectionIdentity = {
	savedConnectionId?: string;
	connectionId?: string;
	username?: string;
	host?: string;
	port?: number;
	keyId?: string;
	useTmux?: boolean;
	tmuxSessionName?: string;
};

export type ConnectionDiagnosticError = {
	name: string;
	message: string;
	stack?: string;
};

export type ConnectionDiagnosticEventInput = {
	type: string;
	source: ConnectionDiagnosticSource;
	message?: string;
	connection?: ConnectionDiagnosticConnectionIdentity;
	error?: ConnectionDiagnosticError;
	details?: Record<string, unknown>;
};

export type ConnectionDiagnosticEvent = ConnectionDiagnosticEventInput & {
	atMs: number;
	elapsedMs: number;
};

export type ConnectionDiagnosticTrace = {
	id: string;
	startedAtMs: number;
	finishedAtMs?: number;
	trigger: ConnectionDiagnosticTrigger;
	reason: string;
	status: ConnectionDiagnosticStatus;
	events: ConnectionDiagnosticEvent[];
};

export type ConnectionDiagnosticTraceHandle = {
	trace: ConnectionDiagnosticTrace;
	event: (event: ConnectionDiagnosticEventInput) => void;
	finish: (status: Exclude<ConnectionDiagnosticStatus, 'running'>) => void;
};

export type ConnectionDiagnosticAppState = {
	platformOS: string;
	pathname?: string;
	isAutoConnecting: boolean;
	isReconnecting: boolean;
	foregroundServiceStarted?: boolean;
	backgroundWorkAllowed?: boolean;
	foregroundServiceRequired?: boolean;
	appActive?: boolean;
};

export type ConnectionDiagnosticRecorder = {
	startTrace: (input: {
		trigger: ConnectionDiagnosticTrigger;
		reason: string;
	}) => ConnectionDiagnosticTraceHandle;
	getLatestTrace: () => ConnectionDiagnosticTrace | null;
	getHistory: () => ConnectionDiagnosticTrace[];
};

let nextTraceId = 1;

function nextId(): string {
	const id = `connection-trace-${nextTraceId}`;
	nextTraceId += 1;
	return id;
}

function sanitizeValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sanitizeValue);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [
			key,
			/privateKey/i.test(key) ? '[omitted private key material]' : sanitizeValue(entry),
		]),
	);
}

export function serializeConnectionDiagnosticError(
	error: unknown,
): ConnectionDiagnosticError {
	if (error instanceof Error) {
		return {
			name: error.name || 'Error',
			message: error.message,
			...(error.stack ? { stack: error.stack } : {}),
		};
	}
	return {
		name: 'NonError',
		message: String(error),
	};
}

export function createConnectionDiagnosticRecorder({
	now = () => Date.now(),
	maxHistory = 5,
}: {
	now?: () => number;
	maxHistory?: number;
} = {}): ConnectionDiagnosticRecorder {
	const history: ConnectionDiagnosticTrace[] = [];
	let latest: ConnectionDiagnosticTrace | null = null;

	return {
		startTrace: ({ trigger, reason }) => {
			const startedAtMs = now();
			const trace: ConnectionDiagnosticTrace = {
				id: nextId(),
				startedAtMs,
				trigger,
				reason,
				status: 'running',
				events: [],
			};
			latest = trace;
			history.push(trace);
			while (history.length > maxHistory) history.shift();

			return {
				trace,
				event: (event) => {
					const atMs = now();
					trace.events.push({
						...event,
						details: event.details
							? (sanitizeValue(event.details) as Record<string, unknown>)
							: undefined,
						atMs,
						elapsedMs: atMs - startedAtMs,
					});
				},
				finish: (status) => {
					trace.status = status;
					trace.finishedAtMs = now();
				},
			};
		},
		getLatestTrace: () => latest,
		getHistory: () => [...history],
	};
}

export const connectionDiagnosticRecorder = createConnectionDiagnosticRecorder({
	maxHistory: 5,
});

function formatConnection(
	connection?: ConnectionDiagnosticConnectionIdentity,
): string {
	if (!connection) return 'none';
	const target =
		connection.username && connection.host && connection.port
			? `${connection.username}@${connection.host}:${connection.port}`
			: 'unknown-target';
	return [
		target,
		connection.savedConnectionId
			? `savedConnectionId=${connection.savedConnectionId}`
			: null,
		connection.connectionId ? `connectionId=${connection.connectionId}` : null,
		connection.keyId ? `keyId=${connection.keyId}` : null,
		typeof connection.useTmux === 'boolean'
			? `useTmux=${String(connection.useTmux)}`
			: null,
		connection.tmuxSessionName
			? `tmuxSessionName=${connection.tmuxSessionName}`
			: null,
	]
		.filter(Boolean)
		.join(' ');
}

function formatEvent(event: ConnectionDiagnosticEvent): string {
	const parts = [
		`+${event.elapsedMs}ms`,
		event.type,
		`source=${event.source}`,
		event.message,
		event.connection ? `connection=${formatConnection(event.connection)}` : null,
		event.error
			? `error=${event.error.name}: ${event.error.message}`
			: null,
		event.details ? `details=${JSON.stringify(sanitizeValue(event.details))}` : null,
	];
	return `- ${parts.filter(Boolean).join(' | ')}`;
}

export function formatConnectionDiagnosticPrompt(
	trace: ConnectionDiagnosticTrace,
	{
		appState,
	}: {
		appState: ConnectionDiagnosticAppState;
	},
): string {
	return [
		'Debug this Fressh mobile SSH connection failure.',
		'Identify the most likely failure layer and propose the next code or logging change.',
		'Private key material has been omitted. Host/user/port and saved connection ids are intentionally included for personal debugging.',
		'',
		'## App State',
		JSON.stringify(appState, null, 2),
		'',
		'## Trace Summary',
		`id: ${trace.id}`,
		`trigger: ${trace.trigger}`,
		`reason: ${trace.reason}`,
		`status: ${trace.status}`,
		`durationMs: ${(trace.finishedAtMs ?? trace.startedAtMs) - trace.startedAtMs}`,
		'',
		'## Events',
		...(trace.events.length ? trace.events.map(formatEvent) : ['- no events recorded']),
	].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/connection-diagnostics.test.ts
```

Expected: PASS for all tests in `connection-diagnostics.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/connection-diagnostics.ts apps/mobile/test/integration/connection-diagnostics.test.ts
git commit -m "Add connection diagnostic trace core"
```

## Task 2: Reconnect Controller Trace Hooks

**Files:**
- Modify: `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`
- Modify: `apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`

- [ ] **Step 1: Write failing reconnect trace tests**

Append this test to `apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`:

```ts
void test('records reconnect lifecycle trace events', async () => {
	const context = harness({ attemptResults: [false], delaysMs: [10] });
	const events: unknown[] = [];
	const tracedController = createAutoConnectReconnectController({
		delaysMs: [10],
		windowMs: 100,
		now: () => 0,
		setTimeout: (callback, delayMs) => {
			const timer = {
				id: 100,
				delayMs,
				callback,
				cleared: false,
			};
			context.timers.push(timer);
			return timer;
		},
		clearTimeout: (timer) => {
			(timer as Timer).cleared = true;
		},
		getSnapshot: () => ({
			...context.snapshot,
			isReconnecting: false,
		}),
		setReconnecting: () => {},
		attemptAutoConnect: async () => false,
		logger: {
			info: () => {},
			warn: () => {},
		},
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.equal(tracedController.start('shell-drop'), true);
	await flushPromises();

	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		[
			'reconnect.started',
			'reconnect.attempt.started',
			'reconnect.attempt.failed',
			'reconnect.retry.scheduled',
		],
	);
	assert.deepEqual(events[0], {
		type: 'reconnect.started',
		source: 'reconnect-controller',
		message: 'shell-drop',
		details: {
			reason: 'shell-drop',
			delaysMs: [10],
			windowMs: 100,
		},
	});
});

void test('records blocked reconnect start trace event', () => {
	const events: unknown[] = [];
	const context = harness({ isAutoConnecting: true });
	const blockedController = createAutoConnectReconnectController({
		delaysMs: [10],
		windowMs: 100,
		now: () => 0,
		setTimeout: context.controller.start as never,
		clearTimeout: () => {},
		getSnapshot: () => ({
			...context.snapshot,
			isAutoConnecting: true,
		}),
		setReconnecting: () => {},
		attemptAutoConnect: async () => false,
		logger: {
			info: () => {},
			warn: () => {},
		},
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.equal(blockedController.start('shell-drop'), false);
	assert.deepEqual(events, [
		{
			type: 'reconnect.start.blocked',
			source: 'reconnect-controller',
			message: 'shell-drop',
			details: {
				reason: 'shell-drop',
				isAutoConnecting: true,
				isReconnecting: false,
				resetInFlight: false,
			},
		},
	]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/auto-connect-reconnect-controller.test.ts
```

Expected: FAIL with TypeScript error that `trace` is not a known option.

- [ ] **Step 3: Add optional trace support**

In `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`, add:

```ts
import { type ConnectionDiagnosticEventInput } from './connection-diagnostics';
```

Add this type near the logger type:

```ts
type AutoConnectReconnectTrace = {
	event: (event: ConnectionDiagnosticEventInput) => void;
};
```

Add `trace?: AutoConnectReconnectTrace;` to
`AutoConnectReconnectControllerOptions`.

Destructure `trace` in `createAutoConnectReconnectController`.

Add this helper inside `createAutoConnectReconnectController`:

```ts
const traceEvent = (event: ConnectionDiagnosticEventInput) => {
	try {
		trace?.event(event);
	} catch (error) {
		logger.warn('Reconnect trace event failed', error);
	}
};
```

In the blocked-start branch before `return false`, add:

```ts
traceEvent({
	type: 'reconnect.start.blocked',
	source: 'reconnect-controller',
	message: reason,
	details: {
		reason,
		isAutoConnecting: snapshot.isAutoConnecting,
		isReconnecting: snapshot.isReconnecting,
		resetInFlight: snapshot.resetInFlight,
	},
});
```

After `logger.info('Reconnect cycle started', { reason });`, add:

```ts
traceEvent({
	type: 'reconnect.started',
	source: 'reconnect-controller',
	message: reason,
	details: { reason, delaysMs, windowMs },
});
```

At the start of `stop`, before `clearTimer();`, add:

```ts
traceEvent({
	type: 'reconnect.stopped',
	source: 'reconnect-controller',
	message: reason,
	details: { reason },
});
```

In `scheduleNextAttempt`, before assigning `timer`, add:

```ts
traceEvent({
	type: 'reconnect.retry.scheduled',
	source: 'reconnect-controller',
	details: { attemptIndex: attempt, delayMs },
});
```

Before `const success = await attemptAutoConnect();`, add:

```ts
traceEvent({
	type: 'reconnect.attempt.started',
	source: 'reconnect-controller',
	details: { elapsedMs },
});
```

After `const success = await attemptAutoConnect();` and after the current-loop
guard, add this before the `if (success)` block:

```ts
traceEvent({
	type: success ? 'reconnect.attempt.connected' : 'reconnect.attempt.failed',
	source: 'reconnect-controller',
	details: { elapsedMs },
});
```

In the retry timeout branch, before `stop('retry-timeout');`, add:

```ts
traceEvent({
	type: 'reconnect.timeout',
	source: 'reconnect-controller',
	details: { elapsedMs, windowMs },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/auto-connect-reconnect-controller.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/auto-connect-reconnect-controller.ts apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts
git commit -m "Trace reconnect lifecycle decisions"
```

## Task 3: Auto-Connect Source And Saved-Entry Tracing

**Files:**
- Modify: `apps/mobile/src/lib/auto-connect-attempt.ts`
- Modify: `apps/mobile/src/lib/auto-connect-saved-entry.ts`
- Modify: `apps/mobile/test/integration/auto-connect-attempt.test.ts`
- Modify: `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`

- [ ] **Step 1: Write failing auto-connect source trace test**

Append this test to `apps/mobile/test/integration/auto-connect-attempt.test.ts`:

```ts
void test('records saved-entry failure trace events', async () => {
	const events: unknown[] = [];
	const { logger } = createLogger();

	const connected = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/(tabs)',
		latestShell: null,
		connections: {},
		openSavedEntryShell: async () => {
			throw new Error('network unreachable');
		},
		loadLatestSavedConnection: async () => createSavedEntry(),
		resolveKeySecurity: async () => ({
			type: 'key',
			privateKey: 'SECRET_PRIVATE_KEY',
		}),
		navigateToShell: () => {},
		recovery: {
			ensureReady: async () => ({
				kind: 'unsupported' as const,
				attempted: false as const,
				available: false as const,
			}),
			recoverAfterFailure: async () => ({
				kind: 'nonNetworkFailure' as const,
				attempted: false as const,
				networkLikeFailure: false as const,
				available: true,
			}),
		},
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logger,
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.equal(connected, false);
	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		[
			'auto-connect.source.missing-latest-shell',
			'auto-connect.source.missing-active-connection',
			'auto-connect.saved-entry.selected',
			'auto-connect.saved-entry.key-resolved',
			'tailscale.ensure-ready.result',
			'auto-connect.saved-entry.connect.failed',
		],
	);
	assert.doesNotMatch(JSON.stringify(events), /SECRET_PRIVATE_KEY/);
});
```

- [ ] **Step 2: Write failing saved-entry Tailscale trace test**

Append this test to `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`:

```ts
void test('records Tailscale recovery retry trace events', async () => {
	const events: unknown[] = [];
	let connectCalls = 0;

	const result = await attemptSavedEntryWithTailscaleRecovery({
		platformOS: 'android',
		recovery: {
			ensureReady: async () => ({
				kind: 'ready' as const,
				attempted: true as const,
				available: true as const,
			}),
			recoverAfterFailure: async () => ({
				kind: 'recovered' as const,
				attempted: true as const,
				networkLikeFailure: true as const,
				available: true as const,
			}),
		},
		connectSavedEntry: async () => {
			connectCalls += 1;
			if (connectCalls === 1) throw new Error('network unreachable');
			return {
				status: 'connected',
				sshConnection: {} as never,
				shellHandle: {} as never,
				connectionId: 'conn-2',
				channelId: 3,
			};
		},
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logTmuxAttachFailure: () => {},
		logWarning: () => {},
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.deepEqual(result, { connected: true });
	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		[
			'tailscale.ensure-ready.result',
			'auto-connect.saved-entry.connect.started',
			'auto-connect.saved-entry.connect.threw',
			'tailscale.recovery.result',
			'auto-connect.saved-entry.retry.started',
			'auto-connect.saved-entry.connect.connected',
		],
	);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/auto-connect-attempt.test.ts test/integration/auto-connect-saved-entry.test.ts
```

Expected: FAIL with TypeScript errors that `trace` is not a known property.

- [ ] **Step 4: Add trace support to auto-connect attempt**

In `apps/mobile/src/lib/auto-connect-attempt.ts`, import:

```ts
import {
	serializeConnectionDiagnosticError,
	type ConnectionDiagnosticEventInput,
} from './connection-diagnostics';
```

Add this type and optional arg:

```ts
type AutoConnectTrace = {
	event: (event: ConnectionDiagnosticEventInput) => void;
};
```

Add `trace?: AutoConnectTrace;` to `AutoConnectAttemptSourceArgs`, destructure
it, and add:

```ts
const traceEvent = (event: ConnectionDiagnosticEventInput) => {
	try {
		trace?.event(event);
	} catch (error) {
		logger.warn('Auto-connect trace event failed', error);
	}
};
```

In the latest-shell branch, add:

```ts
traceEvent({
	type: 'auto-connect.source.latest-shell',
	source: 'latest-shell',
	connection: { connectionId: latestShell.connectionId },
	details: { channelId: latestShell.channelId, pathname },
});
```

Before selecting active connection when there is no latest shell, add:

```ts
traceEvent({
	type: 'auto-connect.source.missing-latest-shell',
	source: 'latest-shell',
	details: { pathname },
});
```

When no active connection exists, add:

```ts
traceEvent({
	type: 'auto-connect.source.missing-active-connection',
	source: 'active-connection',
});
```

When an active connection is selected, add:

```ts
traceEvent({
	type: 'auto-connect.active-connection.selected',
	source: 'active-connection',
	connection: {
		connectionId: activeConnection.connectionId,
		username: activeConnection.connectionDetails.username,
		host: activeConnection.connectionDetails.host,
		port: activeConnection.connectionDetails.port,
	},
});
```

Before `activeConnection.startShell`, add:

```ts
traceEvent({
	type: 'auto-connect.active-connection.shell-started',
	source: 'active-connection',
	connection: {
		connectionId: activeConnection.connectionId,
		username: activeConnection.connectionDetails.username,
		host: activeConnection.connectionDetails.host,
		port: activeConnection.connectionDetails.port,
		useTmux,
		tmuxSessionName,
	},
});
```

In active shell success, add:

```ts
traceEvent({
	type: 'auto-connect.active-connection.shell-connected',
	source: 'active-connection',
	connection: { connectionId: activeConnection.connectionId },
	details: { channelId: shellHandle.channelId },
});
```

In active shell catch, add:

```ts
traceEvent({
	type:
		tmuxAttachFailureReason !== null
			? 'auto-connect.active-connection.tmux-attach-failed'
			: 'auto-connect.active-connection.shell-failed',
	source: 'active-connection',
	connection: { connectionId: activeConnection.connectionId },
	error: serializeConnectionDiagnosticError(error),
	details: { tmuxAttachFailureReason, tmuxSessionName },
});
```

After loading latest entry and finding none, add:

```ts
traceEvent({
	type: 'auto-connect.saved-entry.missing',
	source: 'saved-entry',
});
```

When a saved entry is selected, add:

```ts
traceEvent({
	type: 'auto-connect.saved-entry.selected',
	source: 'saved-entry',
	connection: {
		savedConnectionId: latestEntry.id,
		username: details.username,
		host: details.host,
		port: details.port,
		keyId: details.security.keyId,
		useTmux: details.useTmux,
		tmuxSessionName: details.tmuxSessionName,
	},
});
```

When `resolveKeySecurity` returns null, add:

```ts
traceEvent({
	type: 'auto-connect.saved-entry.key-missing',
	source: 'saved-entry',
	connection: {
		savedConnectionId: latestEntry.id,
		username: details.username,
		host: details.host,
		port: details.port,
		keyId: details.security.keyId,
	},
});
```

When the key resolves, add:

```ts
traceEvent({
	type: 'auto-connect.saved-entry.key-resolved',
	source: 'saved-entry',
	connection: {
		savedConnectionId: latestEntry.id,
		username: details.username,
		host: details.host,
		port: details.port,
		keyId: details.security.keyId,
	},
});
```

Pass `trace` into `attemptSavedEntryWithTailscaleRecovery`.

- [ ] **Step 5: Add trace support to saved-entry recovery**

In `apps/mobile/src/lib/auto-connect-saved-entry.ts`, import:

```ts
import {
	serializeConnectionDiagnosticError,
	type ConnectionDiagnosticEventInput,
} from './connection-diagnostics';
```

Add:

```ts
type SavedEntryTrace = {
	event: (event: ConnectionDiagnosticEventInput) => void;
};
```

Add `trace?: SavedEntryTrace;` to
`AttemptSavedEntryWithTailscaleRecoveryArgs`, destructure it, and add:

```ts
const traceEvent = (event: ConnectionDiagnosticEventInput) => {
	try {
		trace?.event(event);
	} catch (error) {
		logWarning('Saved-entry trace event failed', error);
	}
};
```

After `const readiness = await recovery.ensureReady();`, add:

```ts
traceEvent({
	type: 'tailscale.ensure-ready.result',
	source: 'tailscale-recovery',
	details: { platformOS, readiness },
});
```

At the beginning of `handleConnectResult`, add:

```ts
traceEvent({
	type:
		result.status === 'tmux_attach_failed'
			? 'auto-connect.saved-entry.connect.tmux-attach-failed'
			: 'auto-connect.saved-entry.connect.connected',
	source: 'saved-entry',
	connection:
		result.status === 'tmux_attach_failed'
			? { connectionId: result.connectionId, tmuxSessionName: result.tmuxSessionName }
			: { connectionId: result.connectionId },
	details: result,
});
```

Before the first `connectSavedEntry()` call, add:

```ts
traceEvent({
	type: 'auto-connect.saved-entry.connect.started',
	source: 'saved-entry',
});
```

In the first catch block before recovery, add:

```ts
traceEvent({
	type: 'auto-connect.saved-entry.connect.threw',
	source: 'saved-entry',
	error: serializeConnectionDiagnosticError(error),
});
```

After `const recoveryResult = await recovery.recoverAfterFailure(error);`, add:

```ts
traceEvent({
	type: 'tailscale.recovery.result',
	source: 'tailscale-recovery',
	details: { recoveryResult },
});
```

Before retry `connectSavedEntry()`, add:

```ts
traceEvent({
	type: 'auto-connect.saved-entry.retry.started',
	source: 'saved-entry',
});
```

In the retry catch, add:

```ts
traceEvent({
	type: 'auto-connect.saved-entry.retry.threw',
	source: 'saved-entry',
	error: serializeConnectionDiagnosticError(retryError),
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/auto-connect-attempt.test.ts test/integration/auto-connect-saved-entry.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/auto-connect-attempt.ts apps/mobile/src/lib/auto-connect-saved-entry.ts apps/mobile/test/integration/auto-connect-attempt.test.ts apps/mobile/test/integration/auto-connect-saved-entry.test.ts
git commit -m "Trace auto-connect source decisions"
```

## Task 4: Manual Diagnostic Runner

**Files:**
- Create: `apps/mobile/src/lib/connection-diagnostic-runner.ts`
- Create: `apps/mobile/test/integration/connection-diagnostic-runner.test.ts`

- [ ] **Step 1: Write failing manual diagnostic tests**

Create `apps/mobile/test/integration/connection-diagnostic-runner.test.ts` with:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createConnectionDiagnosticRecorder,
	formatConnectionDiagnosticPrompt,
} from '../../src/lib/connection-diagnostics';
import { runManualConnectionDiagnostic } from '../../src/lib/connection-diagnostic-runner';
import { type SavedConnectionEntry } from '../../src/lib/connection-utils';
import { type ConnectAndOpenShellResult } from '../../src/lib/query-fns';

const savedEntry: SavedConnectionEntry = {
	id: 'saved-1',
	metadata: { createdAtMs: 1, modifiedAtMs: 2, priority: 0 },
	value: {
		username: 'muly',
		host: 'dev.tailnet.ts.net',
		port: 22,
		useTmux: true,
		tmuxSessionName: 'main',
		autoConnect: true,
		security: { type: 'key', keyId: 'key-1' },
	},
};

void test('manual diagnostic records no saved connection as skipped trace', async () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });

	const result = await runManualConnectionDiagnostic({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
		},
		loadLatestSavedConnection: async () => null,
		resolveKeySecurity: async () => {
			throw new Error('key lookup should not run');
		},
		connectSavedEntry: async () => {
			throw new Error('connect should not run');
		},
		recovery: {
			ensureReady: async () => ({
				kind: 'unsupported',
				attempted: false,
				available: false,
			}),
			recoverAfterFailure: async () => ({
				kind: 'nonNetworkFailure',
				attempted: false,
				networkLikeFailure: false,
				available: false,
			}),
		},
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	assert.equal(result.status, 'skipped');
	assert.match(result.prompt, /no eligible saved auto-connect connection/i);
	assert.equal(recorder.getLatestTrace()?.status, 'skipped');
});

void test('manual diagnostic is single-flight', async () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	let resolveConnect: (value: ConnectAndOpenShellResult) => void = () => {};
	const first = runManualConnectionDiagnostic({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolveKeySecurity: async () => ({ type: 'key', privateKey: 'secret' }),
		connectSavedEntry: () =>
			new Promise<ConnectAndOpenShellResult>((resolve) => {
				resolveConnect = resolve;
			}),
		recovery: {
			ensureReady: async () => ({
				kind: 'ready',
				attempted: true,
				available: true,
			}),
			recoverAfterFailure: async () => ({
				kind: 'nonNetworkFailure',
				attempted: false,
				networkLikeFailure: false,
				available: true,
			}),
		},
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	const second = await runManualConnectionDiagnostic({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: true,
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolveKeySecurity: async () => ({ type: 'key', privateKey: 'secret' }),
		connectSavedEntry: async () => {
			throw new Error('second connect should not run');
		},
		recovery: {
			ensureReady: async () => ({
				kind: 'ready',
				attempted: true,
				available: true,
			}),
			recoverAfterFailure: async () => ({
				kind: 'nonNetworkFailure',
				attempted: false,
				networkLikeFailure: false,
				available: true,
			}),
		},
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	assert.equal(second.status, 'busy');
	assert.match(second.prompt, /diagnostic is already running/i);
	resolveConnect({
		status: 'connected',
		sshConnection: {} as never,
		shellHandle: {} as never,
		connectionId: 'conn-1',
		channelId: 1,
	});
	assert.equal((await first).status, 'connected');
});

void test('manual diagnostic records failed connection and produces prompt', async () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });

	const result = await runManualConnectionDiagnostic({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: true,
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolveKeySecurity: async () => ({ type: 'key', privateKey: 'secret' }),
		connectSavedEntry: async () => {
			throw new Error('network unreachable');
		},
		recovery: {
			ensureReady: async () => ({
				kind: 'unsupported',
				attempted: false,
				available: false,
			}),
			recoverAfterFailure: async () => ({
				kind: 'nonNetworkFailure',
				attempted: false,
				networkLikeFailure: false,
				available: false,
			}),
		},
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	assert.equal(result.status, 'failed');
	assert.match(result.prompt, /network unreachable/);
	assert.match(result.prompt, /muly@dev\.tailnet\.ts\.net:22/);
	assert.doesNotMatch(result.prompt, /secret/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/connection-diagnostic-runner.test.ts
```

Expected: FAIL with an import error for
`../../src/lib/connection-diagnostic-runner`.

- [ ] **Step 3: Implement manual diagnostic runner**

Create `apps/mobile/src/lib/connection-diagnostic-runner.ts` with:

```ts
import {
	formatConnectionDiagnosticPrompt,
	serializeConnectionDiagnosticError,
	type ConnectionDiagnosticAppState,
	type ConnectionDiagnosticRecorder,
	type ConnectionDiagnosticTrace,
	type ConnectionDiagnosticTraceHandle,
} from './connection-diagnostics';
import { attemptSavedEntryWithTailscaleRecovery } from './auto-connect-saved-entry';
import { type SavedConnectionEntry } from './connection-utils';
import { type ConnectAndOpenShellResult } from './query-fns';
import { type InputConnectionDetails } from './secrets-manager';

type ResolvedKeySecurity = {
	type: 'key';
	privateKey: string;
};

export type ManualConnectionDiagnosticResult = {
	status: 'connected' | 'failed' | 'skipped' | 'busy';
	prompt: string;
	trace: ConnectionDiagnosticTrace | null;
};

export type ManualConnectionDiagnosticArgs = {
	recorder: ConnectionDiagnosticRecorder;
	appState: ConnectionDiagnosticAppState;
	loadLatestSavedConnection: () => Promise<SavedConnectionEntry | null>;
	resolveKeySecurity: (
		details: SavedConnectionEntry['value'],
	) => Promise<ResolvedKeySecurity | null>;
	connectSavedEntry: (args: {
		connectionDetails: InputConnectionDetails;
		resolvedSecurity: ResolvedKeySecurity;
		trace: ConnectionDiagnosticTraceHandle;
	}) => Promise<ConnectAndOpenShellResult>;
	recovery: Parameters<typeof attemptSavedEntryWithTailscaleRecovery>[0]['recovery'];
	formatPrompt?: typeof formatConnectionDiagnosticPrompt;
};

let running = false;

function promptForTrace(
	trace: ConnectionDiagnosticTrace,
	args: ManualConnectionDiagnosticArgs,
) {
	return (args.formatPrompt ?? formatConnectionDiagnosticPrompt)(trace, {
		appState: args.appState,
	});
}

function finish(
	handle: ConnectionDiagnosticTraceHandle,
	status: 'connected' | 'failed' | 'skipped',
	args: ManualConnectionDiagnosticArgs,
): ManualConnectionDiagnosticResult {
	handle.finish(status);
	return {
		status,
		trace: handle.trace,
		prompt: promptForTrace(handle.trace, args),
	};
}

export async function runManualConnectionDiagnostic(
	args: ManualConnectionDiagnosticArgs,
): Promise<ManualConnectionDiagnosticResult> {
	if (running) {
		const latestTrace = args.recorder.getLatestTrace();
		const prompt = [
			'A Fressh connection diagnostic is already running. Try again after it finishes.',
			latestTrace ? promptForTrace(latestTrace, args) : null,
		]
			.filter(Boolean)
			.join('\n\n');
		return { status: 'busy', prompt, trace: latestTrace };
	}

	running = true;
	const handle = args.recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'command-menu',
	});

	try {
		const latestEntry = await args.loadLatestSavedConnection();
		if (!latestEntry) {
			handle.event({
				type: 'manual-diagnostic.saved-entry.missing',
				source: 'manual-diagnostic',
				message: 'No eligible saved auto-connect connection was found.',
			});
			return finish(handle, 'skipped', args);
		}

		const details = latestEntry.value;
		handle.event({
			type: 'manual-diagnostic.saved-entry.selected',
			source: 'manual-diagnostic',
			connection: {
				savedConnectionId: latestEntry.id,
				username: details.username,
				host: details.host,
				port: details.port,
				keyId: details.security.keyId,
				useTmux: details.useTmux,
				tmuxSessionName: details.tmuxSessionName,
			},
		});

		const resolvedSecurity = await args.resolveKeySecurity(details);
		if (!resolvedSecurity) {
			handle.event({
				type: 'manual-diagnostic.key-missing',
				source: 'manual-diagnostic',
				connection: {
					savedConnectionId: latestEntry.id,
					username: details.username,
					host: details.host,
					port: details.port,
					keyId: details.security.keyId,
				},
			});
			return finish(handle, 'failed', args);
		}

		handle.event({
			type: 'manual-diagnostic.key-resolved',
			source: 'manual-diagnostic',
			connection: {
				savedConnectionId: latestEntry.id,
				username: details.username,
				host: details.host,
				port: details.port,
				keyId: details.security.keyId,
			},
		});

		const normalizedDetails: InputConnectionDetails = {
			...details,
			useTmux: details.useTmux,
			tmuxSessionName: details.tmuxSessionName,
			autoConnect: details.autoConnect ?? false,
		};

		const result = await attemptSavedEntryWithTailscaleRecovery({
			platformOS: args.appState.platformOS,
			recovery: args.recovery,
			connectSavedEntry: () =>
				args.connectSavedEntry({
					connectionDetails: normalizedDetails,
					resolvedSecurity,
					trace: handle,
				}),
			markTailscaleAttention: (message) => {
				handle.event({
					type: 'manual-diagnostic.tailscale.attention',
					source: 'tailscale-recovery',
					message,
				});
			},
			clearTailscaleAttention: () => {
				handle.event({
					type: 'manual-diagnostic.tailscale.attention-cleared',
					source: 'tailscale-recovery',
				});
			},
			logTmuxAttachFailure: (tmuxResult) => {
				handle.event({
					type: 'manual-diagnostic.tmux-attach-failed',
					source: 'manual-diagnostic',
					connection: {
						connectionId: tmuxResult.connectionId,
						tmuxSessionName: tmuxResult.tmuxSessionName,
					},
					details: {
						tmuxAttachFailureReason: tmuxResult.tmuxAttachFailureReason,
					},
				});
			},
			logWarning: (message, error) => {
				handle.event({
					type: 'manual-diagnostic.warning',
					source: 'manual-diagnostic',
					message,
					error: serializeConnectionDiagnosticError(error),
				});
			},
			trace: handle,
		});

		return finish(handle, result.connected ? 'connected' : 'failed', args);
	} catch (error) {
		handle.event({
			type: 'manual-diagnostic.failed',
			source: 'manual-diagnostic',
			error: serializeConnectionDiagnosticError(error),
		});
		return finish(handle, 'failed', args);
	} finally {
		running = false;
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/connection-diagnostic-runner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/connection-diagnostic-runner.ts apps/mobile/test/integration/connection-diagnostic-runner.test.ts
git commit -m "Add manual connection diagnostic runner"
```

## Task 5: Connect Boundary Tracing And Diagnostic Cleanup

**Files:**
- Modify: `apps/mobile/src/lib/query-fns.ts`
- Create: `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts`

- [ ] **Step 1: Write failing connect boundary tests**

Create `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts`
with:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { connectAndOpenShell } from '../../src/lib/query-fns';

const connectionDetails = {
	username: 'muly',
	host: 'dev.tailnet.ts.net',
	port: 22,
	useTmux: true,
	tmuxSessionName: 'main',
	autoConnect: true,
	security: { type: 'key' as const, keyId: 'key-1' },
};

void test('connectAndOpenShell records connect and shell success events', async () => {
	const events: unknown[] = [];
	const navigations: unknown[] = [];

	const result = await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		connect: async () =>
			({
				connectionId: 'conn-1',
				startShell: async () => ({ channelId: 7 }),
			}) as never,
		navigate: (params) => {
			navigations.push(params);
		},
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.equal(result.status, 'connected');
	assert.deepEqual(navigations, [{ connectionId: 'conn-1', channelId: 7 }]);
	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		[
			'ssh.connect.started',
			'ssh.connect.connected',
			'ssh.shell.started',
			'ssh.shell.connected',
		],
	);
	assert.doesNotMatch(JSON.stringify(events), /secret/);
});

void test('connectAndOpenShell disconnects diagnostic connections after success', async () => {
	let disconnected = 0;

	await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		diagnosticMode: true,
		connect: async () =>
			({
				connectionId: 'conn-1',
				disconnect: () => {
					disconnected += 1;
				},
				startShell: async () => ({ channelId: 7 }),
			}) as never,
		navigate: () => {
			throw new Error('diagnostic mode must not navigate');
		},
	});

	assert.equal(disconnected, 1);
});

void test('connectAndOpenShell records connect failure', async () => {
	const events: unknown[] = [];

	await assert.rejects(
		connectAndOpenShell({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			connect: async () => {
				throw new Error('network unreachable');
			},
			navigate: () => {},
			trace: {
				event: (event) => {
					events.push(event);
				},
			},
		}),
		/network unreachable/,
	);

	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		['ssh.connect.started', 'ssh.connect.failed'],
	);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/connect-and-open-shell-diagnostics.test.ts
```

Expected: FAIL with TypeScript errors for unknown `trace` and
`diagnosticMode`.

- [ ] **Step 3: Add trace and diagnostic mode to connectAndOpenShell**

In `apps/mobile/src/lib/query-fns.ts`, import:

```ts
import {
	serializeConnectionDiagnosticError,
	type ConnectionDiagnosticEventInput,
} from './connection-diagnostics';
```

Add to the `connectAndOpenShell` args type:

```ts
	trace?: {
		event: (event: ConnectionDiagnosticEventInput) => void;
	};
	diagnosticMode?: boolean;
```

Inside `connectAndOpenShell`, add:

```ts
const traceEvent = (event: ConnectionDiagnosticEventInput) => {
	try {
		args.trace?.event(event);
	} catch (error) {
		logger.warn('Connect trace event failed', error);
	}
};
const connectionIdentity = {
	username: connectionDetails.username,
	host: connectionDetails.host,
	port: connectionDetails.port,
	keyId: connectionDetails.security.keyId,
	useTmux: connectionDetails.useTmux,
	tmuxSessionName: connectionDetails.tmuxSessionName,
};
```

Before `connectAndRememberConnection`, add:

```ts
traceEvent({
	type: 'ssh.connect.started',
	source: 'saved-entry',
	connection: connectionIdentity,
});
```

Wrap the `connectAndRememberConnection` call in `try/catch`:

```ts
let rememberedConnection: Awaited<ReturnType<typeof connectAndRememberConnection>>;
try {
	rememberedConnection = await connectAndRememberConnection({
		connectionDetails,
		connect,
		saveConnection: (params) =>
			secretsManager.connections.utils.upsertConnection(params),
		onConnectionProgress: (progressEvent) => {
			logger.info('SSH connect progress event', progressEvent);
			traceEvent({
				type: 'ssh.connect.progress',
				source: 'saved-entry',
				connection: connectionIdentity,
				details: { progressEvent },
			});
			onConnectionProgress?.(progressEvent);
		},
		abortSignalTimeoutMs,
		resolvedSecurity: security,
	});
} catch (error) {
	traceEvent({
		type: 'ssh.connect.failed',
		source: 'saved-entry',
		connection: connectionIdentity,
		error: serializeConnectionDiagnosticError(error),
	});
	throw error;
}
const { sshConnection, storedConnectionId } = rememberedConnection;
traceEvent({
	type: 'ssh.connect.connected',
	source: 'saved-entry',
	connection: { ...connectionIdentity, connectionId: sshConnection.connectionId },
	details: { storedConnectionId },
});
```

Before `sshConnection.startShell`, add:

```ts
traceEvent({
	type: 'ssh.shell.started',
	source: 'saved-entry',
	connection: { ...connectionIdentity, connectionId: sshConnection.connectionId },
});
```

In the shell catch, before the tmux branch, add:

```ts
traceEvent({
	type:
		tmuxAttachFailureReason !== null
			? 'ssh.shell.tmux-attach-failed'
			: 'ssh.shell.failed',
	source: 'saved-entry',
	connection: { ...connectionIdentity, connectionId: sshConnection.connectionId },
	error: serializeConnectionDiagnosticError(error),
	details: { tmuxAttachFailureReason, storedConnectionId },
});
```

After shell success, add:

```ts
traceEvent({
	type: 'ssh.shell.connected',
	source: 'saved-entry',
	connection: { ...connectionIdentity, connectionId: sshConnection.connectionId },
	details: { channelId: shellHandle.channelId, storedConnectionId },
});
```

Replace the unconditional `navigate({ ... })` call with:

```ts
if (!args.diagnosticMode) {
	navigate({
		connectionId: sshConnection.connectionId,
		channelId: shellHandle.channelId,
	});
}
```

Before returning connected result, add diagnostic cleanup:

```ts
if (args.diagnosticMode) {
	try {
		await Promise.resolve(sshConnection.disconnect?.());
		traceEvent({
			type: 'ssh.diagnostic.disconnected',
			source: 'saved-entry',
			connection: { ...connectionIdentity, connectionId: sshConnection.connectionId },
		});
	} catch (error) {
		traceEvent({
			type: 'ssh.diagnostic.disconnect-failed',
			source: 'saved-entry',
			connection: { ...connectionIdentity, connectionId: sshConnection.connectionId },
			error: serializeConnectionDiagnosticError(error),
		});
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/connect-and-open-shell-diagnostics.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/query-fns.ts apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts
git commit -m "Trace SSH connect diagnostics"
```

## Task 6: Prompt Delivery Helper And Keyboard Action

**Files:**
- Create: `apps/mobile/src/lib/connection-diagnostic-delivery.ts`
- Create: `apps/mobile/test/integration/connection-diagnostic-delivery.test.ts`
- Modify: `apps/mobile/src/lib/keyboard-actions.ts`
- Modify: `apps/mobile/test/integration/keyboard-actions.test.ts`

- [ ] **Step 1: Write failing delivery helper tests**

Create `apps/mobile/test/integration/connection-diagnostic-delivery.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverConnectionDiagnosticPrompt } from '../../src/lib/connection-diagnostic-delivery';

void test('delivery pastes into terminal when shell exists', async () => {
	const calls: string[] = [];

	const result = await deliverConnectionDiagnosticPrompt({
		prompt: 'debug prompt',
		hasShell: true,
		pasteIntoTerminal: (value) => {
			calls.push(`paste:${value}`);
		},
		copyToClipboard: async () => {
			calls.push('copy');
		},
		showAlert: (title, message) => {
			calls.push(`alert:${title}:${message}`);
		},
	});

	assert.deepEqual(result, { status: 'pasted' });
	assert.deepEqual(calls, ['paste:debug prompt']);
});

void test('delivery copies and alerts when no shell exists', async () => {
	const calls: string[] = [];

	const result = await deliverConnectionDiagnosticPrompt({
		prompt: 'debug prompt',
		hasShell: false,
		pasteIntoTerminal: () => {
			throw new Error('paste should not run');
		},
		copyToClipboard: async (value) => {
			calls.push(`copy:${value}`);
		},
		showAlert: (title, message) => {
			calls.push(`alert:${title}:${message}`);
		},
	});

	assert.deepEqual(result, { status: 'copied' });
	assert.equal(calls[0], 'copy:debug prompt');
	assert.match(calls[1] ?? '', /alert:Connection debug prompt copied/);
});

void test('delivery falls back to clipboard when paste throws', async () => {
	const calls: string[] = [];

	const result = await deliverConnectionDiagnosticPrompt({
		prompt: 'debug prompt',
		hasShell: true,
		pasteIntoTerminal: () => {
			throw new Error('paste failed');
		},
		copyToClipboard: async (value) => {
			calls.push(`copy:${value}`);
		},
		showAlert: (title, message) => {
			calls.push(`alert:${title}:${message}`);
		},
	});

	assert.deepEqual(result, { status: 'copied' });
	assert.equal(calls[0], 'copy:debug prompt');
	assert.match(calls[1] ?? '', /paste failed/i);
});
```

- [ ] **Step 2: Write failing keyboard action test**

Append to `apps/mobile/test/integration/keyboard-actions.test.ts`:

```ts
void test('connection diagnostic action delegates to action context', async () => {
	let calls = 0;

	await runAction('DEBUG_CONNECTION_IN_CODEX', {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		debugConnectionInCodex: async () => {
			calls += 1;
		},
	});

	assert.equal(calls, 1);
	assert.equal(KNOWN_ACTION_IDS.includes('DEBUG_CONNECTION_IN_CODEX'), true);
	assert.equal(
		CONFIG_SUPPORTED_ACTION_IDS.includes('DEBUG_CONNECTION_IN_CODEX'),
		true,
	);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/connection-diagnostic-delivery.test.ts test/integration/keyboard-actions.test.ts
```

Expected: FAIL with missing delivery module and unknown
`debugConnectionInCodex`.

- [ ] **Step 4: Implement delivery helper**

Create `apps/mobile/src/lib/connection-diagnostic-delivery.ts`:

```ts
export type ConnectionDiagnosticDeliveryResult =
	| { status: 'pasted' }
	| { status: 'copied' }
	| { status: 'copy-failed'; error: string };

export async function deliverConnectionDiagnosticPrompt({
	prompt,
	hasShell,
	pasteIntoTerminal,
	copyToClipboard,
	showAlert,
}: {
	prompt: string;
	hasShell: boolean;
	pasteIntoTerminal: (value: string) => void;
	copyToClipboard: (value: string) => Promise<void>;
	showAlert: (title: string, message: string) => void;
}): Promise<ConnectionDiagnosticDeliveryResult> {
	if (hasShell) {
		try {
			pasteIntoTerminal(prompt);
			return { status: 'pasted' };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			try {
				await copyToClipboard(prompt);
				showAlert(
					'Connection debug prompt copied',
					`Pasting into the terminal failed: ${message}\n\nThe prompt was copied to the clipboard instead.`,
				);
				return { status: 'copied' };
			} catch (copyError) {
				const copyMessage =
					copyError instanceof Error ? copyError.message : String(copyError);
				showAlert('Connection debug prompt copy failed', copyMessage);
				return { status: 'copy-failed', error: copyMessage };
			}
		}
	}

	try {
		await copyToClipboard(prompt);
		showAlert(
			'Connection debug prompt copied',
			'No active shell is available. Paste the copied prompt into Codex when you have a Codex TUI available.',
		);
		return { status: 'copied' };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showAlert('Connection debug prompt copy failed', message);
		return { status: 'copy-failed', error: message };
	}
}
```

- [ ] **Step 5: Add keyboard action**

In `apps/mobile/src/lib/keyboard-actions.ts`, add
`'DEBUG_CONNECTION_IN_CODEX',` to `KNOWN_ACTION_IDS` near `RESTART_CODEX`.

Add to `ActionContext`:

```ts
	debugConnectionInCodex?: () => Promise<void> | void;
```

Add to the `runAction` switch:

```ts
		case 'DEBUG_CONNECTION_IN_CODEX': {
			await context.debugConnectionInCodex?.();
			return;
		}
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/connection-diagnostic-delivery.test.ts test/integration/keyboard-actions.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/connection-diagnostic-delivery.ts apps/mobile/src/lib/keyboard-actions.ts apps/mobile/test/integration/connection-diagnostic-delivery.test.ts apps/mobile/test/integration/keyboard-actions.test.ts
git commit -m "Add connection diagnostic prompt delivery action"
```

## Task 7: Shell Config Entry

**Files:**
- Modify: `apps/mobile/config/shell-config.json`
- Modify: `apps/mobile/test/integration/command-menu.test.ts`
- Modify: `apps/mobile/test/integration/shell-config-schema.test.ts`

- [ ] **Step 1: Write failing command menu assertions**

In `apps/mobile/test/integration/command-menu.test.ts`, add this assertion to
the existing bundled command menu tree test:

```ts
assert.deepEqual(
	findEntry(shellConfig.commandMenus, ['mdev', 'Debug connection in Codex']),
	{
		type: 'action',
		label: 'Debug connection in Codex',
		actionId: 'DEBUG_CONNECTION_IN_CODEX',
	},
);
```

If the file does not expose `findEntry`, add this helper near the other command
menu helpers:

```ts
function findEntry(
	entries: CommandMenuEntry[],
	path: string[],
): CommandMenuEntry | undefined {
	let currentEntries = entries;
	let current: CommandMenuEntry | undefined;
	for (const label of path) {
		current = currentEntries.find((entry) => entry.label === label);
		if (!current) return undefined;
		currentEntries = current.type === 'submenu' ? current.entries : [];
	}
	return current;
}
```

In `apps/mobile/test/integration/shell-config-schema.test.ts`, add:

```ts
void test('runtime shell config accepts connection diagnostic action', () => {
	const parsed = parseShellConfigData({
		version: 'test',
		updatedAt: '2026-06-28T00:00:00.000Z',
		defaultKeyboardId: 'main',
		activeKeyboardIds: ['main'],
		keyboardRouting: {
			actionTargets: {},
			oneShotReturnByKeyboardId: {},
		},
		keyboards: [
			{
				id: 'main',
				name: 'Main',
				grid: [
					[
						{
							type: 'action',
							actionId: 'DEBUG_CONNECTION_IN_CODEX',
							label: 'Debug connection',
							icon: null,
						},
					],
				],
			},
		],
		macrosByKeyboardId: { main: [] },
		commandMenus: [
			{
				type: 'action',
				label: 'Debug connection in Codex',
				actionId: 'DEBUG_CONNECTION_IN_CODEX',
			},
		],
	});

	assert.equal(parsed.commandMenus[0]?.type, 'action');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/command-menu.test.ts test/integration/shell-config-schema.test.ts
```

Expected: FAIL because bundled config does not contain the new entry.

- [ ] **Step 3: Add bundled command menu entry**

In `apps/mobile/config/shell-config.json`, inside the `"mdev"` submenu
`"entries"` array, add this object after `"Fit terminal to device"`:

```json
{
	"type": "action",
	"label": "Debug connection in Codex",
	"actionId": "DEBUG_CONNECTION_IN_CODEX"
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/command-menu.test.ts test/integration/shell-config-schema.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/config/shell-config.json apps/mobile/test/integration/command-menu.test.ts apps/mobile/test/integration/shell-config-schema.test.ts
git commit -m "Expose connection diagnostic command"
```

## Task 8: Wire AutoConnectManager And Shell Detail

**Files:**
- Modify: `apps/mobile/src/lib/auto-connect.tsx`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Create: `apps/mobile/test/integration/connection-diagnostic-integration.test.ts`

- [ ] **Step 1: Write integration-level source checks**

Create `apps/mobile/test/integration/connection-diagnostic-integration.test.ts`
with:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const autoConnectSource = readFileSync(
	new URL('../../src/lib/auto-connect.tsx', import.meta.url),
	'utf8',
);
const detailSource = readFileSync(
	new URL('../../src/app/shell/detail.tsx', import.meta.url),
	'utf8',
);

void test('AutoConnectManager uses the shared connection diagnostic recorder', () => {
	assert.match(
		autoConnectSource,
		/connectionDiagnosticRecorder/,
	);
	assert.match(autoConnectSource, /activeDiagnosticTraceRef\.current\s*=\s*trace/);
	assert.match(autoConnectSource, /trace,\s*\n/);
});

void test('shell detail wires DEBUG_CONNECTION_IN_CODEX action delivery', () => {
	assert.match(detailSource, /runManualConnectionDiagnostic/);
	assert.match(detailSource, /deliverConnectionDiagnosticPrompt/);
	assert.match(detailSource, /debugConnectionInCodex:\s*handleDebugConnectionInCodex/);
	assert.match(detailSource, /diagnosticMode:\s*true/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/connection-diagnostic-integration.test.ts
```

Expected: FAIL because the files do not contain the wiring.

- [ ] **Step 3: Wire passive recorder in AutoConnectManager**

In `apps/mobile/src/lib/auto-connect.tsx`, import:

```ts
import {
	connectionDiagnosticRecorder,
	type ConnectionDiagnosticTraceHandle,
} from './connection-diagnostics';
```

Inside `AutoConnectManager`, near other refs, add:

```ts
const activeDiagnosticTraceRef =
	React.useRef<ConnectionDiagnosticTraceHandle | null>(null);
```

At the start of `attemptAutoConnect`, after the in-flight guard and before
`setAutoConnecting(true);`, add:

```ts
const trace =
	activeDiagnosticTraceRef.current ??
	connectionDiagnosticRecorder.startTrace({
		trigger: isReconnecting ? 'reconnect' : 'initial-auto-connect',
		reason: isReconnecting ? 'reconnect-attempt' : 'auto-connect-attempt',
	});
activeDiagnosticTraceRef.current = trace;
```

Pass the trace into `attemptAutoConnectSource`:

```ts
trace,
```

In the `try` block, store the result so the trace can be finished:

```ts
const connected = await attemptAutoConnectSource({
	// existing args
	trace,
});
if (connected) {
	trace.finish('connected');
	activeDiagnosticTraceRef.current = null;
}
return connected;
```

In the catch block before `return false`, add:

```ts
trace.event({
	type: 'auto-connect.attempt.failed',
	source: 'command-menu',
	error: error instanceof Error
		? {
				name: error.name || 'Error',
				message: error.message,
				...(error.stack ? { stack: error.stack } : {}),
			}
		: { name: 'NonError', message: String(error) },
});
trace.finish('failed');
activeDiagnosticTraceRef.current = null;
```

When creating `createAutoConnectReconnectController`, pass:

```ts
trace: {
	event: (event) => {
		const trace =
			activeDiagnosticTraceRef.current ??
			connectionDiagnosticRecorder.startTrace({
				trigger: 'reconnect',
				reason: 'reconnect-controller',
			});
		activeDiagnosticTraceRef.current = trace;
		trace.event(event);
	},
},
```

- [ ] **Step 4: Wire manual diagnostic action in shell detail**

In `apps/mobile/src/app/shell/detail.tsx`, add imports:

```ts
import * as Clipboard from 'expo-clipboard';
import { Alert } from 'react-native';
import { deliverConnectionDiagnosticPrompt } from '@/lib/connection-diagnostic-delivery';
import { runManualConnectionDiagnostic } from '@/lib/connection-diagnostic-runner';
import {
	connectionDiagnosticRecorder,
	formatConnectionDiagnosticPrompt,
} from '@/lib/connection-diagnostics';
import { pickLatestConnection } from '@/lib/connection-utils';
import { connectAndOpenShell } from '@/lib/query-fns';
import { tailscaleRecovery } from '@/lib/tailscale-recovery';
```

If `Clipboard` or `Alert` is already imported, extend the existing imports
instead of duplicating them.

Add this callback before `actionContext`:

```ts
const handleDebugConnectionInCodex = useCallback(async () => {
	const result = await runManualConnectionDiagnostic({
		recorder: connectionDiagnosticRecorder,
		appState: {
			platformOS: Platform.OS,
			pathname: '/shell/detail',
			isAutoConnecting,
			isReconnecting,
			appActive: isAppActiveRef.current,
		},
		loadLatestSavedConnection: async () => {
			const entries = await queryClient.fetchQuery(
				secretsManager.connections.query.list,
			);
			return pickLatestConnection(entries?.filter((entry) => entry.value.autoConnect));
		},
		resolveKeySecurity: async (details) => {
			const keyEntry = await secretsManager.keys.utils.getPrivateKey(
				details.security.keyId,
			);
			return { type: 'key' as const, privateKey: keyEntry.value };
		},
		connectSavedEntry: ({ connectionDetails, resolvedSecurity, trace }) =>
			connectAndOpenShell({
				connectionDetails,
				resolvedSecurity,
				connect,
				diagnosticMode: true,
				navigate: () => {},
				trace,
			}),
		recovery: tailscaleRecovery,
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	await deliverConnectionDiagnosticPrompt({
		prompt: result.prompt,
		hasShell: Boolean(shell),
		pasteIntoTerminal: (value) => {
			sendTextRaw(value);
		},
		copyToClipboard: (value) => Clipboard.setStringAsync(value),
		showAlert: (title, message) => {
			Alert.alert(title, message);
		},
	});
}, [connect, isAutoConnecting, isReconnecting, sendTextRaw, shell]);
```

Add to `actionContext`:

```ts
debugConnectionInCodex: handleDebugConnectionInCodex,
```

Add `handleDebugConnectionInCodex` to the `useMemo` dependency list.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/connection-diagnostic-integration.test.ts test/integration/connection-diagnostic-runner.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run TypeScript check for wiring mistakes**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS. If it fails on import duplication in `detail.tsx`, merge the
new imports into the existing import declarations and rerun the same command.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/auto-connect.tsx apps/mobile/src/app/shell/detail.tsx apps/mobile/src/lib/connection-diagnostic-runner.ts apps/mobile/test/integration/connection-diagnostic-integration.test.ts apps/mobile/test/integration/connection-diagnostic-runner.test.ts
git commit -m "Wire connection diagnostics into mobile shell"
```

## Task 9: Final Verification And Cleanup

**Files:**
- Modify only files touched in previous tasks if verification exposes defects.

- [ ] **Step 1: Run the focused diagnostic test suite**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/connection-diagnostics.test.ts test/integration/connection-diagnostic-runner.test.ts test/integration/connection-diagnostic-delivery.test.ts test/integration/connect-and-open-shell-diagnostics.test.ts test/integration/auto-connect-reconnect-controller.test.ts test/integration/auto-connect-attempt.test.ts test/integration/auto-connect-saved-entry.test.ts test/integration/keyboard-actions.test.ts test/integration/command-menu.test.ts test/integration/shell-config-schema.test.ts test/integration/connection-diagnostic-integration.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run mobile typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS.

- [ ] **Step 3: Run mobile lint check**

Run:

```bash
pnpm --filter @fressh/mobile lint:check
```

Expected: PASS.

- [ ] **Step 4: Run shell config validation**

Run:

```bash
pnpm --filter @fressh/mobile validate:shell-config
```

Expected: PASS and no unsupported action id errors.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff --stat HEAD
git diff --check
```

Expected: `git diff --check` prints nothing. The stat should show only mobile
diagnostics, auto-connect/reconnect, command action, command config, tests, and
this plan if it has not already been committed.

- [ ] **Step 6: Commit verification fixes if any were needed**

If Step 1 through Step 4 required code changes, run:

```bash
git add apps/mobile/src apps/mobile/test/integration apps/mobile/config/shell-config.json
git commit -m "Fix connection diagnostic verification issues"
```

Expected: a commit is created only when verification fixes were made.

## Manual Preview Verification

- [ ] Build or install the Android preview build using the repository default
      preview workflow if a device check is requested:

```bash
cd apps/mobile && ANDROID_HOME=/home/muly/Android/Sdk ANDROID_SDK_ROOT=/home/muly/Android/Sdk EAS_SKIP_AUTO_FINGERPRINT=1 pnpm exec eas build --local --profile preview --platform android
```

Expected: local EAS preview build completes.

- [ ] On device, open a shell with Codex TUI active, then choose
      `Cmds > mdev > Debug connection in Codex`.

Expected: a diagnostic prompt is pasted into the current terminal.

- [ ] Close the shell or enter a state with no active shell, then choose the
      same command.

Expected: the prompt is copied to the clipboard and an alert says the
connection debug prompt was copied.

- [ ] Temporarily break the saved auto-connect target or Tailscale route and
      run the command.

Expected: the prompt includes host/user/port, saved connection id, key id,
Tailscale readiness/recovery events, SSH error details, and no private key
contents.

## Self-Review Notes

- Spec coverage:
  - Core traces and prompt formatting: Task 1.
  - Passive reconnect capture: Task 2.
  - Passive auto-connect/Tailscale capture: Task 3.
  - Manual diagnostic attempt: Task 4 and Task 5.
  - Prompt delivery to terminal or clipboard: Task 6 and Task 8.
  - Command menu entry: Task 7.
  - Verification: Task 9.
- Type consistency:
  - All trace hooks use `ConnectionDiagnosticEventInput`.
  - Manual diagnostic runner passes `ConnectionDiagnosticTraceHandle` to
    connect boundary tracing.
  - The action id is consistently `DEBUG_CONNECTION_IN_CODEX`.
- Scope control:
  - No diagnostics screen, upload, bridge dependency, persistent log store, or
    redaction UI is included.
