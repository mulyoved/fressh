import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildConnectionDebugCommandArgs,
	runConnectionDebugCommand,
} from '../../src/lib/connection-debug-command';
import { createConnectionDiagnosticRecorder } from '../../src/lib/connection-diagnostics';
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

void test('debug command closes menu, probes latest saved entry, and pastes prompt', async () => {
	const calls: string[] = [];
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });

	const result = await runConnectionDebugCommand({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
			pathname: '/shell/detail',
			appActive: true,
		},
		closeMenu: () => {
			calls.push('closeMenu');
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolvePrivateKey: async (keyId) => {
			calls.push(`resolve:${keyId}`);
			return 'private-key';
		},
		runProbe: async ({ connectionDetails, resolvedSecurity, trace }) => {
			calls.push(`probe:${connectionDetails.host}`);
			assert.equal(resolvedSecurity.privateKey, 'private-key');
			trace.event({
				type: 'probe.called',
				source: 'manual-diagnostic',
				connection: { host: connectionDetails.host },
			});
			return {
				status: 'connected',
				connectionId: 'conn-1',
				channelId: 7,
			};
		},
		recovery: readyRecovery,
		hasShell: true,
		pasteIntoTerminal: (prompt) => {
			calls.push(`paste:${prompt.includes('probe.called')}`);
		},
		copyToClipboard: async () => {
			calls.push('copy');
		},
		showAlert: (title) => {
			calls.push(`alert:${title}`);
		},
		logger: {
			warn: (message) => {
				calls.push(`warn:${message}`);
			},
		},
	});

	assert.equal(result.diagnostic.status, 'connected');
	assert.deepEqual(result.delivery, { status: 'pasted' });
	assert.deepEqual(calls, [
		'closeMenu',
		'resolve:key-1',
		'probe:dev.tailnet.ts.net',
		'paste:true',
	]);
});

void test('debug command reports key resolution failure through prompt delivery', async () => {
	const calls: string[] = [];
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });

	const result = await runConnectionDebugCommand({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
		},
		closeMenu: () => {
			calls.push('closeMenu');
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolvePrivateKey: async () => {
			throw new Error('missing key');
		},
		runProbe: async () => {
			throw new Error('probe should not run');
		},
		recovery: readyRecovery,
		hasShell: false,
		pasteIntoTerminal: () => {
			throw new Error('paste should not run');
		},
		copyToClipboard: async (prompt) => {
			calls.push(`copy:${prompt.includes('manual-diagnostic.key-missing')}`);
		},
		showAlert: (title) => {
			calls.push(`alert:${title}`);
		},
		logger: {
			warn: (message, error) => {
				calls.push(`warn:${message}:${(error as Error).message}`);
			},
		},
	});

	assert.equal(result.diagnostic.status, 'failed');
	assert.deepEqual(result.delivery, { status: 'copied' });
	assert.deepEqual(calls, [
		'closeMenu',
		'warn:Connection diagnostic key resolution failed:missing key',
		'copy:true',
		'alert:Connection debug prompt copied',
	]);
});

void test('debug command arg builder wires shell dependencies into probe and delivery', async () => {
	const calls: string[] = [];
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	const connect = async () => {
		calls.push('connect');
		return { connectionId: 'conn-1' } as never;
	};
	const args = buildConnectionDebugCommandArgs({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: true,
			isReconnecting: false,
			pathname: '/shell/detail',
			appActive: true,
		},
		closeMenu: () => {
			calls.push('closeMenu');
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolvePrivateKey: async (keyId) => {
			calls.push(`resolve:${keyId}`);
			return 'private-key';
		},
		runDiagnosticShellProbe: async ({
			connectionDetails,
			resolvedSecurity,
			trace,
			connect: receivedConnect,
		}) => {
			assert.equal(connectionDetails.host, 'dev.tailnet.ts.net');
			assert.deepEqual(resolvedSecurity, {
				type: 'key',
				privateKey: 'private-key',
			});
			assert.equal(receivedConnect, connect);
			assert.ok(trace);
			trace.event({
				type: 'builder.probe.called',
				source: 'manual-diagnostic',
				connection: { host: connectionDetails.host },
			});
			return {
				status: 'connected',
				connectionId: 'conn-1',
				channelId: 7,
			};
		},
		connect,
		recovery: readyRecovery,
		hasShell: true,
		pasteIntoTerminal: (prompt) => {
			calls.push(`paste:${prompt.includes('builder.probe.called')}`);
		},
		copyToClipboard: async (prompt) => {
			calls.push(`copy:${prompt.length > 0}`);
		},
		showAlert: (title) => {
			calls.push(`alert:${title}`);
		},
		logger: {
			warn: (message) => {
				calls.push(`warn:${message}`);
			},
		},
	});

	const result = await runConnectionDebugCommand(args);

	assert.equal(result.diagnostic.status, 'connected');
	assert.deepEqual(result.delivery, { status: 'pasted' });
	assert.deepEqual(calls, [
		'closeMenu',
		'resolve:key-1',
		'paste:true',
	]);
});

void test('debug command arg builder wires logger, clipboard, and alert dependencies', async () => {
	const calls: string[] = [];
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	const args = buildConnectionDebugCommandArgs({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
		},
		closeMenu: () => {
			calls.push('closeMenu');
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolvePrivateKey: async () => {
			throw new Error('missing key');
		},
		runDiagnosticShellProbe: async () => {
			throw new Error('probe should not run');
		},
		connect: async () => ({ connectionId: 'conn-1' }) as never,
		recovery: readyRecovery,
		hasShell: false,
		pasteIntoTerminal: () => {
			throw new Error('paste should not run');
		},
		copyToClipboard: async (prompt) => {
			calls.push(`copy:${prompt.includes('manual-diagnostic.key-missing')}`);
		},
		showAlert: (title) => {
			calls.push(`alert:${title}`);
		},
		logger: {
			warn: (message, error) => {
				calls.push(`warn:${message}:${(error as Error).message}`);
			},
		},
	});

	const result = await runConnectionDebugCommand(args);

	assert.equal(result.diagnostic.status, 'failed');
	assert.deepEqual(result.delivery, { status: 'copied' });
	assert.deepEqual(calls, [
		'closeMenu',
		'warn:Connection diagnostic key resolution failed:missing key',
		'copy:true',
		'alert:Connection debug prompt copied',
	]);
});
