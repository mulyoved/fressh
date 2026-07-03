import assert from 'node:assert/strict';
import test from 'node:test';
import {
	type SavedEntryConnectAttemptPhase,
	type SavedEntryConnectResult,
	type SavedEntryTailscaleRecovery,
} from '../../src/lib/auto-connect-saved-entry';
import {
	runActiveShellReopenAttempt,
	runSavedEntryConnectionAttempt,
	type ConnectionAttemptTimeouts,
} from '../../src/lib/connection-attempt-lifecycle';
import {
	createConnectionRunContext,
	type ConnectionRunContext,
} from '../../src/lib/connection-run-context';

type Timer = {
	delayMs: number;
	callback: () => void;
	cleared: boolean;
};

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
};

const timeouts: ConnectionAttemptTimeouts = {
	operationTimeoutMs: 50,
	recoveryTimeoutMs: 80,
	cleanupTimeoutMs: 25,
};

function deferred<T>(): Deferred<T> {
	let resolve: (value: T) => void = () => {};
	let reject: (error: unknown) => void = () => {};
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
}

function flushPromises() {
	return new Promise<void>((resolve) => {
		setImmediate(resolve);
	});
}

function requireSignal(signal: AbortSignal | null): AbortSignal {
	if (signal === null) {
		throw new assert.AssertionError({
			message: 'Expected cleanup to capture an AbortSignal',
		});
	}
	return signal;
}

function runHarness(opts?: { isCurrent?: () => boolean }): {
	runContext: ConnectionRunContext;
	timers: Timer[];
} {
	const timers: Timer[] = [];
	const runContext = createConnectionRunContext({
		isCurrent: opts?.isCurrent,
		timeouts,
		setTimeout: (callback, delayMs) => {
			const timer = { delayMs, callback, cleared: false };
			timers.push(timer);
			return timer;
		},
		clearTimeout: (timer) => {
			(timer as Timer).cleared = true;
		},
	});
	return { runContext, timers };
}

function readyRecovery(opts?: {
	afterFailure?: ReturnType<
		SavedEntryTailscaleRecovery['recoverAfterFailure']
	> extends Promise<infer TResult>
		? TResult
		: never;
}): SavedEntryTailscaleRecovery {
	return {
		ensureReady: async () => ({
			kind: 'ready',
			attempted: true,
			available: true,
		}),
		recoverAfterFailure: async () =>
			opts?.afterFailure ?? {
				kind: 'nonNetworkFailure',
				attempted: false,
				networkLikeFailure: false,
				available: true,
			},
	};
}

function connectedResult(
	connectionId = 'conn-1',
	channelId = 7,
): SavedEntryConnectResult {
	return {
		status: 'connected',
		connectionId,
		channelId,
	};
}

function tmuxAttachFailedResult(
	connectionId = 'conn-tmux',
): SavedEntryConnectResult {
	return {
		status: 'tmux_attach_failed',
		connectionId,
		tmuxAttachFailureReason: 'no-session',
		tmuxSessionName: 'work',
		storedConnectionId: 'stored-1',
	};
}

void test('saved-entry lifecycle returns connected outcome and passes initial phase', async () => {
	const { runContext } = runHarness();
	const phases: SavedEntryConnectAttemptPhase[] = [];

	const outcome = await runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'auto-connect',
		runContext,
		recovery: readyRecovery(),
		connectSavedEntry: async ({ phase }) => {
			phases.push(phase);
			return connectedResult();
		},
		cleanupConnected: async () => {},
	});

	assert.deepEqual(outcome, {
		status: 'connected',
		connectionId: 'conn-1',
		channelId: 7,
	});
	assert.deepEqual(phases, ['initial']);
});

