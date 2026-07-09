import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	connectWithTailscaleRecovery,
	type ManualConnectAttemptPhase,
	type ManualConnectResult,
} from '../../src/lib/manual-connect-tailscale-recovery';
import { createTailscaleRecoveryController } from '../../src/lib/tailscale-recovery';
import {
	NETWORK_UNAVAILABLE_MESSAGE,
	TAILSCALE_REACHABILITY_MESSAGE,
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

void test('manual connect shows network attention before SSH when network is unavailable', async () => {
	const attempts: ManualConnectAttemptPhase[] = [];
	const attentions: string[] = [];

	await assert.rejects(
		connectWithTailscaleRecovery({
			platformOS: 'android',
			recovery: recoveryFixture({
				ready: {
					kind: 'networkUnavailable',
					attempted: false,
					available: false,
					network: {
						connected: false,
						internetCapable: false,
						validated: false,
						wifiConnected: false,
						transports: [],
					},
				},
			}),
			connect: async (phase) => {
				attempts.push(phase);
				return connectedResult();
			},
			onAttention: (message) => attentions.push(message),
		}),
		(error: unknown) =>
			error instanceof Error &&
			error.message === NETWORK_UNAVAILABLE_MESSAGE,
	);

	assert.deepEqual(attempts, []);
	assert.deepEqual(attentions, [NETWORK_UNAVAILABLE_MESSAGE]);
});

void test('manual connect marks and throws Tailscale attention when recovery retry still cannot reach SSH', async () => {
	const attempts: ManualConnectAttemptPhase[] = [];
	const attentions: string[] = [];

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
					? networkError('No route to host')
					: networkError('network is unreachable');
			},
			onAttention: (message) => attentions.push(message),
		}),
		(error: unknown) =>
			error instanceof Error &&
			error.message === TAILSCALE_RESTART_FAILED_MESSAGE,
	);

	assert.deepEqual(attempts, ['initial', 'retry']);
	assert.deepEqual(attentions, [TAILSCALE_RESTART_FAILED_MESSAGE]);
});

void test('manual connect replaces native Rust abort with Tailscale attention when recovery cannot proceed', async () => {
	const attentions: string[] = [];
	const nativeAbort = new Error('A Rust future was aborted');

	await assert.rejects(
		connectWithTailscaleRecovery({
			platformOS: 'android',
			recovery: recoveryFixture({
				afterFailure: {
					kind: 'cooldown',
					attempted: false,
					networkLikeFailure: true,
					available: true,
				},
			}),
			connect: async () => {
				throw nativeAbort;
			},
			onAttention: (message) => attentions.push(message),
		}),
		(error: unknown) =>
			error instanceof Error &&
			error.message === TAILSCALE_REACHABILITY_MESSAGE,
	);

	assert.deepEqual(attentions, [TAILSCALE_REACHABILITY_MESSAGE]);
});
