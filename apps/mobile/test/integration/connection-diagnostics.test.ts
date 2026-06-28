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
				atMs: 100,
				elapsedMs: 0,
				type: 'connection.selected',
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
			},
			{
				atMs: 120,
				elapsedMs: 20,
				type: 'shell.snapshot',
				source: 'latest-shell',
				message: 'Loaded latest shell context',
			},
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
	const details = {
		attempts: [{ count: 1, privateKeyPreview: 'SECRET' }],
		password: 'PASSWORD_SECRET',
		passphrase: 'PASSPHRASE_SECRET',
		apiKey: 'API_KEY_SECRET',
		Authorization: 'Bearer AUTH_SECRET',
		nested: { phase: 'connect' },
	};

	trace.event({
		type: 'ssh.connect.failed',
		source: 'active-connection',
		message: 'Initial failure',
		connection,
		error,
		details,
	});

	connection.host = 'changed.tailnet.ts.net';
	connection.tmuxSessionName = 'mutated';
	error.message = 'changed failure';
	details.attempts[0]!.count = 99;
	details.nested.phase = 'mutated';

	const latestTrace = recorder.getLatestTrace();
	assert.ok(latestTrace);
	assert.equal(latestTrace.events[0]?.connection?.host, 'dev.tailnet.ts.net');
	assert.equal(latestTrace.events[0]?.connection?.tmuxSessionName, 'main');
	assert.equal(latestTrace.events[0]?.error?.message, 'original failure');
	assert.deepEqual(latestTrace.events[0]?.details, {
		attempts: [{ count: 1, privateKeyPreview: '[REDACTED]' }],
		password: '[REDACTED]',
		passphrase: '[REDACTED]',
		apiKey: '[REDACTED]',
		Authorization: '[REDACTED]',
		nested: { phase: 'connect' },
	});

	const returnedTrace = recorder.getLatestTrace();
	assert.ok(returnedTrace);
	const returnedDetails = returnedTrace.events[0]?.details as {
		nested?: { phase?: string };
	};
	assert.ok(returnedDetails.nested);
	returnedDetails.nested.phase = 'caller-mutated';

	const freshTrace = recorder.getLatestTrace();
	assert.ok(freshTrace);
	const freshDetails = freshTrace.events[0]?.details as {
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

	const returnedEvent = handle.event({
		type: 'ssh.connect.failed',
		source: 'active-connection',
		details: {
			nested: {
				phase: 'connect',
				attempts: 1,
			},
		},
	});

	(handle.trace as ConnectionDiagnosticTrace).reason = 'mutated';
	const handleEventDetails = handle.trace.events[0]?.details as {
		nested?: { phase?: string; attempts?: number };
	};
	assert.ok(handleEventDetails.nested);
	handleEventDetails.nested.phase = 'caller-mutated';
	handleEventDetails.nested.attempts = 99;

	const latestBeforeFinish = recorder.getLatestTrace();
	assert.ok(latestBeforeFinish);
	assert.equal(latestBeforeFinish.reason, 'snapshot-isolation');
	assert.deepEqual(latestBeforeFinish.events[0]?.details, {
		nested: {
			phase: 'connect',
			attempts: 1,
		},
	});

	const returnedEventDetails = returnedEvent.details as {
		nested?: { phase?: string; attempts?: number };
	};
	assert.ok(returnedEventDetails.nested);
	returnedEventDetails.nested.phase = 'returned-mutated';
	returnedEventDetails.nested.attempts = 42;

	const latestAfterReturnedEventMutation = recorder.getLatestTrace();
	assert.ok(latestAfterReturnedEventMutation);
	assert.deepEqual(latestAfterReturnedEventMutation.events[0]?.details, {
		nested: {
			phase: 'connect',
			attempts: 1,
		},
	});

	currentNow = 850;
	handle.finish('failed');

	(handle.trace as ConnectionDiagnosticTrace).reason = 'history-mutated';
	const postFinishHandleDetails = handle.trace.events[0]?.details as {
		nested?: { phase?: string; attempts?: number };
	};
	assert.ok(postFinishHandleDetails.nested);
	postFinishHandleDetails.nested.phase = 'history-mutated';
	postFinishHandleDetails.nested.attempts = -1;

	const history = recorder.getHistory();
	assert.equal(history.length, 1);
	assert.equal(history[0]?.reason, 'snapshot-isolation');
	assert.deepEqual(history[0]?.events[0]?.details, {
		nested: {
			phase: 'connect',
			attempts: 1,
		},
	});
});

