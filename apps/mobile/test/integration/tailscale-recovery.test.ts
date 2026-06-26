import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	createTailscaleRecoveryController,
	type TailscaleRecoveryNative,
} from '../../src/lib/tailscale-recovery';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolveValue) => {
		resolve = resolveValue;
	});
	return { promise, resolve };
}

async function withSafetyTimeout<T>(
	promise: Promise<T>,
): Promise<T | 'timeout'> {
	return await Promise.race([
		promise,
		new Promise<'timeout'>((resolve) => {
			setTimeout(() => {
				resolve('timeout');
			}, 50);
		}),
	]);
}

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

function unavailableNativeFixture(calls: string[]): TailscaleRecoveryNative {
	return {
		...nativeFixture(calls),
		isAvailable: async () => {
			calls.push('isAvailable');
			return false;
		},
	};
}

function connectSkippedNativeFixture(calls: string[]): TailscaleRecoveryNative {
	return {
		...nativeFixture(calls),
		connect: async () => {
			calls.push('connect');
			return { attempted: false };
		},
	};
}

function disconnectSkippedNativeFixture(
	calls: string[],
): TailscaleRecoveryNative {
	return {
		...nativeFixture(calls),
		disconnect: async () => {
			calls.push('disconnect');
			return { attempted: false };
		},
	};
}

function disconnectFailedNativeFixture(
	calls: string[],
): TailscaleRecoveryNative {
	return {
		...nativeFixture(calls),
		disconnect: async () => {
			calls.push('disconnect');
			return { attempted: false, failed: true };
		},
	};
}

function connectAndDisconnectSkippedNativeFixture(
	calls: string[],
): TailscaleRecoveryNative {
	return {
		...connectSkippedNativeFixture(calls),
		disconnect: async () => {
			calls.push('disconnect');
			return { attempted: false };
		},
	};
}

function connectFailedNativeFixture(calls: string[]): TailscaleRecoveryNative {
	return {
		...nativeFixture(calls),
		connect: async () => {
			calls.push('connect');
			return { attempted: false, failed: true };
		},
	};
}

function connectRejectingNativeFixture(
	calls: string[],
): TailscaleRecoveryNative {
	return {
		...nativeFixture(calls),
		connect: async () => {
			calls.push('connect');
			throw new Error('connect rejected');
		},
	};
}

void test('unsupported platforms no-op without native calls', async () => {
	const calls: string[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'ios',
		getNowMs: () => 1_000,
		sleep: async () => {},
		native: nativeFixture(calls),
	});

	assert.deepEqual(await controller.ensureReady(), {
		attempted: false,
		available: false,
	});
	assert.deepEqual(await controller.reset(), { attempted: false });
	assert.deepEqual(await controller.openApp(), { attempted: false });
	assert.deepEqual(
		await controller.recoverAfterFailure(new Error('No route to host')),
		{ attempted: false, networkLikeFailure: true, available: false },
	);
	assert.deepEqual(calls, []);
});

void test('ensureReady skips unavailable native recovery without waiting', async () => {
	const calls: string[] = [];
	const waits: number[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async (ms) => {
			waits.push(ms);
		},
		native: unavailableNativeFixture(calls),
	});

	assert.deepEqual(await controller.ensureReady(), {
		attempted: false,
		available: false,
	});
	assert.deepEqual(calls, ['isAvailable']);
	assert.deepEqual(waits, []);
});

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

void test('ensureReady does not record cooldown when connect skips', async () => {
	const calls: string[] = [];
	const waits: number[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async (ms) => {
			waits.push(ms);
		},
		native: connectSkippedNativeFixture(calls),
	});

	assert.deepEqual(await controller.ensureReady(), {
		attempted: false,
		available: true,
	});
	assert.deepEqual(await controller.ensureReady(), {
		attempted: false,
		available: true,
	});
	assert.deepEqual(calls, ['isAvailable', 'connect', 'isAvailable', 'connect']);
	assert.deepEqual(waits, []);
});

void test('ensureReady records cooldown when connect dispatch fails', async () => {
	const calls: string[] = [];
	const waits: number[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async (ms) => {
			waits.push(ms);
		},
		native: connectFailedNativeFixture(calls),
	});

	assert.deepEqual(await controller.ensureReady(), {
		attempted: false,
		failed: true,
		available: true,
	});
	assert.deepEqual(await controller.ensureReady(), {
		attempted: false,
		available: true,
	});
	assert.deepEqual(calls, ['isAvailable', 'connect', 'isAvailable']);
	assert.deepEqual(waits, []);
});

