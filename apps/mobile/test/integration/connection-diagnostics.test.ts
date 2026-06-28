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
