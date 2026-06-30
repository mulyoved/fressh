# Connection Diagnostics Quality Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure connection diagnostics around typed events, smaller safety
helpers, cleaner retry boundaries, an isolated manual diagnostic runner, and a
ShellDetail hook without changing the user-visible command behavior.

**Architecture:** Introduce a canonical typed diagnostic event API, then migrate
recorder, prompt formatting, SSH lifecycle tracing, auto-connect/manual
diagnostics, and command wiring to it. Split retry policy from side effects so
auto-connect and manual diagnostics map outcomes independently. Keep the
existing `Debug connection in Codex` command behavior while removing generic
event blobs, broad redaction, module-global runner state, and inline ShellDetail
orchestration.

**Tech Stack:** TypeScript, React Native/Expo, Node `tsx --test`, pnpm,
Prettier, ESLint, existing mobile integration test harness.

---

## File Structure

- Create `apps/mobile/src/lib/connection-diagnostic-events.ts`: canonical typed
  event union and event constructors.
- Create `apps/mobile/test/integration/connection-diagnostic-events.test.ts`:
  typed event contract tests.
- Modify `apps/mobile/src/lib/connection-diagnostic-types.ts`: remove generic
  `ConnectionDiagnosticEventInput`; keep trace/app/recorder types pointing at
  typed events.
- Modify `apps/mobile/src/lib/connection-diagnostic-recorder.ts`: record typed
  events, add timing, keep small clone safety.
- Modify `apps/mobile/test/integration/connection-diagnostic-recorder.test.ts`:
  focused recorder tests split out of `connection-diagnostics.test.ts`.
- Modify `apps/mobile/src/lib/connection-diagnostic-redaction.ts`: shrink to
  personal-use safety helpers.
- Modify `apps/mobile/src/lib/connection-diagnostic-prompt.ts`: render typed
  events directly.
- Modify `apps/mobile/test/integration/connection-diagnostic-prompt.test.ts`:
  focused prompt tests split out of `connection-diagnostics.test.ts`.
- Modify `apps/mobile/src/lib/ssh-shell-lifecycle.ts`: emit typed lifecycle
  observer events.
- Modify `apps/mobile/src/lib/connect-and-open-shell.ts`: adapt trace handling
  to typed events.
- Modify `apps/mobile/src/lib/diagnostic-shell-probe.ts`: adapt diagnostic
  cleanup events to typed events.
- Modify
  `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts` and
  `apps/mobile/test/integration/diagnostic-shell-probe.test.ts`: assert typed
  event kinds.
- Modify `apps/mobile/src/lib/auto-connect-saved-entry.ts`: split pure retry
  policy and side-effect mapping.
- Modify `apps/mobile/src/lib/auto-connect-attempt.ts`: map retry outcomes to
  UI/log/trace behavior.
- Modify `apps/mobile/test/integration/auto-connect-saved-entry.test.ts` and
  `apps/mobile/test/integration/auto-connect-attempt.test.ts`: cover pure retry
  outcomes and caller mapping.
- Modify `apps/mobile/src/lib/connection-diagnostic-runner.ts`: export
  `createManualConnectionDiagnosticRunner` and singleton runner.
- Modify `apps/mobile/src/lib/connection-debug-command.ts`: use the singleton
  runner by default and allow runner injection in tests.
- Modify `apps/mobile/test/integration/connection-diagnostic-runner.test.ts` and
  `apps/mobile/test/integration/connection-debug-command.test.ts`: isolated
  runner tests.
- Create `apps/mobile/src/lib/use-connection-debug-command.ts`: hook that owns
  debug command orchestration.
- Modify `apps/mobile/src/app/shell/detail.tsx`: call the hook and remove inline
  orchestration.
- Modify
  `apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts`:
  assert ShellDetail delegates debug command wiring to the hook.
- Delete or shrink `apps/mobile/test/integration/connection-diagnostics.test.ts`
  after focused tests cover recorder, prompt, redaction, and event contracts.
- Modify `apps/mobile/src/lib/connection-diagnostics.ts`: export the new typed
  events and compatibility surface.

## Task 1: Typed Diagnostic Event Contract

**Files:**

- Create: `apps/mobile/src/lib/connection-diagnostic-events.ts`
- Create: `apps/mobile/test/integration/connection-diagnostic-events.test.ts`
- Modify: `apps/mobile/src/lib/connection-diagnostic-types.ts`
- Modify: `apps/mobile/src/lib/connection-diagnostics.ts`

- [ ] **Step 1: Write the typed event contract test**

Create `apps/mobile/test/integration/connection-diagnostic-events.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	diagnosticEvents,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostic-events';

void test('diagnostic event constructors return typed event shapes', () => {
	const selected = diagnosticEvents.savedEntrySelected({
		source: 'manual-diagnostic',
		connection: {
			savedConnectionId: 'saved-1',
			username: 'muly',
			host: 'dev.tailnet.ts.net',
			port: 22,
			keyId: 'key-1',
			useTmux: true,
			tmuxSessionName: 'main',
		},
	});
	const started = diagnosticEvents.sshConnectStarted({
		source: 'saved-entry',
		connection: selected.connection,
	});
	const timeout = diagnosticEvents.manualDiagnosticTimeout({
		timeoutMs: 60_000,
		message: 'Connection diagnostic timed out after 60000ms',
	});

	assert.equal(selected.kind, 'saved-entry.selected');
	assert.equal(started.kind, 'ssh.connect.started');
	assert.equal(timeout.kind, 'manual-diagnostic.timeout');
	assert.equal(timeout.timeoutMs, 60_000);

	const events: ConnectionDiagnosticEvent[] = [selected, started, timeout];
	assert.deepEqual(
		events.map((event) => event.kind),
		[
			'saved-entry.selected',
			'ssh.connect.started',
			'manual-diagnostic.timeout',
		],
	);
});

void test('normal diagnostic events do not expose generic details payloads', () => {
	const event = diagnosticEvents.keyResolved({
		source: 'manual-diagnostic',
		connection: {
			savedConnectionId: 'saved-1',
			host: 'dev.tailnet.ts.net',
		},
	});

	assert.equal('details' in event, false);
	assert.equal('type' in event, false);
});
```

- [ ] **Step 2: Run the event test to verify it fails**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test test/integration/connection-diagnostic-events.test.ts
```

Expected: FAIL because `../../src/lib/connection-diagnostic-events` does not
exist.

- [ ] **Step 3: Create the typed event module**

Create `apps/mobile/src/lib/connection-diagnostic-events.ts`:

```ts
import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticError,
	type ConnectionDiagnosticSource,
} from './connection-diagnostic-types';
import {
	type TailscaleReadyResult,
	type TailscaleRecoverAfterFailureResult,
} from './tailscale-recovery-core';

export type ConnectionDiagnosticEventBase = {
	source: ConnectionDiagnosticSource;
	message?: string;
	connection?: ConnectionDiagnosticConnectionIdentity;
	error?: ConnectionDiagnosticError;
};

export type SavedEntrySelectedEvent = ConnectionDiagnosticEventBase & {
	kind: 'saved-entry.selected';
	connection: ConnectionDiagnosticConnectionIdentity;
};

export type SavedEntryMissingEvent = ConnectionDiagnosticEventBase & {
	kind: 'saved-entry.missing';
};

export type SavedEntryInvalidTmuxSettingsEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'saved-entry.invalid-tmux-settings';
		connection: ConnectionDiagnosticConnectionIdentity;
		useTmuxType: string;
		tmuxSessionNameType: string;
	};

export type KeyResolvedEvent = ConnectionDiagnosticEventBase & {
	kind: 'key.resolved';
	connection: ConnectionDiagnosticConnectionIdentity;
};

export type KeyMissingEvent = ConnectionDiagnosticEventBase & {
	kind: 'key.missing';
	connection: ConnectionDiagnosticConnectionIdentity;
};

export type SshConnectStartedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.connect.started';
	connection: ConnectionDiagnosticConnectionIdentity;
};

export type SshConnectProgressEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.connect.progress';
	connection: ConnectionDiagnosticConnectionIdentity;
	phase?: string;
};

export type SshConnectConnectedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.connect.connected';
	connection: ConnectionDiagnosticConnectionIdentity;
	storedConnectionId: string;
};

export type SshConnectFailedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.connect.failed';
	connection: ConnectionDiagnosticConnectionIdentity;
	error: ConnectionDiagnosticError;
};

export type SshShellStartedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.shell.started';
	connection: ConnectionDiagnosticConnectionIdentity;
};

export type SshShellConnectedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.shell.connected';
	connection: ConnectionDiagnosticConnectionIdentity;
	channelId: number;
	storedConnectionId: string;
};

export type SshShellFailedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.shell.failed';
	connection: ConnectionDiagnosticConnectionIdentity;
	error: ConnectionDiagnosticError;
	storedConnectionId: string;
};

export type SshShellTmuxAttachFailedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.shell.tmux-attach-failed';
	connection: ConnectionDiagnosticConnectionIdentity;
	error: ConnectionDiagnosticError;
	tmuxAttachFailureReason: string | null;
	storedConnectionId: string;
};

export type DiagnosticDisconnectedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.diagnostic.disconnected';
	connection: ConnectionDiagnosticConnectionIdentity;
};

export type DiagnosticDisconnectFailedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.diagnostic.disconnect-failed';
	connection: ConnectionDiagnosticConnectionIdentity;
	error: ConnectionDiagnosticError;
};

export type TailscaleEnsureReadyEvent = ConnectionDiagnosticEventBase & {
	kind: 'tailscale.ensure-ready.result';
	platformOS: string;
	readiness: TailscaleReadyResult;
};

export type TailscaleRecoveryResultEvent = ConnectionDiagnosticEventBase & {
	kind: 'tailscale.recovery.result';
	recoveryResult: TailscaleRecoverAfterFailureResult;
};

export type ReconnectEvent = ConnectionDiagnosticEventBase & {
	kind:
		| 'reconnect.started'
		| 'reconnect.stopped'
		| 'reconnect.start.blocked'
		| 'reconnect.retry.scheduled'
		| 'reconnect.attempt.started'
		| 'reconnect.attempt.connected'
		| 'reconnect.attempt.failed'
		| 'reconnect.timeout';
	reason?: string;
	elapsedMs?: number;
	delayMs?: number;
	attemptIndex?: number;
	windowMs?: number;
	isAutoConnecting?: boolean;
	isReconnecting?: boolean;
	resetInFlight?: boolean;
};

