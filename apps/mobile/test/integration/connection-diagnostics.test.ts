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
