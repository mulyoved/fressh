# Connection Diagnostics Zero-Debt Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the connection diagnostics branch so diagnostic probing, normal shell opening, prompt delivery, and trace formatting live behind clean boundaries without changing user-visible behavior.

**Architecture:** Split the current flag-driven `connectAndOpenShell` into a normal saved-entry opener and a dedicated diagnostic probe. Extract the command-menu debug workflow from `shell/detail.tsx`, split the diagnostics god module into focused files behind a barrel, and replace source-grep wiring tests with behavioral tests against the new boundaries.

**Tech Stack:** Expo React Native, TypeScript, Node `tsx --test`, ESLint, pnpm, existing SSH/Tailscale modules under `apps/mobile/src/lib`.

---

## File Structure

Create:

- `apps/mobile/src/lib/connection-diagnostic-types.ts`  
  Public diagnostic types only.
- `apps/mobile/src/lib/connection-diagnostic-redaction.ts`  
  Redaction, defensive snapshotting, clone helpers, and field readers used by recorder/prompt/error serialization.
- `apps/mobile/src/lib/connection-diagnostic-recorder.ts`  
  Recorder implementation and `connectionDiagnosticRecorder` singleton.
- `apps/mobile/src/lib/connection-diagnostic-prompt.ts`  
  Prompt formatting and connection identity formatting.
- `apps/mobile/src/lib/diagnostic-shell-probe.ts`  
  Diagnostic-only SSH probe flow: no save, no navigation, no store registration, bounded cleanup.
- `apps/mobile/src/lib/connection-debug-command.ts`  
  Command-menu workflow wrapper for manual diagnostics and prompt delivery.
- `apps/mobile/test/integration/diagnostic-shell-probe.test.ts`  
  Direct diagnostic probe behavior tests.
- `apps/mobile/test/integration/connection-debug-command.test.ts`  
  Behavioral tests for the extracted shell debug command.

Modify:

- `apps/mobile/src/lib/connection-diagnostics.ts`  
  Convert to a small barrel export file.
- `apps/mobile/src/lib/connect-and-open-shell.ts`  
  Remove `diagnosticMode`; keep normal saved-entry flow only.
- `apps/mobile/src/lib/connection-diagnostic-runner.ts`  
  Use a probe-shaped result type instead of importing `ConnectAndOpenShellResult`.
- `apps/mobile/src/app/shell/detail.tsx`  
  Delegate debug command to `runConnectionDebugCommand`.
- `apps/mobile/src/lib/auto-connect.tsx`  
  Keep trace lifecycle, reduce inline diagnostic wiring where touched.
- `apps/mobile/src/lib/auto-connect-attempt.ts`  
  Move repeated trace event shapes behind local helpers.
- `apps/mobile/src/lib/auto-connect-saved-entry.ts`  
  Move repeated trace event shapes behind local helpers.
- `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts`  
  Keep normal-flow tests; move diagnostic tests to `diagnostic-shell-probe.test.ts`.
- `apps/mobile/test/integration/connection-diagnostic-integration.test.ts`  
  Delete source-grep tests after behavioral replacements exist.
- Existing diagnostic tests under `apps/mobile/test/integration/connection-diagnostics.test.ts`  
  Keep imports through `connection-diagnostics.ts` barrel and ensure all pass.

Verification commands used throughout:

```bash
pnpm --filter @fressh/mobile typecheck
pnpm --filter @fressh/mobile exec eslint --max-warnings 0 --report-unused-disable-directives <changed files>
pnpm --filter @fressh/mobile exec tsx --test <changed test files>
```

---

### Task 1: Split Diagnostic Types, Redaction, Recorder, And Prompt Modules

**Files:**
- Create: `apps/mobile/src/lib/connection-diagnostic-types.ts`
- Create: `apps/mobile/src/lib/connection-diagnostic-redaction.ts`
- Create: `apps/mobile/src/lib/connection-diagnostic-recorder.ts`
- Create: `apps/mobile/src/lib/connection-diagnostic-prompt.ts`
- Modify: `apps/mobile/src/lib/connection-diagnostics.ts`
- Test: `apps/mobile/test/integration/connection-diagnostics.test.ts`

- [ ] **Step 1: Write the decomposition target with public types**

Create `apps/mobile/src/lib/connection-diagnostic-types.ts` with the public type declarations that currently live at the top of `connection-diagnostics.ts`:

```ts
export type ConnectionDiagnosticTrigger =
	| 'initial-auto-connect'
	| 'reconnect'
	| 'manual-diagnostic'
	| 'command-menu';

export type ConnectionDiagnosticStatus =
	| 'running'
	| 'failed'
	| 'connected'
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
	tag?: string;
	inner?: unknown;
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
	trigger: ConnectionDiagnosticTrigger;
	reason: string;
	status: ConnectionDiagnosticStatus;
	startedAtMs: number;
	finishedAtMs?: number;
	events: ConnectionDiagnosticEvent[];
};

export type ConnectionDiagnosticTraceHandle = {
	readonly trace: ConnectionDiagnosticTrace;
	event: (input: ConnectionDiagnosticEventInput) => ConnectionDiagnosticEvent;
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
	clear: () => void;
};

export type ConnectionDiagnosticRecorderOptions = {
	now?: () => number;
	maxHistory?: number;
};

export type ConnectionDiagnosticPromptOptions = {
	appState?: ConnectionDiagnosticAppState;
};
```

- [ ] **Step 2: Run existing diagnostics test to establish pre-split baseline**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/connection-diagnostics.test.ts
```

Expected: PASS before edits, proving the split starts from a green baseline.

- [ ] **Step 3: Move redaction and normalization helpers**

Create `apps/mobile/src/lib/connection-diagnostic-redaction.ts`. Move the following current implementation details from `connection-diagnostics.ts` into it:

- `CIRCULAR_PLACEHOLDER`
- `REDACTED_PLACEHOLDER`
- `UNREADABLE_ERROR_MESSAGE`
- all `DIAGNOSTIC_*` regex/list constants
- `redactDiagnosticText`
- `containsDiagnosticSecretTerm`
- `isSecretDiagnosticKey`
- `snapshotDiagnosticValue`
- `cloneDiagnosticValue`
- `sanitizeEventInput`
- `createConnectionDiagnosticEvent`
- `normalizeTraceForPrompt`
- `serializeConnectionDiagnosticError`
- `createSerializedErrorFromFields`
- `isErrorLike`
- `readErrorStringField`
- `readNumberField`
- `readBooleanField`
- `readConnectionDiagnosticSource`
- `readConnectionDiagnosticTrigger`
- `readConnectionDiagnosticStatus`
- `normalizeConnectionIdentity`
- `normalizeDiagnosticError`
- `readObjectField`

Use these imports and exported function names. Copy each listed function body from the current `connection-diagnostics.ts` into the named export without changing behavior:

```ts
import { redactBrowserActionErrorText } from './browser-action-error-report';
import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticError,
	type ConnectionDiagnosticEvent,
	type ConnectionDiagnosticEventInput,
	type ConnectionDiagnosticSource,
	type ConnectionDiagnosticStatus,
	type ConnectionDiagnosticTrace,
	type ConnectionDiagnosticTrigger,
} from './connection-diagnostic-types';