void test('ensureReady records cooldown when native connect rejects', async () => {
	const calls: string[] = [];
	const waits: number[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async (ms) => {
			waits.push(ms);
		},
		native: connectRejectingNativeFixture(calls),
	});

	assert.deepEqual(await controller.ensureReady(), {
		attempted: false,
		failed: true,
		available: true,
	});
	assert.deepEqual(await controller.ensureReady(), {
		attempted: false,
		available: true,
	});
	assert.deepEqual(calls, ['isAvailable', 'connect', 'isAvailable']);
	assert.deepEqual(waits, []);
});

void test('overlapping recovery calls share one in-flight native connect', async () => {
	const calls: string[] = [];
	const waits: number[] = [];
	const connect = deferred<{ attempted: boolean }>();
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async (ms) => {
			waits.push(ms);
		},
		native: {
			...nativeFixture(calls),
			connect: async () => {
				calls.push('connect');
				return await connect.promise;
			},
		},
	});

	const firstReady = controller.ensureReady();
	const secondRecovery = controller.recoverAfterFailure(
		new Error('No route to host'),
	);
	for (let index = 0; index < 5; index += 1) {
		if (calls.includes('connect')) break;
		await Promise.resolve();
	}

	assert.equal(calls.filter((call) => call === 'connect').length, 1);
	connect.resolve({ attempted: true });

	assert.deepEqual(await firstReady, {
		attempted: true,
		available: true,
	});
	assert.deepEqual(await secondRecovery, {
		attempted: true,
		networkLikeFailure: true,
		available: true,
	});
	assert.equal(calls.filter((call) => call === 'connect').length, 1);
	assert.deepEqual(waits, [3_000]);
});

void test('automatic recovery times out a stuck native connect and clears in-flight state', async () => {
	const calls: string[] = [];
	const waits: number[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async (ms) => {
			waits.push(ms);
		},
		connectTimeoutMs: 1,
		native: {
			...nativeFixture(calls),
			connect: async () => {
				calls.push('connect');
				return await new Promise<{ attempted: boolean }>(() => {});
			},
		},
	});

	const firstReady = controller.ensureReady();
	const joinedRecovery = controller.recoverAfterFailure(
		new Error('No route to host'),
	);

	assert.deepEqual(await withSafetyTimeout(firstReady), {
		attempted: false,
		failed: true,
		available: true,
	});
	assert.deepEqual(await withSafetyTimeout(joinedRecovery), {
		attempted: false,
		failed: true,
		networkLikeFailure: true,
		available: true,
	});
	assert.equal(calls.filter((call) => call === 'connect').length, 1);
	assert.deepEqual(waits, []);

	assert.deepEqual(await controller.ensureReady(), {
		attempted: false,
		available: true,
	});
	assert.equal(calls.filter((call) => call === 'connect').length, 1);

	controller.resetCooldown();
	assert.deepEqual(await withSafetyTimeout(controller.ensureReady()), {
		attempted: false,
		failed: true,
		available: true,
	});
	assert.equal(calls.filter((call) => call === 'connect').length, 2);
	assert.deepEqual(waits, []);
});

void test('resetCooldown allows a throttled controller to retry immediately', async () => {
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
	assert.deepEqual(await controller.ensureReady(), {
		attempted: false,
		available: true,
	});
	controller.resetCooldown();
	assert.deepEqual(await controller.ensureReady(), {
		attempted: true,
		available: true,
	});
	assert.deepEqual(calls, [
		'isAvailable',
		'connect',
		'isAvailable',
		'isAvailable',
		'connect',
	]);
	assert.deepEqual(waits, [3_000, 3_000]);
});

void test('cooldown is independent per recovery controller', async () => {
	const firstCalls: string[] = [];
	const secondCalls: string[] = [];
	const firstController = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async () => {},
		native: nativeFixture(firstCalls),
	});
	const secondController = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async () => {},
		native: nativeFixture(secondCalls),
	});

	assert.deepEqual(await firstController.ensureReady(), {
		attempted: true,
		available: true,
	});
	assert.deepEqual(await firstController.ensureReady(), {
		attempted: false,
		available: true,
	});
	assert.deepEqual(await secondController.ensureReady(), {
		attempted: true,
		available: true,
	});
	assert.deepEqual(firstCalls, ['isAvailable', 'connect', 'isAvailable']);
	assert.deepEqual(secondCalls, ['isAvailable', 'connect']);
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