export type ManualDiagnosticEvent = ConnectionDiagnosticEventBase & {
	kind:
		| 'manual-diagnostic.saved-entry.missing'
		| 'manual-diagnostic.tailscale.attention'
		| 'manual-diagnostic.tailscale.attention-cleared'
		| 'manual-diagnostic.tmux-attach-failed'
		| 'manual-diagnostic.warning'
		| 'manual-diagnostic.timeout'
		| 'manual-diagnostic.failed';
	timeoutMs?: number;
	tmuxAttachFailureReason?: string | null;
};

export type ActiveConnectionEvent = ConnectionDiagnosticEventBase & {
	kind:
		| 'auto-connect.latest-shell.selected'
		| 'auto-connect.latest-shell.missing'
		| 'auto-connect.active-connection.selected'
		| 'auto-connect.active-connection.missing'
		| 'auto-connect.active-connection.shell-started'
		| 'auto-connect.active-connection.shell-connected'
		| 'auto-connect.active-connection.shell-failed'
		| 'auto-connect.active-connection.tmux-attach-failed';
	channelId?: number;
	pathname?: string;
	tmuxAttachFailureReason?: string | null;
	tmuxSessionName?: string;
};

export type SavedEntryConnectEvent = ConnectionDiagnosticEventBase & {
	kind:
		| 'auto-connect.saved-entry.connect.started'
		| 'auto-connect.saved-entry.connect.connected'
		| 'auto-connect.saved-entry.connect.failed'
		| 'auto-connect.saved-entry.connect.threw'
		| 'auto-connect.saved-entry.connect.tmux-attach-failed'
		| 'auto-connect.saved-entry.retry.started'
		| 'auto-connect.saved-entry.retry.threw';
	connectionId?: string;
	channelId?: number;
	tmuxAttachFailureReason?: string | null;
	tmuxSessionName?: string;
	storedConnectionId?: string;
};

export type ConnectionDiagnosticEvent =
	| SavedEntrySelectedEvent
	| SavedEntryMissingEvent
	| SavedEntryInvalidTmuxSettingsEvent
	| KeyResolvedEvent
	| KeyMissingEvent
	| SshConnectStartedEvent
	| SshConnectProgressEvent
	| SshConnectConnectedEvent
	| SshConnectFailedEvent
	| SshShellStartedEvent
	| SshShellConnectedEvent
	| SshShellFailedEvent
	| SshShellTmuxAttachFailedEvent
	| DiagnosticDisconnectedEvent
	| DiagnosticDisconnectFailedEvent
	| TailscaleEnsureReadyEvent
	| TailscaleRecoveryResultEvent
	| ReconnectEvent
	| ManualDiagnosticEvent
	| ActiveConnectionEvent
	| SavedEntryConnectEvent;

const withSource = <T extends ConnectionDiagnosticEvent>(event: T): T => event;

export const diagnosticEvents = {
	savedEntrySelected: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
	}): SavedEntrySelectedEvent =>
		withSource({ kind: 'saved-entry.selected', ...input }),
	savedEntryMissing: (input: {
		source: ConnectionDiagnosticSource;
		message?: string;
	}): SavedEntryMissingEvent =>
		withSource({ kind: 'saved-entry.missing', ...input }),
	savedEntryInvalidTmuxSettings: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		useTmuxType: string;
		tmuxSessionNameType: string;
	}): SavedEntryInvalidTmuxSettingsEvent =>
		withSource({ kind: 'saved-entry.invalid-tmux-settings', ...input }),
	keyResolved: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
	}): KeyResolvedEvent => withSource({ kind: 'key.resolved', ...input }),
	keyMissing: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
	}): KeyMissingEvent => withSource({ kind: 'key.missing', ...input }),
	sshConnectStarted: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
	}): SshConnectStartedEvent =>
		withSource({ kind: 'ssh.connect.started', ...input }),
	sshConnectProgress: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		phase?: string;
	}): SshConnectProgressEvent =>
		withSource({ kind: 'ssh.connect.progress', ...input }),
	sshConnectConnected: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		storedConnectionId: string;
	}): SshConnectConnectedEvent =>
		withSource({ kind: 'ssh.connect.connected', ...input }),
	sshConnectFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		error: ConnectionDiagnosticError;
	}): SshConnectFailedEvent =>
		withSource({ kind: 'ssh.connect.failed', ...input }),
	sshShellStarted: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
	}): SshShellStartedEvent =>
		withSource({ kind: 'ssh.shell.started', ...input }),
	sshShellConnected: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		channelId: number;
		storedConnectionId: string;
	}): SshShellConnectedEvent =>
		withSource({ kind: 'ssh.shell.connected', ...input }),
	sshShellFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		error: ConnectionDiagnosticError;
		storedConnectionId: string;
	}): SshShellFailedEvent => withSource({ kind: 'ssh.shell.failed', ...input }),
	sshShellTmuxAttachFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		error: ConnectionDiagnosticError;
		tmuxAttachFailureReason: string | null;
		storedConnectionId: string;
	}): SshShellTmuxAttachFailedEvent =>
		withSource({ kind: 'ssh.shell.tmux-attach-failed', ...input }),
	manualDiagnosticTimeout: (input: {
		timeoutMs: number;
		message: string;
	}): ManualDiagnosticEvent =>
		withSource({
			kind: 'manual-diagnostic.timeout',
			source: 'manual-diagnostic',
			...input,
		}),
};
```

- [ ] **Step 4: Update trace types to use typed events**

In `apps/mobile/src/lib/connection-diagnostic-types.ts`, replace the old
`ConnectionDiagnosticEventInput` and `ConnectionDiagnosticEvent` definitions
with imports and timing metadata:

```ts
import { type ConnectionDiagnosticEvent as TypedConnectionDiagnosticEvent } from './connection-diagnostic-events';

export type ConnectionDiagnosticTimedEvent = TypedConnectionDiagnosticEvent & {
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
	events: ConnectionDiagnosticTimedEvent[];
};

export type ConnectionDiagnosticTraceHandle = {
	readonly trace: ConnectionDiagnosticTrace;
	event: (
		input: TypedConnectionDiagnosticEvent,
	) => ConnectionDiagnosticTimedEvent;
	finish: (status: Exclude<ConnectionDiagnosticStatus, 'running'>) => void;
};

export type ConnectionDiagnosticEvent = TypedConnectionDiagnosticEvent;
```

Keep the existing `ConnectionDiagnosticTrigger`, `ConnectionDiagnosticStatus`,
`ConnectionDiagnosticSource`, `ConnectionDiagnosticConnectionIdentity`,
`ConnectionDiagnosticError`, `ConnectionDiagnosticAppState`, and recorder option
types in the same file.

- [ ] **Step 5: Export the typed event API**

Update `apps/mobile/src/lib/connection-diagnostics.ts`:

```ts
export * from './connection-diagnostic-types';
export * from './connection-diagnostic-events';
export {
	createConnectionDiagnosticRecorder,
	connectionDiagnosticRecorder,
} from './connection-diagnostic-recorder';
export { formatConnectionDiagnosticPrompt } from './connection-diagnostic-prompt';
```

- [ ] **Step 6: Run the event test to verify it passes**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test test/integration/connection-diagnostic-events.test.ts
```

Expected: PASS for both event contract tests.

- [ ] **Step 7: Run typecheck to expose callers still using old event input**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile typecheck
```

Expected: FAIL with imports or annotations referring to
`ConnectionDiagnosticEventInput`. Leave the failures for later migration tasks.

- [ ] **Step 8: Commit typed event skeleton**

```bash
git add apps/mobile/src/lib/connection-diagnostic-events.ts \
	apps/mobile/src/lib/connection-diagnostic-types.ts \
	apps/mobile/src/lib/connection-diagnostics.ts \
	apps/mobile/test/integration/connection-diagnostic-events.test.ts
git commit -m "Add typed connection diagnostic events"
```

## Task 2: Recorder And Personal-Use Safety Layer

**Files:**

- Modify: `apps/mobile/src/lib/connection-diagnostic-recorder.ts`
- Modify: `apps/mobile/src/lib/connection-diagnostic-redaction.ts`
- Modify: `apps/mobile/src/lib/connection-diagnostic-normalization.ts`
- Create: `apps/mobile/test/integration/connection-diagnostic-recorder.test.ts`
- Modify: `apps/mobile/test/integration/connection-diagnostics.test.ts`

- [ ] **Step 1: Write focused recorder tests**

Create `apps/mobile/test/integration/connection-diagnostic-recorder.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createConnectionDiagnosticRecorder,
	diagnosticEvents,
} from '../../src/lib/connection-diagnostics';

void test('recorder timestamps typed events and keeps bounded history', () => {
	let now = 100;
	const recorder = createConnectionDiagnosticRecorder({
		now: () => now,
		maxHistory: 1,
	});

	const first = recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'first run',
	});
	now = 125;
	first.event(
		diagnosticEvents.savedEntryMissing({
			source: 'manual-diagnostic',
			message: 'No saved entry',
		}),
	);
	now = 150;
	first.finish('skipped');

	const second = recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'second run',
	});
	now = 175;
	second.event(
		diagnosticEvents.savedEntrySelected({
			source: 'manual-diagnostic',
			connection: { savedConnectionId: 'saved-2' },
		}),
	);
	now = 200;
	second.finish('connected');

	assert.equal(first.trace.events[0]?.elapsedMs, 25);
	assert.equal(recorder.getHistory().length, 1);
	assert.equal(recorder.getHistory()[0]?.id, second.trace.id);
	assert.equal(recorder.getLatestTrace()?.status, 'connected');
});

void test('recorder snapshots typed events without broad secret redaction', () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	const trace = recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'token appears in personal-use reason',
	});

	const event = trace.event(
		diagnosticEvents.sshConnectFailed({
			source: 'saved-entry',
			connection: { host: 'dev.tailnet.ts.net' },
			error: {
				name: 'Error',
				message: 'token=abc is preserved for personal diagnostics',
			},
		}),
	);

	assert.equal(
		event.error.message,
		'token=abc is preserved for personal diagnostics',
	);
	trace.finish('failed');
	assert.equal(
		recorder.getLatestTrace()?.events[0]?.error?.message,
		'token=abc is preserved for personal diagnostics',
	);
});
```

- [ ] **Step 2: Run recorder tests to verify they fail**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test test/integration/connection-diagnostic-recorder.test.ts
```

