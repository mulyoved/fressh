import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createConnectionDiagnosticRecorder,
	manualDiagnosticEvents,
	savedEntryEvents,
	sshEvents,
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
		savedEntryEvents.missing({
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
		savedEntryEvents.selected({
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
		sshEvents.connectFailed({
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

void test('recorder omits nested private key blocks in stored snapshots', () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 3000 });
	const trace = recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'private key material appeared in local error',
	});

	trace.event(
		sshEvents.connectFailed({
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
		manualDiagnosticEvents.warning({
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
