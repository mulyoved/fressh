# Connection Diagnostics Architecture Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current giant diagnostics event module with domain-owned event modules, one shared snapshot/identity boundary, typed recorder/prompt flow, and no legacy trace normalization.

**Architecture:** Keep the public `connection-diagnostics.ts` barrel stable while moving implementation into `apps/mobile/src/lib/connection-diagnostics/events/`. Domain modules own their event types, constructors, and prompt-specific field formatters. Shared recovery code returns lifecycle outcomes only; auto-connect and manual diagnostics map those outcomes to their own events.

**Tech Stack:** TypeScript, Expo React Native mobile app, Node `tsx --test`, pnpm, Prettier, current integration test harness.

---

## Scope Check

This plan implements the approved spec:
`docs/superpowers/specs/2026-07-01-connection-diagnostics-architecture-cleanup-design.md`.

The work is one subsystem: the connection diagnostics event architecture. It is
large enough for multiple commits, but it should stay one implementation plan
because the units are tightly coupled through shared event types, recorder
types, prompt formatting, and auto-connect/manual diagnostic call sites.

## File Structure

Create these files:

- `apps/mobile/src/lib/connection-diagnostics/events/types.ts`
  - shared diagnostic primitive types and generic trace types
- `apps/mobile/src/lib/connection-diagnostics/events/snapshot.ts`
  - one JSON-safe diagnostic snapshot helper, private-key omission, error serialization
- `apps/mobile/src/lib/connection-diagnostics/events/identity.ts`
  - canonical connection identity builders and copy helpers
- `apps/mobile/src/lib/connection-diagnostics/events/prompt-format.ts`
  - shared event prompt formatting helpers
- `apps/mobile/src/lib/connection-diagnostics/events/saved-entry.ts`
  - saved-entry and key-resolution events shared by auto-connect and manual diagnostics
- `apps/mobile/src/lib/connection-diagnostics/events/ssh.ts`
  - SSH connect, shell, and diagnostic cleanup events
- `apps/mobile/src/lib/connection-diagnostics/events/auto-connect.ts`
  - auto-connect source/shell/saved-entry caller events
- `apps/mobile/src/lib/connection-diagnostics/events/manual.ts`
  - manual diagnostic events
- `apps/mobile/src/lib/connection-diagnostics/events/tailscale.ts`
  - Tailscale readiness and recovery events
- `apps/mobile/src/lib/connection-diagnostics/events/reconnect.ts`
  - reconnect controller events
- `apps/mobile/src/lib/connection-diagnostics/events/index.ts`
  - event union, event kind list, and grouped constructor exports
- `apps/mobile/test/integration/connection-diagnostic-shared-events.test.ts`
  - shared identity/snapshot/event-kind/file-size guard tests
- `apps/mobile/test/integration/connection-diagnostic-saved-entry-events.test.ts`
- `apps/mobile/test/integration/connection-diagnostic-ssh-events.test.ts`
- `apps/mobile/test/integration/connection-diagnostic-auto-connect-events.test.ts`
- `apps/mobile/test/integration/connection-diagnostic-manual-events.test.ts`
- `apps/mobile/test/integration/connection-diagnostic-tailscale-events.test.ts`
- `apps/mobile/test/integration/connection-diagnostic-reconnect-events.test.ts`

Modify these files:

- `apps/mobile/src/lib/connection-diagnostic-types.ts`
  - compatibility re-export of new event/trace types
- `apps/mobile/src/lib/connection-diagnostics.ts`
  - compatibility barrel re-exporting the new event folder and existing recorder/prompt APIs
- `apps/mobile/src/lib/connection-diagnostic-recorder.ts`
  - import typed events and snapshot helpers from the new folder
- `apps/mobile/src/lib/connection-diagnostic-prompt.ts`
  - remove legacy normalization import and delegate event-specific fields to domain formatters
- `apps/mobile/src/lib/auto-connect-saved-entry.ts`
  - return recovery outcomes without emitting diagnostics directly
- `apps/mobile/src/lib/auto-connect-attempt.ts`
  - map recovery outcomes to auto-connect events
- `apps/mobile/src/lib/connection-diagnostic-runner.ts`
  - map recovery outcomes to manual diagnostic events
- `apps/mobile/src/lib/connect-and-open-shell.ts`
- `apps/mobile/src/lib/diagnostic-shell-probe.ts`
- `apps/mobile/src/lib/ssh-shell-lifecycle.ts`
  - import SSH event constructors from the new domain module
- Current integration tests that import `diagnosticEvents`
  - update imports and expected event names only where names change

Delete these files after replacement coverage exists:

- `apps/mobile/src/lib/connection-diagnostic-events.ts`
- `apps/mobile/src/lib/connection-diagnostic-normalization.ts`
- `apps/mobile/src/lib/connection-diagnostic-redaction.ts`
- `apps/mobile/test/integration/connection-diagnostic-events.test.ts`

## Naming Decisions

Use these grouped constructor objects:

- `savedEntryEvents`
- `sshEvents`
- `autoConnectEvents`
- `manualDiagnosticEvents`
- `tailscaleDiagnosticEvents`
- `reconnectEvents`

Keep these event kind prefixes:

- `saved-entry.*`
- `key.*`
- `ssh.*`
- `auto-connect.*`
- `manual-diagnostic.*`
- `tailscale.*`
- `reconnect.*`

Change only the shared-recovery leakage: `attemptSavedEntryWithTailscaleRecovery`
must not emit `auto-connect.*` events. Auto-connect callers still emit
`auto-connect.saved-entry.*`; manual diagnostic callers emit
`manual-diagnostic.saved-entry.*` or existing manual diagnostic events.

## Task 1: Shared Event Types, Snapshot, Identity, And Guards

**Files:**

- Create: `apps/mobile/src/lib/connection-diagnostics/events/types.ts`
- Create: `apps/mobile/src/lib/connection-diagnostics/events/snapshot.ts`
- Create: `apps/mobile/src/lib/connection-diagnostics/events/identity.ts`
- Create: `apps/mobile/src/lib/connection-diagnostics/events/prompt-format.ts`
- Create: `apps/mobile/test/integration/connection-diagnostic-shared-events.test.ts`

- [ ] **Step 1: Write failing shared event tests**

Create `apps/mobile/test/integration/connection-diagnostic-shared-events.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
	buildActiveConnectionIdentity,
	buildSavedEntryIdentity,
	copyConnectionIdentity,
	omitPrivateKeyMaterial,
	serializeConnectionDiagnosticError,
	snapshotDiagnosticValue,
} from '../../src/lib/connection-diagnostics/events';

void test('connection identity helpers copy only allowed fields', () => {
	const saved = buildSavedEntryIdentity('saved-1', {
		username: 'muly',
		host: 'dev.tailnet.ts.net',
		port: 22,
		security: { type: 'key', keyId: 'key-1', privateKey: 'PRIVATE' },
		useTmux: true,
		tmuxSessionName: 'main',
		autoConnect: true,
		password: 'must-not-copy',
	} as never);
	const active = buildActiveConnectionIdentity({
		connectionId: 'active-1',
		connectionDetails: {
			username: 'muly',
			host: 'dev.tailnet.ts.net',
			port: 22,
		},
	});
	const copied = copyConnectionIdentity({
		...saved,
		privateKey: 'must-not-copy',
		password: 'must-not-copy',
	} as never);

	assert.deepEqual(saved, {
		savedConnectionId: 'saved-1',
		username: 'muly',
		host: 'dev.tailnet.ts.net',
		port: 22,
		keyId: 'key-1',
		useTmux: true,
		tmuxSessionName: 'main',
	});
	assert.deepEqual(active, {
		connectionId: 'active-1',
		username: 'muly',
		host: 'dev.tailnet.ts.net',
		port: 22,
	});
	assert.equal('privateKey' in copied, false);
	assert.equal('password' in copied, false);
});

void test('snapshot helper is circular-safe and omits private key blocks', () => {
	const value: { nested?: unknown; key: string } = {
		key: [
			'-----BEGIN OPENSSH PRIVATE KEY-----',
			'secret-key-body',
			'-----END OPENSSH PRIVATE KEY-----',
		].join('\n'),
	};
	value.nested = value;

	const snapshot = snapshotDiagnosticValue(value);
	const serialized = JSON.stringify(snapshot);

	assert.doesNotMatch(serialized, /secret-key-body/);
	assert.match(serialized, /Private key material omitted/);
	assert.match(serialized, /Circular/);
});

void test('error serializer preserves useful fields without leaking private keys', () => {
	const error = serializeConnectionDiagnosticError({
		name: 'SshError',
		message: [
			'failed with key',
			'-----BEGIN RSA PRIVATE KEY-----',
			'secret',
			'-----END RSA PRIVATE KEY-----',
		].join('\n'),
		tag: 'ssh-connect',
		inner: { code: 'ECONNRESET' },
	});

	assert.equal(error.name, 'SshError');
	assert.equal(error.tag, 'ssh-connect');
	assert.doesNotMatch(error.message, /secret/);
	assert.deepEqual(error.inner, { code: 'ECONNRESET' });
});

void test('diagnostics event source files stay below the hard size limit', () => {
	const root = join(
		process.cwd(),
		'src/lib/connection-diagnostics/events',
	);
	const files = [
		'types.ts',
		'snapshot.ts',
		'identity.ts',
		'prompt-format.ts',
		'saved-entry.ts',
		'ssh.ts',
		'auto-connect.ts',
		'manual.ts',
		'tailscale.ts',
		'reconnect.ts',
		'index.ts',
	];

	for (const file of files) {
		const source = readFileSync(join(root, file), 'utf8');
		const lineCount = source.split('\n').length;
		assert.ok(lineCount <= 800, `${file} has ${lineCount} lines`);
	}
});

void test('private key omission helper redacts PEM blocks only', () => {
	assert.equal(
		omitPrivateKeyMaterial('token=abc'),
		'token=abc',
	);
	assert.equal(
		omitPrivateKeyMaterial([
			'-----BEGIN PRIVATE KEY-----',
			'abc',
			'-----END PRIVATE KEY-----',
		].join('\n')),
		'[Private key material omitted]',
	);
});
```

- [ ] **Step 2: Run the shared event tests and verify they fail**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test test/integration/connection-diagnostic-shared-events.test.ts
```

Expected: FAIL with module resolution errors for
`../../src/lib/connection-diagnostics/events`.

- [ ] **Step 3: Create shared type primitives**

Create `apps/mobile/src/lib/connection-diagnostics/events/types.ts`:

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

export type ConnectionDiagnosticEventBase = {
	kind: string;
	source: ConnectionDiagnosticSource;
	message?: string;
};

export type TimedConnectionDiagnosticEvent<
	TEvent extends ConnectionDiagnosticEventBase,
> = TEvent & {
	atMs: number;
	elapsedMs: number;
};

export type ConnectionDiagnosticTraceOf<
	TEvent extends ConnectionDiagnosticEventBase,
> = {
	id: string;
	trigger: ConnectionDiagnosticTrigger;
	reason: string;
	status: ConnectionDiagnosticStatus;
	startedAtMs: number;
	finishedAtMs?: number;
	events: TimedConnectionDiagnosticEvent<TEvent>[];
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

export type ConnectionDiagnosticPromptOptions = {
	appState?: ConnectionDiagnosticAppState;
};
```

