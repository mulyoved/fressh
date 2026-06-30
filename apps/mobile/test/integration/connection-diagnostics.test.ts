import assert from 'node:assert/strict';
import test from 'node:test';
import {
	connectionDiagnosticRecorder,
	createConnectionDiagnosticRecorder,
	diagnosticEvents,
	formatConnectionDiagnosticPrompt,
	serializeConnectionDiagnosticError,
	type ConnectionDiagnosticEvent,
	type ConnectionDiagnosticTimedEvent,
	type ConnectionDiagnosticTrace,
} from '../../src/lib/connection-diagnostics';

function timedEvent(
	event: ConnectionDiagnosticEvent,
	atMs: number,
	elapsedMs: number,
): ConnectionDiagnosticTimedEvent {
	return {
		...event,
		atMs,
		elapsedMs,
	};
}

function assertEventKind<TKind extends ConnectionDiagnosticTimedEvent['kind']>(
	event: ConnectionDiagnosticTimedEvent | undefined,
	kind: TKind,
): asserts event is Extract<ConnectionDiagnosticTimedEvent, { kind: TKind }> {
	assert.equal(event?.kind, kind);
}

void test('barrel exports the production recorder singleton', () => {
	connectionDiagnosticRecorder.clear();

	assert.equal(typeof connectionDiagnosticRecorder.startTrace, 'function');
	assert.equal(typeof connectionDiagnosticRecorder.getLatestTrace, 'function');
	assert.equal(typeof connectionDiagnosticRecorder.getHistory, 'function');
	assert.equal(typeof connectionDiagnosticRecorder.clear, 'function');
	assert.equal(connectionDiagnosticRecorder.getLatestTrace(), null);
	assert.deepEqual(connectionDiagnosticRecorder.getHistory(), []);
});

void test('recorder keeps latest trace and bounded history', () => {
	const recorder = createConnectionDiagnosticRecorder({
		now: () => 1000,
		maxHistory: 2,
	});

	const first = recorder.startTrace({
		trigger: 'initial-auto-connect',
		reason: 'app-start',
	});
	first.event(
		diagnosticEvents.savedEntrySelected({
			source: 'saved-entry',
			connection: {
				savedConnectionId: 'muly-dev-box-22',
				username: 'muly',
				host: 'dev.tailnet.ts.net',
				port: 22,
				keyId: 'key-1',
			},
		}),
	);
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
				...diagnosticEvents.savedEntrySelected({
					source: 'saved-entry',
					connection: {
						savedConnectionId: 'muly-dev-box-22',
						username: 'muly',
						host: 'dev.tailnet.ts.net',
						port: 22,
						keyId: 'key-1',
					},
				}),
				atMs: 10,
				elapsedMs: 0,
			},
			timedEvent(
				diagnosticEvents.sshConnectFailed({
					source: 'saved-entry',
					connection: { host: 'dev.tailnet.ts.net' },
					error: {
						name: 'Error',
						message: 'network unreachable',
						stack: [
							'Error: network unreachable',
							'-----BEGIN OPENSSH PRIVATE KEY-----',
							'SECRET_KEY_MATERIAL',
							'-----END OPENSSH PRIVATE KEY-----',
						].join('\n'),
					},
				}),
				11,
				1,
			),
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
	assert.match(prompt, /errorStack=Error: network unreachable/);
	assert.match(prompt, /Private key material has been omitted/);
	assert.doesNotMatch(prompt, /SECRET_KEY_MATERIAL/);
});

void test('prompt renders typed event kind names without undefined fields', () => {
	const trace: ConnectionDiagnosticTrace = {
		id: 'trace-typed-prompt-event',
		trigger: 'manual-diagnostic',
		reason: 'typed-prompt-event',
		status: 'failed',
		startedAtMs: 10,
		finishedAtMs: 20,
		events: [
			timedEvent(
				diagnosticEvents.savedEntrySelected({
					source: 'saved-entry',
					connection: {
						username: 'muly',
						host: 'dev.tailnet.ts.net',
						port: 22,
					},
				}),
				10,
				0,
			),
		],
	};

	const prompt = formatConnectionDiagnosticPrompt(trace);

	assert.match(prompt, /\+0ms saved-entry\.selected/);
	assert.doesNotMatch(prompt, /undefined/);
});