export const CIRCULAR_PLACEHOLDER = '[Circular]';
export const REDACTED_PLACEHOLDER = '[REDACTED]';
export const UNREADABLE_ERROR_MESSAGE = '[Unserializable error]';
```

Export these functions from `connection-diagnostic-redaction.ts`: `redactDiagnosticText`, `cloneDiagnosticValue`, `createConnectionDiagnosticEvent`, `normalizeTraceForPrompt`, `normalizeConnectionIdentity`, and `serializeConnectionDiagnosticError`. Keep these helpers private inside the file: `containsDiagnosticSecretTerm`, `isSecretDiagnosticKey`, `snapshotDiagnosticValue`, `sanitizeEventInput`, `createSerializedErrorFromFields`, `isErrorLike`, `readErrorStringField`, `readNumberField`, `readBooleanField`, `readConnectionDiagnosticSource`, `readConnectionDiagnosticTrigger`, `readConnectionDiagnosticStatus`, `normalizeDiagnosticError`, and `readObjectField`.

- [ ] **Step 4: Move recorder implementation**

Create `apps/mobile/src/lib/connection-diagnostic-recorder.ts`:

```ts
import {
	cloneDiagnosticValue,
	createConnectionDiagnosticEvent,
	redactDiagnosticText,
} from './connection-diagnostic-redaction';
import {
	type ConnectionDiagnosticRecorder,
	type ConnectionDiagnosticRecorderOptions,
	type ConnectionDiagnosticTrace,
} from './connection-diagnostic-types';

const DEFAULT_MAX_HISTORY = 20;

type HistoryEntry = {
	order: number;
	trace: ConnectionDiagnosticTrace;
};

let traceSequence = 0;

function nextTraceId(now: number): string {
	traceSequence += 1;
	return `connection-diagnostic-${now}-${traceSequence}`;
}

function cloneTrace(
	trace: ConnectionDiagnosticTrace,
): ConnectionDiagnosticTrace {
	return {
		...trace,
		reason: redactDiagnosticText(trace.reason),
		events: trace.events.map((event) => cloneDiagnosticValue(event)),
	};
}

export function createConnectionDiagnosticRecorder(
	options: ConnectionDiagnosticRecorderOptions = {},
): ConnectionDiagnosticRecorder {
	const now = options.now ?? Date.now;
	const maxHistory = Math.max(1, options.maxHistory ?? DEFAULT_MAX_HISTORY);
	let latestTrace: ConnectionDiagnosticTrace | null = null;
	let history: HistoryEntry[] = [];
	let recorderGeneration = 0;
	let traceOrderSequence = 0;

	return {
		startTrace: ({ trigger, reason }) => {
			const startedAtMs = now();
			const traceGeneration = recorderGeneration;
			traceOrderSequence += 1;
			const traceOrder = traceOrderSequence;
			const trace: ConnectionDiagnosticTrace = {
				id: nextTraceId(startedAtMs),
				trigger,
				reason,
				status: 'running',
				startedAtMs,
				events: [],
			};
			latestTrace = trace;
			let finished = false;

			return {
				get trace() {
					return cloneTrace(trace);
				},
				event: (input) => {
					const atMs = now();
					const event = createConnectionDiagnosticEvent({
						rawEvent: input,
						startedAtMs: trace.startedAtMs,
						atMs,
					});
					if (finished) {
						return cloneDiagnosticValue(event);
					}
					trace.events.push(event);
					return cloneDiagnosticValue(event);
				},
				finish: (status) => {
					if (finished) {
						return;
					}
					finished = true;
					trace.status = status;
					trace.finishedAtMs = now();
					if (traceGeneration === recorderGeneration) {
						history = [
							...history.filter((entry) => entry.trace.id !== trace.id),
							{ order: traceOrder, trace: cloneTrace(trace) },
						]
							.sort((left, right) => left.order - right.order)
							.slice(-maxHistory);
					}
				},
			};
		},
		getLatestTrace: () => (latestTrace ? cloneTrace(latestTrace) : null),
		getHistory: () => history.map((entry) => cloneTrace(entry.trace)),
		clear: () => {
			recorderGeneration += 1;
			latestTrace = null;
			history = [];
		},
	};
}

export const connectionDiagnosticRecorder =
	createConnectionDiagnosticRecorder();
```

- [ ] **Step 5: Move prompt implementation**

Create `apps/mobile/src/lib/connection-diagnostic-prompt.ts`:

```ts
import {
	cloneDiagnosticValue,
	normalizeConnectionIdentity,
	normalizeTraceForPrompt,
	redactDiagnosticText,
	UNREADABLE_ERROR_MESSAGE,
} from './connection-diagnostic-redaction';
import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticEvent,
	type ConnectionDiagnosticPromptOptions,
	type ConnectionDiagnosticTrace,
} from './connection-diagnostic-types';
```

Move these current functions from `connection-diagnostics.ts` into this file with their existing bodies: `formatConnectionIdentity`, `formatEvent`, `findPrimaryConnectionIdentity`, and `formatConnectionDiagnosticPrompt`. Export only `formatConnectionDiagnosticPrompt`; keep the other three functions private.

- [ ] **Step 6: Replace `connection-diagnostics.ts` with a barrel**

Modify `apps/mobile/src/lib/connection-diagnostics.ts` to:

```ts
export * from './connection-diagnostic-types';
export {
	cloneDiagnosticValue,
	normalizeConnectionIdentity,
	normalizeTraceForPrompt,
	redactDiagnosticText,
	serializeConnectionDiagnosticError,
} from './connection-diagnostic-redaction';
export {
	connectionDiagnosticRecorder,
	createConnectionDiagnosticRecorder,
} from './connection-diagnostic-recorder';
export { formatConnectionDiagnosticPrompt } from './connection-diagnostic-prompt';
```

- [ ] **Step 7: Run diagnostics tests and typecheck**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/connection-diagnostics.test.ts
pnpm --filter @fressh/mobile typecheck
pnpm --filter @fressh/mobile exec eslint --max-warnings 0 --report-unused-disable-directives src/lib/connection-diagnostics.ts src/lib/connection-diagnostic-types.ts src/lib/connection-diagnostic-redaction.ts src/lib/connection-diagnostic-recorder.ts src/lib/connection-diagnostic-prompt.ts test/integration/connection-diagnostics.test.ts
```

