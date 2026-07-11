import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellScrollbackControllerCore } from '../../src/lib/shell-controllers/scrollback-core';
import { createShellTargetKey } from '../../src/lib/shell-controllers/source-keys';
import {
	createDeferred,
	createRecordingCleanupBarrier,
	createScrollbackHarness,
	flushPromises,
} from './shell-scrollback-controller-test-support';

void test('scrollback runtime reset restores remote ownership when current cleanup returns false', async () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	const cleanup = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.reset = () => cleanup.promise;
	harness.remoteCopyModeActive.current = true;
	harness.core.onTerminalRuntimeChanged('instance-2');
	assert.equal(harness.remoteCopyModeActive.current, true);
	cleanup.resolve(false);
	await flushPromises();
	assert.equal(harness.remoteCopyModeActive.current, true);
});

void test('scrollback runtime reset restores remote ownership when current cleanup rejects', async () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	const cleanup = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.reset = () => cleanup.promise;
	harness.remoteCopyModeActive.current = true;
	harness.core.onTerminalRuntimeChanged('instance-2');
	cleanup.reject(new Error('runtime cleanup failed'));
	await flushPromises();
	assert.equal(harness.remoteCopyModeActive.current, true);
});

void test('scrollback context replacement restores remote ownership when current cleanup returns false', async () => {
	const harness = createScrollbackHarness();
	const cleanup = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.dispose = () => cleanup.promise;
	harness.remoteCopyModeActive.current = true;
	harness.core.setContext({
		...harness.context,
		workmuxScroll: { ...harness.scroll },
	});
	cleanup.resolve(false);
	await flushPromises();
	assert.equal(harness.remoteCopyModeActive.current, true);
});

void test('scrollback context replacement restores remote ownership when current cleanup rejects', async () => {
	const harness = createScrollbackHarness();
	const cleanup = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.dispose = () => cleanup.promise;
	harness.remoteCopyModeActive.current = true;
	harness.core.setContext({
		...harness.context,
		workmuxScroll: { ...harness.scroll },
	});
	cleanup.reject(new Error('replacement cleanup failed'));
	await flushPromises();
	assert.equal(harness.remoteCopyModeActive.current, true);
});

void test('scrollback failed older same-target cleanup remains blocking across a newer generation', async () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	const staleCleanup = createDeferred<boolean>();
	const currentCleanup = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	let resetCount = 0;
	executor.reset = () => {
		resetCount += 1;
		return resetCount === 1 ? staleCleanup.promise : currentCleanup.promise;
	};
	harness.remoteCopyModeActive.current = true;
	harness.core.onTerminalRuntimeChanged('instance-2');
	harness.remoteCopyModeActive.current = true;
	harness.core.onTerminalRuntimeChanged('instance-3');
	currentCleanup.resolve(true);
	await flushPromises();
	staleCleanup.resolve(false);
	await flushPromises();
	assert.equal(harness.remoteCopyModeActive.current, true);
});

void test('scrollback stale rejected context cleanup cannot restore remote ownership over a newer generation', async () => {
	const harness = createScrollbackHarness();
	const staleCleanup = createDeferred<boolean>();
	const firstExecutor = harness.executors[0];
	assert.ok(firstExecutor);
	firstExecutor.dispose = () => staleCleanup.promise;
	harness.remoteCopyModeActive.current = true;
	const replacementScroll = { ...harness.scroll };
	harness.core.setContext({
		...harness.context,
		workmuxScroll: replacementScroll,
	});
	harness.core.setContext({
		...harness.context,
		targetKey: createShellTargetKey('transport' as never, 'newer'),
		targetName: 'newer',
		workmuxScroll: replacementScroll,
	});
	staleCleanup.reject(new Error('stale replacement cleanup failed'));
	await flushPromises();
	assert.equal(harness.remoteCopyModeActive.current, false);
});