- [ ] **Step 4: Create the shared snapshot helper**

Create `apps/mobile/src/lib/connection-diagnostics/events/snapshot.ts`:

```ts
import { type ConnectionDiagnosticError } from './types';

const CIRCULAR_PLACEHOLDER = '[Circular]';
const UNREADABLE_VALUE_MESSAGE = '[Unreadable]';
const PRIVATE_KEY_OMITTED_MESSAGE = '[Private key material omitted]';
export const UNREADABLE_ERROR_MESSAGE = '[Unserializable error]';

const PRIVATE_KEY_BLOCK_PATTERN =
	/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gu;

export function omitPrivateKeyMaterial(value: string): string {
	return value.replace(PRIVATE_KEY_BLOCK_PATTERN, PRIVATE_KEY_OMITTED_MESSAGE);
}

export function safeDiagnosticString(
	value: unknown,
	fallback = UNREADABLE_ERROR_MESSAGE,
): string {
	try {
		if (typeof value === 'string') return omitPrivateKeyMaterial(value);
		if (typeof value === 'number' || typeof value === 'boolean') {
			return String(value);
		}
		if (typeof value === 'bigint') return `${value}n`;
		if (typeof value === 'symbol') return `[Symbol ${value.description ?? ''}]`;
		if (typeof value === 'undefined') return 'undefined';
		if (value === null) return 'null';
		return fallback;
	} catch {
		return fallback;
	}
}

function snapshotDiagnosticValueInternal(
	value: unknown,
	seen: WeakMap<object, unknown>,
): unknown {
	try {
		if (value === null) return null;
		if (
			typeof value === 'number' ||
			typeof value === 'boolean' ||
			typeof value === 'undefined'
		) {
			return value;
		}
		if (typeof value === 'string') return safeDiagnosticString(value);
		if (typeof value === 'bigint') return `${value}n`;
		if (typeof value === 'function') return '[Function]';
		if (typeof value === 'symbol') {
			return safeDiagnosticString(`[Symbol ${value.description ?? ''}]`);
		}
		if (typeof value !== 'object') return safeDiagnosticString(value);
		if (seen.has(value)) return CIRCULAR_PLACEHOLDER;

		if (Array.isArray(value)) {
			const copy: unknown[] = [];
			seen.set(value, copy);
			for (const item of value) {
				copy.push(snapshotDiagnosticValueInternal(item, seen));
			}
			return copy;
		}

		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			return UNREADABLE_VALUE_MESSAGE;
		}

		const copy: Record<string, unknown> = {};
		seen.set(value, copy);
		for (const key of Object.keys(value)) {
			try {
				copy[safeDiagnosticString(key, key)] =
					snapshotDiagnosticValueInternal(
						(value as Record<string, unknown>)[key],
						seen,
					);
			} catch {
				copy[safeDiagnosticString(key, key)] = UNREADABLE_VALUE_MESSAGE;
			}
		}
		return copy;
	} catch {
		return UNREADABLE_VALUE_MESSAGE;
	}
}

export function snapshotDiagnosticValue<T>(value: T): T {
	return snapshotDiagnosticValueInternal(value, new WeakMap()) as T;
}

function readObjectField(value: unknown, field: string): unknown {
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
	const fieldValue = readObjectField(value, field);
	return typeof fieldValue === 'string'
		? safeDiagnosticString(fieldValue)
		: undefined;
}

function isErrorLike(error: unknown): error is Error {
	try {
		return error instanceof Error;
	} catch {
		return false;
	}
}

export function serializeConnectionDiagnosticError(
	error: unknown,
): ConnectionDiagnosticError {
	const errorLike = isErrorLike(error);
	const name = readStringField(error, 'name');
	const message = readStringField(error, 'message');
	const tag = readStringField(error, 'tag');
	const inner = readObjectField(error, 'inner');
	const defaultName = errorLike ? 'Error' : 'NonError';

	if (
		errorLike ||
		name !== undefined ||
		message !== undefined ||
		tag !== undefined ||
		inner !== undefined
	) {
		const serializedError: ConnectionDiagnosticError = {
			name: name && name.length > 0 ? name : defaultName,
			message: message ?? tag ?? UNREADABLE_ERROR_MESSAGE,
		};
		const stack = readStringField(error, 'stack');
		if (stack !== undefined) serializedError.stack = stack;
		if (tag !== undefined) serializedError.tag = tag;
		if (inner !== undefined) {
			serializedError.inner = snapshotDiagnosticValue(inner);
		}
		return serializedError;
	}

	return {
		name: 'NonError',
		message: safeDiagnosticString(error),
	};
}
```

- [ ] **Step 5: Create the shared identity helper**

Create `apps/mobile/src/lib/connection-diagnostics/events/identity.ts`:

```ts
import {
	type ConnectionDiagnosticConnectionIdentity,
} from './types';

type SavedEntryDetails = {
	username: string;
	host: string;
	port: number;
	security: { keyId?: string };
	useTmux?: boolean;
	tmuxSessionName?: string;
};

type ActiveConnectionIdentityInput = {
	connectionId: string;
	connectionDetails: {
		username: string;
		host: string;
		port: number;
	};
};

const connectionIdentityCopyKeys = [
	'savedConnectionId',
	'connectionId',
	'username',
	'host',
	'port',
	'keyId',
	'useTmux',
	'tmuxSessionName',
] as const satisfies readonly (keyof ConnectionDiagnosticConnectionIdentity)[];

type ConnectionIdentityCopyKey = (typeof connectionIdentityCopyKeys)[number];
type ExactConnectionIdentityCopyKeys = [
	Exclude<
		keyof ConnectionDiagnosticConnectionIdentity,
		ConnectionIdentityCopyKey
	>,
	Exclude<
		ConnectionIdentityCopyKey,
		keyof ConnectionDiagnosticConnectionIdentity
	>,
] extends [never, never]
	? true
	: false;

const assertExactConnectionIdentityCopyKeys: ExactConnectionIdentityCopyKeys = true;

export function copyConnectionIdentity(
	connection: ConnectionDiagnosticConnectionIdentity,
): ConnectionDiagnosticConnectionIdentity {
	void assertExactConnectionIdentityCopyKeys;
	return Object.fromEntries(
		connectionIdentityCopyKeys.flatMap((key) => {
			const value = connection[key];
			return value === undefined ? [] : [[key, value]];
		}),
	) as ConnectionDiagnosticConnectionIdentity;
}

export function copyOptionalConnectionIdentity(
	connection: ConnectionDiagnosticConnectionIdentity | undefined,
): ConnectionDiagnosticConnectionIdentity | undefined {
	return connection === undefined ? undefined : copyConnectionIdentity(connection);
}

export function buildSavedEntryIdentity(
	id: string,
	details: SavedEntryDetails,
): ConnectionDiagnosticConnectionIdentity {
	return copyConnectionIdentity({
		savedConnectionId: id,
		username: details.username,
		host: details.host,
		port: details.port,
		keyId: details.security.keyId,
		useTmux: details.useTmux,
		tmuxSessionName: details.tmuxSessionName,
	});
}

export function buildActiveConnectionIdentity(
	input: ActiveConnectionIdentityInput,
): ConnectionDiagnosticConnectionIdentity {
	return copyConnectionIdentity({
		connectionId: input.connectionId,
		username: input.connectionDetails.username,
		host: input.connectionDetails.host,
		port: input.connectionDetails.port,
	});
}
```

- [ ] **Step 6: Create shared prompt formatting helpers**

Create `apps/mobile/src/lib/connection-diagnostics/events/prompt-format.ts`:

```ts
import {
	copyConnectionIdentity,
} from './identity';
import {
	omitPrivateKeyMaterial,
	safeDiagnosticString,
	snapshotDiagnosticValue,
} from './snapshot';
import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticError,
} from './types';

export function formatConnectionIdentity(
	connection: ConnectionDiagnosticConnectionIdentity | undefined,
): string {
	if (!connection) return 'unknown connection';
	const normalizedConnection = copyConnectionIdentity(connection);
	const username = normalizedConnection.username?.trim();
	const host = normalizedConnection.host?.trim();
	const port = normalizedConnection.port;
	const address =
		username && host && typeof port === 'number'
			? `${username}@${host}:${port}`
			: host;
	const parts = [
		address ? safeDiagnosticString(address) : null,
		normalizedConnection.savedConnectionId
			? `savedConnectionId=${safeDiagnosticString(
					normalizedConnection.savedConnectionId.trim(),
				)}`
			: null,
		normalizedConnection.connectionId
			? `connectionId=${safeDiagnosticString(
					normalizedConnection.connectionId.trim(),
				)}`
			: null,
		typeof normalizedConnection.useTmux === 'boolean'
			? `useTmux=${String(normalizedConnection.useTmux)}`
			: null,
		normalizedConnection.tmuxSessionName
			? `tmuxSessionName=${safeDiagnosticString(
					normalizedConnection.tmuxSessionName.trim(),
				)}`
			: null,
		normalizedConnection.keyId
			? `keyId=${safeDiagnosticString(normalizedConnection.keyId.trim())}`
			: null,
	];

	return parts.filter(Boolean).join(' | ') || 'unknown connection';
}

export function formatJsonInline(value: unknown): string {
	return JSON.stringify(snapshotDiagnosticValue(value), null, 2).replace(
		/\n/g,
		' ',
	);
}

export function formatDiagnosticError(
	error: ConnectionDiagnosticError | undefined,
): string | null {
	if (!error) return null;
	const parts = [
		`error=${safeDiagnosticString(error.name)}: ${safeDiagnosticString(
			error.message,
		)}`,
		error.tag ? `errorTag=${safeDiagnosticString(error.tag)}` : null,
		error.stack
			? `errorStack=${safeDiagnosticString(error.stack).replace(/\n/g, ' ')}`
			: null,
		error.inner !== undefined
			? `errorInner=${formatJsonInline(error.inner)}`
			: null,
	];
	return omitPrivateKeyMaterial(parts.filter(Boolean).join(' | '));
}

export type PromptField = string | null | undefined;

export function compactPromptFields(fields: PromptField[]): string[] {
	return fields.filter(
		(field): field is string => typeof field === 'string' && field.length > 0,
	);
}
```

- [ ] **Step 7: Create a temporary event barrel with shared exports**

Create `apps/mobile/src/lib/connection-diagnostics/events/index.ts`:

```ts
export * from './types';
export * from './snapshot';
export * from './identity';
export * from './prompt-format';

export const connectionDiagnosticEventKinds = [] as const;
export type ConnectionDiagnosticEvent = never;
export type ConnectionDiagnosticTimedEvent = never;
export type ConnectionDiagnosticTrace = never;
```

This temporary barrel is replaced in later tasks once domain modules exist.

- [ ] **Step 8: Run shared event tests and verify they pass**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test test/integration/connection-diagnostic-shared-events.test.ts
```

Expected: PASS for the shared tests. The file-size test passes because the
domain files do not exist yet only after Step 7 creates the folder with shared
files; if it fails on missing domain files, create empty domain files with
`export {};` and replace them in later tasks.

- [ ] **Step 9: Commit shared helpers**

Run:

```bash
git add \
  apps/mobile/src/lib/connection-diagnostics/events \
  apps/mobile/test/integration/connection-diagnostic-shared-events.test.ts
git commit -m "Add shared connection diagnostic event helpers"
```

## Task 2: Saved-Entry, Tailscale, And Reconnect Domain Events

**Files:**

- Create: `apps/mobile/src/lib/connection-diagnostics/events/saved-entry.ts`
- Create: `apps/mobile/src/lib/connection-diagnostics/events/tailscale.ts`
- Create: `apps/mobile/src/lib/connection-diagnostics/events/reconnect.ts`
- Modify: `apps/mobile/src/lib/connection-diagnostics/events/index.ts`
- Create: `apps/mobile/test/integration/connection-diagnostic-saved-entry-events.test.ts`
- Create: `apps/mobile/test/integration/connection-diagnostic-tailscale-events.test.ts`
- Create: `apps/mobile/test/integration/connection-diagnostic-reconnect-events.test.ts`

- [ ] **Step 1: Write failing saved-entry/tailscale/reconnect tests**

Create `apps/mobile/test/integration/connection-diagnostic-saved-entry-events.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	connectionDiagnosticEventKinds,
	savedEntryEvents,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';

void test('saved-entry constructors copy identity and key events', () => {
	const connection = {
		savedConnectionId: 'saved-1',
		host: 'dev.tailnet.ts.net',
		privateKey: 'must-not-copy',
	} as never;
	const selected = savedEntryEvents.selected({
		source: 'saved-entry',
		connection,
	});
	const keyMissing = savedEntryEvents.keyMissing({
		source: 'manual-diagnostic',
		connection,
	});

	assert.equal(selected.kind, 'saved-entry.selected');
	assert.deepEqual(selected.connection, {
		savedConnectionId: 'saved-1',
		host: 'dev.tailnet.ts.net',
	});
	assert.equal('privateKey' in selected.connection, false);
	assert.equal(keyMissing.kind, 'key.missing');
});
```

Create `apps/mobile/test/integration/connection-diagnostic-tailscale-events.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	connectionDiagnosticEventKinds,
	tailscaleDiagnosticEvents,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';

void test('tailscale events snapshot readiness and recovery results', () => {
	const ready = tailscaleDiagnosticEvents.ensureReadyResult({
		source: 'tailscale-recovery',
		platformOS: 'android',
		readiness: {
			kind: 'ready',
			attempted: false,
			available: true,
			extra: 'must-not-copy',
		} as never,
	});
	const recovery = tailscaleDiagnosticEvents.recoveryResult({
		source: 'tailscale-recovery',
		recoveryResult: {
			kind: 'recovered',
			attempted: true,
			networkLikeFailure: true,
			available: true,
			extra: 'must-not-copy',
		} as never,
	});

	const events: ConnectionDiagnosticEvent[] = [ready, recovery];
	assert.deepEqual(
		events.map((event) => event.kind),
		['tailscale.ensure-ready.result', 'tailscale.recovery.result'],
	);
	assert.equal('extra' in ready.readiness, false);
	assert.equal('extra' in recovery.recoveryResult, false);
	assert.ok(connectionDiagnosticEventKinds.includes('tailscale.recovery.result'));
});
```

Create `apps/mobile/test/integration/connection-diagnostic-reconnect-events.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	connectionDiagnosticEventKinds,
	reconnectEvents,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';

void test('reconnect constructors preserve reconnect-specific timing fields', () => {
	const started = reconnectEvents.started({
		source: 'reconnect-controller',
		reason: 'network-lost',
		windowMs: 30_000,
	});
	const attempt = reconnectEvents.attemptStarted({
		source: 'reconnect-controller',
		reconnectElapsedMs: 500,
	});
	const timeout = reconnectEvents.timeout({
		source: 'reconnect-controller',
		reconnectElapsedMs: 30_000,
		windowMs: 30_000,
	});

	const events: ConnectionDiagnosticEvent[] = [started, attempt, timeout];
	assert.deepEqual(
		events.map((event) => event.kind),
		[
			'reconnect.started',
			'reconnect.attempt.started',
			'reconnect.timeout',
		],
	);
	assert.equal(timeout.windowMs, 30_000);
	assert.equal(timeout.reconnectElapsedMs, 30_000);
	assert.ok(connectionDiagnosticEventKinds.includes('reconnect.timeout'));
});
```

- [ ] **Step 2: Run the domain tests and verify they fail**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/connection-diagnostic-saved-entry-events.test.ts \
  test/integration/connection-diagnostic-tailscale-events.test.ts \
  test/integration/connection-diagnostic-reconnect-events.test.ts
```

Expected: FAIL because `savedEntryEvents`, `tailscaleDiagnosticEvents`, and
`reconnectEvents` are not exported yet.

- [ ] **Step 3: Implement saved-entry events**

Create `apps/mobile/src/lib/connection-diagnostics/events/saved-entry.ts`:

```ts
import {
	copyConnectionIdentity,
	copyOptionalConnectionIdentity,
} from './identity';
import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticError,
	type ConnectionDiagnosticEventBase,
	type ConnectionDiagnosticSource,
} from './types';

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

export type SavedEntryEvent =
	| SavedEntrySelectedEvent
	| SavedEntryMissingEvent
	| SavedEntryInvalidTmuxSettingsEvent
	| KeyResolvedEvent
	| KeyMissingEvent;

export const savedEntryEventKinds = [
	'saved-entry.selected',
	'saved-entry.missing',
	'saved-entry.invalid-tmux-settings',
	'key.resolved',
	'key.missing',
] as const satisfies readonly SavedEntryEvent['kind'][];

export const savedEntryEvents = {
	selected: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		message?: string;
	}): SavedEntrySelectedEvent => ({
		kind: 'saved-entry.selected',
		source: input.source,
		message: input.message,
		connection: copyConnectionIdentity(input.connection),
	}),
	missing: (input: {
		source: ConnectionDiagnosticSource;
		message?: string;
	}): SavedEntryMissingEvent => ({
		kind: 'saved-entry.missing',
		source: input.source,
		message: input.message,
	}),
	invalidTmuxSettings: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		useTmuxType: string;
		tmuxSessionNameType: string;
		message?: string;
	}): SavedEntryInvalidTmuxSettingsEvent => ({
		kind: 'saved-entry.invalid-tmux-settings',
		source: input.source,
		message: input.message,
		connection: copyConnectionIdentity(input.connection),
		useTmuxType: input.useTmuxType,
		tmuxSessionNameType: input.tmuxSessionNameType,
	}),
	keyResolved: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		message?: string;
	}): KeyResolvedEvent => ({
		kind: 'key.resolved',
		source: input.source,
		message: input.message,
		connection: copyConnectionIdentity(input.connection),
	}),
	keyMissing: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		message?: string;
	}): KeyMissingEvent => ({
		kind: 'key.missing',
		source: input.source,
		message: input.message,
		connection: copyConnectionIdentity(input.connection),
	}),
};

export type SavedEntryResultEventBase = ConnectionDiagnosticEventBase & {
	connection?: ConnectionDiagnosticConnectionIdentity;
	error?: ConnectionDiagnosticError;
};

export const copySavedEntryConnection = copyOptionalConnectionIdentity;
```

- [ ] **Step 4: Implement tailscale events**

Create `apps/mobile/src/lib/connection-diagnostics/events/tailscale.ts`:

```ts
import {
	type TailscaleReadyResult,
	type TailscaleRecoverAfterFailureResult,
} from '../../tailscale-recovery-core';
import {
	type ConnectionDiagnosticEventBase,
	type ConnectionDiagnosticSource,
} from './types';

export type TailscaleEnsureReadyEvent = ConnectionDiagnosticEventBase & {
	kind: 'tailscale.ensure-ready.result';
	platformOS: string;
	readiness: TailscaleReadyResult;
};

export type TailscaleRecoveryResultEvent = ConnectionDiagnosticEventBase & {
	kind: 'tailscale.recovery.result';
	recoveryResult: TailscaleRecoverAfterFailureResult;
};

export type TailscaleDiagnosticEvent =
	| TailscaleEnsureReadyEvent
	| TailscaleRecoveryResultEvent;

export const tailscaleDiagnosticEventKinds = [
	'tailscale.ensure-ready.result',
	'tailscale.recovery.result',
] as const satisfies readonly TailscaleDiagnosticEvent['kind'][];

function copyReadyResult(readiness: TailscaleReadyResult): TailscaleReadyResult {
	switch (readiness.kind) {
		case 'unsupported':
		case 'unavailable':
		case 'ready':
		case 'cooldown':
		case 'notStarted':
		case 'failed':
			return {
				kind: readiness.kind,
				attempted: readiness.attempted,
				available: readiness.available,
			};
	}
}

function copyRecoveryResult(
	recoveryResult: TailscaleRecoverAfterFailureResult,
): TailscaleRecoverAfterFailureResult {
	switch (recoveryResult.kind) {
		case 'nonNetworkFailure':
		case 'unsupported':
		case 'unavailable':
		case 'cooldown':
		case 'notStarted':
		case 'preflightReady':
		case 'recovered':
		case 'failed':
			return {
				kind: recoveryResult.kind,
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
			};
	}
}

export const tailscaleDiagnosticEvents = {
	ensureReadyResult: (input: {
		source: ConnectionDiagnosticSource;
		platformOS: string;
		readiness: TailscaleReadyResult;
		message?: string;
	}): TailscaleEnsureReadyEvent => ({
		kind: 'tailscale.ensure-ready.result',
		source: input.source,
		message: input.message,
		platformOS: input.platformOS,
		readiness: copyReadyResult(input.readiness),
	}),
	recoveryResult: (input: {
		source: ConnectionDiagnosticSource;
		recoveryResult: TailscaleRecoverAfterFailureResult;
		message?: string;
	}): TailscaleRecoveryResultEvent => ({
		kind: 'tailscale.recovery.result',
		source: input.source,
		message: input.message,
		recoveryResult: copyRecoveryResult(input.recoveryResult),
	}),
};
```

- [ ] **Step 5: Implement reconnect events**

Create `apps/mobile/src/lib/connection-diagnostics/events/reconnect.ts`:

```ts
import {
	type ConnectionDiagnosticEventBase,
	type ConnectionDiagnosticSource,
} from './types';

export type ReconnectStartedEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.started';
	reason: string;
	windowMs: number;
};

export type ReconnectStoppedEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.stopped';
	reason: string;
};

export type ReconnectStartBlockedEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.start.blocked';
	reason: string;
	isAutoConnecting?: boolean;
	isReconnecting?: boolean;
	resetInFlight?: boolean;
};

export type ReconnectRetryScheduledEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.retry.scheduled';
	attemptIndex: number;
	delayMs: number;
};

export type ReconnectAttemptStartedEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.attempt.started';
	reconnectElapsedMs: number;
};

export type ReconnectAttemptConnectedEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.attempt.connected';
	reconnectElapsedMs: number;
};

export type ReconnectAttemptFailedEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.attempt.failed';
	reconnectElapsedMs: number;
};

export type ReconnectTimeoutEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.timeout';
	reconnectElapsedMs: number;
	windowMs: number;
};

export type ReconnectEvent =
	| ReconnectStartedEvent
	| ReconnectStoppedEvent
	| ReconnectStartBlockedEvent
	| ReconnectRetryScheduledEvent
	| ReconnectAttemptStartedEvent
	| ReconnectAttemptConnectedEvent
	| ReconnectAttemptFailedEvent
	| ReconnectTimeoutEvent;

export const reconnectEventKinds = [
	'reconnect.started',
	'reconnect.stopped',
	'reconnect.start.blocked',
	'reconnect.retry.scheduled',
	'reconnect.attempt.started',
	'reconnect.attempt.connected',
	'reconnect.attempt.failed',
	'reconnect.timeout',
] as const satisfies readonly ReconnectEvent['kind'][];

export const reconnectEvents = {
	started: (input: {
		source: ConnectionDiagnosticSource;
		reason: string;
		windowMs: number;
		message?: string;
	}): ReconnectStartedEvent => ({
		kind: 'reconnect.started',
		source: input.source,
		message: input.message,
		reason: input.reason,
		windowMs: input.windowMs,
	}),
	stopped: (input: {
		source: ConnectionDiagnosticSource;
		reason: string;
		message?: string;
	}): ReconnectStoppedEvent => ({
		kind: 'reconnect.stopped',
		source: input.source,
		message: input.message,
		reason: input.reason,
	}),
	startBlocked: (input: {
		source: ConnectionDiagnosticSource;
		reason: string;
		isAutoConnecting?: boolean;
		isReconnecting?: boolean;
		resetInFlight?: boolean;
		message?: string;
	}): ReconnectStartBlockedEvent => ({
		kind: 'reconnect.start.blocked',
		source: input.source,
		message: input.message,
		reason: input.reason,
		isAutoConnecting: input.isAutoConnecting,
		isReconnecting: input.isReconnecting,
		resetInFlight: input.resetInFlight,
	}),
	retryScheduled: (input: {
		source: ConnectionDiagnosticSource;
		attemptIndex: number;
		delayMs: number;
		message?: string;
	}): ReconnectRetryScheduledEvent => ({
		kind: 'reconnect.retry.scheduled',
		source: input.source,
		message: input.message,
		attemptIndex: input.attemptIndex,
		delayMs: input.delayMs,
	}),
	attemptStarted: (input: {
		source: ConnectionDiagnosticSource;
		reconnectElapsedMs: number;
		message?: string;
	}): ReconnectAttemptStartedEvent => ({
		kind: 'reconnect.attempt.started',
		source: input.source,
		message: input.message,
		reconnectElapsedMs: input.reconnectElapsedMs,
	}),
	attemptConnected: (input: {
		source: ConnectionDiagnosticSource;
		reconnectElapsedMs: number;
		message?: string;
	}): ReconnectAttemptConnectedEvent => ({
		kind: 'reconnect.attempt.connected',
		source: input.source,
		message: input.message,
		reconnectElapsedMs: input.reconnectElapsedMs,
	}),
	attemptFailed: (input: {
		source: ConnectionDiagnosticSource;
		reconnectElapsedMs: number;
		message?: string;
	}): ReconnectAttemptFailedEvent => ({
		kind: 'reconnect.attempt.failed',
		source: input.source,
		message: input.message,
		reconnectElapsedMs: input.reconnectElapsedMs,
	}),
	timeout: (input: {
		source: ConnectionDiagnosticSource;
		reconnectElapsedMs: number;
		windowMs: number;
		message?: string;
	}): ReconnectTimeoutEvent => ({
		kind: 'reconnect.timeout',
		source: input.source,
		message: input.message,
		reconnectElapsedMs: input.reconnectElapsedMs,
		windowMs: input.windowMs,
	}),
};
```

- [ ] **Step 6: Assemble the event union in the barrel**

Replace `apps/mobile/src/lib/connection-diagnostics/events/index.ts` with:

```ts
export * from './types';
export * from './snapshot';
export * from './identity';
export * from './prompt-format';
export * from './saved-entry';
export * from './tailscale';
export * from './reconnect';

import {
	type SavedEntryEvent,
	savedEntryEventKinds,
	savedEntryEvents,
} from './saved-entry';
import {
	type ReconnectEvent,
	reconnectEventKinds,
	reconnectEvents,
} from './reconnect';
import {
	type TailscaleDiagnosticEvent,
	tailscaleDiagnosticEventKinds,
	tailscaleDiagnosticEvents,
} from './tailscale';
import {
	type ConnectionDiagnosticEventBase,
	type ConnectionDiagnosticTraceOf,
	type TimedConnectionDiagnosticEvent,
} from './types';

export type ConnectionDiagnosticEvent =
	| SavedEntryEvent
	| TailscaleDiagnosticEvent
	| ReconnectEvent;

export type ConnectionDiagnosticTimedEvent =
	TimedConnectionDiagnosticEvent<ConnectionDiagnosticEvent>;

export type ConnectionDiagnosticTrace =
	ConnectionDiagnosticTraceOf<ConnectionDiagnosticEvent>;

export const connectionDiagnosticEventKinds = [
	...savedEntryEventKinds,
	...tailscaleDiagnosticEventKinds,
	...reconnectEventKinds,
] as const satisfies readonly ConnectionDiagnosticEvent['kind'][];

export const diagnosticEvents = {
	savedEntrySelected: savedEntryEvents.selected,
	savedEntryMissing: savedEntryEvents.missing,
	savedEntryInvalidTmuxSettings: savedEntryEvents.invalidTmuxSettings,
	keyResolved: savedEntryEvents.keyResolved,
	keyMissing: savedEntryEvents.keyMissing,
	tailscaleEnsureReadyResult: tailscaleDiagnosticEvents.ensureReadyResult,
	tailscaleRecoveryResult: tailscaleDiagnosticEvents.recoveryResult,
	reconnect: (input: ReconnectEvent): ReconnectEvent => input,
} satisfies Record<string, (...args: never[]) => ConnectionDiagnosticEventBase>;

export {
	savedEntryEvents,
	tailscaleDiagnosticEvents,
	reconnectEvents,
};
```

This barrel keeps the old `diagnosticEvents` names available while domain call
sites are migrated.

- [ ] **Step 7: Run domain tests**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/connection-diagnostic-saved-entry-events.test.ts \
  test/integration/connection-diagnostic-tailscale-events.test.ts \
  test/integration/connection-diagnostic-reconnect-events.test.ts \
  test/integration/connection-diagnostic-shared-events.test.ts
```

Expected: PASS after TypeScript import paths and `diagnosticEvents` typing are
consistent with the new event barrel.

- [ ] **Step 8: Commit the first domain split**

Run:

```bash
git add \
  apps/mobile/src/lib/connection-diagnostics/events \
  apps/mobile/test/integration/connection-diagnostic-saved-entry-events.test.ts \
  apps/mobile/test/integration/connection-diagnostic-tailscale-events.test.ts \
  apps/mobile/test/integration/connection-diagnostic-reconnect-events.test.ts
git commit -m "Split shared diagnostic event domains"
```

## Task 3: SSH, Manual, And Auto-Connect Event Domains

**Files:**

- Create: `apps/mobile/src/lib/connection-diagnostics/events/ssh.ts`
- Create: `apps/mobile/src/lib/connection-diagnostics/events/manual.ts`
- Create: `apps/mobile/src/lib/connection-diagnostics/events/auto-connect.ts`
- Modify: `apps/mobile/src/lib/connection-diagnostics/events/index.ts`
- Create: `apps/mobile/test/integration/connection-diagnostic-ssh-events.test.ts`
- Create: `apps/mobile/test/integration/connection-diagnostic-manual-events.test.ts`
- Create: `apps/mobile/test/integration/connection-diagnostic-auto-connect-events.test.ts`

- [ ] **Step 1: Write failing SSH/manual/auto-connect domain tests**

Create `apps/mobile/test/integration/connection-diagnostic-ssh-events.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	connectionDiagnosticEventKinds,
	sshEvents,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';

void test('ssh constructors snapshot connection and error fields', () => {
	const connection = {
		connectionId: 'conn-1',
		host: 'dev.tailnet.ts.net',
		privateKey: 'must-not-copy',
	} as never;
	const failed = sshEvents.connectFailed({
		source: 'saved-entry',
		connection,
		error: {
			name: 'Error',
			message: 'connect failed',
			secret: 'must-not-copy',
		} as never,
	});
	const shell = sshEvents.shellConnected({
		source: 'active-connection',
		connection,
		channelId: 7,
		storedConnectionId: 'stored-1',
	});

	const events: ConnectionDiagnosticEvent[] = [failed, shell];
	assert.deepEqual(
		events.map((event) => event.kind),
		['ssh.connect.failed', 'ssh.shell.connected'],
	);
	assert.equal('privateKey' in failed.connection, false);
	assert.equal('secret' in failed.error, false);
	assert.ok(connectionDiagnosticEventKinds.includes('ssh.shell.connected'));
});
```

Create `apps/mobile/test/integration/connection-diagnostic-manual-events.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	connectionDiagnosticEventKinds,
	manualDiagnosticEvents,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';

void test('manual diagnostic constructors produce manual-domain events', () => {
	const timeout = manualDiagnosticEvents.timeout({
		timeoutMs: 60_000,
		message: 'Connection diagnostic timed out after 60000ms',
	});
	const failed = manualDiagnosticEvents.failed({
		source: 'manual-diagnostic',
		error: { name: 'Error', message: 'failed' },
	});
	const missing = manualDiagnosticEvents.savedEntryMissing({
		source: 'manual-diagnostic',
		message: 'No eligible saved connection',
	});

	const events: ConnectionDiagnosticEvent[] = [timeout, failed, missing];
	assert.deepEqual(
		events.map((event) => event.kind),
		[
			'manual-diagnostic.timeout',
			'manual-diagnostic.failed',
			'manual-diagnostic.saved-entry.missing',
		],
	);
	assert.ok(connectionDiagnosticEventKinds.includes('manual-diagnostic.failed'));
});
```

Create `apps/mobile/test/integration/connection-diagnostic-auto-connect-events.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	autoConnectEvents,
	connectionDiagnosticEventKinds,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';