Expected: FAIL because the recorder still expects old generic events or imports
the old normalizer.

- [ ] **Step 3: Replace redaction with minimal safety helpers**

Replace `apps/mobile/src/lib/connection-diagnostic-redaction.ts` with:

```ts
import { type ConnectionDiagnosticError } from './connection-diagnostic-types';

export const UNREADABLE_ERROR_MESSAGE = '[Unserializable error]';
const CIRCULAR_PLACEHOLDER = '[Circular]';
const PRIVATE_KEY_BLOCK_PATTERN =
	/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gu;

export function omitPrivateKeyMaterial(value: string): string {
	return value.replace(PRIVATE_KEY_BLOCK_PATTERN, '[PRIVATE KEY OMITTED]');
}

export function safeDiagnosticString(value: unknown): string {
	try {
		return omitPrivateKeyMaterial(String(value));
	} catch {
		return UNREADABLE_ERROR_MESSAGE;
	}
}

export function cloneDiagnosticValue<T>(value: T): T {
	return cloneJsonLikeValue(value) as T;
}

function cloneJsonLikeValue(
	value: unknown,
	seen = new WeakMap<object, unknown>(),
): unknown {
	if (
		value === null ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	) {
		return value;
	}
	if (typeof value === 'string') return omitPrivateKeyMaterial(value);
	if (typeof value === 'undefined') return undefined;
	if (typeof value === 'bigint') return `${value}n`;
	if (typeof value === 'function') {
		return value.name ? `[Function ${value.name}]` : '[Function anonymous]';
	}
	if (typeof value === 'symbol') return `[Symbol ${value.description ?? ''}]`;
	if (typeof value !== 'object') return safeDiagnosticString(value);
	if (seen.has(value)) return CIRCULAR_PLACEHOLDER;
	if (Array.isArray(value)) {
		const snapshot: unknown[] = [];
		seen.set(value, snapshot);
		for (const entry of value) snapshot.push(cloneJsonLikeValue(entry, seen));
		return snapshot;
	}
	if (Object.getPrototypeOf(value) === Object.prototype) {
		const snapshot: Record<string, unknown> = {};
		seen.set(value, snapshot);
		for (const [key, entryValue] of Object.entries(value)) {
			snapshot[key] = cloneJsonLikeValue(entryValue, seen);
		}
		return snapshot;
	}
	return Object.prototype.toString.call(value);
}

function readField(value: unknown, field: string): unknown {
	try {
		if (
			value === null ||
			(typeof value !== 'object' && typeof value !== 'function')
		) {
			return undefined;
		}
		return (value as Record<string, unknown>)[field];
	} catch {
		return undefined;
	}
}

function readStringField(value: unknown, field: string): string | undefined {
	const fieldValue = readField(value, field);
	return typeof fieldValue === 'string'
		? omitPrivateKeyMaterial(fieldValue)
		: undefined;
}

export function serializeConnectionDiagnosticError(
	error: unknown,
): ConnectionDiagnosticError {
	const name = readStringField(error, 'name') ?? 'Error';
	const message =
		readStringField(error, 'message') ?? safeDiagnosticString(error);
	const stack = readStringField(error, 'stack');
	const tag = readStringField(error, 'tag');
	const inner = readField(error, 'inner');
	const serialized: ConnectionDiagnosticError = { name, message };

	if (stack !== undefined) serialized.stack = stack;
	if (tag !== undefined) serialized.tag = tag;
	if (inner !== undefined) serialized.inner = cloneDiagnosticValue(inner);

	return serialized;
}
```

- [ ] **Step 4: Update recorder to timestamp typed events directly**

Replace `apps/mobile/src/lib/connection-diagnostic-recorder.ts` with:

```ts
import {
	cloneDiagnosticValue,
	safeDiagnosticString,
} from './connection-diagnostic-redaction';
import {
	type ConnectionDiagnosticEvent,
	type ConnectionDiagnosticRecorder,
	type ConnectionDiagnosticRecorderOptions,
	type ConnectionDiagnosticTimedEvent,
	type ConnectionDiagnosticTrace,
} from './connection-diagnostic-types';

type HistoryEntry = {
	order: number;
	trace: ConnectionDiagnosticTrace;
};

const DEFAULT_MAX_HISTORY = 20;
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
		reason: safeDiagnosticString(trace.reason),
		events: trace.events.map((event) => cloneDiagnosticValue(event)),
	};
}

function timestampEvent(input: {
	event: ConnectionDiagnosticEvent;
	startedAtMs: number;
	atMs: number;
}): ConnectionDiagnosticTimedEvent {
	return cloneDiagnosticValue({
		...input.event,
		atMs: input.atMs,
		elapsedMs: input.atMs - input.startedAtMs,
	});
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
				reason: safeDiagnosticString(reason),
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
					const event = timestampEvent({
						event: input,
						startedAtMs: trace.startedAtMs,
						atMs: now(),
					});
					if (!finished) trace.events.push(event);
					return cloneDiagnosticValue(event);
				},
				finish: (status) => {
					if (finished) return;
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

- [ ] **Step 5: Convert normalization module into legacy fallback only**

Replace `apps/mobile/src/lib/connection-diagnostic-normalization.ts` with:

```ts
import { diagnosticEvents } from './connection-diagnostic-events';
import { serializeConnectionDiagnosticError } from './connection-diagnostic-redaction';
import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticEvent,
	type ConnectionDiagnosticSource,
	type ConnectionDiagnosticTimedEvent,
	type ConnectionDiagnosticTrace,
	type ConnectionDiagnosticTrigger,
	type ConnectionDiagnosticStatus,
} from './connection-diagnostic-types';

function readRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object'
		? (value as Record<string, unknown>)
		: null;
}