void test('scrollback reentrant runtime reset remains blocking when any composed cleanup fails', async () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	const staleCleanup = createDeferred<boolean>();
	const currentCleanup = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	let firstReset = true;
	executor.reset = () => {
		if (firstReset) {
			firstReset = false;
			harness.core.onTerminalRuntimeChanged('instance-3');
			return staleCleanup.promise;
		}
		return currentCleanup.promise;
	};
	harness.remoteCopyModeActive.current = true;
	harness.core.onTerminalRuntimeChanged('instance-2');
	currentCleanup.resolve(true);
	await flushPromises();
	staleCleanup.resolve(false);
	await flushPromises();
	assert.equal(harness.core.getSnapshot().runtimeInstanceId, 'instance-3');
	assert.equal(harness.remoteCopyModeActive.current, true);
});

void test('scrollback reentrant same-target replacement without another exit remains blocking', async () => {
	const harness = createScrollbackHarness();
	const staleCleanup = createDeferred<boolean>();
	const firstExecutor = harness.executors[0];
	assert.ok(firstExecutor);
	const reentrantScroll = { ...harness.scroll };
	const reentrantContext = {
		...harness.context,
		workmuxScroll: reentrantScroll,
	};
	firstExecutor.dispose = () => {
		harness.core.setContext(reentrantContext);
		return staleCleanup.promise;
	};
	harness.remoteCopyModeActive.current = true;
	harness.core.setContext({
		...harness.context,
		workmuxScroll: { ...harness.scroll },
	});
	staleCleanup.resolve(false);
	await flushPromises();
	assert.equal(harness.executors.length, 2);
	assert.equal(harness.remoteCopyModeActive.current, true);
});

for (const settlement of ['false', 'reject'] as const) {
	void test(`scrollback target replacement ${settlement} cleanup cannot restore the old target`, async () => {
		const harness = createScrollbackHarness();
		const cleanup = createDeferred<boolean>();
		const executor = harness.executors[0];
		assert.ok(executor);
		executor.dispose = () => cleanup.promise;
		harness.remoteCopyModeActive.current = true;
		harness.core.setContext({
			...harness.context,
			targetKey: createShellTargetKey('transport' as never, 'other'),
			targetName: 'other',
		});
		if (settlement === 'false') cleanup.resolve(false);
		else cleanup.reject(new Error('old target cleanup failed'));
		await flushPromises();
		assert.equal(harness.remoteCopyModeActive.current, false);
	});
}

void test('scrollback old target cleanup cannot overwrite independently owned new target state', async () => {
	const harness = createScrollbackHarness();
	const cleanup = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.dispose = () => cleanup.promise;
	harness.remoteCopyModeActive.current = true;
	harness.core.setContext({
		...harness.context,
		targetKey: createShellTargetKey('transport' as never, 'other'),
		targetName: 'other',
	});
	harness.remoteCopyModeActive.current = true;
	cleanup.resolve(true);
	await flushPromises();
	assert.equal(harness.remoteCopyModeActive.current, true);
});

void test('scrollback synchronous runtime and invalidate cleanup failures remain blocking', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.reset = () => {
		throw new Error('sync reset failed');
	};
	harness.remoteCopyModeActive.current = true;
	assert.doesNotThrow(() =>
		harness.core.onTerminalRuntimeChanged('instance-2'),
	);
	assert.equal(harness.remoteCopyModeActive.current, true);
	harness.remoteCopyModeActive.current = true;
	assert.doesNotThrow(() => harness.core.invalidate('focus-lost'));
	assert.equal(harness.remoteCopyModeActive.current, true);
});

void test('scrollback synchronous same-target replacement failure remains blocking', () => {
	const harness = createScrollbackHarness();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.dispose = () => {
		throw new Error('sync dispose failed');
	};
	harness.remoteCopyModeActive.current = true;
	assert.doesNotThrow(() =>
		harness.core.setContext({
			...harness.context,
			workmuxScroll: { ...harness.scroll },
		}),
	);
	assert.equal(harness.remoteCopyModeActive.current, true);
});

void test('scrollback synchronous old-target replacement failure cannot block the new target', () => {
	const harness = createScrollbackHarness();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.dispose = () => {
		throw new Error('sync old target dispose failed');
	};
	harness.remoteCopyModeActive.current = true;
	harness.core.setContext({
		...harness.context,
		targetKey: createShellTargetKey('transport' as never, 'other'),
		targetName: 'other',
	});
	assert.equal(harness.remoteCopyModeActive.current, false);
});

