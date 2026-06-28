import assert from 'node:assert/strict';
import test from 'node:test';
import { type ConnectAndOpenShellResult } from '../../src/lib/connect-and-open-shell';
import { runManualConnectionDiagnostic } from '../../src/lib/connection-diagnostic-runner';
import {
	createConnectionDiagnosticRecorder,
	formatConnectionDiagnosticPrompt,
} from '../../src/lib/connection-diagnostics';
import { type SavedConnectionEntry } from '../../src/lib/connection-utils';

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
	const competingRecorder = createConnectionDiagnosticRecorder({
		now: () => 50,
	});
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
	recorder.getLatestTrace()?.events.push({
		type: 'caller-mutation-ignored',
		source: 'manual-diagnostic',
		atMs: 10,
		elapsedMs: 0,
	});

	const second = await runManualConnectionDiagnostic({
		recorder: competingRecorder,
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
	assert.match(second.prompt, /auto-connect\.saved-entry\.connect\.started/);
	assert.equal(second.trace?.id, recorder.getLatestTrace()?.id);
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

void test('manual diagnostic records missing saved key as failed trace', async () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });

	const result = await runManualConnectionDiagnostic({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolveKeySecurity: async () => null,
		connectSavedEntry: async () => {
			throw new Error('connect should not run');
		},
		recovery: readyRecovery,
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	assert.equal(result.status, 'failed');
	assert.match(result.prompt, /manual-diagnostic\.key-missing/);
	assert.equal(recorder.getLatestTrace()?.status, 'failed');
});

void test('manual diagnostic timeout releases single-flight state', async () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	let resolveLoad: (value: SavedConnectionEntry) => void = () => {};
	let connectCalls = 0;

	const timedOut = await runManualConnectionDiagnostic({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
		},
		loadLatestSavedConnection: async () =>
			new Promise((resolve) => {
				resolveLoad = resolve;
			}),
		resolveKeySecurity: async () => {
			throw new Error('key lookup should not run');
		},
		connectSavedEntry: async () => {
			connectCalls += 1;
			throw new Error('stale connect should not run');
		},
		recovery: readyRecovery,
		formatPrompt: formatConnectionDiagnosticPrompt,
		timeoutMs: 5,
	});

	assert.equal(timedOut.status, 'failed');
	assert.match(timedOut.prompt, /manual-diagnostic\.timeout/);
	assert.match(timedOut.prompt, /timed out after 5ms/);
	resolveLoad(savedEntry);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(connectCalls, 0);

	const next = await runManualConnectionDiagnostic({
		recorder,
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
		recovery: unsupportedRecovery,
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	assert.equal(next.status, 'skipped');
});

void test('manual diagnostic start trace failure does not wedge single-flight state', async () => {
	const failingRecorder = {
		getLatestTrace: () => null,
		getHistory: () => [],
		clear: () => {},
		startTrace: () => {
			throw new Error('trace start failed');
		},
	};

	await assert.rejects(
		runManualConnectionDiagnostic({
			recorder: failingRecorder,
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
			recovery: unsupportedRecovery,
			formatPrompt: formatConnectionDiagnosticPrompt,
		}),
		/trace start failed/,
	);

	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	const result = await runManualConnectionDiagnostic({
		recorder,
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
		recovery: unsupportedRecovery,
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	assert.equal(result.status, 'skipped');
});

void test('manual diagnostic continues when trace events and finish fail', async () => {
	let connected = false;
	const throwingHandle = {
		get trace() {
			return {
				id: 'trace-throwing',
				trigger: 'manual-diagnostic' as const,
				reason: 'command-menu',
				status: 'running' as const,
				startedAtMs: 10,
				events: [],
			};
		},
		event: () => {
			throw new Error('event failed');
		},
		finish: () => {
			throw new Error('finish failed');
		},
	};
	const recorder = {
		getLatestTrace: () => null,
		getHistory: () => [],
		clear: () => {},
		startTrace: () => throwingHandle,
	};

	const result = await runManualConnectionDiagnostic({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolveKeySecurity: async () => ({ type: 'key', privateKey: 'secret' }),
		connectSavedEntry: async () => {
			connected = true;
			return {
				status: 'connected',
				sshConnection: {} as never,
				shellHandle: {} as never,
				connectionId: 'conn-1',
				channelId: 1,
			};
		},
		recovery: readyRecovery,
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	assert.equal(result.status, 'connected');
	assert.equal(connected, true);
	assert.equal(result.trace?.id, 'trace-throwing');
});

void test('manual diagnostic prompt uses normalized tmux settings', async () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	const legacyEntry: SavedConnectionEntry = {
		...savedEntry,
		value: {
			...savedEntry.value,
			useTmux: undefined,
			tmuxSessionName: '   ',
		},
	};

	const result = await runManualConnectionDiagnostic({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
		},
		loadLatestSavedConnection: async () => legacyEntry,
		resolveKeySecurity: async () => ({ type: 'key', privateKey: 'secret' }),
		connectSavedEntry: async ({ connectionDetails }) => {
			assert.equal(connectionDetails.useTmux, true);
			assert.equal(connectionDetails.tmuxSessionName, 'main');
			return {
				status: 'connected',
				sshConnection: {} as never,
				shellHandle: {} as never,
				connectionId: 'conn-1',
				channelId: 1,
			};
		},
		recovery: readyRecovery,
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	assert.match(result.prompt, /useTmux=true/);
	assert.match(result.prompt, /tmuxSessionName=main/);
});
