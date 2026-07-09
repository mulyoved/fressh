import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	connectWithTailscaleRecovery,
	type ManualConnectAttemptPhase,
	type ManualConnectResult,
} from '../../src/lib/manual-connect-tailscale-recovery';
import { createTailscaleRecoveryController } from '../../src/lib/tailscale-recovery';
import {
	TAILSCALE_RESTART_FAILED_MESSAGE,
	type TailscaleReadyResult,
	type TailscaleRecoverAfterFailureResult,
} from '../../src/lib/tailscale-recovery-core';

function connectedResult(): ManualConnectResult {
	return {
		status: 'connected',
		connectionId: 'connection-1',
		channelId: 7,
		sshConnection: {
			connectionId: 'connection-1',
		} as Extract<ManualConnectResult, { status: 'connected' }>['sshConnection'],
		shellHandle: {
			channelId: 7,
		} as Extract<ManualConnectResult, { status: 'connected' }>['shellHandle'],
	};
}

function networkError(message: string) {
	return {
		tag: 'Russh',
		inner: [message],
		message: 'SshError.Russh',
	};
}

function recoveryFixture(opts?: {
	ready?: TailscaleReadyResult;
	afterFailure?: TailscaleRecoverAfterFailureResult;
}) {
	return {
		ensureReady: async () =>
			opts?.ready ?? { kind: 'ready', attempted: true, available: true },
		recoverAfterFailure: async () =>
			opts?.afterFailure ?? {
				kind: 'nonNetworkFailure',
				attempted: false,
				networkLikeFailure: false,
				available: true,
			},
	};
}

void test('manual connect retries once after Tailscale recovers a network-like SSH failure', async () => {
	const attempts: ManualConnectAttemptPhase[] = [];
	const attentions: string[] = [];
	let cleared = 0;

	const result = await connectWithTailscaleRecovery({
		platformOS: 'android',
		recovery: recoveryFixture({
			afterFailure: {
				kind: 'recovered',
				attempted: true,
				networkLikeFailure: true,
				available: true,
			},
		}),
		connect: async (phase) => {
			attempts.push(phase);
			if (phase === 'initial') {
				throw networkError('connection timed out');
			}
			return connectedResult();
		},
		onAttention: (message) => attentions.push(message),
		onClearAttention: () => {
			cleared += 1;
		},
	});

	assert.equal(result.status, 'connected');
	assert.deepEqual(attempts, ['initial', 'retry']);
	assert.deepEqual(attentions, []);
	assert.equal(cleared, 1);
});

void test('manual connect clears Tailscale cooldown before explicit Host connect', async () => {
	const nativeCalls: string[] = [];
	const attempts: ManualConnectAttemptPhase[] = [];
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

	await recovery.ensureReady();
	assert.deepEqual(await recovery.ensureReady(), {
		kind: 'cooldown',
		attempted: false,
		available: true,
	});

	const result = await connectWithTailscaleRecovery({
		platformOS: 'android',
		recovery,
		connect: async (phase) => {
			attempts.push(phase);
			return connectedResult();
		},
	});

	assert.equal(result.status, 'connected');
	assert.deepEqual(attempts, ['initial']);
	assert.deepEqual(nativeCalls, [
		'isAvailable',
		'connect',
		'isAvailable',
		'isAvailable',
		'connect',
	]);
});

void test('manual connect marks Tailscale attention and throws retry error when recovery retry still cannot reach SSH', async () => {
	const attempts: ManualConnectAttemptPhase[] = [];
	const attentions: string[] = [];
	const retryError = networkError('No route to host');

	await assert.rejects(
		connectWithTailscaleRecovery({
			platformOS: 'android',
			recovery: recoveryFixture({
				afterFailure: {
					kind: 'recovered',
					attempted: true,
					networkLikeFailure: true,
					available: true,
				},
			}),
			connect: async (phase) => {
				attempts.push(phase);
				throw phase === 'retry'
					? retryError
					: networkError('network is unreachable');
			},
			onAttention: (message) => attentions.push(message),
		}),
		retryError,
	);

	assert.deepEqual(attempts, ['initial', 'retry']);
	assert.deepEqual(attentions, [TAILSCALE_RESTART_FAILED_MESSAGE]);
});
