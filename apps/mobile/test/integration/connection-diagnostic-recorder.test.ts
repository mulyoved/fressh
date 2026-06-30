import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createConnectionDiagnosticRecorder,
	diagnosticEvents,
} from '../../src/lib/connection-diagnostics';

type EventWithCompatibilityFields = {
	type?: string;
	connection?: {
		host?: string;
		username?: string;
	};
	details?: Record<string, unknown>;
	error?: {
		name?: string;
		message?: string;
		inner?: unknown;
	};
};

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
	if (event.kind !== 'ssh.connect.failed') {
		throw new Error(`Unexpected event kind: ${event.kind}`);
	}

	assert.equal(
		event.error.message,
		'token=abc is preserved for personal diagnostics',
	);
	trace.finish('failed');
	const latestEvent = recorder.getLatestTrace()?.events[0];
	if (latestEvent?.kind !== 'ssh.connect.failed') {
		throw new Error(`Unexpected latest event kind: ${latestEvent?.kind}`);
	}
	assert.equal(
		latestEvent.error.message,
		'token=abc is preserved for personal diagnostics',
	);
});

void test('recorder normalizes legacy events before snapshotting traces', () => {
	let now = 1000;
	const recorder = createConnectionDiagnosticRecorder({ now: () => now });
	const trace = recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'legacy runtime caller',
	});

	now = 1030;
	const returnedEvent = trace.event({
		type: 'ssh.connect.failed',
		source: 'active-connection',
		message: 'Legacy SSH failed',
		connection: { host: 'dev.tailnet.ts.net', username: 'muly' },
		error: { name: 'TimeoutError', message: 'connect timed out' },
	} as unknown as Parameters<typeof trace.event>[0]);
	trace.finish('failed');

	if (returnedEvent.kind !== 'ssh.connect.failed') {
		throw new Error(`Unexpected returned event kind: ${returnedEvent.kind}`);
	}
	assert.equal((returnedEvent as { type?: string }).type, 'ssh.connect.failed');
	assert.equal(returnedEvent.elapsedMs, 30);
	assert.equal(returnedEvent.connection.host, 'dev.tailnet.ts.net');
	assert.equal(returnedEvent.error.message, 'connect timed out');

	const latestEvent = recorder.getLatestTrace()?.events[0];
	if (latestEvent?.kind !== 'ssh.connect.failed') {
		throw new Error(`Unexpected latest event kind: ${latestEvent?.kind}`);
	}
	assert.equal((latestEvent as { type?: string }).type, 'ssh.connect.failed');
	assert.equal(latestEvent.connection.username, 'muly');

	const historyEvent = recorder.getHistory()[0]?.events[0];
	if (historyEvent?.kind !== 'ssh.connect.failed') {
		throw new Error(`Unexpected history event kind: ${historyEvent?.kind}`);
	}
	assert.equal((historyEvent as { type?: string }).type, 'ssh.connect.failed');
	assert.equal(historyEvent.error.name, 'TimeoutError');
});

void test('recorder preserves unmapped legacy event evidence in snapshots', () => {
	let now = 2000;
	const recorder = createConnectionDiagnosticRecorder({ now: () => now });
	const trace = recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'generic legacy runtime caller',
	});

	now = 2040;
	const returnedEvent = trace.event({
		type: 'manual-diagnostic.probe-exited',
		source: 'manual-diagnostic',
		message: 'Probe exited before shell prompt',
		connection: { host: 'dev.tailnet.ts.net', username: 'muly' },
		details: { probeExitCode: 255 },
		timeoutMs: 15000,
	} as unknown as Parameters<typeof trace.event>[0]);
	trace.finish('failed');

	if (returnedEvent.kind !== 'manual-diagnostic.warning') {
		throw new Error(`Unexpected returned event kind: ${returnedEvent.kind}`);
	}
	const returned = returnedEvent as EventWithCompatibilityFields;
	assert.equal(returned.type, 'manual-diagnostic.warning');
	assert.equal(returned.connection?.host, 'dev.tailnet.ts.net');
	assert.equal(
		returned.error?.message,
		'manual-diagnostic.probe-exited: Probe exited before shell prompt',
	);
	assert.equal(returned.details?.legacyType, 'manual-diagnostic.probe-exited');
	assert.deepEqual(returned.details?.details, { probeExitCode: 255 });
	assert.equal(returned.details?.timeoutMs, 15000);

	const latest = recorder.getLatestTrace()?.events[0];
	const history = recorder.getHistory()[0]?.events[0];
	assert.deepEqual(latest, returnedEvent);
	assert.deepEqual(history, returnedEvent);
});

void test('recorder preserves known legacy event kinds in snapshots', () => {
	let now = 2500;
	const recorder = createConnectionDiagnosticRecorder({ now: () => now });
	const trace = recorder.startTrace({
		trigger: 'reconnect',
		reason: 'legacy reconnect caller',
	});

	now = 2510;
	const shellFailed = trace.event({
		type: 'ssh.shell.failed',
		source: 'active-connection',
		connection: { host: 'dev.tailnet.ts.net' },
		error: { name: 'ShellError', message: 'shell failed' },
		storedConnectionId: 'stored-1',
	} as unknown as Parameters<typeof trace.event>[0]);
	now = 2520;
	const reconnectStarted = trace.event({
		type: 'reconnect.attempt.started',
		source: 'reconnect-controller',
		message: 'Reconnect attempt started',
		elapsedMs: 99,
	} as unknown as Parameters<typeof trace.event>[0]);
	trace.finish('failed');

	assert.equal(shellFailed.kind, 'ssh.shell.failed');
	assert.equal(shellFailed.error.message, 'shell failed');
	assert.equal(
		(shellFailed as { storedConnectionId?: string }).storedConnectionId,
		'stored-1',
	);
	assert.equal(reconnectStarted.kind, 'reconnect.attempt.started');
	assert.equal(
		(reconnectStarted as { reconnectElapsedMs?: number; message?: string })
			.message,
		'Reconnect attempt started',
	);
	assert.deepEqual(
		recorder.getHistory()[0]?.events.map((event) => event.kind),
		['ssh.shell.failed', 'reconnect.attempt.started'],
	);
});