for (const operation of [
	'runtime',
	'invalidate',
	'context',
	'dispose',
] as const) {
	void test(`scrollback ${operation} tracks the exact executor cleanup promise`, async () => {
		const recording = createRecordingCleanupBarrier();
		const harness = createScrollbackHarness({
			cleanupBarrier: recording.barrier,
		});
		const cleanup = createDeferred<boolean>();
		const executor = harness.executors[0];
		assert.ok(executor);
		if (operation === 'runtime' || operation === 'invalidate') {
			executor.reset = () => cleanup.promise;
		} else {
			executor.dispose = () => cleanup.promise;
		}
		switch (operation) {
			case 'runtime':
				harness.core.onTerminalRuntimeChanged('instance-1');
				break;
			case 'invalidate':
				harness.core.invalidate('focus-lost');
				break;
			case 'context':
				harness.core.setContext({
					...harness.context,
					workmuxScroll: { ...harness.scroll },
				});
				break;
			case 'dispose':
				harness.core.dispose();
				break;
		}
		assert.equal(recording.trackedInputs[0], cleanup.promise);
		cleanup.resolve(true);
		await flushPromises();
	});
}

void test('scrollback coalesces repeated same-executor resets while cleanup is pending', async () => {
	const recording = createRecordingCleanupBarrier();
	const harness = createScrollbackHarness({
		cleanupBarrier: recording.barrier,
	});
	const firstCleanup = createDeferred<boolean>();
	const secondCleanup = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	let resetCount = 0;
	executor.reset = () => {
		resetCount += 1;
		return resetCount === 1 ? firstCleanup.promise : secondCleanup.promise;
	};
	harness.remoteCopyModeActive.current = true;
	harness.core.invalidate('focus-lost');
	const stableBarrier = recording.barrier.current();
	assert.notEqual(stableBarrier, null);
	for (let index = 0; index < 50; index += 1) {
		harness.core.invalidate('app-inactive');
		harness.core.onTerminalRuntimeChanged(`instance-${index}`);
		assert.equal(recording.barrier.current(), stableBarrier);
	}
	assert.equal(resetCount, 1);
	assert.deepEqual(recording.trackedInputs, [firstCleanup.promise]);
	firstCleanup.resolve(true);
	await flushPromises();
	assert.equal(recording.barrier.current(), null);
	assert.equal(harness.remoteCopyModeActive.current, false);
	harness.remoteCopyModeActive.current = true;
	harness.core.invalidate('focus-lost');
	assert.equal(resetCount, 2);
	assert.deepEqual(recording.trackedInputs, [
		firstCleanup.promise,
		secondCleanup.promise,
	]);
	secondCleanup.resolve(true);
	await flushPromises();
	assert.equal(harness.remoteCopyModeActive.current, false);
});

void test('scrollback starts an exit-capable reset after acquisition during a pending no-exit reset', async () => {
	const recording = createRecordingCleanupBarrier();
	const harness = createScrollbackHarness({
		cleanupBarrier: recording.barrier,
	});
	const noExitCleanup = createDeferred<boolean>();
	const exitCleanup = createDeferred<boolean>();
	const resetOptions: Parameters<
		NonNullable<(typeof harness.executors)[number]>['reset']
	>[0][] = [];
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.reset = (options) => {
		resetOptions.push(options);
		return resetOptions.length === 1
			? noExitCleanup.promise
			: exitCleanup.promise;
	};
	harness.core.invalidate('focus-lost');
	assert.equal(resetOptions[0]?.targetName, undefined);
	harness.remoteCopyModeGeneration.current += 1;
	harness.remoteCopyModeActive.current = true;
	harness.core.invalidate('app-inactive');
	assert.equal(resetOptions.length, 2);
	assert.equal(resetOptions[1]?.targetName, 'main');
	assert.deepEqual(recording.trackedInputs, [
		noExitCleanup.promise,
		exitCleanup.promise,
	]);
	const composedBarrier = recording.barrier.current();
	assert.notEqual(composedBarrier, null);
	noExitCleanup.resolve(true);
	await flushPromises();
	assert.equal(harness.remoteCopyModeActive.current, true);
	assert.equal(recording.barrier.current(), composedBarrier);
	exitCleanup.resolve(true);
	await flushPromises();
	assert.equal(harness.remoteCopyModeActive.current, false);
	assert.equal(recording.barrier.current(), null);
});