void test('recoverAfterFailure skips unavailable native recovery', async () => {
	const calls: string[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async () => {},
		native: unavailableNativeFixture(calls),
	});

	assert.deepEqual(
		await controller.recoverAfterFailure(new Error('No route to host')),
		{ attempted: false, networkLikeFailure: true, available: false },
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

void test('recoverAfterFailure preserves failed connect result without settle wait', async () => {
	const calls: string[] = [];
	const waits: number[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async (ms) => {
			waits.push(ms);
		},
		native: connectFailedNativeFixture(calls),
	});

	assert.deepEqual(
		await controller.recoverAfterFailure(new Error('No route to host')),
		{
			attempted: false,
			failed: true,
			networkLikeFailure: true,
			available: true,
		},
	);
	assert.deepEqual(calls, ['isAvailable', 'connect']);
	assert.deepEqual(waits, []);
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

void test('reset connects without reset wait when disconnect skips', async () => {
	const calls: string[] = [];
	const waits: number[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async (ms) => {
			waits.push(ms);
		},
		native: disconnectSkippedNativeFixture(calls),
	});

	assert.deepEqual(await controller.reset(), { attempted: true });
	assert.deepEqual(calls, ['disconnect', 'connect']);
	assert.deepEqual(waits, [3_000]);
});

void test('reset reports no attempt when disconnect and connect skip', async () => {
	const calls: string[] = [];
	const waits: number[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async (ms) => {
			waits.push(ms);
		},
		native: connectAndDisconnectSkippedNativeFixture(calls),
	});

	assert.deepEqual(await controller.reset(), { attempted: false });
	assert.deepEqual(calls, ['disconnect', 'connect']);
	assert.deepEqual(waits, []);
});

void test('reset preserves failed disconnect result', async () => {
	const calls: string[] = [];
	const waits: number[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async (ms) => {
			waits.push(ms);
		},
		native: disconnectFailedNativeFixture(calls),
	});

	assert.deepEqual(await controller.reset(), {
		attempted: true,
		failed: true,
	});
	assert.deepEqual(calls, ['disconnect', 'connect']);
	assert.deepEqual(waits, [3_000]);
});

void test('reset records cooldown when connect attempts', async () => {
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
	assert.deepEqual(await controller.ensureReady(), {
		attempted: false,
		available: true,
	});
	assert.deepEqual(calls, ['disconnect', 'connect', 'isAvailable']);
	assert.deepEqual(waits, [1_500, 3_000]);
});

void test('reset records cooldown when connect dispatch fails', async () => {
	const calls: string[] = [];
	const waits: number[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async (ms) => {
			waits.push(ms);
		},
		native: connectFailedNativeFixture(calls),
	});

	assert.deepEqual(await controller.reset(), {
		attempted: true,
		failed: true,
	});
	assert.deepEqual(await controller.ensureReady(), {
		attempted: false,
		available: true,
	});
	assert.deepEqual(calls, ['disconnect', 'connect', 'isAvailable']);
	assert.deepEqual(waits, [1_500]);
});

void test('reset preserves failed connect result', async () => {
	const calls: string[] = [];
	const waits: number[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async (ms) => {
			waits.push(ms);
		},
		native: connectFailedNativeFixture(calls),
	});

	assert.deepEqual(await controller.reset(), {
		attempted: true,
		failed: true,
	});
	assert.deepEqual(calls, ['disconnect', 'connect']);
	assert.deepEqual(waits, [1_500]);
});

void test('reset does not record cooldown when connect skips', async () => {
	const calls: string[] = [];
	const waits: number[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async (ms) => {
			waits.push(ms);
		},
		native: connectSkippedNativeFixture(calls),
	});

	assert.deepEqual(await controller.reset(), { attempted: true });
	assert.deepEqual(await controller.ensureReady(), {
		attempted: false,
		available: true,
	});
	assert.deepEqual(calls, ['disconnect', 'connect', 'isAvailable', 'connect']);
	assert.deepEqual(waits, [1_500]);
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
