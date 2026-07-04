import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createManualConnectionDiagnosticRunner,
	runManualConnectionDiagnostic,
} from '../../src/lib/connection-diagnostic-runner';
import {
	createConnectionDiagnosticRecorder,
	formatConnectionDiagnosticPrompt,
} from '../../src/lib/connection-diagnostics';
import { type SavedConnectionEntry } from '../../src/lib/connection-utils';
import {
	DiagnosticShellCleanupError,
	type DiagnosticShellProbeResult,
} from '../../src/lib/diagnostic-shell-probe';
import { TAILSCALE_UNAVAILABLE_MESSAGE } from '../../src/lib/tailscale-recovery-core';

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

void test('manual diagnostic runner instances do not share single-flight state', async () => {
	const firstRunner = createManualConnectionDiagnosticRunner();
	const secondRunner = createManualConnectionDiagnosticRunner();
	const firstRecorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	const secondRecorder = createConnectionDiagnosticRecorder({ now: () => 20 });
	const blocked = new Promise<never>(() => undefined);

	const first = firstRunner.run({
		recorder: firstRecorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolveKeySecurity: async () => ({
			type: 'key',
			privateKey: 'private-key',
		}),
		connectSavedEntry: async () => blocked,
		recovery: readyRecovery,
		timeoutMs: 5,
	});

	const second = await secondRunner.run({
		recorder: secondRecorder,
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
		recovery: readyRecovery,
		timeoutMs: 50,
	});

	assert.equal(second.status, 'skipped');
	assert.equal((await first).status, 'failed');
});