void test('prompt preserves legacy ssh connect failure evidence', () => {
	const trace = {
		id: 'trace-legacy-ssh-failure',
		trigger: 'manual-diagnostic',
		reason: 'legacy-ssh-failure',
		status: 'failed',
		startedAtMs: 100,
		finishedAtMs: 130,
		events: [
			{
				atMs: 125,
				elapsedMs: 25,
				type: 'ssh.connect.failed',
				source: 'active-connection',
				connection: {
					username: 'muly',
					host: 'dev.tailnet.ts.net',
					port: 22,
					keyId: 'key-legacy',
				},
				error: {
					name: 'TimeoutError',
					message: 'No route to host',
					stack: 'TimeoutError: No route to host',
				},
			},
		],
	} as unknown as ConnectionDiagnosticTrace;

	const prompt = formatConnectionDiagnosticPrompt(trace);

	assert.match(prompt, /\+25ms ssh\.connect\.failed/);
	assert.match(prompt, /muly@dev\.tailnet\.ts\.net:22/);
	assert.match(prompt, /key-legacy/);
	assert.match(prompt, /TimeoutError: No route to host/);
	assert.match(prompt, /errorStack=TimeoutError: No route to host/);
	assert.doesNotMatch(prompt, /Unsupported legacy diagnostic event/);
	assert.doesNotMatch(prompt, /undefined/);
});

void test('prompt preserves unmapped legacy event evidence', () => {
	const trace = {
		id: 'trace-unmapped-legacy-events',
		trigger: 'manual-diagnostic',
		reason: 'unmapped-legacy-events',
		status: 'failed',
		startedAtMs: 200,
		finishedAtMs: 260,
		events: [
			{
				atMs: 210,
				elapsedMs: 10,
				type: 'manual-diagnostic.failed',
				source: 'manual-diagnostic',
				message: 'Manual diagnostic failed after probe',
				error: {
					name: 'ProbeError',
					message: 'probe command failed',
				},
				details: {
					probeExitCode: 255,
				},
			},
			{
				atMs: 220,
				elapsedMs: 20,
				type: 'manual-diagnostic.timeout',
				source: 'manual-diagnostic',
				message: 'Diagnostic timed out',
				timeoutMs: 15000,
			},
			{
				atMs: 230,
				elapsedMs: 30,
				type: 'ssh.diagnostic.disconnect-failed',
				source: 'active-connection',
				connection: {
					username: 'muly',
					host: 'dev.tailnet.ts.net',
					port: 22,
				},
				error: {
					name: 'DisconnectError',
					message: 'channel close failed',
				},
			},
			{
				atMs: 240,
				elapsedMs: 40,
				type: 'auto-connect.source.latest-shell',
				source: 'latest-shell',
				message: 'Latest shell restored',
				connection: {
					connectionId: 'live-1',
					username: 'muly',
					host: 'dev.tailnet.ts.net',
					port: 22,
				},
				details: {
					pathname: '/shell/detail',
					channelId: 7,
				},
			},
		],
	} as unknown as ConnectionDiagnosticTrace;

	const prompt = formatConnectionDiagnosticPrompt(trace);

	assert.match(prompt, /manual-diagnostic\.failed/);
	assert.match(prompt, /Manual diagnostic failed after probe/);
	assert.match(prompt, /ProbeError: probe command failed/);
	assert.match(prompt, /probeExitCode/);
	assert.match(prompt, /255/);
	assert.match(prompt, /manual-diagnostic\.timeout/);
	assert.match(prompt, /Diagnostic timed out/);
	assert.match(prompt, /timeoutMs/);
	assert.match(prompt, /15000/);
	assert.match(prompt, /ssh\.diagnostic\.disconnect-failed/);
	assert.match(prompt, /muly@dev\.tailnet\.ts\.net:22/);
	assert.match(prompt, /DisconnectError: channel close failed/);
	assert.match(prompt, /auto-connect\.source\.latest-shell/);
	assert.match(prompt, /live-1/);
	assert.match(prompt, /Latest shell restored/);
	assert.match(prompt, /channelId/);
	assert.match(prompt, /7/);
	assert.doesNotMatch(prompt, /Unsupported legacy diagnostic event/);
	assert.doesNotMatch(prompt, /undefined/);
});