Expected: all pass. `wc -l apps/mobile/src/lib/connection-diagnostics.ts` should show a small barrel, not a near-1k implementation file.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/lib/connection-diagnostics.ts apps/mobile/src/lib/connection-diagnostic-types.ts apps/mobile/src/lib/connection-diagnostic-redaction.ts apps/mobile/src/lib/connection-diagnostic-recorder.ts apps/mobile/src/lib/connection-diagnostic-prompt.ts apps/mobile/test/integration/connection-diagnostics.test.ts
git commit -m "Split connection diagnostic modules"
```

---

### Task 2: Extract Diagnostic Shell Probe From Normal Shell Opening

**Files:**
- Create: `apps/mobile/src/lib/diagnostic-shell-probe.ts`
- Create: `apps/mobile/test/integration/diagnostic-shell-probe.test.ts`
- Modify: `apps/mobile/src/lib/connect-and-open-shell.ts`
- Modify: `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts`

- [ ] **Step 1: Write failing diagnostic probe tests**

Create `apps/mobile/test/integration/diagnostic-shell-probe.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { runDiagnosticShellProbe } from '../../src/lib/diagnostic-shell-probe';

const connectionDetails = {
	username: 'muly',
	host: 'dev.tailnet.ts.net',
	port: 22,
	useTmux: true,
	tmuxSessionName: 'main',
	autoConnect: true,
	security: { type: 'key' as const, keyId: 'key-1' },
};

void test('diagnostic probe disconnects after success and never navigates or saves', async () => {
	let disconnected = 0;
	const startShellOptions: unknown[] = [];
	const events: unknown[] = [];

	const result = await runDiagnosticShellProbe({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		connect: async () =>
			({
				connectionId: 'conn-1',
				disconnect: () => {
					disconnected += 1;
				},
				startShell: async (options: unknown) => {
					startShellOptions.push(options);
					return { channelId: 7 };
				},
			}) as never,
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.equal(result.status, 'connected');
	assert.equal(disconnected, 1);
	assert.equal(
		(startShellOptions[0] as { registerInStore?: boolean }).registerInStore,
		false,
	);
	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		[
			'ssh.connect.started',
			'ssh.connect.connected',
			'ssh.shell.started',
			'ssh.shell.connected',
			'ssh.diagnostic.disconnected',
		],
	);
	assert.doesNotMatch(JSON.stringify(events), /secret/);
});

void test('diagnostic probe disconnects after tmux attach failure without throwing', async () => {
	let disconnected = 0;

	const result = await runDiagnosticShellProbe({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		connect: async () =>
			({
				connectionId: 'conn-1',
				disconnect: () => {
					disconnected += 1;
				},
				startShell: async () => {
					throw {
						tag: 'TmuxAttachFailed',
						inner: ['missing session'],
					};
				},
			}) as never,
	});

	assert.equal(result.status, 'tmux_attach_failed');
	assert.equal(result.connectionId, 'conn-1');
	assert.equal(disconnected, 1);
});

void test('diagnostic probe disconnects after shell failure and preserves shell error', async () => {
	let disconnected = 0;

	await assert.rejects(
		runDiagnosticShellProbe({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			connect: async () =>
				({
					connectionId: 'conn-1',
					disconnect: () => {
						disconnected += 1;
					},
					startShell: async () => {
						throw new Error('shell failed');
					},
				}) as never,
		}),
		/shell failed/,
	);

	assert.equal(disconnected, 1);
});

void test('diagnostic probe records disconnect timeout without replacing shell failure', async () => {
	const events: unknown[] = [];

	await assert.rejects(
		runDiagnosticShellProbe({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			abortSignalTimeoutMs: 5,
			connect: async () =>
				({
					connectionId: 'conn-1',
					disconnect: async () => {
						await new Promise(() => {});
					},
					startShell: async () => {
						throw new Error('shell failed');
					},
				}) as never,
			trace: {
				event: (event) => {
					events.push(event);
				},
			},
		}),
		/shell failed/,
	);

	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		[
			'ssh.connect.started',
			'ssh.connect.connected',
			'ssh.shell.started',
			'ssh.shell.failed',
			'ssh.diagnostic.disconnect-failed',
		],
	);
});

void test('diagnostic probe records connect failure', async () => {
	const events: unknown[] = [];

	await assert.rejects(
		runDiagnosticShellProbe({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			connect: async () => {
				throw new Error('network unreachable');
			},
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

- [ ] **Step 2: Run new test to verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/diagnostic-shell-probe.test.ts
```

Expected: FAIL with a module-not-found error for `diagnostic-shell-probe`.

- [ ] **Step 3: Implement `diagnostic-shell-probe.ts`**

Create `apps/mobile/src/lib/diagnostic-shell-probe.ts`:

```ts
// eslint-disable-next-line import/consistent-type-specifier-style -- Pure type import keeps Node integration tests from loading React Native.
import type {
	ConnectionDetails,
	RnRussh,
	SshConnection,
	SshConnectionProgress,
	SshShell,
} from '@fressh/react-native-uniffi-russh';
import {
	serializeConnectionDiagnosticError,
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticEventInput,
} from './connection-diagnostics';
import { type InputConnectionDetails } from './connection-storage';
import { getStoredConnectionId } from './connection-utils';
import { rootLogger } from './logger';
import { extractTmuxAttachFailureReason } from './ssh-error-details';
import { type RegisteredStartShellOptions } from './ssh-registry-store';
import { AbortSignalTimeout } from './utils';

const logger = rootLogger.extend('DiagnosticShellProbe');
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

export type DiagnosticShellProbeResult =
	| {
			status: 'connected';
			sshConnection: SshConnection;
			shellHandle: SshShell;
			connectionId: string;
			channelId: number;
	  }
	| {
			status: 'tmux_attach_failed';
			connectionId: string;
			tmuxAttachFailureReason: string | null;
			tmuxSessionName: string;
			storedConnectionId: string;
	  };

type ProbeTrace = {
	event: (event: ConnectionDiagnosticEventInput) => void;
};

function diagnosticDisconnectTimeoutError(timeoutMs: number) {
	return new Error(`Diagnostic SSH disconnect timed out after ${timeoutMs}ms`);
}

async function withDiagnosticDisconnectTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timeoutId = setTimeout(() => {
					timeoutId = null;
					reject(diagnosticDisconnectTimeoutError(timeoutMs));
				}, timeoutMs);
				const maybeNodeTimer = timeoutId as ReturnType<typeof setTimeout> & {
					unref?: () => void;
				};
				maybeNodeTimer.unref?.();
			}),
		]);
	} finally {
		if (timeoutId !== null) clearTimeout(timeoutId);
	}
}