void test('auto-connect constructors produce caller-owned saved-entry events', () => {
	const selected = autoConnectEvents.latestShellSelected({
		source: 'latest-shell',
		connection: { connectionId: 'conn-1' },
		channelId: 3,
		pathname: '/shell/detail',
	});
	const connected = autoConnectEvents.savedEntryConnectConnected({
		source: 'saved-entry',
		connection: { savedConnectionId: 'saved-1' },
		connectionId: 'conn-2',
		channelId: 4,
		storedConnectionId: 'stored-2',
	});
	const failed = autoConnectEvents.savedEntryConnectFailed({
		source: 'saved-entry',
		connection: { savedConnectionId: 'saved-1' },
	});

	const events: ConnectionDiagnosticEvent[] = [selected, connected, failed];
	assert.deepEqual(
		events.map((event) => event.kind),
		[
			'auto-connect.latest-shell.selected',
			'auto-connect.saved-entry.connect.connected',
			'auto-connect.saved-entry.connect.failed',
		],
	);
	assert.ok(
		connectionDiagnosticEventKinds.includes(
			'auto-connect.saved-entry.connect.connected',
		),
	);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/connection-diagnostic-ssh-events.test.ts \
  test/integration/connection-diagnostic-manual-events.test.ts \
  test/integration/connection-diagnostic-auto-connect-events.test.ts
```

Expected: FAIL because the domain modules and exports do not exist.

- [ ] **Step 3: Implement SSH events**

Create `apps/mobile/src/lib/connection-diagnostics/events/ssh.ts` by moving
the existing SSH event type shapes from
`apps/mobile/src/lib/connection-diagnostic-events.ts` and using this constructor
pattern:

```ts
import { copyConnectionIdentity } from './identity';
import { serializeConnectionDiagnosticError } from './snapshot';
import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticError,
	type ConnectionDiagnosticEventBase,
	type ConnectionDiagnosticSource,
} from './types';

export type SshConnectStartedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.connect.started';
	connection: ConnectionDiagnosticConnectionIdentity;
};

export type SshConnectFailedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.connect.failed';
	connection: ConnectionDiagnosticConnectionIdentity;
	error: ConnectionDiagnosticError;
};

export type SshShellConnectedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.shell.connected';
	connection: ConnectionDiagnosticConnectionIdentity;
	channelId: number;
	storedConnectionId: string;
};

export type SshDiagnosticEvent =
	| SshConnectStartedEvent
	| SshConnectFailedEvent
	| SshShellConnectedEvent;

export const sshEventKinds = [
	'ssh.connect.started',
	'ssh.connect.failed',
	'ssh.shell.connected',
] as const satisfies readonly SshDiagnosticEvent['kind'][];

export const sshEvents = {
	connectStarted: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		message?: string;
	}): SshConnectStartedEvent => ({
		kind: 'ssh.connect.started',
		source: input.source,
		message: input.message,
		connection: copyConnectionIdentity(input.connection),
	}),
	connectFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		error: unknown;
		message?: string;
	}): SshConnectFailedEvent => ({
		kind: 'ssh.connect.failed',
		source: input.source,
		message: input.message,
		connection: copyConnectionIdentity(input.connection),
		error: serializeConnectionDiagnosticError(input.error),
	}),
	shellConnected: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		channelId: number;
		storedConnectionId: string;
		message?: string;
	}): SshShellConnectedEvent => ({
		kind: 'ssh.shell.connected',
		source: input.source,
		message: input.message,
		connection: copyConnectionIdentity(input.connection),
		channelId: input.channelId,
		storedConnectionId: input.storedConnectionId,
	}),
};
```

Before running Step 7, add these SSH events from the current file to the same
module:

- `ssh.connect.progress`
- `ssh.connect.connected`
- `ssh.shell.started`
- `ssh.shell.failed`
- `ssh.shell.tmux-attach-failed`
- `ssh.diagnostic.disconnected`
- `ssh.diagnostic.disconnect-failed`

Use the same constructor style: copy connection identity, serialize unknown
errors inside the constructor, and export all event kinds in `sshEventKinds`.

- [ ] **Step 4: Implement manual events**

Create `apps/mobile/src/lib/connection-diagnostics/events/manual.ts`:

```ts
import { copyConnectionIdentity } from './identity';
import { serializeConnectionDiagnosticError } from './snapshot';
import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticError,
	type ConnectionDiagnosticEventBase,
	type ConnectionDiagnosticSource,
} from './types';

export type ManualDiagnosticSavedEntryMissingEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'manual-diagnostic.saved-entry.missing';
	};

export type ManualDiagnosticTimeoutEvent = ConnectionDiagnosticEventBase & {
	kind: 'manual-diagnostic.timeout';
	source: 'manual-diagnostic';
	message: string;
	timeoutMs: number;
};

export type ManualDiagnosticFailedEvent = ConnectionDiagnosticEventBase & {
	kind: 'manual-diagnostic.failed';
	error: ConnectionDiagnosticError;
};

export type ManualDiagnosticTmuxAttachFailedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'manual-diagnostic.tmux-attach-failed';
		connection: ConnectionDiagnosticConnectionIdentity;
		tmuxAttachFailureReason: string | null;
	};

export type ManualDiagnosticEvent =
	| ManualDiagnosticSavedEntryMissingEvent
	| ManualDiagnosticTimeoutEvent
	| ManualDiagnosticFailedEvent
	| ManualDiagnosticTmuxAttachFailedEvent;

export const manualDiagnosticEventKinds = [
	'manual-diagnostic.saved-entry.missing',
	'manual-diagnostic.timeout',
	'manual-diagnostic.failed',
	'manual-diagnostic.tmux-attach-failed',
] as const satisfies readonly ManualDiagnosticEvent['kind'][];

export const manualDiagnosticEvents = {
	savedEntryMissing: (input: {
		source: ConnectionDiagnosticSource;
		message?: string;
	}): ManualDiagnosticSavedEntryMissingEvent => ({
		kind: 'manual-diagnostic.saved-entry.missing',
		source: input.source,
		message: input.message,
	}),
	timeout: (input: {
		timeoutMs: number;
		message: string;
	}): ManualDiagnosticTimeoutEvent => ({
		kind: 'manual-diagnostic.timeout',
		source: 'manual-diagnostic',
		timeoutMs: input.timeoutMs,
		message: input.message,
	}),
	failed: (input: {
		source: ConnectionDiagnosticSource;
		error: unknown;
		message?: string;
	}): ManualDiagnosticFailedEvent => ({
		kind: 'manual-diagnostic.failed',
		source: input.source,
		message: input.message,
		error: serializeConnectionDiagnosticError(input.error),
	}),
	tmuxAttachFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		tmuxAttachFailureReason: string | null;
		message?: string;
	}): ManualDiagnosticTmuxAttachFailedEvent => ({
		kind: 'manual-diagnostic.tmux-attach-failed',
		source: input.source,
		message: input.message,
		connection: copyConnectionIdentity(input.connection),
		tmuxAttachFailureReason: input.tmuxAttachFailureReason,
	}),
};
```

Then add `manual-diagnostic.tailscale.attention`,
`manual-diagnostic.tailscale.attention-cleared`, and
`manual-diagnostic.warning` from the current event file if existing call sites
still use them.

- [ ] **Step 5: Implement auto-connect events**

Create `apps/mobile/src/lib/connection-diagnostics/events/auto-connect.ts` by
moving current `AutoConnect*` event types and constructors from
`connection-diagnostic-events.ts`. Use this exact constructor pattern:

```ts
import {
	copyConnectionIdentity,
	copyOptionalConnectionIdentity,
} from './identity';
import { serializeConnectionDiagnosticError } from './snapshot';
import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticError,
	type ConnectionDiagnosticEventBase,
	type ConnectionDiagnosticSource,
} from './types';

export type AutoConnectLatestShellSelectedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.latest-shell.selected';
		connection: ConnectionDiagnosticConnectionIdentity;
		channelId: number;
		pathname: string;
	};

export type AutoConnectSavedEntryConnectConnectedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.saved-entry.connect.connected';
		connection: ConnectionDiagnosticConnectionIdentity;
		connectionId: string;
		channelId: number;
		storedConnectionId?: string;
	};

export type AutoConnectSavedEntryConnectFailedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.saved-entry.connect.failed';
		connection?: ConnectionDiagnosticConnectionIdentity;
		connectionId?: string;
		storedConnectionId?: string;
	};

export type AutoConnectEvent =
	| AutoConnectLatestShellSelectedEvent
	| AutoConnectSavedEntryConnectConnectedEvent
	| AutoConnectSavedEntryConnectFailedEvent;

export const autoConnectEventKinds = [
	'auto-connect.latest-shell.selected',
	'auto-connect.saved-entry.connect.connected',
	'auto-connect.saved-entry.connect.failed',
] as const satisfies readonly AutoConnectEvent['kind'][];