void test('scrollback starts a new exit reset after reacquiring a newer remote generation', async () => {
	const recording = createRecordingCleanupBarrier();
	const harness = createScrollbackHarness({
		cleanupBarrier: recording.barrier,
	});
	const olderCleanup = createDeferred<boolean>();
	const newerCleanup = createDeferred<boolean>();
	const resetTargetNames: (string | undefined)[] = [];
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.reset = (options) => {
		resetTargetNames.push(options?.targetName);
		return resetTargetNames.length === 1
			? olderCleanup.promise
			: newerCleanup.promise;
	};
	harness.remoteCopyModeActive.current = true;
	harness.core.invalidate('focus-lost');
	harness.remoteCopyModeGeneration.current += 1;
	harness.remoteCopyModeActive.current = true;
	harness.core.onTerminalRuntimeChanged('instance-after-reacquire');
	assert.deepEqual(resetTargetNames, ['main', 'main']);
	assert.deepEqual(recording.trackedInputs, [
		olderCleanup.promise,
		newerCleanup.promise,
	]);
	const composedBarrier = recording.barrier.current();
	assert.notEqual(composedBarrier, null);
	olderCleanup.resolve(true);
	await flushPromises();
	assert.equal(harness.remoteCopyModeActive.current, true);
	assert.equal(recording.barrier.current(), composedBarrier);
	newerCleanup.resolve(true);
	await flushPromises();
	assert.equal(harness.remoteCopyModeActive.current, false);
	assert.equal(recording.barrier.current(), null);
});

void test('scrollback composes pending cleanup from independent executors', async () => {
	const recording = createRecordingCleanupBarrier();
	const harness = createScrollbackHarness({
		cleanupBarrier: recording.barrier,
	});
	const firstCleanup = createDeferred<boolean>();
	const secondCleanup = createDeferred<boolean>();
	const firstExecutor = harness.executors[0];
	assert.ok(firstExecutor);
	firstExecutor.reset = () => firstCleanup.promise;
	harness.core.invalidate('focus-lost');
	harness.core.setContext({
		...harness.context,
		workmuxScroll: { ...harness.scroll },
	});
	const secondExecutor = harness.executors[1];
	assert.ok(secondExecutor);
	secondExecutor.reset = () => secondCleanup.promise;
	harness.core.invalidate('app-inactive');
	assert.deepEqual(recording.trackedInputs, [
		firstCleanup.promise,
		secondCleanup.promise,
	]);
	const composedBarrier = recording.barrier.current();
	assert.notEqual(composedBarrier, null);
	firstCleanup.resolve(true);
	await flushPromises();
	assert.equal(recording.barrier.current(), composedBarrier);
	secondCleanup.resolve(true);
	await flushPromises();
	assert.equal(recording.barrier.current(), null);
});

void test('scrollback still disposes an executor with a pending reset', async () => {
	const recording = createRecordingCleanupBarrier();
	const harness = createScrollbackHarness({
		cleanupBarrier: recording.barrier,
	});
	const resetCleanup = createDeferred<boolean>();
	const disposeCleanup = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	let disposeCount = 0;
	executor.reset = () => resetCleanup.promise;
	executor.dispose = () => {
		disposeCount += 1;
		return disposeCleanup.promise;
	};
	harness.core.invalidate('focus-lost');
	harness.core.setContext({
		...harness.context,
		workmuxScroll: { ...harness.scroll },
	});
	assert.equal(disposeCount, 1);
	assert.deepEqual(recording.trackedInputs, [
		resetCleanup.promise,
		disposeCleanup.promise,
	]);
	resetCleanup.resolve(true);
	disposeCleanup.resolve(true);
	await flushPromises();
});