export async function runDiagnosticShellProbe(args: {
	connectionDetails: InputConnectionDetails;
	connect: typeof RnRussh.connect;
	resolvedSecurity: ConnectionDetails['security'];
	onConnectionProgress?: (progressEvent: SshConnectionProgress) => void;
	abortSignalTimeoutMs?: number;
	trace?: ProbeTrace;
}): Promise<DiagnosticShellProbeResult> {
	const {
		connectionDetails,
		connect,
		resolvedSecurity,
		onConnectionProgress,
		abortSignalTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
	} = args;
	const traceEvent = (event: ConnectionDiagnosticEventInput) => {
		try {
			args.trace?.event(event);
		} catch (error) {
			logger.warn('Diagnostic probe trace event failed', error);
		}
	};
	const connectionIdentity: ConnectionDiagnosticConnectionIdentity = {
		username: connectionDetails.username,
		host: connectionDetails.host,
		port: connectionDetails.port,
		keyId: connectionDetails.security.keyId,
		useTmux: connectionDetails.useTmux,
		tmuxSessionName: connectionDetails.tmuxSessionName,
	};
	const storedConnectionId = getStoredConnectionId(connectionDetails);

	traceEvent({
		type: 'ssh.connect.started',
		source: 'saved-entry',
		connection: connectionIdentity,
	});

	let sshConnection: SshConnection;
	try {
		sshConnection = await connect({
			host: connectionDetails.host,
			port: connectionDetails.port,
			username: connectionDetails.username,
			security: resolvedSecurity,
			onConnectionProgress: (progressEvent) => {
				traceEvent({
					type: 'ssh.connect.progress',
					source: 'saved-entry',
					connection: connectionIdentity,
					details: { progressEvent },
				});
				onConnectionProgress?.(progressEvent);
			},
			onServerKey: async () => true,
			abortSignal: AbortSignalTimeout(abortSignalTimeoutMs),
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

	const connectedIdentity = {
		...connectionIdentity,
		connectionId: sshConnection.connectionId,
	};
	traceEvent({
		type: 'ssh.connect.connected',
		source: 'saved-entry',
		connection: connectedIdentity,
		details: { storedConnectionId },
	});

	const cleanupDiagnosticConnection = async () => {
		try {
			await withDiagnosticDisconnectTimeout(
				Promise.resolve(
					sshConnection.disconnect?.({
						signal: AbortSignalTimeout(abortSignalTimeoutMs),
					}),
				),
				abortSignalTimeoutMs,
			);
			traceEvent({
				type: 'ssh.diagnostic.disconnected',
				source: 'saved-entry',
				connection: connectedIdentity,
			});
		} catch (error) {
			traceEvent({
				type: 'ssh.diagnostic.disconnect-failed',
				source: 'saved-entry',
				connection: connectedIdentity,
				error: serializeConnectionDiagnosticError(error),
			});
		}
	};

	let shellHandle: Awaited<ReturnType<typeof sshConnection.startShell>>;
	try {
		traceEvent({
			type: 'ssh.shell.started',
			source: 'saved-entry',
			connection: connectedIdentity,
		});
		const startShellOptions: RegisteredStartShellOptions = {
			term: 'Xterm',
			useTmux: connectionDetails.useTmux,
			tmuxSessionName: connectionDetails.tmuxSessionName,
			abortSignal: AbortSignalTimeout(abortSignalTimeoutMs),
			registerInStore: false,
		};
		shellHandle = await sshConnection.startShell(startShellOptions);
	} catch (error) {
		const tmuxAttachFailureReason = extractTmuxAttachFailureReason(error);
		traceEvent({
			type:
				tmuxAttachFailureReason !== null
					? 'ssh.shell.tmux-attach-failed'
					: 'ssh.shell.failed',
			source: 'saved-entry',
			connection: connectedIdentity,
			error: serializeConnectionDiagnosticError(error),
			details: { tmuxAttachFailureReason, storedConnectionId },
		});
		await cleanupDiagnosticConnection();
		if (tmuxAttachFailureReason !== null) {
			return {
				status: 'tmux_attach_failed',
				connectionId: sshConnection.connectionId,
				tmuxAttachFailureReason,
				tmuxSessionName: connectionDetails.tmuxSessionName,
				storedConnectionId,
			};
		}
		throw error;
	}

	traceEvent({
		type: 'ssh.shell.connected',
		source: 'saved-entry',
		connection: connectedIdentity,
		details: { channelId: shellHandle.channelId, storedConnectionId },
	});

	await cleanupDiagnosticConnection();

	return {
		status: 'connected',
		sshConnection,
		shellHandle,
		connectionId: sshConnection.connectionId,
		channelId: shellHandle.channelId,
	};
}
```

- [ ] **Step 4: Run diagnostic probe tests**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/diagnostic-shell-probe.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Convert `connect-and-open-shell.ts` to normal-only**

Modify `apps/mobile/src/lib/connect-and-open-shell.ts`:

- Remove `diagnosticMode` from args.
- Remove `connectDiagnosticOnly`.
- Remove `withDiagnosticDisconnectTimeout` and diagnostic disconnect error helpers.
- Always call `connectAndRememberConnection`.
- Always start shell without `registerInStore: false`.
- Always navigate on connected success.
- Always call `navigateWithError` for tmux attach failure when provided.

The resulting argument type should include:

```ts
export async function connectAndOpenShell(args: {
	connectionDetails: InputConnectionDetails;
	connect: typeof RnRussh.connect;
	navigate: (params: { connectionId: string; channelId: number }) => void;
	navigateWithError?: (params: {
		connectionId: string;
		tmuxAttachFailureReason: string | null;
		tmuxSessionName: string;
		storedConnectionId: string;
	}) => void;
	onConnectionProgress?: (progressEvent: SshConnectionProgress) => void;
	abortSignalTimeoutMs?: number;
	resolvedSecurity?: ConnectionDetails['security'];
	saveConnection?: SaveConnection;
	trace?: ConnectTrace;
}): Promise<ConnectAndOpenShellResult> {
	// Keep the current normal saved-entry implementation without diagnostic branches.
}
```

- [ ] **Step 6: Move diagnostic tests out of `connect-and-open-shell-diagnostics.test.ts`**

Modify `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts` so it keeps only normal behavior:

- `connectAndOpenShell records connect and shell success events`
- `connectAndOpenShell records connect failure`
- add normal tmux attach navigation test:

```ts
void test('connectAndOpenShell navigates with tmux attach failure metadata', async () => {
	const navigatedWithError: unknown[] = [];

	const result = await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		connect: async () =>
			({
				connectionId: 'conn-1',
				startShell: async () => {
					throw {
						tag: 'TmuxAttachFailed',
						inner: ['missing session'],
					};
				},
			}) as never,
		saveConnection: async () => {},
		navigate: () => {
			throw new Error('success navigation should not run');
		},
		navigateWithError: (params) => {
			navigatedWithError.push(params);
		},
	});

	assert.equal(result.status, 'tmux_attach_failed');
	assert.deepEqual(navigatedWithError, [
		{
			connectionId: 'conn-1',
			tmuxAttachFailureReason: 'missing session',
			tmuxSessionName: 'main',
			storedConnectionId: 'muly@dev.tailnet.ts.net:22',
		},
	]);
});
```

- [ ] **Step 7: Run shell flow tests and typecheck**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/connect-and-open-shell-diagnostics.test.ts test/integration/diagnostic-shell-probe.test.ts
pnpm --filter @fressh/mobile typecheck
pnpm --filter @fressh/mobile exec eslint --max-warnings 0 --report-unused-disable-directives src/lib/connect-and-open-shell.ts src/lib/diagnostic-shell-probe.ts test/integration/connect-and-open-shell-diagnostics.test.ts test/integration/diagnostic-shell-probe.test.ts
```

Expected: tests, typecheck, and lint pass.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/lib/connect-and-open-shell.ts apps/mobile/src/lib/diagnostic-shell-probe.ts apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts apps/mobile/test/integration/diagnostic-shell-probe.test.ts
git commit -m "Split diagnostic shell probe flow"
```

---

### Task 3: Update Manual Diagnostic Runner To Use Probe Result Type

**Files:**
- Modify: `apps/mobile/src/lib/connection-diagnostic-runner.ts`
- Modify: `apps/mobile/test/integration/connection-diagnostic-runner.test.ts`

- [ ] **Step 1: Update test imports to use diagnostic probe result**

Modify `apps/mobile/test/integration/connection-diagnostic-runner.test.ts`:

```ts
import { type DiagnosticShellProbeResult } from '../../src/lib/diagnostic-shell-probe';
```

Replace all `ConnectAndOpenShellResult` references with `DiagnosticShellProbeResult`.

- [ ] **Step 2: Run runner test to expose stale type import**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/connection-diagnostic-runner.test.ts
```

Expected: FAIL until `connection-diagnostic-runner.ts` imports the new result type.

- [ ] **Step 3: Update runner type boundary**

Modify `apps/mobile/src/lib/connection-diagnostic-runner.ts`:

```ts
import { type DiagnosticShellProbeResult } from './diagnostic-shell-probe';
```

Update `ManualConnectionDiagnosticArgs`:

```ts
connectSavedEntry: (args: {
	connectionDetails: InputConnectionDetails;
	resolvedSecurity: ResolvedKeySecurity;
	trace: ConnectionDiagnosticTraceHandle;
}) => Promise<DiagnosticShellProbeResult>;
```

No runtime behavior should change in this task.

- [ ] **Step 4: Run runner tests**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/connection-diagnostic-runner.test.ts
pnpm --filter @fressh/mobile typecheck
pnpm --filter @fressh/mobile exec eslint --max-warnings 0 --report-unused-disable-directives src/lib/connection-diagnostic-runner.ts test/integration/connection-diagnostic-runner.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/connection-diagnostic-runner.ts apps/mobile/test/integration/connection-diagnostic-runner.test.ts
git commit -m "Point manual diagnostics at probe result"
```

---

### Task 4: Extract The Connection Debug Command From Shell Detail

**Files:**
- Create: `apps/mobile/src/lib/connection-debug-command.ts`
- Create: `apps/mobile/test/integration/connection-debug-command.test.ts`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Modify: `apps/mobile/test/integration/connection-diagnostic-integration.test.ts`

- [ ] **Step 1: Write behavioral command tests**

Create `apps/mobile/test/integration/connection-debug-command.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { runConnectionDebugCommand } from '../../src/lib/connection-debug-command';
import { createConnectionDiagnosticRecorder } from '../../src/lib/connection-diagnostics';
import { type SavedConnectionEntry } from '../../src/lib/connection-utils';

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

const readyRecovery = {
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

void test('debug command closes menu, probes latest saved entry, and pastes prompt', async () => {
	const calls: string[] = [];
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });

	const result = await runConnectionDebugCommand({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
			pathname: '/shell/detail',
			appActive: true,
		},
		closeMenu: () => {
			calls.push('closeMenu');
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolvePrivateKey: async (keyId) => {
			calls.push(`resolve:${keyId}`);
			return 'private-key';
		},
		runProbe: async ({ connectionDetails, resolvedSecurity, trace }) => {
			calls.push(`probe:${connectionDetails.host}`);
			assert.equal(resolvedSecurity.privateKey, 'private-key');
			trace.event({
				type: 'probe.called',
				source: 'manual-diagnostic',
				connection: { host: connectionDetails.host },
			});
			return {
				status: 'connected',
				sshConnection: {} as never,
				shellHandle: {} as never,
				connectionId: 'conn-1',
				channelId: 7,
			};
		},
		recovery: readyRecovery,
		hasShell: true,
		pasteIntoTerminal: (prompt) => {
			calls.push(`paste:${prompt.includes('probe.called')}`);
		},
		copyToClipboard: async () => {
			calls.push('copy');
		},
		showAlert: (title) => {
			calls.push(`alert:${title}`);
		},
		logger: {
			warn: (message) => {
				calls.push(`warn:${message}`);
			},
		},
	});

	assert.equal(result.diagnostic.status, 'connected');
	assert.deepEqual(calls, [
		'closeMenu',
		'resolve:key-1',
		'probe:dev.tailnet.ts.net',
		'paste:true',
	]);
});