void test('recorder safely snapshots messy details without throwing', () => {
	let currentNow = 700;
	const recorder = createConnectionDiagnosticRecorder({
		now: () => currentNow,
	});
	const trace = recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'safe-snapshot',
	});
	const cyclicDetails: {
		self?: unknown;
		bigint: bigint;
		handler: () => string;
		nested: { privateKeyPreview: string };
	} = {
		bigint: 123n,
		handler: function refreshConnection() {
			return 'ok';
		},
		nested: { privateKeyPreview: 'SECRET_PREVIEW' },
	};
	cyclicDetails.self = cyclicDetails;

	assert.doesNotThrow(() => {
		trace.event({
			type: 'ssh.connect.failed',
			source: 'active-connection',
			details: cyclicDetails as Record<string, unknown>,
		});
	});

	assert.doesNotThrow(() => recorder.getLatestTrace());

	const latestTrace = recorder.getLatestTrace();
	assert.ok(latestTrace);
	assert.deepEqual(latestTrace.events[0]?.details, {
		self: '[Circular]',
		bigint: '123n',
		handler: '[Function refreshConnection]',
		nested: { privateKeyPreview: '[REDACTED]' },
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

	handle.event({
		type: 'ssh.connect.failed',
		source: 'active-connection',
		message: 'Initial failure',
	});

	currentNow = 1050;
	handle.finish('failed');

	const finishedSnapshot = recorder.getLatestTrace();
	assert.ok(finishedSnapshot);
	assert.equal(finishedSnapshot.status, 'failed');
	assert.equal(finishedSnapshot.events.length, 1);
	assert.equal(finishedSnapshot.finishedAtMs, 1050);

	currentNow = 1100;
	const postFinishEvent = handle.event({
		type: 'ssh.connect.retry',
		source: 'active-connection',
		message: 'Should not append',
	});
	handle.finish('connected');

	assert.equal(postFinishEvent.type, 'ssh.connect.retry');
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

void test('clear prevents stale trace handles from repopulating recorder state', () => {
	let currentNow = 1300;
	const recorder = createConnectionDiagnosticRecorder({
		now: () => currentNow,
	});

	const handle = recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'clear-race',
	});

	handle.event({
		type: 'ssh.connect.start',
		source: 'manual-diagnostic',
	});

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
				atMs: 100,
				elapsedMs: 0,
				type: 'connection.selected',
				source: 'saved-entry',
				connection: {
					savedConnectionId: 'saved-22',
					username: 'muly',
					host: 'dev.tailnet.ts.net',
					port: 22,
				},
			},
			{
				atMs: 140,
				elapsedMs: 40,
				type: 'connection.promoted',
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
			},
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

void test('prompt formatting tolerates direct messy trace details', () => {
	const cyclicDetails: {
		self?: unknown;
		bigint: bigint;
		handler: () => string;
		diagnosticSymbol: symbol;
		accessToken: string;
		nested: { privateKeyPreview: string };
	} = {
		bigint: 123n,
		handler: function refreshConnection() {
			return 'ok';
		},
		diagnosticSymbol: Symbol('diagnostic-token'),
		accessToken: 'ACCESS_TOKEN_SECRET',
		nested: { privateKeyPreview: 'SECRET_PREVIEW' },
	};
	cyclicDetails.self = cyclicDetails;

	const trace: ConnectionDiagnosticTrace = {
		id: 'trace-messy-direct',
		trigger: 'manual-diagnostic',
		reason: 'direct-trace-formatting',
		status: 'failed',
		startedAtMs: 200,
		finishedAtMs: 260,
		events: [
			{
				atMs: 220,
				elapsedMs: 20,
				type: 'ssh.connect.failed',
				source: 'active-connection',
				details: cyclicDetails as Record<string, unknown>,
			},
		],
	};

	assert.doesNotThrow(() => formatConnectionDiagnosticPrompt(trace));

	const prompt = formatConnectionDiagnosticPrompt(trace);
	assert.match(prompt, /\[Circular\]/);
	assert.match(prompt, /123n/);
	assert.match(prompt, /\[Function refreshConnection\]/);
	assert.match(prompt, /\[Symbol diagnostic-token\]/);
	assert.doesNotMatch(prompt, /SECRET_PREVIEW/);
	assert.doesNotMatch(prompt, /ACCESS_TOKEN_SECRET/);
});

void test('prompt redacts credential text inside generic string fields', () => {
	const trace: ConnectionDiagnosticTrace = {
		id: 'trace-string-redaction',
		trigger: 'manual-diagnostic',
		reason: 'apiKey=TRACE_REASON_SECRET',
		status: 'failed',
		startedAtMs: 300,
		finishedAtMs: 360,
		events: [
			{
				atMs: 320,
				elapsedMs: 20,
				type: 'ssh.connect.failed',
				source: 'active-connection',
				message: 'Authorization: Bearer EVENT_MESSAGE_SECRET',
				error: {
					name: 'Error',
					message:
						'https://user:password@example.test/path?token=ERROR_URL_SECRET',
				},
				details: {
					log: 'Authorization: Bearer DETAIL_LOG_SECRET',
					url: 'https://user:password@example.test/path?token=DETAIL_URL_SECRET',
					note: 'apiKey=DETAIL_NOTE_SECRET',
					pem: [
						'-----BEGIN OPENSSH PRIVATE KEY-----',
						'PRIVATE_KEY_BODY_SECRET',
						'-----END OPENSSH PRIVATE KEY-----',
					].join('\n'),
				},
			},
		],
	};

	const prompt = formatConnectionDiagnosticPrompt(trace, {
		appState: {
			platformOS: 'android',
			pathname: '/shell/detail?access_token=APP_STATE_SECRET',
			isAutoConnecting: false,
			isReconnecting: true,
		},
	});

	for (const secret of [
		'TRACE_REASON_SECRET',
		'EVENT_MESSAGE_SECRET',
		'ERROR_URL_SECRET',
		'DETAIL_LOG_SECRET',
		'DETAIL_URL_SECRET',
		'DETAIL_NOTE_SECRET',
		'PRIVATE_KEY_BODY_SECRET',
		'APP_STATE_SECRET',
	]) {
		assert.doesNotMatch(prompt, new RegExp(secret));
	}

	assert.match(prompt, /\[redacted\]/);
	assert.match(prompt, /\[REDACTED\]/);
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
		stack: undefined,
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

	const prompt = formatConnectionDiagnosticPrompt({
		id: 'trace-uniffi-error',
		trigger: 'manual-diagnostic',
		reason: 'uniffi-error',
		status: 'failed',
		startedAtMs: 10,
		finishedAtMs: 20,
		events: [
			{
				atMs: 20,
				elapsedMs: 10,
				type: 'ssh.connect.failed',
				source: 'active-connection',
				error: serializeConnectionDiagnosticError(uniffiError),
			},
		],
	});

	assert.match(prompt, /errorTag=Russh/);
	assert.match(prompt, /No route to host/);
});