void test('manual diagnostic is single-flight', async () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	const competingRecorder = createConnectionDiagnosticRecorder({
		now: () => 50,
	});
	let resolveConnect: (value: DiagnosticShellProbeResult) => void = () => {};
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
			new Promise<DiagnosticShellProbeResult>((resolve) => {
				resolveConnect = resolve;
				notifyConnectStarted();
			}),
		recovery: readyRecovery,
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	await connectStarted;
	recorder.getLatestTrace()?.events.push({
		kind: 'manual-diagnostic.timeout',
		source: 'manual-diagnostic',
		message: 'caller-mutation-ignored',
		timeoutMs: 1,
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
	assert.match(second.prompt, /tailscale\.ensure-ready\.result/);
	assert.doesNotMatch(second.prompt, /auto-connect\./);
	assert.equal(second.trace?.id, recorder.getLatestTrace()?.id);
	resolveConnect({
		status: 'connected',
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
	assert.match(result.prompt, /manual-diagnostic\.warning/);
	assert.ok(result.prompt.includes('Saved-entry connection threw.'));
	assert.doesNotMatch(result.prompt, /auto-connect\./);
	assert.match(result.prompt, /muly@dev\.tailnet\.ts\.net:22/);
	assert.doesNotMatch(result.prompt, /secret/);
	const initialWarning = result.trace?.events.find(
		(event) =>
			event.kind === 'manual-diagnostic.warning' &&
			event.message === 'Saved-entry connection threw.',
	);
	assert.equal(initialWarning?.message, 'Saved-entry connection threw.');
});

void test('manual diagnostic records returned saved-entry abort as failed diagnostic', async () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	const abortReason = new Error('saved-entry connect aborted');

	const result = await runManualConnectionDiagnostic({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: true,
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolveKeySecurity: async () => ({ type: 'key', privateKey: 'secret' }),
		connectSavedEntry: async () => ({
			status: 'aborted',
			reason: abortReason,
		}),
		recovery: unsupportedRecovery,
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	assert.equal(result.status, 'failed');
	assert.equal(recorder.getLatestTrace()?.status, 'failed');
	assert.match(result.prompt, /manual-diagnostic\.failed/);
	assert.match(result.prompt, /saved-entry connect aborted/);
	assert.doesNotMatch(result.prompt, /auto-connect\./);
	assert.doesNotMatch(result.prompt, /secret/);
	const failedEvent = result.trace?.events.find(
		(event) => event.kind === 'manual-diagnostic.failed',
	);
	assert.equal(failedEvent?.error.message, 'saved-entry connect aborted');
});

void test('manual diagnostic records non-error saved-entry abort as failed diagnostic', async () => {
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
		connectSavedEntry: async () => ({
			status: 'aborted',
			reason: 'caller-aborted',
		}),
		recovery: unsupportedRecovery,
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	assert.equal(result.status, 'failed');
	assert.equal(recorder.getLatestTrace()?.status, 'failed');
	assert.match(result.prompt, /manual-diagnostic\.failed/);
	assert.match(result.prompt, /Saved-entry connection aborted/);
	assert.doesNotMatch(result.prompt, /auto-connect\./);
	assert.doesNotMatch(result.prompt, /secret/);
	const failedEvent = result.trace?.events.find(
		(event) => event.kind === 'manual-diagnostic.failed',
	);
	assert.equal(failedEvent?.error.message, 'Saved-entry connection aborted');
});

void test('manual diagnostic records Tailscale attention without auto-connect events', async () => {
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
			throw new Error('connect should not run');
		},
		recovery: {
			ensureReady: async () => ({
				kind: 'unavailable' as const,
				attempted: false as const,
				available: false as const,
			}),
			recoverAfterFailure: async () => {
				throw new Error('recovery should not run');
			},
		},
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	assert.equal(result.status, 'failed');
	assert.match(result.prompt, /manual-diagnostic\.tailscale\.attention/);
	assert.ok(result.prompt.includes(TAILSCALE_UNAVAILABLE_MESSAGE));
	assert.doesNotMatch(result.prompt, /auto-connect\./);
	const attentionEvent = result.trace?.events.find(
		(event) => event.kind === 'manual-diagnostic.tailscale.attention',
	);
	assert.equal(attentionEvent?.message, TAILSCALE_UNAVAILABLE_MESSAGE);
});

void test('manual diagnostic does not retry diagnostic cleanup failures', async () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	let connectCalls = 0;
	let recoveryCalls = 0;

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
			connectCalls += 1;
			throw new DiagnosticShellCleanupError(
				new Error('connection reset during disconnect'),
			);
		},
		recovery: {
			...readyRecovery,
			recoverAfterFailure: async () => {
				recoveryCalls += 1;
				return {
					kind: 'recovered',
					attempted: true,
					networkLikeFailure: true,
					available: true,
				};
			},
		},
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	assert.equal(result.status, 'failed');
	assert.equal(connectCalls, 1);
	assert.equal(recoveryCalls, 0);
	assert.match(result.prompt, /DiagnosticShellCleanupError/);
	assert.match(result.prompt, /connection reset during disconnect/);
	assert.doesNotMatch(result.prompt, /auto-connect\./);
});

void test('manual diagnostic preserves cleanup failure after Tailscale retry', async () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	let connectCalls = 0;

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
			connectCalls += 1;
			if (connectCalls === 1) {
				throw new Error('No route to host');
			}
			throw new DiagnosticShellCleanupError(
				new Error('connection reset during disconnect'),
			);
		},
		recovery: {
			...readyRecovery,
			recoverAfterFailure: async () => ({
				kind: 'recovered',
				attempted: true,
				networkLikeFailure: true,
				available: true,
			}),
		},
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	assert.equal(result.status, 'failed');
	assert.equal(connectCalls, 2);
	assert.match(result.prompt, /manual-diagnostic\.warning/);
	assert.ok(result.prompt.includes('Saved-entry retry threw.'));
	assert.match(result.prompt, /DiagnosticShellCleanupError/);
	assert.doesNotMatch(result.prompt, /auto-connect\./);
	assert.doesNotMatch(result.prompt, /restart failed/i);
	const retryWarning = result.trace?.events.find(
		(event) =>
			event.kind === 'manual-diagnostic.warning' &&
			event.message === 'Saved-entry retry threw.',
	);
	assert.equal(retryWarning?.message, 'Saved-entry retry threw.');
});

void test('manual diagnostic records tmux attach failures in the prompt', async () => {
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
		connectSavedEntry: async () => ({
			status: 'tmux_attach_failed',
			connectionId: 'conn-1',
			tmuxAttachFailureReason: 'missing session',
			tmuxSessionName: 'main',
			storedConnectionId: 'stored-1',
		}),
		recovery: readyRecovery,
		formatPrompt: formatConnectionDiagnosticPrompt,
	});

	assert.equal(result.status, 'failed');
	assert.match(result.prompt, /manual-diagnostic\.tmux-attach-failed/);
	assert.match(result.prompt, /missing session/);
	assert.match(result.prompt, /tmuxSessionName=main/);
	assert.doesNotMatch(result.prompt, /auto-connect\./);
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
	assert.match(result.prompt, /key\.missing/);
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