void test('saved-entry lifecycle maps Tailscale readiness block and does not connect', async () => {
	const { runContext } = runHarness();
	let connectCount = 0;

	const outcome = await runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'manual-diagnostic',
		runContext,
		recovery: {
			ensureReady: async () => ({
				kind: 'unavailable',
				attempted: false,
				available: false,
			}),
			recoverAfterFailure: async () => {
				throw new Error('recovery should not run');
			},
		},
		connectSavedEntry: async () => {
			connectCount += 1;
			throw new Error('connect should not run');
		},
		cleanupConnected: async () => {},
	});

	assert.equal(outcome.status, 'blocked');
	assert.equal(connectCount, 0);
	if (outcome.status !== 'blocked') return;
	assert.match(outcome.attentionMessage ?? '', /Tailscale/i);
});

void test('saved-entry lifecycle maps tmux attach failure metadata', async () => {
	const { runContext } = runHarness();

	const outcome = await runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'auto-connect',
		runContext,
		recovery: readyRecovery(),
		connectSavedEntry: async () => tmuxAttachFailedResult(),
		cleanupConnected: async () => {},
	});

	assert.deepEqual(outcome, {
		status: 'tmuxAttachFailed',
		connectionId: 'conn-tmux',
		tmuxAttachFailureReason: 'no-session',
		tmuxSessionName: 'work',
		storedConnectionId: 'stored-1',
	});
});

void test('saved-entry lifecycle treats readiness abort errors as failures when run is active', async () => {
	const { runContext } = runHarness();
	const abortError = Object.assign(new Error('The operation was aborted.'), {
		name: 'AbortError',
	});

	const outcome = await runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'auto-connect',
		runContext,
		recovery: {
			ensureReady: async () => {
				throw abortError;
			},
			recoverAfterFailure: async () => {
				throw new Error('recovery should not run');
			},
		},
		connectSavedEntry: async () => {
			throw new Error('connect should not run');
		},
		cleanupConnected: async () => {},
	});

	assert.deepEqual(outcome, {
		status: 'failed',
		error: abortError,
		recoverable: false,
		attentionMessage: null,
	});
});

void test('saved-entry lifecycle retries after Tailscale recovery', async () => {
	const { runContext } = runHarness();
	const phases: SavedEntryConnectAttemptPhase[] = [];

	const outcome = await runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'auto-connect',
		runContext,
		recovery: readyRecovery({
			afterFailure: {
				kind: 'recovered',
				attempted: true,
				networkLikeFailure: true,
				available: true,
			},
		}),
		connectSavedEntry: async ({ phase }) => {
			phases.push(phase);
			if (phase === 'initial') throw new Error('No route to host');
			return connectedResult('conn-2', 8);
		},
		cleanupConnected: async () => {},
	});

	assert.deepEqual(outcome, {
		status: 'connected',
		connectionId: 'conn-2',
		channelId: 8,
	});
	assert.deepEqual(phases, ['initial', 'retry']);
});

void test('saved-entry lifecycle maps non-network recovery failure as non-recoverable', async () => {
	const { runContext } = runHarness();
	const connectError = new Error('permission denied');

	const outcome = await runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'auto-connect',
		runContext,
		recovery: readyRecovery({
			afterFailure: {
				kind: 'nonNetworkFailure',
				attempted: false,
				networkLikeFailure: false,
				available: true,
			},
		}),
		connectSavedEntry: async () => {
			throw connectError;
		},
		cleanupConnected: async () => {},
	});

	assert.deepEqual(outcome, {
		status: 'failed',
		error: connectError,
		recoverable: false,
		attentionMessage: null,
	});
});

void test('saved-entry lifecycle preserves Tailscale attention on recovery failure', async () => {
	const { runContext } = runHarness();
	const connectError = new Error('No route to host');

	const outcome = await runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'auto-connect',
		runContext,
		recovery: readyRecovery({
			afterFailure: {
				kind: 'failed',
				attempted: true,
				networkLikeFailure: true,
				available: true,
			},
		}),
		connectSavedEntry: async () => {
			throw connectError;
		},
		cleanupConnected: async () => {},
	});

	assert.equal(outcome.status, 'failed');
	if (outcome.status !== 'failed') return;
	assert.equal(outcome.error, connectError);
	assert.equal(outcome.recoverable, false);
	assert.match(outcome.attentionMessage ?? '', /Tailscale/i);
});

