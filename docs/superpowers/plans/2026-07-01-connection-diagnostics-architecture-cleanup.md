# Connection Diagnostics Architecture Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make connection diagnostics smaller and easier to reason about by deleting the monolithic event module, deleting legacy trace normalization, and moving diagnostic event ownership into focused domain modules.

**Architecture:** Build a small `connection-diagnostics/events/` package with shared `types`, `snapshot`, and `identity` helpers plus coarse domain modules for saved-entry, SSH, auto-connect, manual diagnostics, Tailscale, and reconnect. Keep compatibility through the existing `connection-diagnostics.ts` barrel while migrating, but remove the old `diagnosticEvents` compatibility object before the branch is done. Shared saved-entry recovery returns outcomes only; callers own their diagnostic events.

**Tech Stack:** TypeScript, Expo React Native mobile app, Node `tsx --test`, pnpm, Prettier, current mobile integration test harness.

---

## Design Guardrails

This plan intentionally avoids building a diagnostics framework.

- Keep domain modules coarse and readable. A cohesive 300-500 line file is better than many tiny indirection files.
- No schema DSL, generated types, decorator-style registry, or runtime event framework.
- No long-lived `diagnosticEvents` compatibility layer. A temporary shim is allowed only while migrating imports and must be deleted in Task 6.
- No placeholder files to satisfy tests. File-size guard lands after the event files exist.
- No legacy trace compatibility. Delete `connection-diagnostic-normalization.ts` and all `type` alias tests.
- Prefer deleting concepts over preserving two APIs.

## File Structure

Create:

- `apps/mobile/src/lib/connection-diagnostics/events/types.ts`
  - shared source/status/trace/event primitive types
- `apps/mobile/src/lib/connection-diagnostics/events/snapshot.ts`
  - one JSON-safe snapshot helper, private-key omission, and error serialization
- `apps/mobile/src/lib/connection-diagnostics/events/identity.ts`
  - canonical saved-entry and active-connection identity builders
- `apps/mobile/src/lib/connection-diagnostics/events/prompt-format.ts`
  - shared prompt helper functions
- `apps/mobile/src/lib/connection-diagnostics/events/saved-entry.ts`
- `apps/mobile/src/lib/connection-diagnostics/events/ssh.ts`
- `apps/mobile/src/lib/connection-diagnostics/events/auto-connect.ts`
- `apps/mobile/src/lib/connection-diagnostics/events/manual.ts`
- `apps/mobile/src/lib/connection-diagnostics/events/tailscale.ts`
- `apps/mobile/src/lib/connection-diagnostics/events/reconnect.ts`
- `apps/mobile/src/lib/connection-diagnostics/events/index.ts`

Modify:

- `apps/mobile/src/lib/connection-diagnostic-types.ts`
- `apps/mobile/src/lib/connection-diagnostics.ts`
- `apps/mobile/src/lib/connection-diagnostic-recorder.ts`
- `apps/mobile/src/lib/connection-diagnostic-prompt.ts`
- `apps/mobile/src/lib/auto-connect-saved-entry.ts`
- `apps/mobile/src/lib/auto-connect-attempt.ts`
- `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`
- `apps/mobile/src/lib/connection-diagnostic-runner.ts`
- `apps/mobile/src/lib/connect-and-open-shell.ts`
- `apps/mobile/src/lib/diagnostic-shell-probe.ts`
- `apps/mobile/src/lib/ssh-shell-lifecycle.ts`

Replace:

- `apps/mobile/test/integration/connection-diagnostic-events.test.ts`

with focused tests:

- `apps/mobile/test/integration/connection-diagnostic-shared-events.test.ts`
- `apps/mobile/test/integration/connection-diagnostic-saved-entry-events.test.ts`
- `apps/mobile/test/integration/connection-diagnostic-ssh-events.test.ts`
- `apps/mobile/test/integration/connection-diagnostic-auto-connect-events.test.ts`
- `apps/mobile/test/integration/connection-diagnostic-manual-events.test.ts`
- `apps/mobile/test/integration/connection-diagnostic-tailscale-events.test.ts`
- `apps/mobile/test/integration/connection-diagnostic-reconnect-events.test.ts`

Delete by the end:

