import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	attemptSavedEntryWithTailscaleRecovery,
	type SavedEntryTailscaleRecovery,
} from '../../src/lib/auto-connect-saved-entry';
// eslint-disable-next-line import/consistent-type-specifier-style -- keep query-fns type-only so Node integration tests do not load React Native at runtime
import type { ConnectAndOpenShellResult } from '../../src/lib/query-fns';
import { createTailscaleRecoveryController } from '../../src/lib/tailscale-recovery';
import { createTailscaleRecoveryActions } from '../../src/lib/tailscale-recovery-actions';
import {
	TAILSCALE_RESET_FAILED_MESSAGE,
	TAILSCALE_RESET_NOT_STARTED_MESSAGE,
	type TailscaleManualResetResult,
} from '../../src/lib/tailscale-recovery-core';

type Call =
	| ['openApp']
	| ['reset']
	| ['resetCooldown']
	| ['waitForIdle']
	| ['stop', string]
	| ['replace', string]
	| ['clear']
	| ['mark', string]
	| ['recovering', string]
	| ['warn', string, unknown];

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function createDeps(opts?: {
	replaceResult?: boolean;
	idleResult?: boolean;
	resetResult?: TailscaleManualResetResult;
	resetError?: unknown;
	openError?: unknown;
}) {
	const calls: Call[] = [];
	const deps = {
		recovery: {
			openApp: async () => {
				calls.push(['openApp']);
				if (opts?.openError) throw opts.openError;
				return { attempted: true };
			},
			reset: async () => {
				calls.push(['reset']);
				if (opts?.resetError) throw opts.resetError;
				return opts?.resetResult ?? { kind: 'reset', attempted: true };
			},
			resetCooldown: () => {
				calls.push(['resetCooldown']);
			},
		},
		waitForAutoConnectIdle: async () => {
			calls.push(['waitForIdle']);
			return opts?.idleResult ?? true;
		},
		reconnect: {
			stop: (reason: string) => {
				calls.push(['stop', reason]);
			},
			replace: (reason: string) => {
				calls.push(['replace', reason]);
				return opts?.replaceResult ?? true;
			},
		},
		attention: {
			clear: () => {
				calls.push(['clear']);
			},
			mark: (message: string) => {
				calls.push(['mark', message]);
			},
			recovering: (message: string) => {
				calls.push(['recovering', message]);
			},
		},
		logger: {
			warn: (message: string, error: unknown) => {
				calls.push(['warn', message, error]);
			},
		},
	};

	return { calls, deps };
}

void test('manual retry replaces reconnect and clears attention when replacement starts', () => {
	const { calls, deps } = createDeps();
	const actions = createTailscaleRecoveryActions(deps);

	actions.retry();

	assert.deepEqual(calls, [
		['resetCooldown'],
		['replace', 'tailscale-retry-action'],
		['clear'],
	]);
});

void test('manual retry preserves attention when reconnect replacement cannot start', () => {
	const { calls, deps } = createDeps({ replaceResult: false });
	const actions = createTailscaleRecoveryActions(deps);

	actions.retry();

	assert.deepEqual(calls, [
		['resetCooldown'],
		['replace', 'tailscale-retry-action'],
	]);
});

void test('manual reset stops reconnect, waits for idle, resets, replaces reconnect, and clears attention when replacement starts', async () => {
	const { calls, deps } = createDeps();
	const actions = createTailscaleRecoveryActions(deps);

	await actions.reset();

	assert.equal(actions.isResetInFlight(), false);
	assert.deepEqual(calls, [
		['stop', 'tailscale-reset-action'],
		['recovering', 'Resetting Tailscale...'],
		['waitForIdle'],
		['reset'],
		['resetCooldown'],
		['replace', 'tailscale-reset-action'],
		['clear'],
	]);
});

for (const attempted of [false, true]) {
	void test(`manual reset marks failed attention when reset returns failed with attempted ${attempted}`, async () => {
		const { calls, deps } = createDeps({
			resetResult: { kind: 'failed', attempted },
		});
		const actions = createTailscaleRecoveryActions(deps);

		await actions.reset();

		assert.equal(actions.isResetInFlight(), false);
		assert.deepEqual(calls, [
			['stop', 'tailscale-reset-action'],
			['recovering', 'Resetting Tailscale...'],
			['waitForIdle'],
			['reset'],
			['mark', TAILSCALE_RESET_FAILED_MESSAGE],
		]);
	});
}

