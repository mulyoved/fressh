import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	createTailscaleRecoveryController,
	type TailscaleRecoveryNative,
} from '../../src/lib/tailscale-recovery';

function nativeFixture(calls: string[]): TailscaleRecoveryNative {
	return {
		isAvailable: async () => {
			calls.push('isAvailable');
			return true;
		},
		connect: async () => {
			calls.push('connect');
			return { attempted: true };
		},
		disconnect: async () => {
			calls.push('disconnect');
			return { attempted: true };
		},
		openApp: async () => {
			calls.push('openApp');
			return { attempted: true };
		},
	};
}

void test('ensureReady nudges Tailscale on Android and waits', async () => {
	const calls: string[] = [];
	const waits: number[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async (ms) => {
			waits.push(ms);
		},
		native: nativeFixture(calls),
	});

	assert.deepEqual(await controller.ensureReady(), {
		attempted: true,
		available: true,
	});
	assert.deepEqual(calls, ['isAvailable', 'connect']);
	assert.deepEqual(waits, [3_000]);
});

void test('ensureReady respects cooldown', async () => {
	const calls: string[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async () => {},
		native: nativeFixture(calls),
	});

	await controller.ensureReady();
	assert.deepEqual(await controller.ensureReady(), {
		attempted: false,
		available: true,
	});
	assert.deepEqual(calls, ['isAvailable', 'connect', 'isAvailable']);
});

void test('recoverAfterFailure skips non-network errors', async () => {
	const calls: string[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async () => {},
		native: nativeFixture(calls),
	});

	assert.deepEqual(
		await controller.recoverAfterFailure(new Error('Permission denied')),
		{ attempted: false, networkLikeFailure: false, available: true },
	);
	assert.deepEqual(calls, ['isAvailable']);
});

void test('recoverAfterFailure connects after network-like errors and waits', async () => {
	const calls: string[] = [];
	const waits: number[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async (ms) => {
			waits.push(ms);
		},
		native: nativeFixture(calls),
	});

	assert.deepEqual(
		await controller.recoverAfterFailure(new Error('No route to host')),
		{ attempted: true, networkLikeFailure: true, available: true },
	);
	assert.deepEqual(calls, ['isAvailable', 'connect']);
	assert.deepEqual(waits, [3_000]);
});

void test('manual reset disconnects, connects, and waits between actions', async () => {
	const calls: string[] = [];
	const waits: number[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async (ms) => {
			waits.push(ms);
		},
		native: nativeFixture(calls),
	});

	assert.deepEqual(await controller.reset(), { attempted: true });
	assert.deepEqual(calls, ['disconnect', 'connect']);
	assert.deepEqual(waits, [1_500, 3_000]);
});

void test('openApp delegates to native module', async () => {
	const calls: string[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async () => {},
		native: nativeFixture(calls),
	});

	assert.deepEqual(await controller.openApp(), { attempted: true });
	assert.deepEqual(calls, ['openApp']);
});
