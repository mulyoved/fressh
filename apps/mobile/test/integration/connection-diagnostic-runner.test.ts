import assert from 'node:assert/strict';
import test from 'node:test';
import { runManualConnectionDiagnostic } from '../../src/lib/connection-diagnostic-runner';
import {
	createConnectionDiagnosticRecorder,
	formatConnectionDiagnosticPrompt,
} from '../../src/lib/connection-diagnostics';
import { type SavedConnectionEntry } from '../../src/lib/connection-utils';
// eslint-disable-next-line import/consistent-type-specifier-style -- keep query-fns type-only so Node integration tests do not load React Native at runtime
import type { ConnectAndOpenShellResult } from '../../src/lib/query-fns';

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

const unsupportedRecovery = {
	ensureReady: async () => ({
		kind: 'unsupported' as const,
		attempted: false as const,
		available: false as const,
	}),
	recoverAfterFailure: async () => ({
		kind: 'nonNetworkFailure' as const,
		attempted: false as const,
		networkLikeFailure: false as const,
		available: false,
	}),
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

void test('manual diagnostic records no saved connection as skipped trace', async () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });

	const result = await runManualConnectionDiagnostic({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
		},
		loadLatestSavedConnection: async () => null,
		resolveKeySecurity: async () => {
			throw new Error('key lookup should not run');
		},
		connectSavedEntry: async () => {
			throw new Error('connect should not run');
		},
		recovery: unsupportedRecovery,
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	assert.equal(result.status, 'skipped');
	assert.match(result.prompt, /no eligible saved auto-connect connection/i);
	assert.equal(recorder.getLatestTrace()?.status, 'skipped');
});

void test('manual diagnostic is single-flight', async () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	let resolveConnect: (value: ConnectAndOpenShellResult) => void = () => {};
	let notifyConnectStarted: () => void = () => {};
	const connectStarted = new Promise<void>((resolve) => {
		notifyConnectStarted = resolve;
	});
	const first = runManualConnectionDiagnostic({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolveKeySecurity: async () => ({ type: 'key', privateKey: 'secret' }),
		connectSavedEntry: () =>
			new Promise<ConnectAndOpenShellResult>((resolve) => {
				resolveConnect = resolve;
				notifyConnectStarted();
			}),
		recovery: readyRecovery,
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	await connectStarted;

	const second = await runManualConnectionDiagnostic({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: true,
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolveKeySecurity: async () => ({ type: 'key', privateKey: 'secret' }),
		connectSavedEntry: async () => {
			throw new Error('second connect should not run');
		},
		recovery: readyRecovery,
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	assert.equal(second.status, 'busy');
	assert.match(second.prompt, /diagnostic is already running/i);
	resolveConnect({
		status: 'connected',
		sshConnection: {} as never,
		shellHandle: {} as never,
		connectionId: 'conn-1',
		channelId: 1,
	});
	assert.equal((await first).status, 'connected');
});

void test('manual diagnostic records failed connection and produces prompt', async () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });

	const result = await runManualConnectionDiagnostic({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: true,
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolveKeySecurity: async () => ({ type: 'key', privateKey: 'secret' }),
		connectSavedEntry: async () => {
			throw new Error('network unreachable');
		},
		recovery: unsupportedRecovery,
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	assert.equal(result.status, 'failed');
	assert.match(result.prompt, /network unreachable/);
	assert.match(result.prompt, /muly@dev\.tailnet\.ts\.net:22/);
	assert.doesNotMatch(result.prompt, /secret/);
});