- `apps/mobile/src/lib/connection-diagnostic-events.ts`
- `apps/mobile/src/lib/connection-diagnostic-normalization.ts`
- `apps/mobile/src/lib/connection-diagnostic-redaction.ts`
- `apps/mobile/test/integration/connection-diagnostic-events.test.ts`

## Task 1: Shared Helpers And First Domain Slice

**Files:**

- Create: `apps/mobile/src/lib/connection-diagnostics/events/types.ts`
- Create: `apps/mobile/src/lib/connection-diagnostics/events/snapshot.ts`
- Create: `apps/mobile/src/lib/connection-diagnostics/events/identity.ts`
- Create: `apps/mobile/src/lib/connection-diagnostics/events/prompt-format.ts`
- Create: `apps/mobile/src/lib/connection-diagnostics/events/saved-entry.ts`
- Create: `apps/mobile/src/lib/connection-diagnostics/events/index.ts`
- Create: `apps/mobile/test/integration/connection-diagnostic-shared-events.test.ts`
- Create: `apps/mobile/test/integration/connection-diagnostic-saved-entry-events.test.ts`

- [ ] **Step 1: Write failing shared helper tests**

Create `apps/mobile/test/integration/connection-diagnostic-shared-events.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildActiveConnectionIdentity,
	buildSavedEntryIdentity,
	copyConnectionIdentity,
	omitPrivateKeyMaterial,
	serializeConnectionDiagnosticError,
	snapshotDiagnosticValue,
} from '../../src/lib/connection-diagnostics/events';

void test('identity helpers copy only diagnostic-safe connection fields', () => {
	const saved = buildSavedEntryIdentity('saved-1', {
		username: 'muly',
		host: 'dev.tailnet.ts.net',
		port: 22,
		security: { keyId: 'key-1', privateKey: 'private' },
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
	const value: { nested?: unknown; key: string; token: string } = {
		token: 'token=abc stays for personal diagnostics',
		key: [
			'-----BEGIN OPENSSH PRIVATE KEY-----',
			'secret-key-body',
			'-----END OPENSSH PRIVATE KEY-----',
		].join('\n'),
	};
	value.nested = value;

	const serialized = JSON.stringify(snapshotDiagnosticValue(value));

	assert.doesNotMatch(serialized, /secret-key-body/);
	assert.match(serialized, /Private key material omitted/);
	assert.match(serialized, /Circular/);
	assert.match(serialized, /token=abc stays/);
});

void test('error serializer keeps useful fields and omits private key material', () => {
	const error = serializeConnectionDiagnosticError({
		name: 'SshError',
		message: [
			'failed',
			'-----BEGIN RSA PRIVATE KEY-----',
			'secret',
			'-----END RSA PRIVATE KEY-----',
		].join('\n'),
		tag: 'ssh-connect',
		inner: { code: 'ECONNRESET' },
		secret: 'must-not-copy',
	});

	assert.equal(error.name, 'SshError');
	assert.equal(error.tag, 'ssh-connect');
	assert.doesNotMatch(error.message, /secret/);
	assert.equal('secret' in error, false);
	assert.deepEqual(error.inner, { code: 'ECONNRESET' });
});

void test('private key omission helper redacts PEM blocks only', () => {
	assert.equal(omitPrivateKeyMaterial('token=abc'), 'token=abc');
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

- [ ] **Step 2: Write failing saved-entry event tests**

Create `apps/mobile/test/integration/connection-diagnostic-saved-entry-events.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	connectionDiagnosticEventKinds,
	savedEntryEvents,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';