function readString(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readSource(value: unknown): ConnectionDiagnosticSource {
	const source = readString(value, 'manual-diagnostic');
	switch (source) {
		case 'latest-shell':
		case 'active-connection':
		case 'saved-entry':
		case 'tailscale-recovery':
		case 'reconnect-controller':
		case 'manual-diagnostic':
		case 'foreground-service':
		case 'command-menu':
			return source;
		default:
			return 'manual-diagnostic';
	}
}

function readTrigger(value: unknown): ConnectionDiagnosticTrigger {
	const trigger = readString(value, 'manual-diagnostic');
	switch (trigger) {
		case 'initial-auto-connect':
		case 'reconnect':
		case 'manual-diagnostic':
		case 'command-menu':
			return trigger;
		default:
			return 'manual-diagnostic';
	}
}

function readStatus(value: unknown): ConnectionDiagnosticStatus {
	const status = readString(value, 'failed');
	switch (status) {
		case 'running':
		case 'failed':
		case 'connected':
		case 'skipped':
			return status;
		default:
			return 'failed';
	}
}

function readConnection(
	value: unknown,
): ConnectionDiagnosticConnectionIdentity {
	const record = readRecord(value) ?? {};
	return {
		savedConnectionId:
			typeof record.savedConnectionId === 'string'
				? record.savedConnectionId
				: undefined,
		connectionId:
			typeof record.connectionId === 'string' ? record.connectionId : undefined,
		username: typeof record.username === 'string' ? record.username : undefined,
		host: typeof record.host === 'string' ? record.host : undefined,
		port: typeof record.port === 'number' ? record.port : undefined,
		keyId: typeof record.keyId === 'string' ? record.keyId : undefined,
		useTmux: typeof record.useTmux === 'boolean' ? record.useTmux : undefined,
		tmuxSessionName:
			typeof record.tmuxSessionName === 'string'
				? record.tmuxSessionName
				: undefined,
	};
}

export function normalizeTraceForPrompt(
	trace: ConnectionDiagnosticTrace,
): ConnectionDiagnosticTrace {
	const record = readRecord(trace) ?? {};
	const startedAtMs = readNumber(record.startedAtMs, 0);
	const rawEvents = Array.isArray(record.events) ? record.events : [];
	return {
		id: readString(record.id, 'unknown-trace'),
		trigger: readTrigger(record.trigger),
		reason: readString(record.reason, 'unknown'),
		status: readStatus(record.status),
		startedAtMs,
		finishedAtMs:
			typeof record.finishedAtMs === 'number' ? record.finishedAtMs : undefined,
		events: rawEvents.map((rawEvent): ConnectionDiagnosticTimedEvent => {
			const eventRecord = readRecord(rawEvent) ?? {};
			const event = normalizeLegacyEvent(eventRecord);
			const atMs = readNumber(eventRecord.atMs, startedAtMs);
			return {
				...event,
				atMs,
				elapsedMs: readNumber(eventRecord.elapsedMs, atMs - startedAtMs),
			};
		}),
	};
}

function normalizeLegacyEvent(
	record: Record<string, unknown>,
): ConnectionDiagnosticEvent {
	if (typeof record.kind === 'string') {
		return record as ConnectionDiagnosticEvent;
	}
	const source = readSource(record.source);
	const type = readString(record.type, 'manual-diagnostic.warning');
	const connection = readConnection(record.connection);
	const message = typeof record.message === 'string' ? record.message : type;
	const error =
		record.error === undefined
			? undefined
			: serializeConnectionDiagnosticError(record.error);

	if (type.includes('selected')) {
		return diagnosticEvents.savedEntrySelected({ source, connection });
	}
	if (type.includes('key-resolved')) {
		return diagnosticEvents.keyResolved({ source, connection });
	}
	if (type.includes('key-missing')) {
		return diagnosticEvents.keyMissing({ source, connection });
	}
	return {
		kind: 'manual-diagnostic.warning',
		source: 'manual-diagnostic',
		message,
		error,
	};
}
```

- [ ] **Step 6: Remove generic sanitizer tests from the old aggregate file**

In `apps/mobile/test/integration/connection-diagnostics.test.ts`, delete tests
whose only purpose is hostile arbitrary event input or broad secret-term
redaction:

```ts
// Delete these old tests after equivalent focused coverage exists:
// - recorder safely snapshots messy details without throwing
// - recorder tolerates hostile event inputs before and after finish
// - prompt formatting tolerates malformed direct trace input
// - prompt formatting tolerates direct messy trace details
// - prompt redacts credential text inside generic string fields
```

Keep any remaining barrel-export tests until the final cleanup task moves them.

- [ ] **Step 7: Run recorder tests**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test test/integration/connection-diagnostic-recorder.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run focused typecheck**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile typecheck
```

Expected: FAIL only for production callers that still emit old event shapes or
import `ConnectionDiagnosticEventInput`. The remaining failures should be in
`auto-connect-attempt.ts`, `auto-connect-reconnect-controller.ts`,
`auto-connect-saved-entry.ts`, `connect-and-open-shell.ts`,
`diagnostic-shell-probe.ts`, `ssh-shell-lifecycle.ts`,
`connection-diagnostic-runner.ts`, and their integration tests.

- [ ] **Step 9: Commit recorder and safety layer**

```bash
git add apps/mobile/src/lib/connection-diagnostic-recorder.ts \
	apps/mobile/src/lib/connection-diagnostic-redaction.ts \
	apps/mobile/src/lib/connection-diagnostic-normalization.ts \
	apps/mobile/test/integration/connection-diagnostic-recorder.test.ts \
	apps/mobile/test/integration/connection-diagnostics.test.ts
git commit -m "Simplify connection diagnostic recorder safety"
```

## Task 3: Typed Prompt Formatter

**Files:**

- Modify: `apps/mobile/src/lib/connection-diagnostic-prompt.ts`
- Create: `apps/mobile/test/integration/connection-diagnostic-prompt.test.ts`
- Modify: `apps/mobile/test/integration/connection-diagnostics.test.ts`

- [ ] **Step 1: Write prompt formatter tests**

Create `apps/mobile/test/integration/connection-diagnostic-prompt.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	diagnosticEvents,
	formatConnectionDiagnosticPrompt,
	type ConnectionDiagnosticTrace,
} from '../../src/lib/connection-diagnostics';

void test('prompt renders typed event timeline and app state', () => {
	const trace: ConnectionDiagnosticTrace = {
		id: 'trace-1',
		trigger: 'manual-diagnostic',
		reason: 'command-menu',
		status: 'failed',
		startedAtMs: 100,
		finishedAtMs: 150,
		events: [
			{
				...diagnosticEvents.savedEntrySelected({
					source: 'manual-diagnostic',
					connection: {
						savedConnectionId: 'saved-1',
						username: 'muly',
						host: 'dev.tailnet.ts.net',
						port: 22,
						useTmux: true,
						tmuxSessionName: 'main',
					},
				}),
				atMs: 110,
				elapsedMs: 10,
			},
			{
				...diagnosticEvents.sshConnectFailed({
					source: 'saved-entry',
					connection: { host: 'dev.tailnet.ts.net' },
					error: { name: 'Error', message: 'connection refused' },
				}),
				atMs: 140,
				elapsedMs: 40,
			},
		],
	};

	const prompt = formatConnectionDiagnosticPrompt(trace, {
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
			pathname: '/shell/detail',
			appActive: true,
		},
	});

	assert.match(prompt, /Debug this Fressh mobile SSH connection failure/);
	assert.match(prompt, /platformOS: android/);
	assert.match(prompt, /selected connection/i);
	assert.match(prompt, /dev\.tailnet\.ts\.net/);
	assert.match(prompt, /ssh\.connect\.failed/);
	assert.match(prompt, /connection refused/);
	assert.match(prompt, /Private key material has been omitted/);
});

void test('prompt preserves personal diagnostic tokens but omits private key blocks', () => {
	const trace: ConnectionDiagnosticTrace = {
		id: 'trace-token',
		trigger: 'manual-diagnostic',
		reason: 'token=abc is useful context',
		status: 'failed',
		startedAtMs: 100,
		events: [
			{
				kind: 'manual-diagnostic.failed',
				source: 'manual-diagnostic',
				error: {
					name: 'Error',
					message:
						'-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----',
				},
				atMs: 100,
				elapsedMs: 0,
			},
		],
	};

	const prompt = formatConnectionDiagnosticPrompt(trace);
	assert.match(prompt, /token=abc is useful context/);
	assert.doesNotMatch(prompt, /secret/);
	assert.match(
		prompt,
		/PRIVATE KEY OMITTED|Private key material has been omitted/,
	);
});
```

- [ ] **Step 2: Run prompt tests to verify they fail**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test test/integration/connection-diagnostic-prompt.test.ts
```

Expected: FAIL because the formatter still expects old event fields.

- [ ] **Step 3: Replace prompt formatting with typed event rendering**

Replace `apps/mobile/src/lib/connection-diagnostic-prompt.ts` with:

```ts
import { normalizeTraceForPrompt } from './connection-diagnostic-normalization';
import {
	omitPrivateKeyMaterial,
	safeDiagnosticString,
} from './connection-diagnostic-redaction';
import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticPromptOptions,
	type ConnectionDiagnosticTimedEvent,
	type ConnectionDiagnosticTrace,
} from './connection-diagnostic-types';

function formatConnectionIdentity(
	connection: ConnectionDiagnosticConnectionIdentity | undefined,
): string {
	if (!connection) return 'unknown connection';
	const parts = [
		connection.username &&
		connection.host &&
		typeof connection.port === 'number'
			? `${connection.username}@${connection.host}:${connection.port}`
			: connection.host,
		connection.savedConnectionId
			? `savedConnectionId=${connection.savedConnectionId}`
			: null,
		connection.connectionId ? `connectionId=${connection.connectionId}` : null,
		typeof connection.useTmux === 'boolean'
			? `useTmux=${String(connection.useTmux)}`
			: null,
		connection.tmuxSessionName
			? `tmuxSessionName=${connection.tmuxSessionName}`
			: null,
		connection.keyId ? `keyId=${connection.keyId}` : null,
	];
	return parts.filter(Boolean).join(' | ') || 'unknown connection';
}

function findPrimaryConnectionIdentity(
	trace: ConnectionDiagnosticTrace,
): ConnectionDiagnosticConnectionIdentity | undefined {
	let selected: ConnectionDiagnosticConnectionIdentity | undefined;
	let selectedScore = -1;
	for (const event of trace.events) {
		if (!event.connection) continue;
		const score = Object.values(event.connection).filter(
			(value) => value !== undefined && value !== '',
		).length;
		if (score >= selectedScore) {
			selected = event.connection;
			selectedScore = score;
		}
	}
	return selected;
}

function formatError(event: ConnectionDiagnosticTimedEvent): string | null {
	if (!event.error) return null;
	const parts = [
		`${event.error.name}: ${event.error.message}`,
		event.error.tag ? `tag=${event.error.tag}` : null,
		event.error.stack ? `stack=${event.error.stack.replace(/\n/g, ' ')}` : null,
	];
	return parts.filter(Boolean).join(' | ');
}

function formatEventSpecifics(event: ConnectionDiagnosticTimedEvent): string[] {
	switch (event.kind) {
		case 'manual-diagnostic.timeout':
			return [`timeoutMs=${event.timeoutMs ?? 'unknown'}`];
		case 'ssh.shell.connected':
			return [
				`channelId=${event.channelId}`,
				`storedConnectionId=${event.storedConnectionId}`,
			];
		case 'ssh.connect.connected':
			return [`storedConnectionId=${event.storedConnectionId}`];
		case 'ssh.shell.tmux-attach-failed':
			return [
				`tmuxAttachFailureReason=${event.tmuxAttachFailureReason ?? 'unknown'}`,
				`storedConnectionId=${event.storedConnectionId}`,
			];
		case 'ssh.shell.failed':
			return [`storedConnectionId=${event.storedConnectionId}`];
		case 'tailscale.ensure-ready.result':
			return [
				`platformOS=${event.platformOS}`,
				`readiness=${JSON.stringify(event.readiness)}`,
			];
		case 'tailscale.recovery.result':
			return [`recoveryResult=${JSON.stringify(event.recoveryResult)}`];
		case 'auto-connect.active-connection.shell-connected':
			return [`channelId=${event.channelId ?? 'unknown'}`];
		case 'auto-connect.saved-entry.connect.connected':
			return [
				`connectionId=${event.connectionId ?? 'unknown'}`,
				`channelId=${event.channelId ?? 'unknown'}`,
			];
		default:
			return [];
	}
}

function formatEvent(event: ConnectionDiagnosticTimedEvent): string {
	const parts = [
		`- +${event.elapsedMs}ms ${event.kind}`,
		`source=${event.source}`,
		event.message ? `message=${event.message}` : null,
		event.connection
			? `connection=${formatConnectionIdentity(event.connection)}`
			: null,
		formatError(event),
		...formatEventSpecifics(event),
	];
	return omitPrivateKeyMaterial(parts.filter(Boolean).join(' | '));
}

function formatAppState(options: ConnectionDiagnosticPromptOptions): string[] {
	if (!options.appState) return [];
	const state = options.appState;
	const lines = [
		'App state:',
		`- platformOS: ${state.platformOS}`,
		`- isAutoConnecting: ${String(state.isAutoConnecting)}`,
		`- isReconnecting: ${String(state.isReconnecting)}`,
	];
	if (state.pathname !== undefined) lines.push(`- pathname: ${state.pathname}`);
	if (state.foregroundServiceStarted !== undefined) {
		lines.push(
			`- foregroundServiceStarted: ${String(state.foregroundServiceStarted)}`,
		);
	}
	if (state.backgroundWorkAllowed !== undefined) {
		lines.push(
			`- backgroundWorkAllowed: ${String(state.backgroundWorkAllowed)}`,
		);
	}
	if (state.foregroundServiceRequired !== undefined) {
		lines.push(
			`- foregroundServiceRequired: ${String(state.foregroundServiceRequired)}`,
		);
	}
	if (state.appActive !== undefined) {
		lines.push(`- appActive: ${String(state.appActive)}`);
	}
	return lines;
}