void test('prompt supports planned contract fields and includes them in output', () => {
	const trace: ConnectionDiagnosticTrace = {
		id: 'trace-contract',
		trigger: 'manual-diagnostic',
		reason: 'command-menu',
		status: 'failed',
		startedAtMs: 100,
		finishedAtMs: 160,
		events: [
			{
				...diagnosticEvents.autoConnectActiveConnectionSelected({
					source: 'active-connection',
					message: 'Selected current shell connection',
					connection: {
						savedConnectionId: 'saved-22',
						connectionId: 'live-connection-9',
						username: 'muly',
						host: 'dev.tailnet.ts.net',
						port: 22,
						keyId: 'key-9',
						useTmux: true,
						tmuxSessionName: 'workspace',
					},
				}),
				atMs: 100,
				elapsedMs: 0,
			},
			timedEvent(
				diagnosticEvents.autoConnectLatestShellMissing({
					source: 'latest-shell',
					pathname: '/shell/detail',
					message: 'Loaded latest shell context',
				}),
				120,
				20,
			),
		],
	};

	const prompt = formatConnectionDiagnosticPrompt(trace, {
		appState: {
			platformOS: 'android',
			pathname: '/shell/detail',
			isAutoConnecting: false,
			isReconnecting: true,
			foregroundServiceRequired: true,
			appActive: false,
		},
	});

	assert.match(prompt, /source=active-connection/);
	assert.match(prompt, /source=latest-shell/);
	assert.match(prompt, /live-connection-9/);
	assert.match(prompt, /useTmux=true/);
	assert.match(prompt, /tmuxSessionName=workspace/);
	assert.match(prompt, /foregroundServiceRequired: true/);
	assert.match(prompt, /appActive: false/);
	assert.match(prompt, /Selected current shell connection/);
	assert.match(prompt, /Loaded latest shell context/);
});

void test('recorder snapshots event inputs and returned traces', () => {
	let currentNow = 500;
	const recorder = createConnectionDiagnosticRecorder({
		now: () => currentNow,
	});

	const trace = recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'mutation-check',
	});
	const connection = {
		savedConnectionId: 'saved-1',
		connectionId: 'connection-1',
		username: 'muly',
		host: 'dev.tailnet.ts.net',
		port: 22,
		keyId: 'key-1',
		useTmux: true,
		tmuxSessionName: 'main',
	};
	const error = {
		name: 'TimeoutError',
		message: 'original failure',
		stack: 'stack-1',
	};
	const inner = {
		attempts: [{ count: 1, privateKeyPreview: 'SECRET' }],
		password: 'PASSWORD_SECRET',
		passphrase: 'PASSPHRASE_SECRET',
		apiKey: 'API_KEY_SECRET',
		Authorization: 'Bearer AUTH_SECRET',
		nested: { phase: 'connect' },
	};

	trace.event(
		diagnosticEvents.sshConnectFailed({
			source: 'active-connection',
			connection,
			error: { ...error, inner },
		}),
	);

	connection.host = 'changed.tailnet.ts.net';
	connection.tmuxSessionName = 'mutated';
	error.message = 'changed failure';
	inner.attempts[0]!.count = 99;
	inner.nested.phase = 'mutated';

	const latestTrace = recorder.getLatestTrace();
	assert.ok(latestTrace);
	const latestEvent = latestTrace.events[0];
	assertEventKind(latestEvent, 'ssh.connect.failed');
	const latestInner = latestEvent.error.inner as typeof inner;
	assert.equal(latestEvent.connection.host, 'dev.tailnet.ts.net');
	assert.equal(latestEvent.connection.tmuxSessionName, 'main');
	assert.equal(latestEvent.error.message, 'original failure');
	assert.deepEqual(latestInner.attempts, [
		{ count: 1, privateKeyPreview: 'SECRET' },
	]);
	assert.deepEqual(latestInner.nested, {
		phase: 'connect',
	});
	for (const secretKey of [
		'password',
		'passphrase',
		'apiKey',
		'Authorization',
	]) {
		assert.equal(Object.hasOwn(latestInner, secretKey), true);
	}

	const returnedTrace = recorder.getLatestTrace();
	assert.ok(returnedTrace);
	const returnedEvent = returnedTrace.events[0];
	assertEventKind(returnedEvent, 'ssh.connect.failed');
	const returnedDetails = returnedEvent.error.inner as {
		nested?: { phase?: string };
	};
	assert.ok(returnedDetails.nested);
	returnedDetails.nested.phase = 'caller-mutated';

	const freshTrace = recorder.getLatestTrace();
	assert.ok(freshTrace);
	const freshEvent = freshTrace.events[0];
	assertEventKind(freshEvent, 'ssh.connect.failed');
	const freshDetails = freshEvent.error.inner as {
		nested?: { phase?: string };
	};
	assert.equal(freshDetails.nested?.phase, 'connect');
});