void test('saved-entry events copy identity and expose typed kinds', () => {
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
	const missing = savedEntryEvents.missing({
		source: 'saved-entry',
		message: 'No saved entry',
	});

	const events: ConnectionDiagnosticEvent[] = [selected, keyMissing, missing];
	assert.deepEqual(
		events.map((event) => event.kind),
		['saved-entry.selected', 'key.missing', 'saved-entry.missing'],
	);
	assert.equal('privateKey' in selected.connection, false);
	assert.ok(connectionDiagnosticEventKinds.includes('saved-entry.selected'));
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/connection-diagnostic-shared-events.test.ts \
  test/integration/connection-diagnostic-saved-entry-events.test.ts
```

Expected: FAIL with module resolution errors for
`../../src/lib/connection-diagnostics/events`.

- [ ] **Step 4: Implement shared helpers and saved-entry domain**

Create the files listed in this task. Move existing type definitions from
`connection-diagnostic-types.ts` and copy/snapshot behavior from
`connection-diagnostic-redaction.ts`, but keep only one implementation in
`snapshot.ts`.

Required exports from `apps/mobile/src/lib/connection-diagnostics/events/index.ts`:

```ts
export * from './types';
export * from './snapshot';
export * from './identity';
export * from './prompt-format';
export * from './saved-entry';

import {
	type SavedEntryEvent,
	savedEntryEventKinds,
	savedEntryEvents,
} from './saved-entry';
import {
	type ConnectionDiagnosticTraceOf,
	type TimedConnectionDiagnosticEvent,
} from './types';

export type ConnectionDiagnosticEvent = SavedEntryEvent;
export type ConnectionDiagnosticTimedEvent =
	TimedConnectionDiagnosticEvent<ConnectionDiagnosticEvent>;
export type ConnectionDiagnosticTrace =
	ConnectionDiagnosticTraceOf<ConnectionDiagnosticEvent>;

export const connectionDiagnosticEventKinds = [
	...savedEntryEventKinds,
] as const satisfies readonly ConnectionDiagnosticEvent['kind'][];

export { savedEntryEvents };
```

`saved-entry.ts` must export `savedEntryEvents.selected`,
`savedEntryEvents.missing`, `savedEntryEvents.invalidTmuxSettings`,
`savedEntryEvents.keyResolved`, and `savedEntryEvents.keyMissing`.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/connection-diagnostic-shared-events.test.ts \
  test/integration/connection-diagnostic-saved-entry-events.test.ts
```

Expected: PASS.

Commit:

```bash
git add \
  apps/mobile/src/lib/connection-diagnostics/events \
  apps/mobile/test/integration/connection-diagnostic-shared-events.test.ts \
  apps/mobile/test/integration/connection-diagnostic-saved-entry-events.test.ts
git commit -m "Add shared diagnostic event helpers"
```

## Task 2: Move Remaining Event Domains

**Files:**

- Create: `apps/mobile/src/lib/connection-diagnostics/events/ssh.ts`
- Create: `apps/mobile/src/lib/connection-diagnostics/events/auto-connect.ts`
- Create: `apps/mobile/src/lib/connection-diagnostics/events/manual.ts`
- Create: `apps/mobile/src/lib/connection-diagnostics/events/tailscale.ts`
- Create: `apps/mobile/src/lib/connection-diagnostics/events/reconnect.ts`
- Modify: `apps/mobile/src/lib/connection-diagnostics/events/index.ts`
- Create: domain event tests listed in File Structure

- [ ] **Step 1: Write focused domain tests**

Create one test per domain. Use these minimum assertions:

```ts
// apps/mobile/test/integration/connection-diagnostic-ssh-events.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	connectionDiagnosticEventKinds,
	sshEvents,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';

void test('ssh events snapshot connection and error fields', () => {
	const failed = sshEvents.connectFailed({
		source: 'saved-entry',
		connection: {
			connectionId: 'conn-1',
			host: 'dev.tailnet.ts.net',
			privateKey: 'must-not-copy',
		} as never,
		error: { name: 'Error', message: 'connect failed', secret: 'no' } as never,
	});
	const connected = sshEvents.shellConnected({
		source: 'active-connection',
		connection: { connectionId: 'conn-1' },
		channelId: 7,
		storedConnectionId: 'stored-1',
	});
	const events: ConnectionDiagnosticEvent[] = [failed, connected];

	assert.deepEqual(
		events.map((event) => event.kind),
		['ssh.connect.failed', 'ssh.shell.connected'],
	);
	assert.equal('privateKey' in failed.connection, false);
	assert.equal('secret' in failed.error, false);
	assert.ok(connectionDiagnosticEventKinds.includes('ssh.shell.connected'));
});
```

```ts
// apps/mobile/test/integration/connection-diagnostic-auto-connect-events.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	autoConnectEvents,
	connectionDiagnosticEventKinds,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';

void test('auto-connect events own auto-connect saved-entry vocabulary', () => {
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
	const events: ConnectionDiagnosticEvent[] = [selected, connected];

	assert.deepEqual(
		events.map((event) => event.kind),
		[
			'auto-connect.latest-shell.selected',
			'auto-connect.saved-entry.connect.connected',
		],
	);
	assert.ok(
		connectionDiagnosticEventKinds.includes(
			'auto-connect.saved-entry.connect.connected',
		),
	);
});
```

```ts
// apps/mobile/test/integration/connection-diagnostic-manual-events.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	manualDiagnosticEvents,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';

void test('manual diagnostic events stay in the manual domain', () => {
	const timeout = manualDiagnosticEvents.timeout({
		timeoutMs: 60_000,
		message: 'Connection diagnostic timed out after 60000ms',
	});
	const failed = manualDiagnosticEvents.failed({
		source: 'manual-diagnostic',
		error: { name: 'Error', message: 'failed' },
	});
	const events: ConnectionDiagnosticEvent[] = [timeout, failed];

	assert.deepEqual(
		events.map((event) => event.kind),
		['manual-diagnostic.timeout', 'manual-diagnostic.failed'],
	);
});
```

```ts
// apps/mobile/test/integration/connection-diagnostic-tailscale-events.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	tailscaleDiagnosticEvents,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';

void test('tailscale events copy readiness and recovery result shapes', () => {
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
});
```

```ts
// apps/mobile/test/integration/connection-diagnostic-reconnect-events.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	reconnectEvents,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';

void test('reconnect events keep reconnect-specific timing fields', () => {
	const started = reconnectEvents.started({
		source: 'reconnect-controller',
		reason: 'network-lost',
		windowMs: 30_000,
	});
	const timeout = reconnectEvents.timeout({
		source: 'reconnect-controller',
		reconnectElapsedMs: 30_000,
		windowMs: 30_000,
	});
	const events: ConnectionDiagnosticEvent[] = [started, timeout];

	assert.deepEqual(
		events.map((event) => event.kind),
		['reconnect.started', 'reconnect.timeout'],
	);
	assert.equal(timeout.reconnectElapsedMs, 30_000);
	assert.equal(timeout.windowMs, 30_000);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/connection-diagnostic-saved-entry-events.test.ts \
  test/integration/connection-diagnostic-ssh-events.test.ts \
  test/integration/connection-diagnostic-auto-connect-events.test.ts \
  test/integration/connection-diagnostic-manual-events.test.ts \
  test/integration/connection-diagnostic-tailscale-events.test.ts \
  test/integration/connection-diagnostic-reconnect-events.test.ts
```

Expected: FAIL because the new domain exports are not implemented.

- [ ] **Step 3: Implement domain modules by moving current shapes**

Move event type definitions and constructor logic out of
`connection-diagnostic-events.ts` into the matching domain modules.

Required constructor groups:

- `sshEvents`
  - `connectStarted`, `connectProgress`, `connectConnected`, `connectFailed`
  - `shellStarted`, `shellConnected`, `shellFailed`, `shellTmuxAttachFailed`
  - `diagnosticDisconnected`, `diagnosticDisconnectFailed`
- `autoConnectEvents`
  - `latestShellSelected`, `latestShellMissing`
  - `activeConnectionSelected`, `activeConnectionMissing`
  - `activeConnectionShellStarted`, `activeConnectionShellConnected`
  - `activeConnectionShellFailed`, `activeConnectionTmuxAttachFailed`
  - `savedEntryConnectStarted`, `savedEntryConnectConnected`
  - `savedEntryConnectFailed`, `savedEntryConnectThrew`
  - `savedEntryConnectTmuxAttachFailed`
  - `savedEntryRetryStarted`, `savedEntryRetryThrew`
- `manualDiagnosticEvents`
  - `savedEntryMissing`, `tailscaleAttention`, `tailscaleAttentionCleared`
  - `tmuxAttachFailed`, `warning`, `timeout`, `failed`
- `tailscaleDiagnosticEvents`
  - `ensureReadyResult`, `recoveryResult`
- `reconnectEvents`
  - `started`, `stopped`, `startBlocked`, `retryScheduled`
  - `attemptStarted`, `attemptConnected`, `attemptFailed`, `timeout`

Constructor rules:

- Copy connection identities through `copyConnectionIdentity` or
  `copyOptionalConnectionIdentity`.
- Serialize caught errors through `serializeConnectionDiagnosticError`.
- Copy Tailscale readiness/recovery result variants explicitly by `kind`.
- Export `<domain>EventKinds` arrays from each module.
- Export `<domain>Event` unions from each module.

- [ ] **Step 4: Assemble the union and event kind list**

Update `apps/mobile/src/lib/connection-diagnostics/events/index.ts`:

```ts
export * from './types';
export * from './snapshot';
export * from './identity';
export * from './prompt-format';
export * from './saved-entry';
export * from './ssh';
export * from './auto-connect';
export * from './manual';
export * from './tailscale';
export * from './reconnect';

import {
	type AutoConnectEvent,
	autoConnectEventKinds,
} from './auto-connect';
import {
	type ManualDiagnosticEvent,
	manualDiagnosticEventKinds,
} from './manual';
import {
	type ReconnectEvent,
	reconnectEventKinds,
} from './reconnect';
import {
	type SavedEntryEvent,
	savedEntryEventKinds,
} from './saved-entry';
import {
	type SshDiagnosticEvent,
	sshEventKinds,
} from './ssh';
import {
	type TailscaleDiagnosticEvent,
	tailscaleDiagnosticEventKinds,
} from './tailscale';
import {
	type ConnectionDiagnosticTraceOf,
	type TimedConnectionDiagnosticEvent,
} from './types';

export type ConnectionDiagnosticEvent =
	| SavedEntryEvent
	| SshDiagnosticEvent
	| AutoConnectEvent
	| ManualDiagnosticEvent
	| TailscaleDiagnosticEvent
	| ReconnectEvent;

export type ConnectionDiagnosticTimedEvent =
	TimedConnectionDiagnosticEvent<ConnectionDiagnosticEvent>;

export type ConnectionDiagnosticTrace =
	ConnectionDiagnosticTraceOf<ConnectionDiagnosticEvent>;

export const connectionDiagnosticEventKinds = [
	...savedEntryEventKinds,
	...sshEventKinds,
	...autoConnectEventKinds,
	...manualDiagnosticEventKinds,
	...tailscaleDiagnosticEventKinds,
	...reconnectEventKinds,
] as const satisfies readonly ConnectionDiagnosticEvent['kind'][];
```

Do not export a `diagnosticEvents` compatibility object from the final barrel.

- [ ] **Step 5: Add union coverage assertion**

Append to `connection-diagnostic-shared-events.test.ts`:

```ts
import {
	connectionDiagnosticEventKinds,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';

void test('event kind list covers every public event union member', () => {
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

- [ ] **Step 6: Run tests and commit**

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
  test/integration/connection-diagnostic-reconnect-events.test.ts
```

Expected: PASS.

Commit:

```bash
git add \
  apps/mobile/src/lib/connection-diagnostics/events \
  apps/mobile/test/integration/connection-diagnostic-*-events.test.ts
git commit -m "Split connection diagnostic event domains"
```

## Task 3: Switch Recorder And Prompt To The New Typed Stack

**Files:**

- Modify: `apps/mobile/src/lib/connection-diagnostic-types.ts`
- Modify: `apps/mobile/src/lib/connection-diagnostics.ts`
- Modify: `apps/mobile/src/lib/connection-diagnostic-recorder.ts`
- Modify: `apps/mobile/src/lib/connection-diagnostic-prompt.ts`
- Delete: `apps/mobile/src/lib/connection-diagnostic-normalization.ts`
- Delete: `apps/mobile/src/lib/connection-diagnostic-redaction.ts`
- Test: `apps/mobile/test/integration/connection-diagnostic-recorder.test.ts`
- Test: `apps/mobile/test/integration/connection-diagnostic-prompt.test.ts`

- [ ] **Step 1: Update recorder test to reject legacy normalization**

In `connection-diagnostic-recorder.test.ts`, keep typed recorder tests and delete
tests that cast `{ type: string }` events into `trace.event`.

Add:

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
		savedEntryEvents.missing({
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

- [ ] **Step 2: Update prompt test for domain delegated fields**

In `connection-diagnostic-prompt.test.ts`, add:

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

Use the file's current trace helper name if it is not `createTrace`.

- [ ] **Step 3: Run recorder and prompt tests and verify failure**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/connection-diagnostic-recorder.test.ts \
  test/integration/connection-diagnostic-prompt.test.ts
```

Expected: FAIL until imports point at the new event package and prompt
normalization is removed.

- [ ] **Step 4: Move compatibility types and barrels**

Update `connection-diagnostic-types.ts` to re-export types from
`connection-diagnostics/events`.

Update `connection-diagnostics.ts` to export:

```ts
export * from './connection-diagnostics/events';
export {
	createConnectionDiagnosticRecorder,
	connectionDiagnosticRecorder,
} from './connection-diagnostic-recorder';
export { formatConnectionDiagnosticPrompt } from './connection-diagnostic-prompt';
```

- [ ] **Step 5: Update recorder**

In `connection-diagnostic-recorder.ts`, import from
`./connection-diagnostics/events`.

Replace `cloneDiagnosticValue` with `snapshotDiagnosticValue`.

Use `manualDiagnosticEvents.warning(...)` only for the defensive fallback when a
typed event cannot be cloned.

The recorder must not import `connection-diagnostic-normalization`.

- [ ] **Step 6: Update prompt formatter**

In `connection-diagnostic-prompt.ts`:

- remove `normalizeLegacyTraceForPrompt`
- remove `readDetails`
- remove support for generic `details=...`
- use domain formatter functions for event-specific fields
- keep shared formatting for header, app state, selected connection, timeline,
  errors, and private-key omission

Each domain module should export one formatter:

- `formatSavedEntryEventFields`
- `formatSshEventFields`
- `formatAutoConnectEventFields`
- `formatManualDiagnosticEventFields`
- `formatTailscaleDiagnosticEventFields`
- `formatReconnectEventFields`

- [ ] **Step 7: Delete old normalization/redaction files**

Run:

```bash
git rm apps/mobile/src/lib/connection-diagnostic-normalization.ts
git rm apps/mobile/src/lib/connection-diagnostic-redaction.ts
```

Then scan:

```bash
rg -n "connection-diagnostic-normalization|connection-diagnostic-redaction|normalizeLegacy|legacyTypeAliases|cloneDiagnosticValue" apps/mobile/src apps/mobile/test
```

Expected: no matches.

- [ ] **Step 8: Run tests and commit**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/connection-diagnostic-recorder.test.ts \
  test/integration/connection-diagnostic-prompt.test.ts \
  test/integration/connection-diagnostic-shared-events.test.ts
```

Expected: PASS.

Commit:

```bash
git add \
  apps/mobile/src/lib/connection-diagnostic-types.ts \
  apps/mobile/src/lib/connection-diagnostics.ts \
  apps/mobile/src/lib/connection-diagnostic-recorder.ts \
  apps/mobile/src/lib/connection-diagnostic-prompt.ts \
  apps/mobile/src/lib/connection-diagnostics/events \
  apps/mobile/test/integration/connection-diagnostic-recorder.test.ts \
  apps/mobile/test/integration/connection-diagnostic-prompt.test.ts
git commit -m "Use typed diagnostic event stack in recorder and prompt"
```

## Task 4: Decouple Saved-Entry Recovery From Diagnostic Events

**Files:**

- Modify: `apps/mobile/src/lib/auto-connect-saved-entry.ts`
- Modify: `apps/mobile/src/lib/auto-connect-attempt.ts`
- Modify: `apps/mobile/src/lib/connection-diagnostic-runner.ts`
- Test: `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`
- Test: `apps/mobile/test/integration/auto-connect-attempt.test.ts`
- Test: `apps/mobile/test/integration/connection-diagnostic-runner.test.ts`

- [ ] **Step 1: Add failing test for pure recovery helper**

In `auto-connect-saved-entry.test.ts`, add:

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
	} as never);

	assert.equal(result.status, 'connected');
	assert.deepEqual(events, []);
});
```

- [ ] **Step 2: Run saved-entry recovery test and verify failure**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-saved-entry.test.ts
```