void test('saved-entry lifecycle maps retry failure as recoverable with attention', async () => {
	const { runContext } = runHarness();
	const retryError = new Error('No route to host');

	const outcome = await runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'auto-connect',
		runContext,
		recovery: readyRecovery({
			afterFailure: {
				kind: 'recovered',
				attempted: true,
				networkLikeFailure: true,
				available: true,
			},
		}),
		connectSavedEntry: async () => {
			throw retryError;
		},
		cleanupConnected: async () => {},
	});

	assert.equal(outcome.status, 'failed');
	if (outcome.status !== 'failed') return;
	assert.equal(outcome.error, retryError);
	assert.equal(outcome.recoverable, true);
	assert.match(outcome.attentionMessage ?? '', /Tailscale/i);
});

void test('saved-entry lifecycle treats dependency abort errors as failures when run is active', async () => {
	const { runContext } = runHarness();
	const abortError = Object.assign(new Error('The operation was aborted.'), {
		name: 'AbortError',
	});

	const outcome = await runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'auto-connect',
		runContext,
		recovery: readyRecovery(),
		shouldRecoverAfterFailure: () => false,
		connectSavedEntry: async () => {
			throw abortError;
		},
		cleanupConnected: async () => {},
	});

	assert.deepEqual(outcome, {
		status: 'failed',
		error: abortError,
		recoverable: false,
		attentionMessage: null,
	});
});

void test('saved-entry lifecycle maps operation timeout', async () => {
	const { runContext, timers } = runHarness();

	const outcomePromise = runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'auto-connect',
		runContext,
		recovery: readyRecovery(),
		connectSavedEntry: async () =>
			new Promise<SavedEntryConnectResult>(() => {}),
		cleanupConnected: async () => {},
	});
	await flushPromises();

	assert.equal(timers[0]?.delayMs, 80);
	assert.equal(timers[1]?.delayMs, 50);
	timers[1]?.callback();

	assert.deepEqual(await outcomePromise, {
		status: 'timedOut',
		timeoutKind: 'operation',
	});
});

void test('saved-entry lifecycle cleans up success that arrives after operation timeout', async () => {
	const { runContext, timers } = runHarness();
	const connect = deferred<SavedEntryConnectResult>();
	let cleanupCount = 0;
	let cleanedOutcome: unknown = null;

	const outcomePromise = runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'auto-connect',
		runContext,
		recovery: readyRecovery(),
		connectSavedEntry: async () => connect.promise,
		cleanupConnected: async (outcome) => {
			cleanupCount += 1;
			cleanedOutcome = outcome;
		},
	});
	await flushPromises();

	timers[1]?.callback();

	assert.deepEqual(await outcomePromise, {
		status: 'timedOut',
		timeoutKind: 'operation',
	});
	assert.equal(cleanupCount, 0);

	connect.resolve(connectedResult());
	await flushPromises();
	await flushPromises();

	assert.equal(cleanupCount, 1);
	assert.deepEqual(cleanedOutcome, {
		status: 'connected',
		connectionId: 'conn-1',
		channelId: 7,
	});
});