void test('debug command reports key resolution failure through prompt delivery', async () => {
	const calls: string[] = [];
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });

	const result = await runConnectionDebugCommand({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
		},
		closeMenu: () => {
			calls.push('closeMenu');
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolvePrivateKey: async () => {
			throw new Error('missing key');
		},
		runProbe: async () => {
			throw new Error('probe should not run');
		},
		recovery: readyRecovery,
		hasShell: false,
		pasteIntoTerminal: () => {
			throw new Error('paste should not run');
		},
		copyToClipboard: async (prompt) => {
			calls.push(`copy:${prompt.includes('manual-diagnostic.key-missing')}`);
		},
		showAlert: (title) => {
			calls.push(`alert:${title}`);
		},
		logger: {
			warn: (message, error) => {
				calls.push(`warn:${message}:${(error as Error).message}`);
			},
		},
	});

	assert.equal(result.diagnostic.status, 'failed');
	assert.deepEqual(calls, [
		'closeMenu',
		'warn:Connection diagnostic key resolution failed:missing key',
		'copy:true',
		'alert:Connection debug prompt copied',
	]);
});
```

- [ ] **Step 2: Run command tests to verify they fail**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/connection-debug-command.test.ts
```

Expected: FAIL with module-not-found for `connection-debug-command`.

