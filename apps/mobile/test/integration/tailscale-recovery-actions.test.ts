import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTailscaleRecoveryActions } from '../../src/lib/tailscale-recovery-actions';
import {
	TAILSCALE_RESET_FAILED_MESSAGE,
	TAILSCALE_RESET_NOT_STARTED_MESSAGE,
	type TailscaleManualResetResult,
} from '../../src/lib/tailscale-recovery-core';

type Call =
	| ['openApp']
	| ['reset']
	| ['waitForIdle']
	| ['stop', string]
	| ['replace', string]
	| ['clear']
	| ['mark', string]
	| ['recovering', string]
	| ['warn', string, unknown];

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

	assert.deepEqual(calls, [['replace', 'tailscale-retry-action'], ['clear']]);
});

void test('manual retry preserves attention when reconnect replacement cannot start', () => {
	const { calls, deps } = createDeps({ replaceResult: false });
	const actions = createTailscaleRecoveryActions(deps);

	actions.retry();

	assert.deepEqual(calls, [['replace', 'tailscale-retry-action']]);
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
		['replace', 'tailscale-reset-action'],
		['clear'],
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