Expected: FAIL because the helper currently emits through `onEvent`.

- [ ] **Step 3: Remove diagnostic emission from shared recovery**

In `auto-connect-saved-entry.ts`:

- remove `onEvent` from `AttemptSavedEntryWithTailscaleRecoveryArgs`
- delete the local trace wrapper
- delete all calls to diagnostic event constructors
- preserve the existing `SavedEntryRecoveryOutcome` union statuses:
  `blocked`, `connected`, `tmuxAttachFailed`, `recoveryNotAttempted`,
  `retryFailed`, `threw`

- [ ] **Step 4: Move event mapping to callers**

In `auto-connect-attempt.ts`, emit auto-connect events before and after calling
the helper. Use:

- `autoConnectEvents.savedEntryConnectStarted`
- `autoConnectEvents.savedEntryConnectConnected`
- `autoConnectEvents.savedEntryConnectFailed`
- `autoConnectEvents.savedEntryConnectTmuxAttachFailed`
- `autoConnectEvents.savedEntryConnectThrew`
- `autoConnectEvents.savedEntryRetryStarted`
- `autoConnectEvents.savedEntryRetryThrew`

In `connection-diagnostic-runner.ts`, emit manual-domain events for manual
diagnostics. Do not emit `auto-connect.*` events from manual diagnostic code.