void test('recorder handle snapshots stay isolated from caller mutations', () => {
	let currentNow = 800;
	const recorder = createConnectionDiagnosticRecorder({
		now: () => currentNow,
		maxHistory: 5,
	});
	const handle = recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'snapshot-isolation',
	});

	const returnedEvent = handle.event(
		diagnosticEvents.manualDiagnosticWarning({
			source: 'manual-diagnostic',
			message: 'Initial failure',
			error: {
				name: 'Error',
				message: 'Initial failure',
				inner: {
					nested: {
						phase: 'connect',
						attempts: 1,
					},
				},
			},
		}),
	);

	(handle.trace as ConnectionDiagnosticTrace).reason = 'mutated';
	const handleEvent = handle.trace.events[0];
	assertEventKind(handleEvent, 'manual-diagnostic.warning');
	const handleEventDetails = handleEvent.error.inner as {
		nested?: { phase?: string; attempts?: number };
	};
	assert.ok(handleEventDetails.nested);
	handleEventDetails.nested.phase = 'caller-mutated';
	handleEventDetails.nested.attempts = 99;

	const latestBeforeFinish = recorder.getLatestTrace();
	assert.ok(latestBeforeFinish);
	const latestBeforeFinishEvent = latestBeforeFinish.events[0];
	assertEventKind(latestBeforeFinishEvent, 'manual-diagnostic.warning');
	assert.equal(latestBeforeFinish.reason, 'snapshot-isolation');
	assert.deepEqual(latestBeforeFinishEvent.error.inner, {
		nested: {
			phase: 'connect',
			attempts: 1,
		},
	});

	assertEventKind(returnedEvent, 'manual-diagnostic.warning');
	const returnedEventDetails = returnedEvent.error.inner as {
		nested?: { phase?: string; attempts?: number };
	};
	assert.ok(returnedEventDetails.nested);
	returnedEventDetails.nested.phase = 'returned-mutated';
	returnedEventDetails.nested.attempts = 42;

	const latestAfterReturnedEventMutation = recorder.getLatestTrace();
	assert.ok(latestAfterReturnedEventMutation);
	const latestAfterReturnedEvent = latestAfterReturnedEventMutation.events[0];
	assertEventKind(latestAfterReturnedEvent, 'manual-diagnostic.warning');
	assert.deepEqual(latestAfterReturnedEvent.error.inner, {
		nested: {
			phase: 'connect',
			attempts: 1,
		},
	});

	currentNow = 850;
	handle.finish('failed');

	(handle.trace as ConnectionDiagnosticTrace).reason = 'history-mutated';
	const postFinishHandleEvent = handle.trace.events[0];
	assertEventKind(postFinishHandleEvent, 'manual-diagnostic.warning');
	const postFinishHandleDetails = postFinishHandleEvent.error.inner as {
		nested?: { phase?: string; attempts?: number };
	};
	assert.ok(postFinishHandleDetails.nested);
	postFinishHandleDetails.nested.phase = 'history-mutated';
	postFinishHandleDetails.nested.attempts = -1;

	const history = recorder.getHistory();
	assert.equal(history.length, 1);
	assert.equal(history[0]?.reason, 'snapshot-isolation');
	const historyEvent = history[0]?.events[0];
	assertEventKind(historyEvent, 'manual-diagnostic.warning');
	assert.deepEqual(historyEvent.error.inner, {
		nested: {
			phase: 'connect',
			attempts: 1,
		},
	});
});