export function formatConnectionDiagnosticPrompt(
	trace: ConnectionDiagnosticTrace,
	options: ConnectionDiagnosticPromptOptions = {},
): string {
	try {
		const safeTrace = normalizeTraceForPrompt(trace);
		const appState = formatAppState(options);
		const connection = findPrimaryConnectionIdentity(safeTrace);
		const failure = [...safeTrace.events]
			.reverse()
			.find((event) => event.error || event.kind.includes('failed'));
		const lines = [
			'Debug this Fressh mobile SSH connection failure.',
			'',
			'Trace:',
			`- traceId: ${safeTrace.id}`,
			`- trigger: ${safeTrace.trigger}`,
			`- reason: ${safeDiagnosticString(safeTrace.reason)}`,
			`- status: ${safeTrace.status}`,
			`- startedAtMs: ${safeTrace.startedAtMs}`,
			`- finishedAtMs: ${safeTrace.finishedAtMs ?? 'not-finished'}`,
			'',
			`Selected connection: ${formatConnectionIdentity(connection)}`,
			'',
			...appState,
			...(appState.length ? [''] : []),
			'Failure summary:',
			failure ? formatEvent(failure) : '- no failure event recorded',
			'',
			'Timeline:',
			...safeTrace.events.map((event) => formatEvent(event)),
			'',
			'Private key material has been omitted from this diagnostic trace.',
			'Please explain the most likely failure point, the evidence from the trace, and the next debugging steps.',
		];
		return omitPrivateKeyMaterial(lines.join('\n'));
	} catch (error) {
		return [
			'Debug this Fressh mobile SSH connection failure.',
			'',
			'Trace:',
			'- traceId: unknown-trace',
			'- trigger: manual-diagnostic',
			`- reason: ${safeDiagnosticString(error)}`,
			'- status: failed',
			'',
			'Timeline:',
			'- prompt formatting failed',
			'',
			'Private key material has been omitted from this diagnostic trace.',
			'Please explain the most likely failure point, the evidence from the trace, and the next debugging steps.',
		].join('\n');
	}
}
```

- [ ] **Step 4: Move surviving prompt tests out of the old aggregate file**

In `apps/mobile/test/integration/connection-diagnostics.test.ts`, remove prompt
tests now covered by `connection-diagnostic-prompt.test.ts`:

```ts
// Delete old prompt tests after the new prompt test passes:
// - prompt includes connection identity and omits private key material
// - prompt supports planned contract fields and includes them in output
// - prompt summary prefers the richest later connection identity
// - prompt omits optional app state lines when values are absent
```

- [ ] **Step 5: Run prompt and recorder tests**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
	test/integration/connection-diagnostic-events.test.ts \
	test/integration/connection-diagnostic-recorder.test.ts \
	test/integration/connection-diagnostic-prompt.test.ts
```

Expected: PASS for typed event, recorder, and prompt tests.

- [ ] **Step 6: Commit typed prompt formatter**

```bash
git add apps/mobile/src/lib/connection-diagnostic-prompt.ts \
	apps/mobile/test/integration/connection-diagnostic-prompt.test.ts \
	apps/mobile/test/integration/connection-diagnostics.test.ts
git commit -m "Render typed connection diagnostic prompts"
```

## Task 4: Typed SSH Lifecycle And Probe Events

**Files:**

- Modify: `apps/mobile/src/lib/ssh-shell-lifecycle.ts`
- Modify: `apps/mobile/src/lib/connect-and-open-shell.ts`
- Modify: `apps/mobile/src/lib/diagnostic-shell-probe.ts`
- Modify:
  `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts`
- Modify: `apps/mobile/test/integration/diagnostic-shell-probe.test.ts`

- [ ] **Step 1: Update lifecycle tests to assert event kinds**

In `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts`,
update event-sequence assertions to read `kind` instead of `type`:

```ts
assert.deepEqual(
	events.map((event) => event.kind),
	[
		'ssh.connect.started',
		'ssh.connect.connected',
		'ssh.shell.started',
		'ssh.shell.connected',
	],
);
```

In the shell failure test, assert:

```ts
assert.deepEqual(
	events.map((event) => event.kind),
	[
		'ssh.connect.started',
		'ssh.connect.connected',
		'ssh.shell.started',
		'ssh.shell.failed',
	],
);
```

In `apps/mobile/test/integration/diagnostic-shell-probe.test.ts`, update cleanup
event assertions to use:

```ts
assert.deepEqual(
	events.map((event) => event.kind),
	[
		'ssh.connect.started',
		'ssh.connect.connected',
		'ssh.shell.started',
		'ssh.shell.connected',
		'ssh.diagnostic.disconnected',
	],
);
```

- [ ] **Step 2: Run lifecycle tests to verify they fail**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
	test/integration/connect-and-open-shell-diagnostics.test.ts \
	test/integration/diagnostic-shell-probe.test.ts
```

Expected: FAIL because production code still emits old `type` event objects.

- [ ] **Step 3: Update `ssh-shell-lifecycle.ts` to emit typed events**

In `apps/mobile/src/lib/ssh-shell-lifecycle.ts`:

- Replace `ConnectionDiagnosticEventInput` imports with
  `ConnectionDiagnosticEvent`.
- Import `diagnosticEvents`.
- Change `traceEvent` argument type to
  `(event: ConnectionDiagnosticEvent) => void`.
- Replace event construction:

```ts
traceEvent(
	diagnosticEvents.sshConnectStarted({
		source: 'saved-entry',
		connection: connectionIdentity,
	}),
);
```

```ts
traceEvent(
	diagnosticEvents.sshConnectProgress({
		source: 'saved-entry',
		connection: connectionIdentity,
		phase:
			typeof progressEvent === 'object' &&
			progressEvent !== null &&
			'phase' in progressEvent &&
			typeof progressEvent.phase === 'string'
				? progressEvent.phase
				: undefined,
	}),
);
```

```ts
traceEvent(
	diagnosticEvents.sshConnectFailed({
		source: 'saved-entry',
		connection: connectionIdentity,
		error: serializeConnectionDiagnosticError(error),
	}),
);
```

```ts
traceEvent(
	diagnosticEvents.sshConnectConnected({
		source: 'saved-entry',
		connection: connectedIdentity,
		storedConnectionId,
	}),
);
```

```ts
traceEvent(
	diagnosticEvents.sshShellStarted({
		source: 'saved-entry',
		connection: connectedIdentity,
	}),
);
```

```ts
traceEvent(
	tmuxAttachFailureReason !== null
		? diagnosticEvents.sshShellTmuxAttachFailed({
				source: 'saved-entry',
				connection: connectedIdentity,
				error: serializeConnectionDiagnosticError(error),
				tmuxAttachFailureReason,
				storedConnectionId,
			})
		: diagnosticEvents.sshShellFailed({
				source: 'saved-entry',
				connection: connectedIdentity,
				error: serializeConnectionDiagnosticError(error),
				storedConnectionId,
			}),
);
```

```ts
traceEvent(
	diagnosticEvents.sshShellConnected({
		source: 'saved-entry',
		connection: connectedIdentity,
		channelId: shellHandle.channelId,
		storedConnectionId,
	}),
);
```

- [ ] **Step 4: Update connect and diagnostic probe trace wrappers**

In `apps/mobile/src/lib/connect-and-open-shell.ts` and
`apps/mobile/src/lib/diagnostic-shell-probe.ts`, replace
`ConnectionDiagnosticEventInput` with `ConnectionDiagnosticEvent` in trace
types.

In `apps/mobile/src/lib/diagnostic-shell-probe.ts`, import `diagnosticEvents`
and replace cleanup events:

```ts
traceEvent(
	diagnosticEvents.diagnosticDisconnected({
		source: 'saved-entry',
		connection: connectedIdentity,
	}),
);
```

Add these constructors to `diagnosticEvents` if Task 1 did not include them:

```ts
diagnosticDisconnected: (input: {
	source: ConnectionDiagnosticSource;
	connection: ConnectionDiagnosticConnectionIdentity;
}): DiagnosticDisconnectedEvent =>
	withSource({ kind: 'ssh.diagnostic.disconnected', ...input }),
diagnosticDisconnectFailed: (input: {
	source: ConnectionDiagnosticSource;
	connection: ConnectionDiagnosticConnectionIdentity;
	error: ConnectionDiagnosticError;
}): DiagnosticDisconnectFailedEvent =>
	withSource({ kind: 'ssh.diagnostic.disconnect-failed', ...input }),
```

Use `diagnosticDisconnectFailed` in the disconnect catch block.

- [ ] **Step 5: Run lifecycle and probe tests**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
	test/integration/connect-and-open-shell-diagnostics.test.ts \
	test/integration/diagnostic-shell-probe.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile typecheck
```

Expected: FAIL only for auto-connect, reconnect, manual diagnostic, and tests
that Task 5 and Task 6 will migrate to typed events.

- [ ] **Step 7: Commit typed SSH lifecycle events**

```bash
git add apps/mobile/src/lib/ssh-shell-lifecycle.ts \
	apps/mobile/src/lib/connect-and-open-shell.ts \
	apps/mobile/src/lib/diagnostic-shell-probe.ts \
	apps/mobile/src/lib/connection-diagnostic-events.ts \
	apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts \
	apps/mobile/test/integration/diagnostic-shell-probe.test.ts
git commit -m "Emit typed SSH diagnostic events"
```

## Task 5: Pure Tailscale Retry Policy And Auto-Connect Mapping

**Files:**

- Modify: `apps/mobile/src/lib/auto-connect-saved-entry.ts`
- Modify: `apps/mobile/src/lib/auto-connect-attempt.ts`
- Modify: `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`
- Modify: `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`
- Modify: `apps/mobile/test/integration/auto-connect-attempt.test.ts`
- Modify:
  `apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`

- [ ] **Step 1: Add pure retry outcome tests**

In `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`, add:

```ts
void test('saved-entry retry policy returns blocked without UI callbacks', async () => {
	const result = await attemptSavedEntryWithTailscaleRecovery({
		platformOS: 'android',
		recovery: {
			ensureReady: async () => ({
				kind: 'starting',
				attempted: true,
				available: false,
			}),
			recoverAfterFailure: async () => {
				throw new Error('recover should not run');
			},
		},
		connectSavedEntry: async () => {
			throw new Error('connect should not run');
		},
	});

	assert.equal(result.status, 'blocked');
	assert.match(result.attentionMessage ?? '', /Tailscale/i);
});

void test('saved-entry retry policy returns retryFailed after recovery retry failure', async () => {
	const result = await attemptSavedEntryWithTailscaleRecovery({
		platformOS: 'android',
		recovery: {
			ensureReady: async () => ({
				kind: 'ready',
				attempted: false,
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
			throw Object.assign(new Error('network failed'), {
				tag: 'NetworkError',
			});
		},
	});

	assert.equal(result.status, 'retryFailed');
	assert.match((result.error as Error).message, /network failed/);
});
```