- [ ] **Step 3: Implement command module**

Create `apps/mobile/src/lib/connection-debug-command.ts`:

```ts
import {
	runManualConnectionDiagnostic,
	type ManualConnectionDiagnosticResult,
} from './connection-diagnostic-runner';
import { deliverConnectionDiagnosticPrompt } from './connection-diagnostic-delivery';
import {
	type ConnectionDiagnosticAppState,
	type ConnectionDiagnosticRecorder,
	type ConnectionDiagnosticTraceHandle,
} from './connection-diagnostics';
import {
	type SavedConnectionEntry,
} from './connection-utils';
import {
	type DiagnosticShellProbeResult,
} from './diagnostic-shell-probe';
import { type SavedEntryTailscaleRecovery } from './auto-connect-saved-entry';
// eslint-disable-next-line import/consistent-type-specifier-style -- keep secrets-manager type-only so Node tests do not load React Native at runtime
import type { InputConnectionDetails } from './secrets-manager';

type ResolvedKeySecurity = {
	type: 'key';
	privateKey: string;
};

type Logger = {
	warn: (message: string, error: unknown) => void;
};

export async function runConnectionDebugCommand(args: {
	recorder: ConnectionDiagnosticRecorder;
	appState: ConnectionDiagnosticAppState;
	closeMenu: () => void;
	loadLatestSavedConnection: () => Promise<SavedConnectionEntry | null>;
	resolvePrivateKey: (keyId: string) => Promise<string>;
	runProbe: (args: {
		connectionDetails: InputConnectionDetails;
		resolvedSecurity: ResolvedKeySecurity;
		trace: ConnectionDiagnosticTraceHandle;
	}) => Promise<DiagnosticShellProbeResult>;
	recovery: SavedEntryTailscaleRecovery;
	hasShell: boolean;
	pasteIntoTerminal: (value: string) => void;
	copyToClipboard: (value: string) => Promise<void>;
	showAlert: (title: string, message: string) => void;
	logger: Logger;
}): Promise<{
	diagnostic: ManualConnectionDiagnosticResult;
	delivery: Awaited<ReturnType<typeof deliverConnectionDiagnosticPrompt>>;
}> {
	args.closeMenu();
	const diagnostic = await runManualConnectionDiagnostic({
		recorder: args.recorder,
		appState: args.appState,
		loadLatestSavedConnection: args.loadLatestSavedConnection,
		resolveKeySecurity: async (details: SavedConnectionEntry['value']) => {
			try {
				const privateKey = await args.resolvePrivateKey(details.security.keyId);
				return { type: 'key', privateKey };
			} catch (error) {
				args.logger.warn('Connection diagnostic key resolution failed', error);
				return null;
			}
		},
		connectSavedEntry: args.runProbe,
		recovery: args.recovery,
	});
	const delivery = await deliverConnectionDiagnosticPrompt({
		prompt: diagnostic.prompt,
		hasShell: args.hasShell,
		pasteIntoTerminal: args.pasteIntoTerminal,
		copyToClipboard: args.copyToClipboard,
		showAlert: args.showAlert,
	});
	return { diagnostic, delivery };
}
```

- [ ] **Step 4: Wire shell detail to the command module**

Modify `apps/mobile/src/app/shell/detail.tsx`:

- Remove direct imports of `runManualConnectionDiagnostic`, `deliverConnectionDiagnosticPrompt`, and `connectAndOpenShell` if they are only used by debug command.
- Import:

```ts
import { runConnectionDebugCommand } from '@/lib/connection-debug-command';
import { runDiagnosticShellProbe } from '@/lib/diagnostic-shell-probe';
```

Replace the current `handleDebugConnectionInCodex` body with:

```ts
const handleDebugConnectionInCodex = useCallback(async () => {
	const autoState = useAutoConnectStore.getState();
	await runConnectionDebugCommand({
		recorder: connectionDiagnosticRecorder,
		appState: {
			platformOS: Platform.OS,
			isAutoConnecting: autoState.isAutoConnecting,
			isReconnecting: autoState.isReconnecting,
			pathname: '/shell/detail',
			appActive: isAppActiveRef.current,
		},
		closeMenu: () => {
			commandMenuModal.onClose();
		},
		loadLatestSavedConnection: loadLatestSavedConnectionForDiagnostic,
		resolvePrivateKey: async (keyId) => {
			const keyEntry = await secretsManager.keys.utils.getPrivateKey(keyId);
			return keyEntry.value;
		},
		runProbe: ({ connectionDetails, resolvedSecurity, trace }) =>
			runDiagnosticShellProbe({
				connectionDetails,
				resolvedSecurity,
				trace,
				connect: RnRussh.connect,
			}),
		recovery: tailscaleRecovery,
		hasShell: Boolean(shell),
		pasteIntoTerminal: sendTextRaw,
		copyToClipboard: async (value) => {
			await Clipboard.setStringAsync(value);
		},
		showAlert: (title, message) => {
			Alert.alert(title, message);
		},
		logger,
	});
}, [
	commandMenuModal,
	loadLatestSavedConnectionForDiagnostic,
	sendTextRaw,
	shell,
]);
```

- [ ] **Step 5: Delete source-grep tests**

Remove `apps/mobile/test/integration/connection-diagnostic-integration.test.ts`. Its coverage is replaced by `connection-debug-command.test.ts`, existing command-menu tests, runner tests, and auto-connect/reconnect tests.