- [ ] **Step 5: Run recovery/caller tests and commit**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/auto-connect-saved-entry.test.ts \
  test/integration/auto-connect-attempt.test.ts \
  test/integration/connection-diagnostic-runner.test.ts
```

Expected: PASS with caller-owned event sequences.

Commit:

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

## Task 5: Migrate Call Sites And Delete The Old Event API

**Files:**

- Modify: diagnostic event imports across `apps/mobile/src/lib`
- Delete: `apps/mobile/src/lib/connection-diagnostic-events.ts`
- Delete: `apps/mobile/test/integration/connection-diagnostic-events.test.ts`
- Modify: tests importing `diagnosticEvents`
  - includes `apps/mobile/test/integration/connection-diagnostics.test.ts`

- [ ] **Step 1: Replace source imports**

Replace source imports from:

```ts
import { diagnosticEvents } from './connection-diagnostic-events';
```

or:

```ts
import { diagnosticEvents } from './connection-diagnostics';
```

with grouped imports:

```ts
import {
	autoConnectEvents,
	manualDiagnosticEvents,
	reconnectEvents,
	savedEntryEvents,
	sshEvents,
	tailscaleDiagnosticEvents,
} from './connection-diagnostics/events';
```

Use only the groups each file needs.

- [ ] **Step 2: Replace event constructor calls**

Use direct grouped constructors:

- `diagnosticEvents.savedEntrySelected(...)` -> `savedEntryEvents.selected(...)`
- `diagnosticEvents.keyResolved(...)` -> `savedEntryEvents.keyResolved(...)`
- `diagnosticEvents.sshConnectFailed(...)` -> `sshEvents.connectFailed(...)`
- `diagnosticEvents.manualDiagnosticTimeout(...)` ->
  `manualDiagnosticEvents.timeout(...)`
- `diagnosticEvents.autoConnectLatestShellSelected(...)` ->
  `autoConnectEvents.latestShellSelected(...)`
- `diagnosticEvents.tailscaleRecoveryResult(...)` ->
  `tailscaleDiagnosticEvents.recoveryResult(...)`
- `diagnosticEvents.reconnect({ kind: 'reconnect.timeout', ... })` ->
  `reconnectEvents.timeout(...)`

- [ ] **Step 3: Update the public barrel test**

In `connection-diagnostics.test.ts`, remove the `diagnosticEvents` import and
assert that the barrel exports at least one grouped constructor instead:

```ts
import {
	connectionDiagnosticRecorder,
	createConnectionDiagnosticRecorder,
	formatConnectionDiagnosticPrompt,
	savedEntryEvents,
} from '../../src/lib/connection-diagnostics';