export const autoConnectEvents = {
	latestShellSelected: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		channelId: number;
		pathname: string;
		message?: string;
	}): AutoConnectLatestShellSelectedEvent => ({
		kind: 'auto-connect.latest-shell.selected',
		source: input.source,
		message: input.message,
		connection: copyConnectionIdentity(input.connection),
		channelId: input.channelId,
		pathname: input.pathname,
	}),
	savedEntryConnectConnected: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		connectionId: string;
		channelId: number;
		storedConnectionId?: string;
		message?: string;
	}): AutoConnectSavedEntryConnectConnectedEvent => ({
		kind: 'auto-connect.saved-entry.connect.connected',
		source: input.source,
		message: input.message,
		connection: copyConnectionIdentity(input.connection),
		connectionId: input.connectionId,
		channelId: input.channelId,
		storedConnectionId: input.storedConnectionId,
	}),
	savedEntryConnectFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection?: ConnectionDiagnosticConnectionIdentity;
		connectionId?: string;
		storedConnectionId?: string;
		message?: string;
	}): AutoConnectSavedEntryConnectFailedEvent => ({
		kind: 'auto-connect.saved-entry.connect.failed',
		source: input.source,
		message: input.message,
		connection: copyOptionalConnectionIdentity(input.connection),
		connectionId: input.connectionId,
		storedConnectionId: input.storedConnectionId,
	}),
};
```

Before running Step 7, add these current auto-connect events to the same module:

- `auto-connect.latest-shell.missing`
- `auto-connect.active-connection.selected`
- `auto-connect.active-connection.missing`
- `auto-connect.active-connection.shell-started`
- `auto-connect.active-connection.shell-connected`
- `auto-connect.active-connection.shell-failed`
- `auto-connect.active-connection.tmux-attach-failed`
- `auto-connect.saved-entry.connect.started`
- `auto-connect.saved-entry.connect.threw`
- `auto-connect.saved-entry.connect.tmux-attach-failed`
- `auto-connect.saved-entry.retry.started`
- `auto-connect.saved-entry.retry.threw`

- [ ] **Step 6: Assemble all domains in the barrel**

Update `apps/mobile/src/lib/connection-diagnostics/events/index.ts` so it
exports all domain modules, includes all event types in `ConnectionDiagnosticEvent`,
and maps old `diagnosticEvents.*` names to the new grouped constructors.

Required `diagnosticEvents` compatibility names:

```ts
export const diagnosticEvents = {
	savedEntrySelected: savedEntryEvents.selected,
	savedEntryMissing: savedEntryEvents.missing,
	savedEntryInvalidTmuxSettings: savedEntryEvents.invalidTmuxSettings,
	keyResolved: savedEntryEvents.keyResolved,
	keyMissing: savedEntryEvents.keyMissing,
	sshConnectStarted: sshEvents.connectStarted,
	sshConnectProgress: sshEvents.connectProgress,
	sshConnectConnected: sshEvents.connectConnected,
	sshConnectFailed: sshEvents.connectFailed,
	sshShellStarted: sshEvents.shellStarted,
	sshShellConnected: sshEvents.shellConnected,
	sshShellFailed: sshEvents.shellFailed,
	sshShellTmuxAttachFailed: sshEvents.shellTmuxAttachFailed,
	diagnosticDisconnected: sshEvents.diagnosticDisconnected,
	diagnosticDisconnectFailed: sshEvents.diagnosticDisconnectFailed,
	tailscaleEnsureReadyResult: tailscaleDiagnosticEvents.ensureReadyResult,
	tailscaleRecoveryResult: tailscaleDiagnosticEvents.recoveryResult,
	reconnect: reconnectEvents.fromEvent,
	manualDiagnosticSavedEntryMissing: manualDiagnosticEvents.savedEntryMissing,
	manualDiagnosticTailscaleAttention: manualDiagnosticEvents.tailscaleAttention,
	manualDiagnosticTailscaleAttentionCleared:
		manualDiagnosticEvents.tailscaleAttentionCleared,
	manualDiagnosticTmuxAttachFailed: manualDiagnosticEvents.tmuxAttachFailed,
	manualDiagnosticWarning: manualDiagnosticEvents.warning,
	manualDiagnosticTimeout: manualDiagnosticEvents.timeout,
	manualDiagnosticFailed: manualDiagnosticEvents.failed,
	autoConnectLatestShellSelected: autoConnectEvents.latestShellSelected,
	autoConnectLatestShellMissing: autoConnectEvents.latestShellMissing,
	autoConnectActiveConnectionSelected:
		autoConnectEvents.activeConnectionSelected,
	autoConnectActiveConnectionMissing: autoConnectEvents.activeConnectionMissing,
	autoConnectActiveConnectionShellStarted:
		autoConnectEvents.activeConnectionShellStarted,
	autoConnectActiveConnectionShellConnected:
		autoConnectEvents.activeConnectionShellConnected,
	autoConnectActiveConnectionShellFailed:
		autoConnectEvents.activeConnectionShellFailed,
	autoConnectActiveConnectionTmuxAttachFailed:
		autoConnectEvents.activeConnectionTmuxAttachFailed,
	autoConnectSavedEntryConnectStarted:
		autoConnectEvents.savedEntryConnectStarted,
	autoConnectSavedEntryConnectConnected:
		autoConnectEvents.savedEntryConnectConnected,
	autoConnectSavedEntryConnectFailed: autoConnectEvents.savedEntryConnectFailed,
	autoConnectSavedEntryConnectThrew: autoConnectEvents.savedEntryConnectThrew,
	autoConnectSavedEntryConnectTmuxAttachFailed:
		autoConnectEvents.savedEntryConnectTmuxAttachFailed,
	autoConnectSavedEntryRetryStarted: autoConnectEvents.savedEntryRetryStarted,
	autoConnectSavedEntryRetryThrew: autoConnectEvents.savedEntryRetryThrew,
};
```

- [ ] **Step 7: Run all domain event tests**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/connection-diagnostic-shared-events.test.ts \
  test/integration/connection-diagnostic-tailscale-events.test.ts \
  test/integration/connection-diagnostic-reconnect-events.test.ts \
  test/integration/connection-diagnostic-ssh-events.test.ts \
  test/integration/connection-diagnostic-manual-events.test.ts \
  test/integration/connection-diagnostic-auto-connect-events.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit full event domain split**

Run:

```bash
git add \
  apps/mobile/src/lib/connection-diagnostics/events \
  apps/mobile/test/integration/connection-diagnostic-ssh-events.test.ts \
  apps/mobile/test/integration/connection-diagnostic-manual-events.test.ts \
  apps/mobile/test/integration/connection-diagnostic-auto-connect-events.test.ts
git commit -m "Split diagnostic event domains"
```

## Task 4: Compatibility Barrels And Recorder Without Legacy Normalization

**Files:**

- Modify: `apps/mobile/src/lib/connection-diagnostic-types.ts`
- Modify: `apps/mobile/src/lib/connection-diagnostics.ts`
- Modify: `apps/mobile/src/lib/connection-diagnostic-recorder.ts`
- Delete: `apps/mobile/src/lib/connection-diagnostic-normalization.ts`
- Delete: `apps/mobile/src/lib/connection-diagnostic-redaction.ts`
- Test: `apps/mobile/test/integration/connection-diagnostic-recorder.test.ts`

- [ ] **Step 1: Add failing recorder assertions for no legacy normalization**

In `apps/mobile/test/integration/connection-diagnostic-recorder.test.ts`, add:

```ts
void test('recorder stores typed events without legacy normalization', () => {
	let now = 1000;
	const recorder = createConnectionDiagnosticRecorder({ now: () => now });
	const trace = recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'typed events only',
	});

	now = 1030;
	const event = trace.event(
		diagnosticEvents.savedEntryMissing({
			source: 'manual-diagnostic',
			message: 'No saved entry',
		}),
	);
	trace.finish('skipped');

	assert.equal(event.kind, 'saved-entry.missing');
	assert.equal(event.elapsedMs, 30);
	assert.equal('type' in event, false);
	assert.equal('details' in event, false);
	assert.deepEqual(recorder.getHistory()[0]?.events, [event]);
});
```

Delete any recorder tests that pass casted `{ type: string }` events to
`trace.event`.

- [ ] **Step 2: Run recorder tests and verify they fail**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test test/integration/connection-diagnostic-recorder.test.ts
```

Expected: FAIL until imports and type barrels point at the new event folder.

- [ ] **Step 3: Replace compatibility type file**

Replace `apps/mobile/src/lib/connection-diagnostic-types.ts` with:

```ts
import {
	type ConnectionDiagnosticEvent,
	type ConnectionDiagnosticTimedEvent,
	type ConnectionDiagnosticTrace,
} from './connection-diagnostics/events';
export type {
	ConnectionDiagnosticAppState,
	ConnectionDiagnosticConnectionIdentity,
	ConnectionDiagnosticError,
	ConnectionDiagnosticEvent,
	ConnectionDiagnosticPromptOptions,
	ConnectionDiagnosticSource,
	ConnectionDiagnosticStatus,
	ConnectionDiagnosticTimedEvent,
	ConnectionDiagnosticTrace,
	ConnectionDiagnosticTrigger,
} from './connection-diagnostics/events';

export type ConnectionDiagnosticTraceHandle = {
	readonly trace: ConnectionDiagnosticTrace;
	event: (input: ConnectionDiagnosticEvent) => ConnectionDiagnosticTimedEvent;
	finish: (
		status: Exclude<
			import('./connection-diagnostics/events').ConnectionDiagnosticStatus,
			'running'
		>,
	) => void;
};

export type ConnectionDiagnosticRecorder = {
	startTrace: (input: {
		trigger: import('./connection-diagnostics/events').ConnectionDiagnosticTrigger;
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
```

- [ ] **Step 4: Replace compatibility barrel exports**

Update `apps/mobile/src/lib/connection-diagnostics.ts`:

```ts
export * from './connection-diagnostics/events';
export {
	createConnectionDiagnosticRecorder,
	connectionDiagnosticRecorder,
} from './connection-diagnostic-recorder';
export { formatConnectionDiagnosticPrompt } from './connection-diagnostic-prompt';
```

- [ ] **Step 5: Update recorder imports and timestamping**

In `apps/mobile/src/lib/connection-diagnostic-recorder.ts`, import from the new
folder:

```ts
import {
	manualDiagnosticEvents,
	safeDiagnosticString,
	snapshotDiagnosticValue,
	type ConnectionDiagnosticEvent,
	type ConnectionDiagnosticRecorder,
	type ConnectionDiagnosticRecorderOptions,
	type ConnectionDiagnosticSource,
	type ConnectionDiagnosticTimedEvent,
	type ConnectionDiagnosticTrace,
} from './connection-diagnostics/events';
```

Use this timestamp helper:

```ts
function timestampEvent(input: {
	event: ConnectionDiagnosticEvent;
	startedAtMs: number;
	atMs: number;
}): ConnectionDiagnosticTimedEvent {
	try {
		return snapshotDiagnosticValue({
			...input.event,
			atMs: input.atMs,
			elapsedMs: input.atMs - input.startedAtMs,
		});
	} catch {
		const fallbackEvent = manualDiagnosticEvents.warning({
			source: readEventSource(input.event),
			message: 'Connection diagnostic event could not be recorded',
			error: {
				name: 'ConnectionDiagnosticRecorderError',
				message: 'Unable to clone typed diagnostic event',
			},
		});
		return snapshotDiagnosticValue({
			...fallbackEvent,
			atMs: input.atMs,
			elapsedMs: input.atMs - input.startedAtMs,
		});
	}
}
```

Replace all `cloneDiagnosticValue` calls with `snapshotDiagnosticValue`.

- [ ] **Step 6: Remove legacy normalization and old redaction modules**

Delete:

```bash
rm apps/mobile/src/lib/connection-diagnostic-normalization.ts
rm apps/mobile/src/lib/connection-diagnostic-redaction.ts
```

Run:

```bash
rg -n "connection-diagnostic-normalization|connection-diagnostic-redaction|normalizeLegacy|normalizeTimedConnectionDiagnosticEvent|cloneDiagnosticValue" apps/mobile/src apps/mobile/test
```

Expected: no matches for deleted modules or legacy normalization. Matches for
`snapshotDiagnosticValue` are expected.

- [ ] **Step 7: Run recorder and domain tests**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/connection-diagnostic-recorder.test.ts \
  test/integration/connection-diagnostic-shared-events.test.ts \
  test/integration/connection-diagnostic-ssh-events.test.ts \
  test/integration/connection-diagnostic-manual-events.test.ts \
  test/integration/connection-diagnostic-auto-connect-events.test.ts \
  test/integration/connection-diagnostic-tailscale-events.test.ts \
  test/integration/connection-diagnostic-reconnect-events.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit recorder/type migration**