void test('saved-entry timeout late cleanup keeps deadline after run finish', async () => {
	const { runContext, timers } = runHarness();
	const connect = deferred<SavedEntryConnectResult>();
	const cleanupStarted = deferred<void>();
	let cleanupSignal: AbortSignal | null = null;
	let cleanedOutcome: unknown = null;
	let reportedCleanupFailure: unknown = null;

	const outcomePromise = runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'auto-connect',
		runContext,
		recovery: readyRecovery(),
		connectSavedEntry: async () => connect.promise,
		cleanupConnected: async (outcome, signal) => {
			cleanedOutcome = outcome;
			cleanupSignal = signal;
			cleanupStarted.resolve();
			await new Promise<void>(() => {});
		},
		onLateCleanupFailure: (outcome) => {
			reportedCleanupFailure = outcome;
		},
	});
	await flushPromises();

	timers[1]?.callback();

	assert.deepEqual(await outcomePromise, {
		status: 'timedOut',
		timeoutKind: 'operation',
	});
	runContext.finish();

	connect.resolve(connectedResult());
	await cleanupStarted.promise;

	assert.equal(requireSignal(cleanupSignal).aborted, false);
	timers.at(-1)?.callback();
	await flushPromises();
	assert.equal(requireSignal(cleanupSignal).aborted, true);
	assert.deepEqual(cleanedOutcome, {
		status: 'connected',
		connectionId: 'conn-1',
		channelId: 7,
	});
	assert.deepEqual(reportedCleanupFailure, {
		status: 'timedOut',
		timeoutKind: 'cleanup',
	});
});

void test('saved-entry lifecycle cleans up stale late success', async () => {
	let current = true;
	const { runContext } = runHarness({ isCurrent: () => current });
	const connect = deferred<SavedEntryConnectResult>();
	let cleanupCount = 0;
	let cleanedOutcome: unknown = null;

	const outcomePromise = runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'auto-connect',
		runContext,
		recovery: readyRecovery(),
		connectSavedEntry: async () => connect.promise,
		cleanupConnected: async (outcome) => {
			cleanupCount += 1;
			cleanedOutcome = outcome;
		},
	});
	await flushPromises();

	current = false;
	connect.resolve(connectedResult());

	assert.deepEqual(await outcomePromise, {
		status: 'aborted',
		reason: 'stale-run',
	});
	assert.equal(cleanupCount, 1);
	assert.deepEqual(cleanedOutcome, {
		status: 'connected',
		connectionId: 'conn-1',
		channelId: 7,
	});
});

void test('saved-entry lifecycle preserves stale outcome when stale cleanup fails', async () => {
	let current = true;
	const { runContext } = runHarness({ isCurrent: () => current });
	const connect = deferred<SavedEntryConnectResult>();
	let cleanupCount = 0;
	let reportedCleanupFailure: unknown = null;

	const outcomePromise = runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'auto-connect',
		runContext,
		recovery: readyRecovery(),
		connectSavedEntry: async () => connect.promise,
		cleanupConnected: async () => {
			cleanupCount += 1;
			throw new Error('disconnect failed');
		},
		onLateCleanupFailure: (outcome) => {
			reportedCleanupFailure = outcome;
		},
	});
	await flushPromises();

	current = false;
	connect.resolve(connectedResult());

	assert.deepEqual(await outcomePromise, {
		status: 'aborted',
		reason: 'stale-run',
	});
	assert.equal(cleanupCount, 1);
	assert.equal(
		(reportedCleanupFailure as { status?: unknown } | null)?.status,
		'cleanupFailed',
	);
});

void test('saved-entry lifecycle ignores late cleanup failure reporter errors', async () => {
	let current = true;
	const { runContext } = runHarness({ isCurrent: () => current });
	const connect = deferred<SavedEntryConnectResult>();

	const outcomePromise = runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'auto-connect',
		runContext,
		recovery: readyRecovery(),
		connectSavedEntry: async () => connect.promise,
		cleanupConnected: async () => {
			throw new Error('disconnect failed');
		},
		onLateCleanupFailure: () => {
			throw new Error('report failed');
		},
	});
	await flushPromises();

	current = false;
	connect.resolve(connectedResult());

	assert.deepEqual(await outcomePromise, {
		status: 'aborted',
		reason: 'stale-run',
	});
});