void test('connection diagnostics barrel exports public diagnostic helpers', () => {
	assert.equal(typeof createConnectionDiagnosticRecorder, 'function');
	assert.equal(typeof connectionDiagnosticRecorder.startTrace, 'function');
	assert.equal(typeof savedEntryEvents.selected, 'function');
	assert.equal(typeof formatConnectionDiagnosticPrompt, 'function');
});
```

- [ ] **Step 4: Delete old event module and giant event test**

Run:

```bash
git rm apps/mobile/src/lib/connection-diagnostic-events.ts
git rm apps/mobile/test/integration/connection-diagnostic-events.test.ts
```

Move unique assertions from the giant event test into the domain tests before
deleting it. The required union-kind coverage assertion belongs in
`connection-diagnostic-shared-events.test.ts`.

- [ ] **Step 5: Run deletion scans**

Run:

```bash
rg -n "connection-diagnostic-events|diagnosticEvents\\.|normalizeLegacy|legacyTypeAliases|connectionDiagnosticEventKinds = new Set" apps/mobile/src apps/mobile/test
```

Expected: no matches for deleted modules, old constructor object, legacy
normalization, alias table, or old local kind set.

- [ ] **Step 6: Run call-site tests and commit**

Run:

```bash
cd apps/mobile
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/auto-connect-attempt.test.ts \
  test/integration/auto-connect-reconnect-controller.test.ts \
  test/integration/auto-connect-saved-entry.test.ts \
  test/integration/connect-and-open-shell-diagnostics.test.ts \
  test/integration/diagnostic-shell-probe.test.ts \
  test/integration/connection-diagnostics.test.ts \
  test/integration/connection-diagnostic-runner.test.ts \
  test/integration/connection-debug-command.test.ts \
  test/integration/connection-diagnostic-shared-events.test.ts \
  test/integration/connection-diagnostic-saved-entry-events.test.ts \
  test/integration/connection-diagnostic-ssh-events.test.ts \
  test/integration/connection-diagnostic-auto-connect-events.test.ts \
  test/integration/connection-diagnostic-manual-events.test.ts \
  test/integration/connection-diagnostic-tailscale-events.test.ts \
  test/integration/connection-diagnostic-reconnect-events.test.ts
