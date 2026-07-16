import assert from 'node:assert/strict';
import test from 'node:test';
import {
	formatRecordedConnectionDiagnosticTrace,
	runConnectionDebugCommand,
} from '../../src/lib/connection-debug-command';
import {
	createConnectionDiagnosticRecorder,
	reconnectEvents,
	sshEvents,
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
		runDiagnosticShellProbe: async ({
			connectionDetails,
			resolvedSecurity,
			trace,
		}) => {
			calls.push(`probe:${connectionDetails.host}`);
			assert.equal(resolvedSecurity.type, 'key');
			assert.equal(resolvedSecurity.privateKey, 'private-key');
			if (!trace) {
				throw new Error('trace should be provided');
			}
			trace.event(
				sshEvents.connectProgress({
					source: 'manual-diagnostic',
					connection: { host: connectionDetails.host },
					phase: 'probe.called',
					message: 'probe.called',
				}),
			);
			return {
				status: 'connected',
				connectionId: 'conn-1',
				channelId: 7,
			};
		},
		connect: async () => {
			throw new Error('connect should be passed to probe');
		},
		recovery: readyRecovery,
		delivery: {
			type: 'terminal',
			paste: (prompt) => {
				calls.push(`paste:${prompt.includes('probe.called')}`);
			},
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

void test('debug command includes recorded reconnect trace history', async () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 1000 });
	const trace = recorder.startTrace({
		trigger: 'reconnect',
		reason: 'shell-drop',
	});
	trace.event(
		reconnectEvents.completed({
			source: 'reconnect-controller',
			outcome: 'needsAttention',
			destination: 'hostPage',
			message: 'Tailscale needs attention',
		}),
	);
	trace.finish('failed');
	const formattedTrace = formatRecordedConnectionDiagnosticTrace(trace.trace);
	assert.match(formattedTrace, /reason: shell-drop/);
	assert.match(formattedTrace, /reconnect.completed/);
	assert.match(formattedTrace, /destination=hostPage/);
	let copiedPrompt = '';

	const result = await runConnectionDebugCommand({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
		},
		closeMenu: () => {},
		loadLatestSavedConnection: async () => {
			throw new Error('manual diagnostic runner should not load saved entries');
		},
		resolvePrivateKey: async () => {
			throw new Error('manual diagnostic runner should not resolve keys');
		},
		runDiagnosticShellProbe: async () => {
			throw new Error('manual diagnostic runner should not probe');
		},
		connect: async () => ({ connectionId: 'conn-1' }) as never,
		recovery: readyRecovery,
		delivery: { type: 'clipboard-only' },
		copyToClipboard: async (prompt) => {
			copiedPrompt = prompt;
		},
		showAlert: () => {},
		logger: {
			warn: () => {},
		},
		manualDiagnosticRunner: {
			run: async () => ({
				prompt: 'manual diagnostic prompt',
				trace: null,
				status: 'skipped',
			}),
		},
	});

	assert.deepEqual(result.delivery, { status: 'copied' });
	assert.match(copiedPrompt, /Recorded reconnect traces/);
	assert.match(copiedPrompt, /reason: shell-drop/);
	assert.match(copiedPrompt, /reconnect.completed/);
	assert.match(copiedPrompt, /destination=hostPage/);
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
		runDiagnosticShellProbe: async () => {
			throw new Error('probe should not run');
		},
		connect: async () => {
			throw new Error('connect should not run');
		},
		recovery: readyRecovery,
		delivery: { type: 'clipboard-only' },
		copyToClipboard: async (prompt) => {
			calls.push(`copy:${prompt.includes('key.missing')}`);
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

void test('debug command wires shell dependencies into probe and delivery', async () => {
	const calls: string[] = [];
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	const connect = async () => {
		calls.push('connect');
		return { connectionId: 'conn-1' } as never;
	};

	const result = await runConnectionDebugCommand({
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
			operationSignals,
		}) => {
			assert.equal(connectionDetails.host, 'dev.tailnet.ts.net');
			assert.deepEqual(resolvedSecurity, {
				type: 'key',
				privateKey: 'private-key',
			});
			assert.equal(receivedConnect, connect);
			assert.ok(operationSignals?.connect instanceof AbortSignal);
			assert.equal(operationSignals.shell, operationSignals.connect);
			assert.equal(operationSignals.cleanup, undefined);
			assert.ok(trace);
			trace.event(
				sshEvents.connectProgress({
					source: 'manual-diagnostic',
					connection: { host: connectionDetails.host },
					phase: 'command.probe.called',
					message: 'command.probe.called',
				}),
			);
			return {
				status: 'connected',
				connectionId: 'conn-1',
				channelId: 7,
			};
		},
		connect,
		recovery: readyRecovery,
		delivery: {
			type: 'terminal',
			paste: (prompt) => {
				calls.push(`paste:${prompt.includes('command.probe.called')}`);
			},
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

	assert.equal(result.diagnostic.status, 'connected');
	assert.deepEqual(result.delivery, { status: 'pasted' });
	assert.deepEqual(calls, ['closeMenu', 'resolve:key-1', 'paste:true']);
});

void test('debug command wires logger, clipboard, and alert dependencies', async () => {
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
		runDiagnosticShellProbe: async () => {
			throw new Error('probe should not run');
		},
		connect: async () => ({ connectionId: 'conn-1' }) as never,
		recovery: readyRecovery,
		delivery: { type: 'clipboard-only' },
		copyToClipboard: async (prompt) => {
			calls.push(`copy:${prompt.includes('key.missing')}`);
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

void test('debug command forwards manual diagnostic signal into probe operation signals', async () => {
	const calls: string[] = [];
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	const sentinelSignal = new AbortController().signal;

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
		loadLatestSavedConnection: async () => {
			throw new Error('default runner should not load saved entries');
		},
		resolvePrivateKey: async () => {
			throw new Error('default runner should not resolve keys');
		},
		runDiagnosticShellProbe: async ({ operationSignals }) => {
			assert.equal(operationSignals?.connect, sentinelSignal);
			assert.equal(operationSignals?.shell, sentinelSignal);
			assert.equal(operationSignals?.cleanup, undefined);
			calls.push('probe');
			return {
				status: 'connected',
				connectionId: 'conn-1',
				channelId: 7,
			};
		},
		connect: async () => ({ connectionId: 'conn-1' }) as never,
		recovery: readyRecovery,
		delivery: { type: 'clipboard-only' },
		copyToClipboard: async (prompt) => {
			calls.push(`copy:${prompt}`);
		},
		showAlert: (title) => {
			calls.push(`alert:${title}`);
		},
		logger: {
			warn: (message) => {
				calls.push(`warn:${message}`);
			},
		},
		manualDiagnosticRunner: {
			run: async (args) => {
				const trace = args.recorder.startTrace({
					trigger: 'manual-diagnostic',
					reason: 'command-menu',
				});
				await args.connectSavedEntry({
					connectionDetails: {
						...savedEntry.value,
						useTmux: true,
						tmuxSessionName: 'main',
						autoConnect: true,
					},
					resolvedSecurity: { type: 'key', privateKey: 'private-key' },
					trace,
					signal: sentinelSignal,
				});
				trace.finish('connected');
				return {
					status: 'connected',
					prompt: 'signal prompt',
					trace: trace.trace,
				};
			},
		},
	});

	assert.equal(result.diagnostic.status, 'connected');
	assert.deepEqual(result.delivery, { status: 'copied' });
	assert.deepEqual(calls, [
		'closeMenu',
		'probe',
		'copy:signal prompt',
		'alert:Connection debug prompt copied',
	]);
});

void test('debug command can use an injected manual diagnostic runner', async () => {
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
		loadLatestSavedConnection: async () => {
			throw new Error('default runner should not load saved entries');
		},
		resolvePrivateKey: async () => {
			throw new Error('default runner should not resolve keys');
		},
		runDiagnosticShellProbe: async () => {
			throw new Error('default runner should not probe');
		},
		connect: async () => ({ connectionId: 'conn-1' }) as never,
		recovery: readyRecovery,
		delivery: { type: 'clipboard-only' },
		copyToClipboard: async (prompt) => {
			calls.push(`copy:${prompt}`);
		},
		showAlert: (title) => {
			calls.push(`alert:${title}`);
		},
		logger: {
			warn: (message) => {
				calls.push(`warn:${message}`);
			},
		},
		manualDiagnosticRunner: {
			run: async (args) => {
				assert.equal(args.recorder, recorder);
				calls.push('runner');
				return {
					status: 'skipped',
					prompt: 'injected prompt',
					trace: null,
				};
			},
		},
	});

	assert.equal(result.diagnostic.status, 'skipped');
	assert.deepEqual(result.delivery, { status: 'copied' });
	assert.deepEqual(calls, [
		'closeMenu',
		'runner',
		'copy:injected prompt',
		'alert:Connection debug prompt copied',
	]);
});