- [ ] **Step 2: Run saved-entry tests to verify they fail**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-saved-entry.test.ts
```

Expected: FAIL because `attemptSavedEntryWithTailscaleRecovery` still requires
UI callbacks and returns `{ connected: boolean }`.

- [ ] **Step 3: Refactor saved-entry retry return types**

In `apps/mobile/src/lib/auto-connect-saved-entry.ts`, replace
`AttemptSavedEntryWithTailscaleRecoveryArgs` and the function result with:

```ts
export type SavedEntryRecoveryOutcome =
	| {
			status: 'blocked';
			readiness: TailscaleReadyResult;
			attentionMessage: string | null;
	  }
	| {
			status: 'connected';
			result: Extract<SavedEntryConnectResult, { status: 'connected' }>;
	  }
	| { status: 'tmuxAttachFailed'; result: TmuxAttachFailedResult }
	| {
			status: 'recoveryNotAttempted';
			error: unknown;
			recoveryResult: TailscaleRecoverAfterFailureResult;
			attentionMessage: string | null;
	  }
	| {
			status: 'retryFailed';
			error: unknown;
			recoveryResult: TailscaleRecoverAfterFailureResult;
			attentionMessage: string | null;
	  }
	| { status: 'threw'; error: unknown };

export type AttemptSavedEntryWithTailscaleRecoveryArgs = {
	platformOS: string;
	recovery: SavedEntryTailscaleRecovery;
	connectSavedEntry: () => Promise<SavedEntryConnectResult>;
	shouldRecoverAfterFailure?: (error: unknown) => boolean;
	onEvent?: (event: ConnectionDiagnosticEvent) => void;
};
```

Inside the function:

- emit typed `diagnosticEvents.tailscaleEnsureReadyResult`
- return `blocked` instead of calling `markTailscaleAttention`
- return `connected` or `tmuxAttachFailed` from `handleConnectResult`
- return `recoveryNotAttempted` when recovery fails or should not retry
- return `retryFailed` when the retry throws a network-like error
- return `threw` for non-network failures that callers should rethrow

Add constructors to `diagnosticEvents`:

```ts
tailscaleEnsureReadyResult: (input: {
	source: ConnectionDiagnosticSource;
	platformOS: string;
	readiness: TailscaleReadyResult;
}): TailscaleEnsureReadyEvent =>
	withSource({ kind: 'tailscale.ensure-ready.result', ...input }),
tailscaleRecoveryResult: (input: {
	source: ConnectionDiagnosticSource;
	recoveryResult: TailscaleRecoverAfterFailureResult;
}): TailscaleRecoveryResultEvent =>
	withSource({ kind: 'tailscale.recovery.result', ...input }),
```

- [ ] **Step 4: Map retry outcomes in auto-connect**

In `apps/mobile/src/lib/auto-connect-attempt.ts`, change the saved-entry call
to:

```ts
const result = await attemptSavedEntryWithTailscaleRecovery({
	platformOS,
	recovery,
	connectSavedEntry,
	shouldRecoverAfterFailure: () => true,
	onEvent: traceEvent,
});

switch (result.status) {
	case 'connected':
		clearTailscaleAttention();
		return true;
	case 'tmuxAttachFailed':
		logTmuxAttachFailure(result.result);
		traceSavedEntry(
			trace,
			logger,
			'auto-connect.saved-entry.connect.failed',
			latestEntry,
		);
		return false;
	case 'blocked':
	case 'recoveryNotAttempted':
	case 'retryFailed':
		if (result.attentionMessage !== null) {
			markTailscaleAttention(result.attentionMessage);
		}
		if (result.status === 'retryFailed') {
			logger.warn(
				'Auto-connect failed after Tailscale recovery retry',
				result.error,
			);
		}
		traceSavedEntry(
			trace,
			logger,
			'auto-connect.saved-entry.connect.failed',
			latestEntry,
		);
		return false;
	case 'threw':
		throw result.error;
}
```

While editing this file, convert old string events to typed constructors:

```ts
traceEvent(
	diagnosticEvents.savedEntrySelected({
		source: 'saved-entry',
		connection: getSavedEntryConnectionIdentity(
			latestEntry.id,
			latestEntry.value,
		),
	}),
);
```

Use `diagnosticEvents.keyMissing`, `diagnosticEvents.keyResolved`,
`diagnosticEvents.savedEntryMissing`, and active-connection event constructors
for the remaining trace calls.

- [ ] **Step 5: Convert reconnect controller events**

In `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`:

- Replace `ConnectionDiagnosticEventInput` with `ConnectionDiagnosticEvent`.
- Import `diagnosticEvents`.
- Replace reconnect trace object literals with
  `diagnosticEvents.reconnect(...)`.

Add a generic reconnect constructor in `diagnosticEvents`:

```ts
reconnect: (input: Omit<ReconnectEvent, 'source'>): ReconnectEvent =>
	withSource({ source: 'reconnect-controller', ...input }),
```

- [ ] **Step 6: Update auto-connect tests to assert typed event kinds**

In `apps/mobile/test/integration/auto-connect-attempt.test.ts`, replace
`event.type` assertions with `event.kind`. Example:

```ts
assert.deepEqual(
	events.map((event) => event.kind),
	[
		'saved-entry.selected',
		'key.resolved',
		'tailscale.ensure-ready.result',
		'auto-connect.saved-entry.connect.started',
		'auto-connect.saved-entry.connect.connected',
	],
);
```

In `apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`,
replace reconnect event assertions with `kind` checks:

```ts
assert.ok(events.some((event) => event.kind === 'reconnect.started'));
assert.ok(events.some((event) => event.kind === 'reconnect.retry.scheduled'));
```

- [ ] **Step 7: Run auto-connect tests**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
	test/integration/auto-connect-saved-entry.test.ts \
	test/integration/auto-connect-attempt.test.ts \
	test/integration/auto-connect-reconnect-controller.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit pure retry and typed auto-connect mapping**

```bash
git add apps/mobile/src/lib/auto-connect-saved-entry.ts \
	apps/mobile/src/lib/auto-connect-attempt.ts \
	apps/mobile/src/lib/auto-connect-reconnect-controller.ts \
	apps/mobile/src/lib/connection-diagnostic-events.ts \
	apps/mobile/test/integration/auto-connect-saved-entry.test.ts \
	apps/mobile/test/integration/auto-connect-attempt.test.ts \
	apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts
git commit -m "Split connection retry policy from diagnostics side effects"
```

## Task 6: Manual Diagnostic Runner Factory

**Files:**

- Modify: `apps/mobile/src/lib/connection-diagnostic-runner.ts`
- Modify: `apps/mobile/src/lib/connection-debug-command.ts`
- Modify: `apps/mobile/test/integration/connection-diagnostic-runner.test.ts`
- Modify: `apps/mobile/test/integration/connection-debug-command.test.ts`

- [ ] **Step 1: Update runner tests for isolated instances**

In `apps/mobile/test/integration/connection-diagnostic-runner.test.ts`, import
`createManualConnectionDiagnosticRunner` and create a runner inside each test:

```ts
import { createManualConnectionDiagnosticRunner } from '../../src/lib/connection-diagnostic-runner';
```

Add this test:

```ts
void test('manual diagnostic runner instances do not share single-flight state', async () => {
	const firstRunner = createManualConnectionDiagnosticRunner();
	const secondRunner = createManualConnectionDiagnosticRunner();
	const firstRecorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	const secondRecorder = createConnectionDiagnosticRecorder({ now: () => 20 });

	const blocked = new Promise<never>(() => undefined);
	const first = firstRunner.run({
		recorder: firstRecorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolveKeySecurity: async () => ({
			type: 'key',
			privateKey: 'private-key',
		}),
		connectSavedEntry: async () => blocked,
		recovery: readyRecovery,
		timeoutMs: 5,
	});

	const second = await secondRunner.run({
		recorder: secondRecorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
		},
		loadLatestSavedConnection: async () => null,
		resolveKeySecurity: async () => null,
		connectSavedEntry: async () => {
			throw new Error('connect should not run');
		},
		recovery: readyRecovery,
		timeoutMs: 50,
	});

	assert.equal(second.status, 'skipped');
	assert.equal((await first).status, 'failed');
});
```

- [ ] **Step 2: Run manual runner tests to verify they fail**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test test/integration/connection-diagnostic-runner.test.ts
```

Expected: FAIL because `createManualConnectionDiagnosticRunner` does not exist.

- [ ] **Step 3: Refactor runner module into a factory**

In `apps/mobile/src/lib/connection-diagnostic-runner.ts`:

- Remove module-level `running`, `activeTraceHandle`, and `activeRunToken`.
- Keep `ManualDiagnosticTimeoutError`, timeout helper, `finish`, and
  `safeTraceEvent`.
- Export:

```ts
export type ManualConnectionDiagnosticRunner = {
	run: (
		args: ManualConnectionDiagnosticArgs,
	) => Promise<ManualConnectionDiagnosticResult>;
};

export function createManualConnectionDiagnosticRunner(): ManualConnectionDiagnosticRunner {
	let running = false;
	let activeTraceHandle: ConnectionDiagnosticTraceHandle | null = null;
	let activeRunToken: symbol | null = null;

	return {
		run: async (args) =>
			runManualConnectionDiagnosticWithState(args, {
				get running() {
					return running;
				},
				set running(next) {
					running = next;
				},
				get activeTraceHandle() {
					return activeTraceHandle;
				},
				set activeTraceHandle(next) {
					activeTraceHandle = next;
				},
				get activeRunToken() {
					return activeRunToken;
				},
				set activeRunToken(next) {
					activeRunToken = next;
				},
			}),
	};
}

export const manualConnectionDiagnosticRunner =
	createManualConnectionDiagnosticRunner();

export function runManualConnectionDiagnostic(
	args: ManualConnectionDiagnosticArgs,
): Promise<ManualConnectionDiagnosticResult> {
	return manualConnectionDiagnosticRunner.run(args);
}
```

Add a private helper immediately above the factory. Start by moving the current
body of `runManualConnectionDiagnostic` into this helper and replacing reads or
writes of the old module globals with `state.running`,
`state.activeTraceHandle`, and `state.activeRunToken`. The helper must keep the
same command sequence as the current function: busy check, set state, start
trace, load saved entry, resolve key, run diagnostic probe through Tailscale
recovery, finish trace, catch timeout/failure, and clear state in `finally`. Use
this wrapper shape:

```ts
type ManualConnectionDiagnosticRunnerState = {
	running: boolean;
	activeTraceHandle: ConnectionDiagnosticTraceHandle | null;
	activeRunToken: symbol | null;
};

async function runManualConnectionDiagnosticWithState(
	args: ManualConnectionDiagnosticArgs,
	state: ManualConnectionDiagnosticRunnerState,
): Promise<ManualConnectionDiagnosticResult> {
	if (state.running) {
		const latestTrace =
			state.activeTraceHandle?.trace ?? args.recorder.getLatestTrace();
		const prompt = [
			'A Fressh connection diagnostic is already running. Try again after it finishes.',
			latestTrace ? promptForTrace(latestTrace, args) : null,
		]
			.filter(Boolean)
			.join('\n\n');
		return { status: 'busy', prompt, trace: latestTrace };
	}

	state.running = true;
	const runToken = Symbol('manual-connection-diagnostic');
	state.activeRunToken = runToken;
	let handle: ConnectionDiagnosticTraceHandle | null = null;
	const ensureCurrentRun = () => {
		if (state.activeRunToken !== runToken) {
			throw new Error('Connection diagnostic run is no longer active');
		}
	};

	try {
		return await withManualDiagnosticTimeout(
			runManualConnectionDiagnosticAttempt(args, state, {
				runToken,
				setHandle: (next) => {
					handle = next;
				},
				ensureCurrentRun,
			}),
			args.timeoutMs ?? DEFAULT_MANUAL_DIAGNOSTIC_TIMEOUT_MS,
		);
	} catch (error) {
		if (!handle) throw error;
		if (error instanceof ManualDiagnosticTimeoutError) {
			safeTraceEvent(
				handle,
				diagnosticEvents.manualDiagnosticTimeout({
					timeoutMs: error.timeoutMs,
					message: error.message,
				}),
			);
			return finish(handle, 'failed', args);
		}
		safeTraceEvent(
			handle,
			diagnosticEvents.manualDiagnosticFailed({
				error: serializeConnectionDiagnosticError(error),
			}),
		);
		return finish(handle, 'failed', args);
	} finally {
		if (state.activeRunToken === runToken) {
			state.activeTraceHandle = null;
			state.activeRunToken = null;
			state.running = false;
		}
	}
}
```

Create `runManualConnectionDiagnosticAttempt` by moving the current happy-path
body from `runManualConnectionDiagnostic` into a helper. The helper takes
`args`, `state`, and `{ setHandle, ensureCurrentRun }`; it starts the trace,
assigns `state.activeTraceHandle`, loads the saved entry, resolves the key, runs
`attemptSavedEntryWithTailscaleRecovery`, and returns `finish(...)` exactly once
for each terminal outcome. Inside that helper, replace manual event object
literals with these typed events:

```ts
safeTraceEvent(
	traceHandle,
	diagnosticEvents.savedEntryMissing({
		source: 'manual-diagnostic',
		message: 'No eligible saved auto-connect connection was found.',
	}),
);
```

```ts
safeTraceEvent(
	traceHandle,
	diagnosticEvents.savedEntrySelected({
		source: 'manual-diagnostic',
		connection,
	}),
);
```

```ts
safeTraceEvent(
	traceHandle,
	diagnosticEvents.keyMissing({
		source: 'manual-diagnostic',
		connection,
	}),
);
```

```ts
safeTraceEvent(
	traceHandle,
	diagnosticEvents.keyResolved({
		source: 'manual-diagnostic',
		connection,
	}),
);
```

Use `diagnosticEvents.manualDiagnosticTimeout(...)` for timeouts and a
`manualDiagnosticFailed` constructor for final failures. Add the constructor to
`connection-diagnostic-events.ts`:

```ts
manualDiagnosticFailed: (input: {
	error: ConnectionDiagnosticError;
}): ManualDiagnosticEvent =>
	withSource({
		kind: 'manual-diagnostic.failed',
		source: 'manual-diagnostic',
		...input,
	}),
```

- [ ] **Step 4: Map pure retry outcomes in manual diagnostics**

In the runner's call to `attemptSavedEntryWithTailscaleRecovery`, remove UI
callback arguments and map the returned outcome:

```ts
const result = await attemptSavedEntryWithTailscaleRecovery({
	platformOS: args.appState.platformOS,
	recovery: args.recovery,
	connectSavedEntry: () =>
		Promise.resolve()
			.then(ensureCurrentRun)
			.then(() =>
				args.connectSavedEntry({
					connectionDetails: normalizedDetails,
					resolvedSecurity,
					trace: traceHandle,
				}),
			),
	shouldRecoverAfterFailure: (error) => !isDiagnosticShellCleanupError(error),
	onEvent: (event) => safeTraceEvent(traceHandle, event),
});

switch (result.status) {
	case 'connected':
		return finish(traceHandle, 'connected', args);
	case 'tmuxAttachFailed':
	case 'blocked':
	case 'recoveryNotAttempted':
	case 'retryFailed':
		return finish(traceHandle, 'failed', args);
	case 'threw':
		throw result.error;
}
```

- [ ] **Step 5: Allow command tests to inject a runner**

In `apps/mobile/src/lib/connection-debug-command.ts`, add an optional runner
dependency:

```ts
import {
	manualConnectionDiagnosticRunner,
	type ManualConnectionDiagnosticRunner,
} from './connection-diagnostic-runner';

export type ConnectionDebugCommandArgs = {
	recorder: ConnectionDiagnosticRecorder;
	appState: ConnectionDiagnosticAppState;
	closeMenu: () => void;
	loadLatestSavedConnection: () => Promise<SavedConnectionEntry | null>;
	resolvePrivateKey: (keyId: string) => Promise<string>;
	runDiagnosticShellProbe: typeof runDiagnosticShellProbe;
	connect: Parameters<typeof runDiagnosticShellProbe>[0]['connect'];
	recovery: SavedEntryTailscaleRecovery;
	allowTerminalPaste: boolean;
	pasteIntoTerminal: (value: string) => void;
	copyToClipboard: (value: string) => Promise<void>;
	showAlert: (title: string, message: string) => void;
	logger: ConnectionDebugLogger;
	manualDiagnosticRunner?: ManualConnectionDiagnosticRunner;
};
```

Use it:

```ts
const diagnostic = await (
	args.manualDiagnosticRunner ?? manualConnectionDiagnosticRunner
).run({
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
	connectSavedEntry: ({ connectionDetails, resolvedSecurity, trace }) =>
		args.runDiagnosticShellProbe({
			connectionDetails,
			resolvedSecurity,
			trace,
			connect: args.connect,
		}),
	recovery: args.recovery,
});
```

- [ ] **Step 6: Run runner and command tests**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
	test/integration/connection-diagnostic-runner.test.ts \
	test/integration/connection-debug-command.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit manual runner factory**

```bash
git add apps/mobile/src/lib/connection-diagnostic-runner.ts \
	apps/mobile/src/lib/connection-debug-command.ts \
	apps/mobile/src/lib/connection-diagnostic-events.ts \
	apps/mobile/test/integration/connection-diagnostic-runner.test.ts \
	apps/mobile/test/integration/connection-debug-command.test.ts
git commit -m "Isolate manual connection diagnostic runner state"
```

## Task 7: ShellDetail Debug Command Hook

**Files:**

- Create: `apps/mobile/src/lib/use-connection-debug-command.ts`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Modify:
  `apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts`

- [ ] **Step 1: Update ShellDetail wiring test**

In `apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts`,
replace the inline debug-command block assertion with:

```ts
void test('delegates connection debug command wiring to hook', () => {
	const source = readFileSync(detailSourcePath, 'utf8');

	assert.match(
		source,
		/import \{ useConnectionDebugCommand \} from '@\/lib\/use-connection-debug-command'/,
	);
	assert.match(
		source,
		/const debugConnectionInCodex = useConnectionDebugCommand\(\{/,
	);
	assert.match(source, /debugConnectionInCodex,\s*$/m);
	assert.doesNotMatch(source, /runConnectionDebugCommand\(\{/);
	assert.doesNotMatch(source, /loadLatestSavedConnectionForDiagnostic/);
});
```