void test('manual reset suppresses duplicate reset while first reset is in flight', async () => {
	const pendingReset = deferred<TailscaleManualResetResult>();
	const { calls, deps } = createDeps();
	const actions = createTailscaleRecoveryActions({
		...deps,
		recovery: {
			...deps.recovery,
			reset: async () => {
				calls.push(['reset']);
				return pendingReset.promise;
			},
		},
	});

	const firstReset = actions.reset();
	await Promise.resolve();
	await Promise.resolve();

	assert.equal(actions.isResetInFlight(), true);

	const secondReset = actions.reset();
	pendingReset.resolve({ kind: 'reset', attempted: true });

	const secondResult = await secondReset;
	await firstReset;

	assert.equal(secondResult, undefined);
	assert.equal(actions.isResetInFlight(), false);
	assert.deepEqual(calls, [
		['stop', 'tailscale-reset-action'],
		['recovering', 'Resetting Tailscale...'],
		['waitForIdle'],
		['reset'],
		['resetCooldown'],
		['replace', 'tailscale-reset-action'],
		['clear'],
	]);
});

void test('manual reset marks retry attention when reconnect replacement cannot start after reset', async () => {
	const { calls, deps } = createDeps({ replaceResult: false });
	const actions = createTailscaleRecoveryActions(deps);

	await actions.reset();

	assert.equal(actions.isResetInFlight(), false);
	assert.deepEqual(calls, [
		['stop', 'tailscale-reset-action'],
		['recovering', 'Resetting Tailscale...'],
		['waitForIdle'],
		['reset'],
		['resetCooldown'],
		['replace', 'tailscale-reset-action'],
		['mark', 'Tailscale reset finished. Retry Fressh to reconnect.'],
	]);
});

function connectedResult(): ConnectAndOpenShellResult {
	return {
		status: 'connected',
		connectionId: 'connection-1',
		channelId: 1,
		sshConnection: {} as Extract<
			ConnectAndOpenShellResult,
			{ status: 'connected' }
		>['sshConnection'],
		shellHandle: {} as Extract<
			ConnectAndOpenShellResult,
			{ status: 'connected' }
		>['shellHandle'],
	};
}

function createComposedCooldownHarness() {
	const nativeCalls: string[] = [];
	const connectSavedEntryCalls: string[] = [];
	const reconnectPromises: Promise<{ connected: boolean }>[] = [];
	const recovery = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async () => {},
		native: {
			isAvailable: async () => {
				nativeCalls.push('isAvailable');
				return true;
			},
			connect: async () => {
				nativeCalls.push('connect');
				return { attempted: true };
			},
			disconnect: async () => {
				nativeCalls.push('disconnect');
				return { attempted: true };
			},
			openApp: async () => {
				nativeCalls.push('openApp');
				return { attempted: true };
			},
		},
	});
	const actions = createTailscaleRecoveryActions({
		recovery,
		waitForAutoConnectIdle: async () => true,
		reconnect: {
			stop: () => {},
			replace: () => {
				const reconnectPromise = attemptSavedEntryWithTailscaleRecovery({
					platformOS: 'android',
					recovery: recovery satisfies SavedEntryTailscaleRecovery,
					connectSavedEntry: async () => {
						connectSavedEntryCalls.push('connectSavedEntry');
						return connectedResult();
					},
					markTailscaleAttention: () => {},
					clearTailscaleAttention: () => {},
					logTmuxAttachFailure: () => {},
					logWarning: () => {},
				});
				reconnectPromises.push(reconnectPromise);
				return true;
			},
		},
		attention: {
			clear: () => {},
			mark: () => {},
			recovering: () => {},
		},
		logger: {
			warn: () => {},
		},
	});

	return {
		actions,
		recovery,
		nativeCalls,
		connectSavedEntryCalls,
		reconnectPromises,
	};
}

void test('manual retry reaches saved-entry connect even when recovery cooldown is active', async () => {
	const context = createComposedCooldownHarness();
	await context.recovery.ensureReady();
	assert.deepEqual(await context.recovery.ensureReady(), {
		kind: 'cooldown',
		attempted: false,
		available: true,
	});

	context.actions.retry();
	assert.equal(context.reconnectPromises.length, 1);
	assert.deepEqual(await context.reconnectPromises[0], { connected: true });
	assert.deepEqual(context.connectSavedEntryCalls, ['connectSavedEntry']);
});