Run:

```bash
git add \
  apps/mobile/src/lib/connection-diagnostic-types.ts \
  apps/mobile/src/lib/connection-diagnostics.ts \
  apps/mobile/src/lib/connection-diagnostic-recorder.ts \
  apps/mobile/src/lib/connection-diagnostics/events \
  apps/mobile/test/integration/connection-diagnostic-recorder.test.ts
git rm apps/mobile/src/lib/connection-diagnostic-normalization.ts \
  apps/mobile/src/lib/connection-diagnostic-redaction.ts
git commit -m "Move recorder to typed diagnostic event modules"
```

## Task 5: Domain-Delegated Prompt Formatting

**Files:**

- Modify: `apps/mobile/src/lib/connection-diagnostic-prompt.ts`
- Modify: domain modules under `apps/mobile/src/lib/connection-diagnostics/events/*.ts`
- Test: `apps/mobile/test/integration/connection-diagnostic-prompt.test.ts`

- [ ] **Step 1: Add failing prompt delegation test**

In `apps/mobile/test/integration/connection-diagnostic-prompt.test.ts`, add:

```ts
void test('prompt renders fields through domain formatters', () => {
	const trace = createTrace([
		{
			...autoConnectEvents.savedEntryConnectConnected({
				source: 'saved-entry',
				connection: { savedConnectionId: 'saved-1' },
				connectionId: 'connection-1',
				channelId: 9,
				storedConnectionId: 'stored-1',
			}),
			atMs: 110,
			elapsedMs: 10,
		},
		{
			...tailscaleDiagnosticEvents.recoveryResult({
				source: 'tailscale-recovery',
				recoveryResult: {
					kind: 'recovered',
					attempted: true,
					networkLikeFailure: true,
					available: true,
				},
			}),
			atMs: 120,
			elapsedMs: 20,
		},
	]);

	const prompt = formatConnectionDiagnosticPrompt(trace);

	assert.match(prompt, /auto-connect.saved-entry.connect.connected/);
	assert.match(prompt, /connectionId=connection-1/);
	assert.match(prompt, /channelId=9/);
	assert.match(prompt, /storedConnectionId=stored-1/);
	assert.match(prompt, /tailscale.recovery.result/);
	assert.match(prompt, /recoveryResult=/);
});
```

Use the file's existing trace helper if one exists. If the helper is named
differently, update this test to call the local helper already used by the file.

- [ ] **Step 2: Run prompt tests and verify they fail**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test test/integration/connection-diagnostic-prompt.test.ts
```

Expected: FAIL until prompt imports use the new modules and domain formatters
exist.

- [ ] **Step 3: Add formatter exports to each domain**

In each domain module, export a formatter with this signature:

```ts
export function formatAutoConnectEventFields(
	event: AutoConnectEvent,
): string[] {
	switch (event.kind) {
		case 'auto-connect.saved-entry.connect.connected':
			return compactPromptFields([
				`connectionId=${safeDiagnosticString(event.connectionId)}`,
				`channelId=${event.channelId}`,
				event.storedConnectionId
					? `storedConnectionId=${safeDiagnosticString(
							event.storedConnectionId,
						)}`
					: null,
			]);
		case 'auto-connect.saved-entry.connect.failed':
			return compactPromptFields([
				event.connectionId
					? `connectionId=${safeDiagnosticString(event.connectionId)}`
					: null,
				event.storedConnectionId
					? `storedConnectionId=${safeDiagnosticString(
							event.storedConnectionId,
						)}`
					: null,
			]);
		default:
			return [];
	}
}
```

Add these formatter functions for the other domains:

- `formatSavedEntryEventFields`
- `formatSshEventFields`
- `formatManualDiagnosticEventFields`
- `formatTailscaleDiagnosticEventFields`
- `formatReconnectEventFields`

Domain formatters should import from `./prompt-format` and `./snapshot`, not
from `connection-diagnostic-prompt.ts`.

- [ ] **Step 4: Replace prompt's event-specific switch with delegation**

In `apps/mobile/src/lib/connection-diagnostic-prompt.ts`, delete the import of
`normalizeLegacyTraceForPrompt`.

Use this dispatcher:

```ts
function formatEventSpecifics(event: ConnectionDiagnosticTimedEvent): string[] {
	if (event.kind.startsWith('auto-connect.')) {
		return formatAutoConnectEventFields(event as AutoConnectEvent);
	}
	if (event.kind.startsWith('ssh.')) {
		return formatSshEventFields(event as SshDiagnosticEvent);
	}
	if (event.kind.startsWith('manual-diagnostic.')) {
		return formatManualDiagnosticEventFields(event as ManualDiagnosticEvent);
	}
	if (event.kind.startsWith('tailscale.')) {
		return formatTailscaleDiagnosticEventFields(
			event as TailscaleDiagnosticEvent,
		);
	}
	if (event.kind.startsWith('reconnect.')) {
		return formatReconnectEventFields(event as ReconnectEvent);
	}
	if (event.kind.startsWith('saved-entry.') || event.kind.startsWith('key.')) {
		return formatSavedEntryEventFields(event as SavedEntryEvent);
	}
	return [];
}
```

Keep the cast local to the dispatcher. Do not add casts at call sites.

- [ ] **Step 5: Remove trace normalization from prompt entry**

In `formatConnectionDiagnosticPrompt`, replace:

```ts
const safeTrace = normalizeLegacyTraceForPrompt(trace);
```

with:

```ts
const safeTrace = trace;
```

Remove tests that assert old `type` aliases render in prompts.

- [ ] **Step 6: Run prompt tests**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/connection-diagnostic-prompt.test.ts \
  test/integration/connection-diagnostic-shared-events.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit prompt delegation**

Run:

```bash
git add \
  apps/mobile/src/lib/connection-diagnostic-prompt.ts \
  apps/mobile/src/lib/connection-diagnostics/events \
  apps/mobile/test/integration/connection-diagnostic-prompt.test.ts
git commit -m "Delegate diagnostic prompt formatting by domain"
```

## Task 6: Decouple Shared Saved-Entry Recovery From Diagnostics

**Files:**

- Modify: `apps/mobile/src/lib/auto-connect-saved-entry.ts`
- Modify: `apps/mobile/src/lib/auto-connect-attempt.ts`
- Modify: `apps/mobile/src/lib/connection-diagnostic-runner.ts`
- Test: `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`
- Test: `apps/mobile/test/integration/auto-connect-attempt.test.ts`
- Test: `apps/mobile/test/integration/connection-diagnostic-runner.test.ts`

- [ ] **Step 1: Add failing test that shared recovery emits no events**

In `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`, add:

```ts
void test('saved-entry recovery helper returns outcomes without trace events', async () => {
	const events: unknown[] = [];
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
		connectSavedEntry: async () => ({
			status: 'connected',
			connectionId: 'connection-1',
			channelId: 3,
		}),
		onEvent: (event) => events.push(event),
	});

	assert.equal(result.status, 'connected');
	assert.deepEqual(events, []);
});
```

- [ ] **Step 2: Run saved-entry tests and verify they fail**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-saved-entry.test.ts
```

Expected: FAIL because `attemptSavedEntryWithTailscaleRecovery` still emits
diagnostic events through `onEvent`.

- [ ] **Step 3: Remove diagnostics from shared recovery args**

In `apps/mobile/src/lib/auto-connect-saved-entry.ts`, remove:

```ts
onEvent?: (event: ConnectionDiagnosticEvent) => void;
```

from `AttemptSavedEntryWithTailscaleRecoveryArgs`.

Delete `SavedEntryTrace`, local `emitTrace`, and all `traceEvent(...)` calls.
Return the same `SavedEntryRecoveryOutcome` statuses.

- [ ] **Step 4: Add outcome metadata required by callers**

Ensure `SavedEntryRecoveryOutcome` still includes enough data for callers:

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
```

- [ ] **Step 5: Map outcomes to auto-connect events in auto-connect caller**

In `apps/mobile/src/lib/auto-connect-attempt.ts`, remove `onEvent: traceEvent`
from the recovery call and emit events before/after the helper call:

```ts
traceEvent(
	autoConnectEvents.savedEntryConnectStarted({
		source: 'saved-entry',
		connection: latestEntryConnection,
	}),
);
const result = await attemptSavedEntryWithTailscaleRecovery({
	platformOS,
	recovery,
	connectSavedEntry,
	shouldRecoverAfterFailure: () => true,
});
```

For `result.status === 'connected'`, emit:

```ts
traceEvent(
	autoConnectEvents.savedEntryConnectConnected({
		source: 'saved-entry',
		connection: latestEntryConnection,
		connectionId: result.result.connectionId,
		channelId: result.result.channelId,
	}),
);
```

For Tailscale readiness/recovery visibility, emit explicit events in the caller
around the helper only if the helper exposes those results in outcomes. Do not
reintroduce an `onEvent` callback into the shared helper.

- [ ] **Step 6: Map outcomes to manual diagnostic events in manual runner**

In `apps/mobile/src/lib/connection-diagnostic-runner.ts`, remove `onEvent:
(event) => safeTraceEvent(traceHandle, event)` from the recovery call. Emit
manual-domain events around the saved-entry attempt:

```ts
safeTraceEvent(
	traceHandle,
	manualDiagnosticEvents.savedEntryProbeStarted({
		source: 'manual-diagnostic',
		connection,
	}),
);
```

If `manualDiagnosticEvents.savedEntryProbeStarted` does not exist yet, add it
to `manual.ts` with kind `manual-diagnostic.saved-entry.probe-started`.

When the result is `tmuxAttachFailed`, emit
`manualDiagnosticEvents.tmuxAttachFailed(...)`.

- [ ] **Step 7: Run recovery and diagnostic runner tests**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/auto-connect-saved-entry.test.ts \
  test/integration/auto-connect-attempt.test.ts \
  test/integration/connection-diagnostic-runner.test.ts
```

Expected: PASS after expected event sequences are updated to caller-owned
events.

- [ ] **Step 8: Commit recovery decoupling**

Run:

```bash
git add \
  apps/mobile/src/lib/auto-connect-saved-entry.ts \
  apps/mobile/src/lib/auto-connect-attempt.ts \
  apps/mobile/src/lib/connection-diagnostic-runner.ts \
  apps/mobile/src/lib/connection-diagnostics/events \
  apps/mobile/test/integration/auto-connect-saved-entry.test.ts \
  apps/mobile/test/integration/auto-connect-attempt.test.ts \
  apps/mobile/test/integration/connection-diagnostic-runner.test.ts
git commit -m "Decouple saved-entry recovery from diagnostic events"
```

## Task 7: Migrate Call Sites To Domain Constructors

**Files:**