- [ ] **Step 6: Run command and shell-related tests**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/connection-debug-command.test.ts test/integration/connection-diagnostic-runner.test.ts test/integration/connection-diagnostic-delivery.test.ts test/integration/diagnostic-shell-probe.test.ts test/integration/keyboard-actions.test.ts test/integration/command-menu.test.ts
pnpm --filter @fressh/mobile typecheck
pnpm --filter @fressh/mobile exec eslint --max-warnings 0 --report-unused-disable-directives src/lib/connection-debug-command.ts src/lib/connection-diagnostic-runner.ts src/lib/connection-diagnostic-delivery.ts src/lib/diagnostic-shell-probe.ts src/app/shell/detail.tsx test/integration/connection-debug-command.test.ts test/integration/connection-diagnostic-runner.test.ts test/integration/connection-diagnostic-delivery.test.ts test/integration/diagnostic-shell-probe.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/connection-debug-command.ts apps/mobile/src/app/shell/detail.tsx apps/mobile/test/integration/connection-debug-command.test.ts apps/mobile/test/integration/connection-diagnostic-integration.test.ts
git commit -m "Extract connection debug command"
```

---

### Task 5: Reduce Passive Trace Noise In Auto-Connect Helpers

**Files:**
- Modify: `apps/mobile/src/lib/auto-connect-attempt.ts`
- Modify: `apps/mobile/src/lib/auto-connect-saved-entry.ts`
- Modify: `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`
- Test: `apps/mobile/test/integration/auto-connect-attempt.test.ts`
- Test: `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`
- Test: `apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`

- [ ] **Step 1: Add helper-level assertions before refactor**

In `apps/mobile/test/integration/auto-connect-attempt.test.ts`, add this focused event-order test:

```ts
void test('records saved-entry selection through trace sink', async () => {
	const events: unknown[] = [];
	const { logger } = createLogger();

	await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/(tabs)',
		latestShell: null,
		connections: {},
		openSavedEntryShell: async () => ({
			status: 'connected',
			sshConnection: {} as never,
			shellHandle: {} as never,
			connectionId: 'conn-2',
			channelId: 3,
		}),
		loadLatestSavedConnection: async () => createSavedEntry(),
		resolveKeySecurity: async () => ({
			type: 'key',
			privateKey: 'private-key',
		}),
		navigateToShell: () => {},
		recovery: readyRecovery,
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logger,
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		[
			'auto-connect.source.missing-latest-shell',
			'auto-connect.source.missing-active-connection',
			'auto-connect.saved-entry.selected',
			'auto-connect.saved-entry.key-resolved',
			'tailscale.ensure-ready.result',
			'auto-connect.saved-entry.connect.started',
			'auto-connect.saved-entry.connect.connected',
		],
	);
});
```

- [ ] **Step 2: Run auto-connect tests before refactor**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-attempt.test.ts test/integration/auto-connect-saved-entry.test.ts test/integration/auto-connect-reconnect-controller.test.ts
```

Expected: PASS with the event order shown in Step 1.

- [ ] **Step 3: Extract local event helpers in `auto-connect-attempt.ts`**

Add helper functions near `getSavedEntryConnectionIdentity`:

```ts
function emitTrace(
	trace: AutoConnectTrace | undefined,
	logger: Logger,
	event: ConnectionDiagnosticEventInput,
) {
	try {
		trace?.event(event);
	} catch (error) {
		logger.warn('Auto-connect trace event failed', error);
	}
}

function traceLatestShell(
	trace: AutoConnectTrace | undefined,
	logger: Logger,
	latestShell: LatestShellSnapshot,
	pathname: string,
) {
	emitTrace(trace, logger, {
		type: 'auto-connect.source.latest-shell',
		source: 'latest-shell',
		connection: { connectionId: latestShell.connectionId },
		details: { channelId: latestShell.channelId, pathname },
	});
}

function traceSavedEntry(
	trace: AutoConnectTrace | undefined,
	logger: Logger,
	type: string,
	entry: SavedConnectionEntry,
	details?: Record<string, unknown>,
) {
	emitTrace(trace, logger, {
		type,
		source: 'saved-entry',
		connection: getSavedEntryConnectionIdentity(entry.id, entry.value),
		details,
	});
}
```

Then replace repeated inline `traceEvent({ ... })` blocks with these helpers where they directly match. Keep domain branching unchanged.

- [ ] **Step 4: Extract local event helpers in saved-entry recovery**

In `apps/mobile/src/lib/auto-connect-saved-entry.ts`, add:

```ts
function emitTrace(
	trace: SavedEntryTrace | undefined,
	logWarning: (message: string, error: unknown) => void,
	event: ConnectionDiagnosticEventInput,
) {
	try {
		trace?.event(event);
	} catch (error) {
		logWarning('Saved-entry trace event failed', error);
	}
}

function traceRecoveryResult(
	trace: SavedEntryTrace | undefined,
	logWarning: (message: string, error: unknown) => void,
	recoveryResult: TailscaleRecoverAfterFailureResult,
) {
	emitTrace(trace, logWarning, {
		type: 'tailscale.recovery.result',
		source: 'tailscale-recovery',
		details: {
			recoveryResult: snapshotTailscaleRecoverAfterFailureResult(recoveryResult),
		},
	});
}
```

Use helpers to reduce repeated inline event object construction without changing event names.

- [ ] **Step 5: Extract local event helper in reconnect controller**

In `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`, keep `traceEvent` but add small named helpers for stop, blocked start, scheduled retry, attempt result:

```ts
const traceStop = (reason: string) =>
	traceEvent({
		type: 'reconnect.stopped',
		source: 'reconnect-controller',
		message: reason,
		details: { reason },
	});

const traceAttemptResult = (success: boolean, elapsedMs: number) =>
	traceEvent({
		type: success
			? 'reconnect.attempt.connected'
			: 'reconnect.attempt.failed',
		source: 'reconnect-controller',
		details: { elapsedMs },
	});
```

Replace only the matching inline blocks. Do not alter timer, generation, snapshot, or retry logic.

- [ ] **Step 6: Run auto-connect tests and lint**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-attempt.test.ts test/integration/auto-connect-saved-entry.test.ts test/integration/auto-connect-reconnect-controller.test.ts
pnpm --filter @fressh/mobile typecheck
pnpm --filter @fressh/mobile exec eslint --max-warnings 0 --report-unused-disable-directives src/lib/auto-connect-attempt.ts src/lib/auto-connect-saved-entry.ts src/lib/auto-connect-reconnect-controller.ts test/integration/auto-connect-attempt.test.ts test/integration/auto-connect-saved-entry.test.ts test/integration/auto-connect-reconnect-controller.test.ts
```

Expected: all pass and event names remain unchanged.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/auto-connect-attempt.ts apps/mobile/src/lib/auto-connect-saved-entry.ts apps/mobile/src/lib/auto-connect-reconnect-controller.ts apps/mobile/test/integration/auto-connect-attempt.test.ts apps/mobile/test/integration/auto-connect-saved-entry.test.ts apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts
git commit -m "Clarify passive connection trace events"
```

---

### Task 6: Remove Diagnostic Mode From All Production Paths