void test('trace handle finalization is terminal and idempotent', () => {
	let currentNow = 1000;
	const recorder = createConnectionDiagnosticRecorder({
		now: () => currentNow,
	});
	const handle = recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'post-finish-noop',
	});

	handle.event(
		diagnosticEvents.manualDiagnosticWarning({
			source: 'manual-diagnostic',
			message: 'Initial failure',
			error: {
				name: 'Error',
				message: 'Initial failure',
			},
		}),
	);

	currentNow = 1050;
	handle.finish('failed');

	const finishedSnapshot = recorder.getLatestTrace();
	assert.ok(finishedSnapshot);
	assert.equal(finishedSnapshot.status, 'failed');
	assert.equal(finishedSnapshot.events.length, 1);
	assert.equal(finishedSnapshot.finishedAtMs, 1050);

	currentNow = 1100;
	const postFinishEvent = handle.event(
		diagnosticEvents.manualDiagnosticWarning({
			source: 'manual-diagnostic',
			message: 'Should not append',
			error: {
				name: 'Error',
				message: 'Should not append',
			},
		}),
	);
	handle.finish('connected');

	assert.equal(postFinishEvent.kind, 'manual-diagnostic.warning');
	assert.equal(postFinishEvent.message, 'Should not append');
	assert.equal(postFinishEvent.atMs, 1100);
	assert.equal(postFinishEvent.elapsedMs, 100);

	const latestTrace = recorder.getLatestTrace();
	assert.ok(latestTrace);
	assert.equal(latestTrace.status, 'failed');
	assert.equal(latestTrace.events.length, 1);
	assert.equal(latestTrace.finishedAtMs, 1050);
	assert.equal(latestTrace.events[0]?.message, 'Initial failure');

	const history = recorder.getHistory();
	assert.equal(history.length, 1);
	assert.equal(history[0]?.status, 'failed');
	assert.equal(history[0]?.events.length, 1);
	assert.equal(history[0]?.finishedAtMs, 1050);
});

void test('older trace finish does not replace newer latest trace', () => {
	let currentNow = 1200;
	const recorder = createConnectionDiagnosticRecorder({
		now: () => currentNow,
	});

	const first = recorder.startTrace({
		trigger: 'reconnect',
		reason: 'first-attempt',
	});

	currentNow = 1210;
	const second = recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'second-attempt',
	});

	currentNow = 1220;
	first.finish('failed');

	assert.equal(recorder.getLatestTrace()?.id, second.trace.id);
	assert.equal(recorder.getLatestTrace()?.status, 'running');
});

void test('older trace finish does not evict newer bounded history entry', () => {
	let currentNow = 1250;
	const recorder = createConnectionDiagnosticRecorder({
		now: () => currentNow,
		maxHistory: 1,
	});

	const first = recorder.startTrace({
		trigger: 'reconnect',
		reason: 'older-overlap',
	});

	currentNow = 1260;
	const second = recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'newer-overlap',
	});

	currentNow = 1270;
	second.finish('connected');

	currentNow = 1280;
	first.finish('failed');

	assert.equal(recorder.getLatestTrace()?.id, second.trace.id);
	assert.deepEqual(
		recorder.getHistory().map((trace) => trace.id),
		[second.trace.id],
	);
});

void test('clear prevents stale trace handles from repopulating recorder state', () => {
	let currentNow = 1300;
	const recorder = createConnectionDiagnosticRecorder({
		now: () => currentNow,
	});

	const handle = recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'clear-race',
	});

	handle.event(
		diagnosticEvents.sshConnectStarted({
			source: 'manual-diagnostic',
			connection: {},
		}),
	);

	recorder.clear();

	currentNow = 1310;
	handle.finish('failed');

	assert.equal(recorder.getLatestTrace(), null);
	assert.deepEqual(recorder.getHistory(), []);
	assert.equal(handle.trace.status, 'failed');
});