- Modify: `apps/mobile/src/lib/auto-connect-attempt.ts`
- Modify: `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`
- Modify: `apps/mobile/src/lib/connect-and-open-shell.ts`
- Modify: `apps/mobile/src/lib/connection-debug-command.ts`
- Modify: `apps/mobile/src/lib/connection-diagnostic-runner.ts`
- Modify: `apps/mobile/src/lib/diagnostic-shell-probe.ts`
- Modify: `apps/mobile/src/lib/ssh-shell-lifecycle.ts`
- Modify: tests covering those files

- [ ] **Step 1: Replace imports in auto-connect and reconnect code**

Replace:

```ts
import { diagnosticEvents } from './connection-diagnostic-events';
```

with grouped imports from the barrel:

```ts
import {
	autoConnectEvents,
	reconnectEvents,
	savedEntryEvents,
	tailscaleDiagnosticEvents,
} from './connection-diagnostics/events';
```

Use grouped constructors at call sites:

```ts
savedEntryEvents.selected({ source: 'saved-entry', connection });
autoConnectEvents.activeConnectionMissing({ source: 'active-connection' });
reconnectEvents.retryScheduled({
	source: 'reconnect-controller',
	attemptIndex,
	delayMs,
});
```

- [ ] **Step 2: Replace imports in SSH/manual diagnostic code**

Replace diagnostic imports in SSH and manual diagnostic modules with:

```ts
import {
	manualDiagnosticEvents,
	savedEntryEvents,
	sshEvents,
	tailscaleDiagnosticEvents,
} from './connection-diagnostics/events';
```

Use grouped constructors at call sites:

```ts
sshEvents.connectFailed({
	source: 'saved-entry',
	connection,
	error,
});
manualDiagnosticEvents.timeout({
	timeoutMs: error.timeoutMs,
	message: error.message,
});
```

- [ ] **Step 3: Run an import scan**

Run:

```bash
rg -n "connection-diagnostic-events|diagnosticEvents\\." apps/mobile/src apps/mobile/test
```

Expected: no source imports from `connection-diagnostic-events`. Remaining
`diagnosticEvents.` matches are allowed only in compatibility tests until the
old giant event test is deleted in Task 8.

- [ ] **Step 4: Run changed call-site tests**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/auto-connect-attempt.test.ts \
  test/integration/auto-connect-reconnect-controller.test.ts \
  test/integration/auto-connect-saved-entry.test.ts \
  test/integration/connect-and-open-shell-diagnostics.test.ts \
  test/integration/diagnostic-shell-probe.test.ts \
  test/integration/connection-diagnostic-runner.test.ts \
  test/integration/connection-debug-command.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit call-site migration**

Run:

```bash
git add \
  apps/mobile/src/lib/auto-connect-attempt.ts \
  apps/mobile/src/lib/auto-connect-reconnect-controller.ts \
  apps/mobile/src/lib/connect-and-open-shell.ts \
  apps/mobile/src/lib/connection-debug-command.ts \
  apps/mobile/src/lib/connection-diagnostic-runner.ts \
  apps/mobile/src/lib/diagnostic-shell-probe.ts \
  apps/mobile/src/lib/ssh-shell-lifecycle.ts \
  apps/mobile/test/integration
git commit -m "Use domain diagnostic event constructors"
```

## Task 8: Delete The Giant Event Module And Split Tests

**Files:**

- Delete: `apps/mobile/src/lib/connection-diagnostic-events.ts`
- Delete: `apps/mobile/test/integration/connection-diagnostic-events.test.ts`
- Modify: `apps/mobile/test/integration/connection-diagnostics.test.ts`
- Modify: `apps/mobile/test/integration/connection-diagnostic-shared-events.test.ts`
- Modify: domain event tests

- [ ] **Step 1: Move unique assertions from the giant event test**

For each assertion still unique in
`apps/mobile/test/integration/connection-diagnostic-events.test.ts`, move it to
the owning domain test:

- saved-entry/key assertions -> `connection-diagnostic-saved-entry-events.test.ts`
- SSH assertions -> `connection-diagnostic-ssh-events.test.ts`
- auto-connect assertions -> `connection-diagnostic-auto-connect-events.test.ts`
- manual assertions -> `connection-diagnostic-manual-events.test.ts`
- reconnect assertions -> `connection-diagnostic-reconnect-events.test.ts`
- copy/snapshot assertions -> `connection-diagnostic-shared-events.test.ts`

Use explicit tests like:

```ts
void test('exported event kind list covers every public event union member', () => {
	type KnownKind = (typeof connectionDiagnosticEventKinds)[number];
	type ExactKindCoverage = [
		Exclude<ConnectionDiagnosticEvent['kind'], KnownKind>,
		Exclude<KnownKind, ConnectionDiagnosticEvent['kind']>,
	] extends [never, never]
		? true
		: false;
	const assertExactKindCoverage: ExactKindCoverage = true;
	assert.equal(assertExactKindCoverage, true);
});
```

- [ ] **Step 2: Delete the giant event module and old test**

Run:

```bash
git rm apps/mobile/src/lib/connection-diagnostic-events.ts
git rm apps/mobile/test/integration/connection-diagnostic-events.test.ts
```

- [ ] **Step 3: Run deletion scans**

Run:

```bash
rg -n "connection-diagnostic-events|normalizeLegacy|legacyTypeAliases|connectionDiagnosticEventKinds = new Set" apps/mobile/src apps/mobile/test
```

Expected: no matches for deleted module, legacy normalization, alias table, or
the old local kind set. Matches for the new exported
`connectionDiagnosticEventKinds` array are expected.

- [ ] **Step 4: Run diagnostic tests**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/connection-diagnostic-shared-events.test.ts \
  test/integration/connection-diagnostic-saved-entry-events.test.ts \
  test/integration/connection-diagnostic-ssh-events.test.ts \
  test/integration/connection-diagnostic-auto-connect-events.test.ts \
  test/integration/connection-diagnostic-manual-events.test.ts \
  test/integration/connection-diagnostic-tailscale-events.test.ts \
  test/integration/connection-diagnostic-reconnect-events.test.ts \
  test/integration/connection-diagnostic-recorder.test.ts \
  test/integration/connection-diagnostic-prompt.test.ts \
  test/integration/connection-diagnostic-runner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit event module deletion**

Run:

```bash
git add apps/mobile/test/integration
git commit -m "Remove monolithic diagnostic event module"
```

## Task 9: Full Verification And Maintainability Checks

**Files:**

- Modify only if checks expose issues in files changed by earlier tasks.

- [ ] **Step 1: Run focused diagnostics test set**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/connection-diagnostic-shared-events.test.ts \
  test/integration/connection-diagnostic-ssh-events.test.ts \
  test/integration/connection-diagnostic-auto-connect-events.test.ts \
  test/integration/connection-diagnostic-manual-events.test.ts \
  test/integration/connection-diagnostic-tailscale-events.test.ts \
  test/integration/connection-diagnostic-reconnect-events.test.ts \
  test/integration/connection-diagnostic-recorder.test.ts \
  test/integration/connection-diagnostic-prompt.test.ts \
  test/integration/connection-diagnostic-runner.test.ts \
  test/integration/connection-debug-command.test.ts \
  test/integration/connection-diagnostic-delivery.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run broader connection/Tailscale integration slice**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/diagnostic-shell-probe.test.ts \
  test/integration/connection-storage.test.ts \
  test/integration/shell-detail-workmux-control-channel.test.ts \
  test/integration/auto-connect.test.ts \
  test/integration/auto-connect-saved-entry.test.ts \
  test/integration/auto-connect-attempt.test.ts \
  test/integration/connect-and-open-shell-diagnostics.test.ts \
  test/integration/tailscale-recovery-banner.test.ts \
  test/integration/tailscale-recovery-core.test.ts \
  test/integration/auto-connect-reconnect-controller.test.ts \
  test/integration/tailscale-recovery-actions.test.ts \
  test/integration/tailscale-native-core.test.ts \
  test/integration/tailscale-recovery.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS.

- [ ] **Step 4: Run formatting check**

Run:

```bash
pnpm exec prettier --check \
  apps/mobile/src/lib/connection-diagnostics/events \
  apps/mobile/src/lib/connection-diagnostic-types.ts \
  apps/mobile/src/lib/connection-diagnostics.ts \
  apps/mobile/src/lib/connection-diagnostic-recorder.ts \
  apps/mobile/src/lib/connection-diagnostic-prompt.ts \
  apps/mobile/src/lib/auto-connect-saved-entry.ts \
  apps/mobile/src/lib/auto-connect-attempt.ts \
  apps/mobile/src/lib/connection-diagnostic-runner.ts \
  apps/mobile/test/integration/connection-diagnostic-*.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run lint check and record current blocker if unchanged**

Run:

```bash
pnpm --filter @fressh/mobile lint:check
```

Expected: either PASS, or the known ESLint config loading failure:
`could not find plugin "@typescript-eslint"` for
`@typescript-eslint/no-explicit-any`. If that config error remains, do not fix
it in this branch; record it in the final summary.

- [ ] **Step 6: Run maintainability scans**

Run:

```bash
wc -l apps/mobile/src/lib/connection-diagnostics/events/*.ts | sort -nr
rg -n "connection-diagnostic-events|connection-diagnostic-normalization|connection-diagnostic-redaction|normalizeLegacy|legacyTypeAliases|details:" apps/mobile/src apps/mobile/test
rg -n "as unknown|as any" apps/mobile/src/lib/connection-diagnostics apps/mobile/src/lib/connection-diagnostic-*.ts
```

Expected:

- no diagnostics event source file over 800 lines
- no imports of deleted diagnostic modules
- no legacy normalization terms
- casts limited to prompt dispatcher or test fixtures

- [ ] **Step 7: Commit verification fixes**

If verification required code/test changes, commit them:

```bash
git add apps/mobile/src apps/mobile/test/integration
git commit -m "Verify connection diagnostics architecture cleanup"
```

If verification required no changes, skip this commit and mention that the
previous task commit is the final implementation commit.

## Self-Review Notes

- Spec coverage:
  - domain-owned modules: Tasks 2, 3, and 8
  - no legacy trace compatibility: Tasks 4, 5, and 8
  - canonical snapshot/redaction helper: Task 1
  - canonical identity helper: Task 1 and Task 7
  - saved-entry recovery decoupling: Task 6
  - smaller files and guard: Task 1 and Task 9
  - focused domain tests: Tasks 2, 3, and 8
- Type consistency:
  - `ConnectionDiagnosticEvent`, `ConnectionDiagnosticTimedEvent`, and
    `ConnectionDiagnosticTrace` come from
    `apps/mobile/src/lib/connection-diagnostics/events/index.ts`.
  - Old imports continue through compatibility files until call sites migrate.
  - Domain constructor names are grouped as `savedEntryEvents`, `sshEvents`,
    `autoConnectEvents`, `manualDiagnosticEvents`,
    `tailscaleDiagnosticEvents`, and `reconnectEvents`.
- Scope control:
  - No UI behavior changes.
  - No new command behavior.
  - No persistent trace storage.
  - No ESLint config repair inside this cleanup.