```

Expected: PASS.

Commit:

```bash
git add apps/mobile/src apps/mobile/test/integration
git commit -m "Remove legacy diagnostic event API"
```

## Task 6: Final Verification And Maintainability Guard

**Files:**

- Modify only files touched by earlier tasks if verification exposes issues.

- [ ] **Step 1: Add file-size guard**

Append to `connection-diagnostic-shared-events.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

void test('diagnostics event source files stay below the hard size limit', () => {
	const root = join(process.cwd(), 'src/lib/connection-diagnostics/events');
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
```

- [ ] **Step 2: Run focused diagnostics tests**

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
  test/integration/connection-diagnostic-runner.test.ts \
  test/integration/connection-debug-command.test.ts \
  test/integration/connection-diagnostic-delivery.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run broader connection/Tailscale slice**

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

- [ ] **Step 4: Run typecheck and formatting**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
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

- [ ] **Step 5: Run lint and maintainability scans**

Run:

```bash
pnpm --filter @fressh/mobile lint:check
wc -l apps/mobile/src/lib/connection-diagnostics/events/*.ts | sort -nr
rg -n "connection-diagnostic-events|connection-diagnostic-normalization|connection-diagnostic-redaction|diagnosticEvents\\.|normalizeLegacy|legacyTypeAliases|details:" apps/mobile/src apps/mobile/test
rg -n "as unknown|as any" apps/mobile/src/lib/connection-diagnostics apps/mobile/src/lib/connection-diagnostic-*.ts
```

Expected:

- lint passes, or the existing ESLint config error is documented in the final summary
- no event source file exceeds 800 lines
- no deleted diagnostic modules or old `diagnosticEvents` API remain
- no legacy normalization terms remain
- casts are limited to tests or one local prompt dispatcher

- [ ] **Step 6: Commit final verification changes**

If the file-size guard or verification fixes changed files:

```bash
git add apps/mobile/src apps/mobile/test/integration
git commit -m "Verify diagnostic architecture cleanup"
```

If no files changed after Task 5, skip this commit and record that verification
passed without additional changes.

## Self-Review Notes

- This revised plan is intentionally smaller than the first draft. It keeps the
  cleanup goals but removes the idea of a long-lived compatibility constructor
  object and avoids placeholder domain files.
- Spec coverage:
  - split event domains: Tasks 1, 2, and 5
  - shared snapshot/redaction helper: Task 1
  - shared identity helper: Task 1
  - no legacy normalization: Tasks 3 and 5
  - saved-entry recovery decoupling: Task 4
  - prompt delegation: Task 3
  - file-size guard: Task 6
- Scope control:
  - no UI changes
  - no new diagnostic command behavior
  - no persistent trace storage
  - no ESLint configuration repair in this cleanup