- [ ] **Step 2: Run ShellDetail wiring test to verify it fails**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test test/integration/shell-detail-workmux-control-channel.test.ts
```

Expected: FAIL because the hook does not exist and ShellDetail still wires
`runConnectionDebugCommand` inline.

- [ ] **Step 3: Create the hook**

Create `apps/mobile/src/lib/use-connection-debug-command.ts`:

```ts
import * as Clipboard from 'expo-clipboard';
import { useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import { RnRussh } from '@fressh/react-native-uniffi-russh';
import { useAutoConnectStore } from './auto-connect';
import { runConnectionDebugCommand } from './connection-debug-command';
import { connectionDiagnosticRecorder } from './connection-diagnostic-recorder';
import { pickLatestConnection } from './connection-utils';
import { runDiagnosticShellProbe } from './diagnostic-shell-probe';
import { rootLogger } from './logger';
import { secretsManager } from './secrets-manager';
import { tailscaleRecovery } from './tailscale-recovery';
import { queryClient } from './utils';

const logger = rootLogger.extend('ConnectionDebugCommand');

export type UseConnectionDebugCommandArgs = {
	appActive: boolean;
	closeMenu: () => void;
	allowTerminalPaste: boolean;
	pasteIntoTerminal: (value: string) => void;
};

export function useConnectionDebugCommand({
	appActive,
	closeMenu,
	allowTerminalPaste,
	pasteIntoTerminal,
}: UseConnectionDebugCommandArgs) {
	return useCallback(async () => {
		const autoState = useAutoConnectStore.getState();
		await runConnectionDebugCommand({
			recorder: connectionDiagnosticRecorder,
			appState: {
				platformOS: Platform.OS,
				isAutoConnecting: autoState.isAutoConnecting,
				isReconnecting: autoState.isReconnecting,
				pathname: '/shell/detail',
				appActive,
			},
			closeMenu,
			loadLatestSavedConnection: async () => {
				const entries = await queryClient.fetchQuery(
					secretsManager.connections.query.list,
				);
				return pickLatestConnection(
					entries?.filter((entry) => entry.value.autoConnect),
				);
			},
			resolvePrivateKey: async (keyId) => {
				const keyEntry = await secretsManager.keys.utils.getPrivateKey(keyId);
				return keyEntry.value;
			},
			runDiagnosticShellProbe,
			connect: RnRussh.connect,
			recovery: tailscaleRecovery,
			allowTerminalPaste,
			pasteIntoTerminal,
			copyToClipboard: async (value) => {
				await Clipboard.setStringAsync(value);
			},
			showAlert: (title, message) => {
				Alert.alert(title, message);
			},
			logger,
		});
	}, [allowTerminalPaste, appActive, closeMenu, pasteIntoTerminal]);
}
```

- [ ] **Step 4: Replace ShellDetail inline wiring with the hook**

In `apps/mobile/src/app/shell/detail.tsx`:

- Remove imports for `runConnectionDebugCommand`,
  `connectionDiagnosticRecorder`, `pickLatestConnection`,
  `runDiagnosticShellProbe`, `Clipboard`, `RnRussh`, and direct
  `tailscaleRecovery` usage if they are only used by the debug command.
- Add:

```ts
import { useConnectionDebugCommand } from '@/lib/use-connection-debug-command';
```

- Replace `loadLatestSavedConnectionForDiagnostic` and
  `handleDebugConnectionInCodex` with:

```ts
const debugConnectionInCodex = useConnectionDebugCommand({
	appActive: isAppActiveRef.current,
	closeMenu: commandMenuModal.onClose,
	allowTerminalPaste: Boolean(shell),
	pasteIntoTerminal: sendTextRaw,
});
```

- In the action context, replace:

```ts
debugConnectionInCodex: handleDebugConnectionInCodex,
```

with:

```ts
debugConnectionInCodex,
```

- Remove `handleDebugConnectionInCodex` from dependency arrays and add
  `debugConnectionInCodex` where needed.

- [ ] **Step 5: Run ShellDetail wiring test**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test test/integration/shell-detail-workmux-control-channel.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run command delivery tests**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
	test/integration/connection-debug-command.test.ts \
	test/integration/connection-diagnostic-delivery.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit hook extraction**

```bash
git add apps/mobile/src/lib/use-connection-debug-command.ts \
	apps/mobile/src/app/shell/detail.tsx \
	apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts
git commit -m "Extract connection debug command hook"
```

## Task 8: Delete Generic Diagnostic Debt And Final Verification

**Files:**

- Modify or delete: `apps/mobile/src/lib/connection-diagnostic-normalization.ts`
- Modify: `apps/mobile/test/integration/connection-diagnostics.test.ts`
- Modify: any integration tests still asserting old `type` events
- Modify: any source files still importing `ConnectionDiagnosticEventInput`

- [ ] **Step 1: Search for old generic event API**

Run:

```bash
rg -n "ConnectionDiagnosticEventInput|type: '.*diagnostic|\\.type\\)|event\\.type|details: \\{|Record<string, unknown>" apps/mobile/src/lib apps/mobile/src/app/shell/detail.tsx apps/mobile/test/integration
```

Expected: Any remaining hits are either unrelated generic app code or legacy
fallback comments. There should be no production diagnostic event emission with
`type: string` or generic `details` objects.

- [ ] **Step 2: Remove or quarantine normalization fallback**

Keep the legacy fallback for direct prompt inputs and make the boundary
explicit. Rename the exported function declaration in
`apps/mobile/src/lib/connection-diagnostic-normalization.ts` from
`normalizeTraceForPrompt` to `normalizeLegacyTraceForPrompt`. The function body
remains the Task 2 fallback implementation.

```ts
export function normalizeLegacyTraceForPrompt(
	trace: ConnectionDiagnosticTrace,
): ConnectionDiagnosticTrace {
	const record = readRecord(trace) ?? {};
	const startedAtMs = readNumber(record.startedAtMs, 0);
	const rawEvents = Array.isArray(record.events) ? record.events : [];
	return {
		id: readString(record.id, 'unknown-trace'),
		trigger: readTrigger(record.trigger),
		reason: readString(record.reason, 'unknown'),
		status: readStatus(record.status),
		startedAtMs,
		finishedAtMs:
			typeof record.finishedAtMs === 'number' ? record.finishedAtMs : undefined,
		events: rawEvents.map((rawEvent): ConnectionDiagnosticTimedEvent => {
			const eventRecord = readRecord(rawEvent) ?? {};
			const event = normalizeLegacyEvent(eventRecord);
			const atMs = readNumber(eventRecord.atMs, startedAtMs);
			return {
				...event,
				atMs,
				elapsedMs: readNumber(eventRecord.elapsedMs, atMs - startedAtMs),
			};
		}),
	};
}
```

Then update `connection-diagnostic-prompt.ts` to import and call
`normalizeLegacyTraceForPrompt` instead of `normalizeTraceForPrompt`. After the
rename, `rg -n "normalizeTraceForPrompt" apps/mobile/src apps/mobile/test`
should return no hits.

- [ ] **Step 3: Shrink the old aggregate diagnostics test**

In `apps/mobile/test/integration/connection-diagnostics.test.ts`, keep only
barrel-level compatibility coverage:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	connectionDiagnosticRecorder,
	createConnectionDiagnosticRecorder,
	diagnosticEvents,
	formatConnectionDiagnosticPrompt,
} from '../../src/lib/connection-diagnostics';

void test('connection diagnostics barrel exports public diagnostic helpers', () => {
	assert.equal(typeof createConnectionDiagnosticRecorder, 'function');
	assert.equal(typeof connectionDiagnosticRecorder.startTrace, 'function');
	assert.equal(typeof diagnosticEvents.savedEntrySelected, 'function');
	assert.equal(typeof formatConnectionDiagnosticPrompt, 'function');
});
```

- [ ] **Step 4: Run full changed diagnostic test set**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
	test/integration/auto-connect-attempt.test.ts \
	test/integration/auto-connect-reconnect-controller.test.ts \
	test/integration/auto-connect-saved-entry.test.ts \
	test/integration/connect-and-open-shell-diagnostics.test.ts \
	test/integration/connection-debug-command.test.ts \
	test/integration/connection-diagnostic-delivery.test.ts \
	test/integration/connection-diagnostic-events.test.ts \
	test/integration/connection-diagnostic-prompt.test.ts \
	test/integration/connection-diagnostic-recorder.test.ts \
	test/integration/connection-diagnostic-runner.test.ts \
	test/integration/connection-diagnostics.test.ts \
	test/integration/diagnostic-shell-probe.test.ts \
	test/integration/shell-detail-workmux-control-channel.test.ts
```

Expected: PASS for all listed tests.

- [ ] **Step 5: Run formatting, lint, and typecheck**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec prettier --check \
	src/app/shell/detail.tsx \
	src/lib/auto-connect-attempt.ts \
	src/lib/auto-connect-reconnect-controller.ts \
	src/lib/auto-connect-saved-entry.ts \
	src/lib/connect-and-open-shell.ts \
	src/lib/connection-debug-command.ts \
	src/lib/connection-diagnostic-delivery.ts \
	src/lib/connection-diagnostic-events.ts \
	src/lib/connection-diagnostic-prompt.ts \
	src/lib/connection-diagnostic-recorder.ts \
	src/lib/connection-diagnostic-redaction.ts \
	src/lib/connection-diagnostic-runner.ts \
	src/lib/connection-diagnostic-types.ts \
	src/lib/diagnostic-shell-probe.ts \
	src/lib/ssh-shell-lifecycle.ts \
	src/lib/use-connection-debug-command.ts \
	test/integration/auto-connect-attempt.test.ts \
	test/integration/auto-connect-reconnect-controller.test.ts \
	test/integration/auto-connect-saved-entry.test.ts \
	test/integration/connect-and-open-shell-diagnostics.test.ts \
	test/integration/connection-debug-command.test.ts \
	test/integration/connection-diagnostic-delivery.test.ts \
	test/integration/connection-diagnostic-events.test.ts \
	test/integration/connection-diagnostic-prompt.test.ts \
	test/integration/connection-diagnostic-recorder.test.ts \
	test/integration/connection-diagnostic-runner.test.ts \
	test/integration/connection-diagnostics.test.ts \
	test/integration/diagnostic-shell-probe.test.ts \
	test/integration/shell-detail-workmux-control-channel.test.ts

pnpm --filter @fressh/mobile exec eslint --max-warnings 0 --report-unused-disable-directives \
	src/app/shell/detail.tsx \
	src/lib/auto-connect-attempt.ts \
	src/lib/auto-connect-reconnect-controller.ts \
	src/lib/auto-connect-saved-entry.ts \
	src/lib/connect-and-open-shell.ts \
	src/lib/connection-debug-command.ts \
	src/lib/connection-diagnostic-delivery.ts \
	src/lib/connection-diagnostic-events.ts \
	src/lib/connection-diagnostic-prompt.ts \
	src/lib/connection-diagnostic-recorder.ts \
	src/lib/connection-diagnostic-redaction.ts \
	src/lib/connection-diagnostic-runner.ts \
	src/lib/connection-diagnostic-types.ts \
	src/lib/diagnostic-shell-probe.ts \
	src/lib/ssh-shell-lifecycle.ts \
	src/lib/use-connection-debug-command.ts \
	test/integration/auto-connect-attempt.test.ts \
	test/integration/auto-connect-reconnect-controller.test.ts \
	test/integration/auto-connect-saved-entry.test.ts \
	test/integration/connect-and-open-shell-diagnostics.test.ts \
	test/integration/connection-debug-command.test.ts \
	test/integration/connection-diagnostic-delivery.test.ts \
	test/integration/connection-diagnostic-events.test.ts \
	test/integration/connection-diagnostic-prompt.test.ts \
	test/integration/connection-diagnostic-recorder.test.ts \
	test/integration/connection-diagnostic-runner.test.ts \
	test/integration/connection-diagnostics.test.ts \
	test/integration/diagnostic-shell-probe.test.ts \
	test/integration/shell-detail-workmux-control-channel.test.ts

pnpm --filter @fressh/mobile typecheck
```

Expected:

- Prettier: `All matched files use Prettier code style!`
- ESLint: exits 0
- Typecheck: exits 0

- [ ] **Step 6: Commit final cleanup**

```bash
git add apps/mobile/src apps/mobile/test/integration
git commit -m "Remove generic connection diagnostic event handling"
```