void test('manual diagnostic timeout aborts underlying saved-entry work', async () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	const observed = { signal: null as AbortSignal | null };
	let resolveConnectStarted: () => void = () => {};
	const connectStarted = new Promise<void>((resolve) => {
		resolveConnectStarted = resolve;
	});

	const resultPromise = createManualConnectionDiagnosticRunner().run({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolveKeySecurity: async () => ({ type: 'key', privateKey: 'secret' }),
		connectSavedEntry: async ({ signal }) => {
			observed.signal = signal;
			resolveConnectStarted();
			return new Promise<DiagnosticShellProbeResult>(() => undefined);
		},
		recovery: readyRecovery,
		timeoutMs: 5,
	});

	await connectStarted;
	const result = await resultPromise;

	assert.equal(result.status, 'failed');
	assert.equal(observed.signal?.aborted, true);
	assert.match(result.prompt, /timed out/i);
});

void test('manual diagnostic timeout does not recover after abort-aware connect rejects', async () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	let recoveryCalls = 0;
	let resolveConnectStarted: () => void = () => {};
	const connectStarted = new Promise<void>((resolve) => {
		resolveConnectStarted = resolve;
	});

	const resultPromise = createManualConnectionDiagnosticRunner().run({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolveKeySecurity: async () => ({ type: 'key', privateKey: 'secret' }),
		connectSavedEntry: async ({ signal }) => {
			resolveConnectStarted();
			return await new Promise<DiagnosticShellProbeResult>(
				(_resolve, reject) => {
					signal.addEventListener(
						'abort',
						() => {
							reject(new Error('connect aborted'));
						},
						{ once: true },
					);
				},
			);
		},
		recovery: {
			...readyRecovery,
			recoverAfterFailure: async () => {
				recoveryCalls += 1;
				return {
					kind: 'recovered',
					attempted: true,
					networkLikeFailure: true,
					available: true,
				};
			},
		},
		timeoutMs: 5,
	});

	await connectStarted;
	const result = await resultPromise;
	await new Promise((resolve) => setTimeout(resolve, 0));

	assert.equal(result.status, 'failed');
	assert.match(result.prompt, /timed out/i);
	assert.equal(recoveryCalls, 0);
});

void test('manual diagnostic ignores late connected result after timeout', async () => {
	const recorder = createConnectionDiagnosticRecorder({ now: () => 10 });
	const observed = { signal: null as AbortSignal | null };
	let resolveConnectStarted: () => void = () => {};
	let resolveConnect: (result: DiagnosticShellProbeResult) => void = () => {};
	const connectStarted = new Promise<void>((resolve) => {
		resolveConnectStarted = resolve;
	});

	const resultPromise = createManualConnectionDiagnosticRunner().run({
		recorder,
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
		},
		loadLatestSavedConnection: async () => savedEntry,
		resolveKeySecurity: async () => ({ type: 'key', privateKey: 'secret' }),
		connectSavedEntry: async ({ signal }) => {
			observed.signal = signal;
			resolveConnectStarted();
			return await new Promise<DiagnosticShellProbeResult>((resolve) => {
				resolveConnect = resolve;
			});
		},
		recovery: readyRecovery,
		timeoutMs: 5,
	});

	await connectStarted;
	const result = await resultPromise;
	resolveConnect({
		status: 'connected',
		connectionId: 'conn-1',
		channelId: 7,
	});
	await new Promise((resolve) => setTimeout(resolve, 0));

	assert.equal(result.status, 'failed');
	assert.equal(observed.signal?.aborted, true);
	assert.match(result.prompt, /timed out/i);
	assert.equal(recorder.getLatestTrace()?.status, 'failed');
	assert.match(
		JSON.stringify(recorder.getLatestTrace()?.events),
		/manual-diagnostic\.timeout/,
	);
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