void test('manual diagnostic mode returns cleanup failure with prior outcome', async () => {
	const { runContext } = runHarness();
	const cleanupError = new Error('disconnect failed');

	const outcome = await runSavedEntryConnectionAttempt({
		platformOS: 'android',
		mode: 'manual-diagnostic',
		runContext,
		recovery: readyRecovery(),
		connectSavedEntry: async () => connectedResult(),
		cleanupConnected: async () => {
			throw cleanupError;
		},
	});

	assert.equal(outcome.status, 'cleanupFailed');
	if (outcome.status !== 'cleanupFailed') return;
	assert.equal(outcome.error, cleanupError);
	assert.deepEqual(outcome.priorOutcome, {
		status: 'connected',
		connectionId: 'conn-1',
		channelId: 7,
	});
});

void test('active shell reopen returns connected outcome', async () => {
	const { runContext } = runHarness();

	const outcome = await runActiveShellReopenAttempt({
		runContext,
		startShell: async () => ({
			connectionId: 'active-1',
			channelId: 9,
			close: async () => {},
		}),
		cleanupConnected: async () => {},
	});

	assert.deepEqual(outcome, {
		status: 'connected',
		connectionId: 'active-1',
		channelId: 9,
	});
});

void test('active shell reopen treats dependency abort errors as failures when run is active', async () => {
	const { runContext } = runHarness();
	const abortError = Object.assign(new Error('The operation was aborted.'), {
		name: 'AbortError',
	});

	const outcome = await runActiveShellReopenAttempt({
		runContext,
		startShell: async () => {
			throw abortError;
		},
		cleanupConnected: async () => {},
	});

	assert.deepEqual(outcome, {
		status: 'failed',
		error: abortError,
		recoverable: false,
		attentionMessage: null,
	});
});

void test('active shell reopen cleans up success that arrives after operation timeout', async () => {
	const { runContext, timers } = runHarness();
	const shell = deferred<{
		connectionId: string;
		channelId: number;
		close: () => Promise<void>;
	}>();
	let cleanupCount = 0;
	let cleanedShell: unknown = null;

	const outcomePromise = runActiveShellReopenAttempt({
		runContext,
		startShell: async () => shell.promise,
		cleanupConnected: async (result) => {
			cleanupCount += 1;
			cleanedShell = result;
		},
	});
	await flushPromises();

	timers[0]?.callback();

	assert.deepEqual(await outcomePromise, {
		status: 'timedOut',
		timeoutKind: 'operation',
	});
	assert.equal(cleanupCount, 0);

	shell.resolve({
		connectionId: 'active-1',
		channelId: 9,
		close: async () => {},
	});
	await flushPromises();
	await flushPromises();

	assert.equal(cleanupCount, 1);
	assert.equal(
		(cleanedShell as { connectionId?: unknown } | null)?.connectionId,
		'active-1',
	);
	assert.equal((cleanedShell as { channelId?: unknown } | null)?.channelId, 9);
	assert.equal(
		typeof (cleanedShell as { close?: unknown } | null)?.close,
		'function',
	);
});

void test('active shell timeout late cleanup keeps deadline after run finish', async () => {
	const { runContext, timers } = runHarness();
	const shell = deferred<{
		connectionId: string;
		channelId: number;
		close: () => Promise<void>;
	}>();
	const cleanupStarted = deferred<void>();
	let cleanupSignal: AbortSignal | null = null;
	let cleanedShell: unknown = null;
	let reportedCleanupFailure: unknown = null;

	const outcomePromise = runActiveShellReopenAttempt({
		runContext,
		startShell: async () => shell.promise,
		cleanupConnected: async (result, signal) => {
			cleanedShell = result;
			cleanupSignal = signal;
			cleanupStarted.resolve();
			await new Promise<void>(() => {});
		},
		onLateCleanupFailure: (outcome) => {
			reportedCleanupFailure = outcome;
		},
	});
	await flushPromises();

	timers[0]?.callback();

	assert.deepEqual(await outcomePromise, {
		status: 'timedOut',
		timeoutKind: 'operation',
	});
	runContext.finish();

	shell.resolve({
		connectionId: 'active-1',
		channelId: 9,
		close: async () => {},
	});
	await cleanupStarted.promise;

	assert.equal(requireSignal(cleanupSignal).aborted, false);
	timers.at(-1)?.callback();
	await flushPromises();
	assert.equal(requireSignal(cleanupSignal).aborted, true);
	assert.equal(
		(cleanedShell as { connectionId?: unknown } | null)?.connectionId,
		'active-1',
	);
	assert.equal((cleanedShell as { channelId?: unknown } | null)?.channelId, 9);
	assert.equal(
		typeof (cleanedShell as { close?: unknown } | null)?.close,
		'function',
	);
	assert.deepEqual(reportedCleanupFailure, {
		status: 'timedOut',
		timeoutKind: 'cleanup',
	});
});