**Files:**
- Search/modify: `apps/mobile/src/**/*.ts`, `apps/mobile/src/**/*.tsx`
- Search/modify: `apps/mobile/test/integration/**/*.test.ts`

- [ ] **Step 1: Search for `diagnosticMode`**

Run:

```bash
rg "diagnosticMode" apps/mobile/src apps/mobile/test/integration
```

Expected before cleanup: no production hits after Tasks 2-4. Test hits should also be gone except this plan is not under `apps/mobile`.

- [ ] **Step 2: If any production hit remains, remove it**

If `rg` reports a production usage such as:

```ts
diagnosticMode: true
```

replace the call with `runDiagnosticShellProbe(...)` and remove the flag from the normal flow. There must be no fallback branch like:

```ts
if (args.diagnosticMode) {
	// diagnostic behavior
}
```

- [ ] **Step 3: Search for source-grep wiring tests**

Run:

```bash
rg "readFileSync|assert\\.match\\(source|sourcePath|diagnosticMode" apps/mobile/test/integration
```

Expected: no `connection-diagnostic-integration.test.ts` source-grep coverage. Other tests may use `assert.match` against prompt strings; those are acceptable because they are behavioral output assertions, not source text assertions.

- [ ] **Step 4: Run changed diagnostic suite**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test \
 test/integration/connection-diagnostics.test.ts \
 test/integration/connection-diagnostic-runner.test.ts \
 test/integration/connection-debug-command.test.ts \
 test/integration/connection-diagnostic-delivery.test.ts \
 test/integration/connect-and-open-shell-diagnostics.test.ts \
 test/integration/diagnostic-shell-probe.test.ts \
 test/integration/auto-connect-attempt.test.ts \
 test/integration/auto-connect-saved-entry.test.ts \
 test/integration/auto-connect-reconnect-controller.test.ts \
 test/integration/keyboard-actions.test.ts \
 test/integration/command-menu.test.ts \
 test/integration/shell-config-schema.test.ts \
 test/integration/keyboard-config.test.ts \
 test/integration/tailscale-recovery-actions.test.ts
```

Expected: all tests pass. The exact count will reflect the deleted source-grep test file and the added behavioral test files.

- [ ] **Step 5: Commit any residual cleanup**

If Step 1 or Step 3 required edits:

```bash
git add apps/mobile/src apps/mobile/test/integration
git commit -m "Remove diagnostic mode wiring residue"
```

If no edits were required, do not create an empty commit.

---

### Task 7: Final Verification And Branch Quality Gate

**Files:**
- Verify all changed files.
- No code changes expected unless verification exposes a concrete issue.

- [ ] **Step 1: Check worktree status**

Run:

```bash
git status --short
```

Expected: clean or only intentional uncommitted fixes from Task 6. Commit intentional fixes before continuing.

- [ ] **Step 2: Run final typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: exit 0.

- [ ] **Step 3: Run focused ESLint on changed source and test files**

Run:

```bash
pnpm --filter @fressh/mobile exec eslint --max-warnings 0 --report-unused-disable-directives \
 src/lib/connection-diagnostics.ts \
 src/lib/connection-diagnostic-types.ts \
 src/lib/connection-diagnostic-redaction.ts \
 src/lib/connection-diagnostic-recorder.ts \
 src/lib/connection-diagnostic-prompt.ts \
 src/lib/connect-and-open-shell.ts \
 src/lib/diagnostic-shell-probe.ts \
 src/lib/connection-diagnostic-runner.ts \
 src/lib/connection-debug-command.ts \
 src/lib/connection-diagnostic-delivery.ts \
 src/lib/auto-connect-attempt.ts \
 src/lib/auto-connect-saved-entry.ts \
 src/lib/auto-connect-reconnect-controller.ts \
 src/lib/auto-connect.tsx \
 src/app/shell/detail.tsx \
 test/integration/connection-diagnostics.test.ts \
 test/integration/connect-and-open-shell-diagnostics.test.ts \
 test/integration/diagnostic-shell-probe.test.ts \
 test/integration/connection-diagnostic-runner.test.ts \
 test/integration/connection-debug-command.test.ts \
 test/integration/connection-diagnostic-delivery.test.ts \
 test/integration/auto-connect-attempt.test.ts \
 test/integration/auto-connect-saved-entry.test.ts \
 test/integration/auto-connect-reconnect-controller.test.ts \
 test/integration/keyboard-actions.test.ts \
 test/integration/command-menu.test.ts \
 test/integration/shell-config-schema.test.ts \
 test/integration/keyboard-config.test.ts \
 test/integration/tailscale-recovery-actions.test.ts
```

Expected: exit 0 with no warnings.

- [ ] **Step 4: Run final targeted integration tests**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test \
 test/integration/connection-diagnostics.test.ts \
 test/integration/connect-and-open-shell-diagnostics.test.ts \
 test/integration/diagnostic-shell-probe.test.ts \
 test/integration/connection-diagnostic-runner.test.ts \
 test/integration/connection-debug-command.test.ts \
 test/integration/connection-diagnostic-delivery.test.ts \
 test/integration/auto-connect-attempt.test.ts \
 test/integration/auto-connect-saved-entry.test.ts \
 test/integration/auto-connect-reconnect-controller.test.ts \
 test/integration/keyboard-actions.test.ts \
 test/integration/command-menu.test.ts \
 test/integration/shell-config-schema.test.ts \
 test/integration/keyboard-config.test.ts \
 test/integration/tailscale-recovery-actions.test.ts
```

Expected: exit 0 with no failures.

- [ ] **Step 5: Re-run structural searches**

Run:

```bash
rg "diagnosticMode" apps/mobile/src apps/mobile/test/integration
rg "readFileSync|assert\\.match\\(source|sourcePath" apps/mobile/test/integration
wc -l apps/mobile/src/lib/connection-diagnostics.ts apps/mobile/src/lib/connection-diagnostic-*.ts apps/mobile/src/lib/diagnostic-shell-probe.ts apps/mobile/src/lib/connection-debug-command.ts
```

Expected:

- no `diagnosticMode` hits in `apps/mobile/src` or `apps/mobile/test/integration`;
- no source-grep diagnostic integration test remains;
- `connection-diagnostics.ts` is a small barrel;
- no new diagnostic implementation file is near 1k lines.

- [ ] **Step 6: Commit final verification fixes if any**

If verification required edits:

```bash
git add apps/mobile/src apps/mobile/test/integration
git commit -m "Polish connection diagnostic cleanup"
```

If no edits were required, do not create an empty commit.

- [ ] **Step 7: Record final status**

Run:

```bash
git status --short
git log --oneline --decorate -8
```

Expected: clean worktree and recent commits for each completed task.