void test('prompt summary prefers the richest later connection identity', () => {
	const trace: ConnectionDiagnosticTrace = {
		id: 'trace-richer-identity',
		trigger: 'manual-diagnostic',
		reason: 'identity-selection',
		status: 'failed',
		startedAtMs: 100,
		finishedAtMs: 180,
		events: [
			{
				...diagnosticEvents.savedEntrySelected({
					source: 'saved-entry',
					connection: {
						savedConnectionId: 'saved-22',
						username: 'muly',
						host: 'dev.tailnet.ts.net',
						port: 22,
					},
				}),
				atMs: 100,
				elapsedMs: 0,
			},
			timedEvent(
				diagnosticEvents.savedEntrySelected({
					source: 'active-connection',
					connection: {
						savedConnectionId: 'saved-22',
						connectionId: 'connection-9',
						username: 'muly',
						host: 'dev.tailnet.ts.net',
						port: 22,
						keyId: 'key-9',
						useTmux: true,
						tmuxSessionName: 'workspace',
					},
				}),
				140,
				40,
			),
		],
	};

	const prompt = formatConnectionDiagnosticPrompt(trace);
	const connectionLine = prompt
		.split('\n')
		.find((line) => line.startsWith('- connection: '));

	assert.equal(
		connectionLine,
		'- connection: muly@dev.tailnet.ts.net:22 | savedConnectionId=saved-22 | connectionId=connection-9 | useTmux=true | tmuxSessionName=workspace | keyId=key-9',
	);
});

void test('prompt omits optional app state lines when values are absent', () => {
	const trace: ConnectionDiagnosticTrace = {
		id: 'trace-optional-app-state',
		trigger: 'manual-diagnostic',
		reason: 'prompt-optional-fields',
		status: 'failed',
		startedAtMs: 200,
		finishedAtMs: 260,
		events: [],
	};

	const prompt = formatConnectionDiagnosticPrompt(trace, {
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: true,
		},
	});

	assert.match(prompt, /- platformOS: android/);
	assert.match(prompt, /- isAutoConnecting: false/);
	assert.match(prompt, /- isReconnecting: true/);
	assert.doesNotMatch(prompt, /undefined/);
	assert.doesNotMatch(prompt, /- pathname:/);
	assert.doesNotMatch(prompt, /- foregroundServiceStarted:/);
	assert.doesNotMatch(prompt, /- backgroundWorkAllowed:/);
	assert.doesNotMatch(prompt, /- foregroundServiceRequired:/);
	assert.doesNotMatch(prompt, /- appActive:/);
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

	assert.deepEqual(
		serializeConnectionDiagnosticError({
			toString() {
				throw new Error('stringify failed');
			},
		}),
		{
			name: 'NonError',
			message: '[Unserializable error]',
		},
	);

	const hostileError = Object.create(Error.prototype, {
		name: {
			get() {
				throw new Error('name failed');
			},
		},
		message: {
			get() {
				throw new Error('message failed');
			},
		},
		stack: {
			get() {
				throw new Error('stack failed');
			},
		},
	}) as Error;

	assert.deepEqual(serializeConnectionDiagnosticError(hostileError), {
		name: 'Error',
		message: '[Unserializable error]',
	});

	const { proxy, revoke } = Proxy.revocable(new Error('revoked'), {});
	revoke();

	assert.doesNotThrow(() => serializeConnectionDiagnosticError(proxy));
	assert.deepEqual(serializeConnectionDiagnosticError(proxy), {
		name: 'NonError',
		message: '[Unserializable error]',
	});

	const uniffiError = Object.assign(new Error('Russh'), {
		name: 'SshError',
		tag: 'Russh',
		inner: ['No route to host'],
	});

	assert.deepEqual(serializeConnectionDiagnosticError(uniffiError), {
		name: 'SshError',
		message: 'Russh',
		stack: uniffiError.stack,
		tag: 'Russh',
		inner: ['No route to host'],
	});

	assert.deepEqual(
		serializeConnectionDiagnosticError({
			tag: 'Russh',
			inner: ['No route to host'],
		}),
		{
			name: 'NonError',
			message: 'Russh',
			tag: 'Russh',
			inner: ['No route to host'],
		},
	);

	const prompt = formatConnectionDiagnosticPrompt({
		id: 'trace-uniffi-error',
		trigger: 'manual-diagnostic',
		reason: 'uniffi-error',
		status: 'failed',
		startedAtMs: 10,
		finishedAtMs: 20,
		events: [
			{
				...diagnosticEvents.sshConnectFailed({
					source: 'active-connection',
					connection: {},
					error: serializeConnectionDiagnosticError({
						tag: 'Russh',
						inner: ['No route to host'],
					}),
				}),
				atMs: 20,
				elapsedMs: 10,
			},
		],
	});

	assert.match(prompt, /errorTag=Russh/);
	assert.match(prompt, /No route to host/);
});