void test('active shell reopen cleans up stale late success', async () => {
	let current = true;
	const { runContext } = runHarness({ isCurrent: () => current });
	const shell = deferred<{
		connectionId: string;
		channelId: number;
		close: () => Promise<void>;
	}>();
	let cleanupCount = 0;
	let cleanedShell: unknown = null;

	const outcomePromise = runActiveShellReopenAttempt({
		runContext,
		startShell: async () => shell.promise,
		cleanupConnected: async (result) => {
			cleanupCount += 1;
			cleanedShell = result;
		},
	});
	await flushPromises();

	current = false;
	shell.resolve({
		connectionId: 'active-1',
		channelId: 9,
		close: async () => {},
	});

	assert.deepEqual(await outcomePromise, {
		status: 'aborted',
		reason: 'stale-run',
	});
	assert.equal(cleanupCount, 1);
	assert.equal(
		(cleanedShell as { connectionId?: unknown } | null)?.connectionId,
		'active-1',
	);
	assert.equal((cleanedShell as { channelId?: unknown } | null)?.channelId, 9);
	assert.equal(
		typeof (cleanedShell as { close?: unknown } | null)?.close,
		'function',
	);
});

void test('active shell reopen preserves stale outcome when stale cleanup fails', async () => {
	let current = true;
	const { runContext } = runHarness({ isCurrent: () => current });
	const shell = deferred<{
		connectionId: string;
		channelId: number;
		close: () => Promise<void>;
	}>();
	let cleanupCount = 0;
	let reportedCleanupFailure: unknown = null;

	const outcomePromise = runActiveShellReopenAttempt({
		runContext,
		startShell: async () => shell.promise,
		cleanupConnected: async () => {
			cleanupCount += 1;
			throw new Error('close failed');
		},
		onLateCleanupFailure: (outcome) => {
			reportedCleanupFailure = outcome;
		},
	});
	await flushPromises();

	current = false;
	shell.resolve({
		connectionId: 'active-1',
		channelId: 9,
		close: async () => {},
	});

	assert.deepEqual(await outcomePromise, {
		status: 'aborted',
		reason: 'stale-run',
	});
	assert.equal(cleanupCount, 1);
	assert.equal(
		(reportedCleanupFailure as { status?: unknown } | null)?.status,
		'cleanupFailed',
	);
});

void test('active shell reopen ignores late cleanup failure reporter errors', async () => {
	let current = true;
	const { runContext } = runHarness({ isCurrent: () => current });
	const shell = deferred<{
		connectionId: string;
		channelId: number;
		close: () => Promise<void>;
	}>();

	const outcomePromise = runActiveShellReopenAttempt({
		runContext,
		startShell: async () => shell.promise,
		cleanupConnected: async () => {
			throw new Error('close failed');
		},
		onLateCleanupFailure: () => {
			throw new Error('report failed');
		},
	});
	await flushPromises();

	current = false;
	shell.resolve({
		connectionId: 'active-1',
		channelId: 9,
		close: async () => {},
	});

	assert.deepEqual(await outcomePromise, {
		status: 'aborted',
		reason: 'stale-run',
	});
});
