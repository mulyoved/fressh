import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTailscaleNativeController } from '../../src/lib/tailscale-native-core';

void test('Tailscale native controller skips unsupported platforms', async () => {
	const calls: string[] = [];
	const controller = createTailscaleNativeController({
		getPlatformOS: () => 'ios',
		getNativeModule: () => ({
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
		}),
		logger: { warn: () => {} },
	});

	assert.equal(await controller.isAvailable(), false);
	assert.deepEqual(await controller.connect(), { attempted: false });
	assert.deepEqual(await controller.disconnect(), { attempted: false });
	assert.deepEqual(await controller.openApp(), { attempted: false });
	assert.deepEqual(calls, []);
});

void test('Tailscale native controller reports native successes', async () => {
	const calls: string[] = [];
	const controller = createTailscaleNativeController({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			isAvailable: async () => true,
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
		}),
		logger: { warn: () => {} },
	});

	assert.equal(await controller.isAvailable(), true);
	assert.deepEqual(await controller.connect(), { attempted: true });
	assert.deepEqual(await controller.disconnect(), { attempted: true });
	assert.deepEqual(await controller.openApp(), { attempted: true });
	assert.deepEqual(calls, ['connect', 'disconnect', 'openApp']);
});

void test('Tailscale native controller preserves negative native successes', async () => {
	const calls: string[] = [];
	const controller = createTailscaleNativeController({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			isAvailable: async () => {
				calls.push('isAvailable');
				return false;
			},
			connect: async () => {
				calls.push('connect');
				return { attempted: false };
			},
			disconnect: async () => {
				calls.push('disconnect');
				return { attempted: false };
			},
			openApp: async () => {
				calls.push('openApp');
				return { attempted: false };
			},
		}),
		logger: { warn: () => {} },
	});

	assert.equal(await controller.isAvailable(), false);
	assert.deepEqual(await controller.connect(), { attempted: false });
	assert.deepEqual(await controller.disconnect(), { attempted: false });
	assert.deepEqual(await controller.openApp(), { attempted: false });
	assert.deepEqual(calls, [
		'isAvailable',
		'connect',
		'disconnect',
		'openApp',
	]);
});

void test('Tailscale native controller converts missing module to no-attempt results', async () => {
	const controller = createTailscaleNativeController({
		getPlatformOS: () => 'android',
		getNativeModule: () => undefined,
		logger: { warn: () => {} },
	});

	assert.equal(await controller.isAvailable(), false);
	assert.deepEqual(await controller.connect(), { attempted: false });
	assert.deepEqual(await controller.disconnect(), { attempted: false });
	assert.deepEqual(await controller.openApp(), { attempted: false });
});

void test('Tailscale native controller logs and returns false on native rejection', async () => {
	const error = new Error('broadcast rejected');
	const warnings: unknown[][] = [];
	const controller = createTailscaleNativeController({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			isAvailable: async () => {
				throw error;
			},
			connect: async () => {
				throw error;
			},
			disconnect: async () => {
				throw error;
			},
			openApp: async () => {
				throw error;
			},
		}),
		logger: { warn: (...args) => warnings.push(args) },
	});

	assert.equal(await controller.isAvailable(), false);
	assert.deepEqual(await controller.connect(), { attempted: false });
	assert.deepEqual(await controller.disconnect(), { attempted: false });
	assert.deepEqual(await controller.openApp(), { attempted: false });
	assert.deepEqual(warnings, [
		['tailscale availability check failed', error],
		['tailscale connect intent failed', error],
		['tailscale disconnect intent failed', error],
		['tailscale open app failed', error],
	]);
});