void test('scrollback retains same-target remote ownership while runtime cleanup is pending', async () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	const cleanup = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.reset = () => cleanup.promise;
	harness.remoteCopyModeActive.current = true;
	harness.core.onTerminalRuntimeChanged('instance-2');
	assert.equal(harness.remoteCopyModeActive.current, true);
	cleanup.resolve(true);
	await flushPromises();
	assert.equal(harness.remoteCopyModeActive.current, false);
});

void test('scrollback retains same-target remote ownership through replacement and factory failure', async () => {
	const harness = createScrollbackHarness();
	const cleanup = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.dispose = () => cleanup.promise;
	harness.setExecutorFactoryOverride(() => {
		throw new Error('replacement factory failed');
	});
	harness.remoteCopyModeActive.current = true;
	harness.core.setContext({
		...harness.context,
		workmuxScroll: { ...harness.scroll },
	});
	assert.equal(harness.remoteCopyModeActive.current, true);
	cleanup.resolve(true);
	await flushPromises();
	assert.equal(harness.remoteCopyModeActive.current, false);
	harness.remoteCopyModeActive.current = true;
	harness.core.invalidate('focus-lost');
	assert.equal(harness.remoteCopyModeActive.current, true);
});

void test('scrollback invalidate retains ownership until a successful cleanup retry', async () => {
	const harness = createScrollbackHarness();
	const firstCleanup = createDeferred<boolean>();
	const retryCleanup = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	let resetCount = 0;
	executor.reset = () => {
		resetCount += 1;
		return resetCount === 1 ? firstCleanup.promise : retryCleanup.promise;
	};
	harness.remoteCopyModeActive.current = true;
	harness.core.invalidate('focus-lost');
	assert.equal(harness.remoteCopyModeActive.current, true);
	firstCleanup.resolve(false);
	await flushPromises();
	assert.equal(harness.remoteCopyModeActive.current, true);
	harness.core.invalidate('app-inactive');
	assert.equal(harness.remoteCopyModeActive.current, true);
	retryCleanup.resolve(true);
	await flushPromises();
	assert.equal(harness.remoteCopyModeActive.current, false);
});

void test('older same-target cleanup success cannot clear a newer remote acquisition', async () => {
	const harness = createScrollbackHarness();
	const cleanup = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.dispose = () => cleanup.promise;
	harness.remoteCopyModeActive.current = true;
	harness.core.setContext({
		...harness.context,
		workmuxScroll: { ...harness.scroll },
	});
	harness.remoteCopyModeGeneration.current += 1;
	harness.remoteCopyModeActive.current = true;
	cleanup.resolve(true);
	await flushPromises();
	assert.equal(harness.remoteCopyModeActive.current, true);
});

void test('older same-target cleanup failure remains blocking after newer acquisition', async () => {
	const harness = createScrollbackHarness();
	const cleanup = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.dispose = () => cleanup.promise;
	harness.remoteCopyModeActive.current = true;
	harness.core.setContext({
		...harness.context,
		workmuxScroll: { ...harness.scroll },
	});
	harness.remoteCopyModeGeneration.current += 1;
	harness.remoteCopyModeActive.current = true;
	cleanup.resolve(false);
	await flushPromises();
	assert.equal(harness.remoteCopyModeActive.current, true);
});

void test('real suppressed runtime reset failure logs exactly once', async () => {
	const fixture = createScrollbackHarness();
	const warnings: string[] = [];
	const remoteCopyModeActive = { current: false };
	const remoteCopyModeGeneration = { current: 0 };
	const core = createShellScrollbackControllerCore({
		remoteCopyModeActive,
		remoteCopyModeGeneration,
	});
	core.setContext({
		...fixture.context,
		workmuxScroll: {
			...fixture.scroll,
			exit: async () => ({
				success: false,
				output: '',
				error: 'suppressed exit failed',
			}),
		},
		logger: { warn: (message) => warnings.push(message) },
	});
	core.onTerminalRuntimeChanged('instance-1');
	remoteCopyModeActive.current = true;
	core.onTerminalRuntimeChanged('instance-2');
	await flushPromises();
	assert.deepEqual(warnings, ['suppressed exit failed']);
	assert.equal(remoteCopyModeActive.current, true);
	core.dispose();
});