void test('manual reset reaches saved-entry connect after reset records cooldown', async () => {
	const context = createComposedCooldownHarness();

	await context.actions.reset();

	assert.equal(context.reconnectPromises.length, 1);
	assert.deepEqual(await context.reconnectPromises[0], { connected: true });
	assert.deepEqual(context.connectSavedEntryCalls, ['connectSavedEntry']);
	assert.deepEqual(context.nativeCalls, [
		'disconnect',
		'connect',
		'isAvailable',
		'connect',
	]);
});

void test('ordinary attention updates are ignored during manual reset while reset-owned clear still works', async () => {
	let actions: ReturnType<typeof createTailscaleRecoveryActions>;
	let attentionState = 'needs attention';
	const { deps } = createDeps();
	const guardedDeps = {
		...deps,
		waitForAutoConnectIdle: async () => {
			actions.attention.clear();
			actions.attention.mark('ordinary auto-connect attention');
			assert.equal(attentionState, 'Resetting Tailscale...');
			return true;
		},
		attention: {
			clear: () => {
				attentionState = 'hidden';
			},
			mark: (message: string) => {
				attentionState = message;
			},
			recovering: (message: string) => {
				attentionState = message;
			},
		},
	};
	actions = createTailscaleRecoveryActions(guardedDeps);

	await actions.reset();

	assert.equal(attentionState, 'hidden');
});

void test('ordinary attention updates are ignored during manual reset while reset-owned mark still works', async () => {
	let actions: ReturnType<typeof createTailscaleRecoveryActions>;
	let attentionState = 'needs attention';
	const { deps } = createDeps({ idleResult: false });
	const guardedDeps = {
		...deps,
		waitForAutoConnectIdle: async () => {
			actions.attention.clear();
			actions.attention.mark('ordinary auto-connect attention');
			assert.equal(attentionState, 'Resetting Tailscale...');
			return false;
		},
		attention: {
			clear: () => {
				attentionState = 'hidden';
			},
			mark: (message: string) => {
				attentionState = message;
			},
			recovering: (message: string) => {
				attentionState = message;
			},
		},
	};
	actions = createTailscaleRecoveryActions(guardedDeps);

	await actions.reset();

	assert.equal(
		attentionState,
		'Fressh is still reconnecting. Try resetting Tailscale again.',
	);
});

void test('manual reset marks not-started attention when reset did not start', async () => {
	const { calls, deps } = createDeps({
		resetResult: { kind: 'notStarted', attempted: false },
	});
	const actions = createTailscaleRecoveryActions(deps);

	await actions.reset();

	assert.equal(actions.isResetInFlight(), false);
	assert.deepEqual(calls, [
		['stop', 'tailscale-reset-action'],
		['recovering', 'Resetting Tailscale...'],
		['waitForIdle'],
		['reset'],
		['mark', TAILSCALE_RESET_NOT_STARTED_MESSAGE],
	]);
});

void test('manual reset marks retry-again attention when auto-connect does not become idle', async () => {
	const { calls, deps } = createDeps({ idleResult: false });
	const actions = createTailscaleRecoveryActions(deps);

	await actions.reset();

	assert.equal(actions.isResetInFlight(), false);
	assert.deepEqual(calls, [
		['stop', 'tailscale-reset-action'],
		['recovering', 'Resetting Tailscale...'],
		['waitForIdle'],
		['mark', 'Fressh is still reconnecting. Try resetting Tailscale again.'],
	]);
});

void test('manual reset logs and marks failed attention when reset throws', async () => {
	const error = new Error('reset failed');
	const { calls, deps } = createDeps({ resetError: error });
	const actions = createTailscaleRecoveryActions(deps);

	await actions.reset();

	assert.equal(actions.isResetInFlight(), false);
	assert.deepEqual(calls, [
		['stop', 'tailscale-reset-action'],
		['recovering', 'Resetting Tailscale...'],
		['waitForIdle'],
		['reset'],
		['warn', 'Manual Tailscale reset failed', error],
		['mark', TAILSCALE_RESET_FAILED_MESSAGE],
	]);
});

void test('open logs failures from Tailscale open action', async () => {
	const error = new Error('open failed');
	const { calls, deps } = createDeps({ openError: error });
	const actions = createTailscaleRecoveryActions(deps);

	await actions.open();

	assert.deepEqual(calls, [
		['openApp'],
		['warn', 'Manual Tailscale open failed', error],
	]);
});