void test('recorder omits nested private key blocks in stored snapshots', () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 3000 });
	const trace = recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'private key material appeared in local error',
	});

	trace.event(
		diagnosticEvents.sshConnectFailed({
			source: 'saved-entry',
			connection: { host: 'dev.tailnet.ts.net' },
			error: {
				name: 'Error',
				message: [
					'failed with key',
					'-----BEGIN OPENSSH PRIVATE KEY-----',
					'secret-key-body',
					'-----END OPENSSH PRIVATE KEY-----',
				].join('\n'),
				inner: {
					token: 'token=abc stays for personal diagnostics',
					nested: {
						key: [
							'-----BEGIN RSA PRIVATE KEY-----',
							'nested-secret-body',
							'-----END RSA PRIVATE KEY-----',
						].join('\n'),
					},
				},
			},
		}),
	);
	trace.finish('failed');

	const latestEvent = recorder.getLatestTrace()?.events[0];
	assert.ok(latestEvent);
	const serialized = JSON.stringify(latestEvent);
	assert.doesNotMatch(serialized, /secret-key-body/);
	assert.doesNotMatch(serialized, /nested-secret-body/);
	assert.match(serialized, /Private key material omitted/);
	assert.match(serialized, /token=abc stays for personal diagnostics/);

	const historyEvent = recorder.getHistory()[0]?.events[0];
	assert.deepEqual(historyEvent, latestEvent);
});

void test('recorder serialization does not invoke hostile coercion hooks', () => {
	let coercionCalls = 0;
	const nonPlainObject = Object.create({
		get [Symbol.toStringTag]() {
			coercionCalls += 1;
			return 'HostileTag';
		},
	});
	Object.assign(nonPlainObject, {
		toString() {
			coercionCalls += 1;
			return 'hostile toString';
		},
		valueOf() {
			coercionCalls += 1;
			return 'hostile valueOf';
		},
		[Symbol.toPrimitive]() {
			coercionCalls += 1;
			return 'hostile primitive';
		},
	});

	const recorder = createConnectionDiagnosticRecorder({ now: () => 3500 });
	const trace = recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'hostile coercion hooks',
	});
	trace.event(
		diagnosticEvents.manualDiagnosticWarning({
			source: 'manual-diagnostic',
			message: 'hostile details',
			error: {
				name: 'HostileError',
				message: 'hostile object attached',
				inner: {
					nonPlainObject,
					plainObject: {
						toString() {
							coercionCalls += 1;
							return 'plain hostile toString';
						},
					},
				},
			},
		}),
	);
	trace.finish('failed');

	const latestEvent = recorder.getLatestTrace()?.events[0];
	assert.ok(latestEvent);
	assert.equal(coercionCalls, 0);
	assert.doesNotMatch(JSON.stringify(latestEvent), /hostile toString/);
	assert.doesNotMatch(JSON.stringify(latestEvent), /HostileTag/);
});

void test('recorder safely normalizes hostile legacy events', () => {
	let now = 4000;
	const recorder = createConnectionDiagnosticRecorder({ now: () => now });
	const trace = recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'hostile legacy event',
	});
	const hostileEvent = Object.defineProperties(
		{},
		{
			type: {
				enumerable: true,
				get() {
					throw new Error('type getter failed');
				},
			},
			source: {
				enumerable: true,
				get() {
					throw new Error('source getter failed');
				},
			},
			details: {
				enumerable: true,
				get() {
					throw new Error('details getter failed');
				},
			},
		},
	) as Parameters<typeof trace.event>[0];

	now = 4020;
	assert.doesNotThrow(() => trace.event(hostileEvent));
	const latestBeforeFinish = recorder.getLatestTrace();
	assert.ok(latestBeforeFinish);
	assert.equal(latestBeforeFinish.events.length, 1);
	const event = latestBeforeFinish.events[0];
	if (event?.kind !== 'manual-diagnostic.warning') {
		throw new Error(`Unexpected event kind: ${event?.kind}`);
	}
	assert.equal(event.source, 'manual-diagnostic');

	trace.finish('failed');
	now = 4040;
	assert.doesNotThrow(() => trace.event(hostileEvent));
	assert.equal(recorder.getLatestTrace()?.events.length, 1);
	assert.equal(recorder.getHistory()[0]?.events.length, 1);
});

void test('recorder falls back when readable kind cannot be safely cloned', () => {
	let now = 5000;
	const recorder = createConnectionDiagnosticRecorder({ now: () => now });
	const trace = recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'hostile typed event',
	});
	const hostileEvent = new Proxy(
		{},
		{
			get(_target, property) {
				if (property === 'kind') return 'ssh.connect.failed';
				if (property === 'source') return 'active-connection';
				throw new Error('unexpected property read');
			},
			ownKeys() {
				throw new Error('ownKeys failed');
			},
		},
	) as Parameters<typeof trace.event>[0];

	now = 5010;
	const event = trace.event(hostileEvent);
	if (event.kind !== 'manual-diagnostic.warning') {
		throw new Error(`Unexpected fallback event kind: ${event.kind}`);
	}
	assert.equal(event.source, 'active-connection');
	assert.equal(recorder.getLatestTrace()?.events[0]?.kind, event.kind);
});
