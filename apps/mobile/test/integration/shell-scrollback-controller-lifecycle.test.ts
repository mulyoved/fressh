import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createDeferred,
	createScrollbackHarness,
	flushPromises,
} from './shell-scrollback-controller-test-support';

void test('scrollback runtime reset cannot overwrite a reentrant newer runtime', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	let reentered = false;
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.reset = () => {
		if (!reentered) {
			reentered = true;
			harness.core.onTerminalRuntimeChanged('instance-3');
		}
		return null;
	};
	harness.core.onTerminalRuntimeChanged('instance-2');
	assert.equal(harness.core.getSnapshot().runtimeInstanceId, 'instance-3');
});

void test('scrollback executor replacement cannot overwrite a reentrant newer context', () => {
	const harness = createScrollbackHarness();
	const outerScroll = { ...harness.scroll };
	const reentrantScroll = { ...harness.scroll };
	const reentrantContext = {
		...harness.context,
		workmuxScroll: reentrantScroll,
	};
	const firstExecutor = harness.executors[0];
	assert.ok(firstExecutor);
	firstExecutor.dispose = () => {
		harness.core.setContext(reentrantContext);
		return null;
	};
	harness.core.setContext({
		...harness.context,
		workmuxScroll: outerScroll,
	});
	assert.equal(harness.executors.length, 2);
	harness.core.setContext(reentrantContext);
	assert.equal(harness.executors.length, 2);
});

for (const settlement of ['false', 'reject'] as const) {
	void test(`scrollback dispose logs ${settlement} cleanup after clearing context without reviving state`, async () => {
		const harness = createScrollbackHarness();
		const cleanup = createDeferred<boolean>();
		const executor = harness.executors[0];
		assert.ok(executor);
		executor.dispose = () => cleanup.promise;
		harness.remoteCopyModeActive.current = true;
		harness.core.dispose();
		if (settlement === 'false') cleanup.resolve(false);
		else cleanup.reject(new Error('dispose cleanup failed'));
		await flushPromises();
		assert.equal(harness.remoteCopyModeActive.current, false);
		assert.deepEqual(harness.warnings, [
			'Workmux scrollback executor disposal failed',
		]);
	});
}

void test('scrollback dispose contains synchronous cleanup, logger, and subscriber throws', () => {
	const harness = createScrollbackHarness({
		logger: {
			warn: () => {
				throw new Error('logger failed');
			},
		},
	});
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.dispose = () => {
		throw new Error('dispose failed');
	};
	harness.core.subscribe(() => {
		throw new Error('subscriber failed');
	});
	assert.doesNotThrow(() => harness.core.dispose());
	assert.doesNotThrow(() => harness.core.dispose());
	assert.doesNotThrow(() => harness.core.invalidate('unmount'));
	assert.deepEqual(harness.core.getSnapshot(), {
		active: false,
		phase: 'active',
		runtimeInstanceId: null,
	});
});

void test('scrollback dispose logs a synchronous cleanup throw through captured logger', () => {
	const harness = createScrollbackHarness();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.dispose = () => {
		throw new Error('synchronous dispose failed');
	};
	harness.core.dispose();
	assert.deepEqual(harness.warnings, [
		'Workmux scrollback executor disposal failed',
	]);
});

void test('scrollback invalidation and disposal clear all owned local runtime state', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.core.onScrollbackModeChange({
		active: true,
		phase: 'dragging',
		instanceId: 'instance-1',
	});
	harness.lineAccumulator.lines = 8;
	harness.localExitRequestIds.add(7);
	harness.remoteCopyModeActive.current = true;
	harness.core.invalidate('app-inactive');
	assert.deepEqual(harness.core.getSnapshot(), {
		active: false,
		phase: 'active',
		runtimeInstanceId: 'instance-1',
	});
	assert.equal(harness.lineAccumulator.lines, 0);
	assert.equal(harness.localExitRequestIds.size, 0);
	harness.core.dispose();
	assert.equal(harness.remoteCopyModeActive.current, false);
});

void test('scrollback factory return after reentrant context is disposed without replacing newer executor', () => {
	const harness = createScrollbackHarness();
	const reentrantScroll = { ...harness.scroll };
	const reentrantContext = {
		...harness.context,
		workmuxScroll: reentrantScroll,
	};
	const staleEvents: string[] = [];
	harness.setExecutorFactoryOverride((_input, createDefault) => {
		harness.setExecutorFactoryOverride(null);
		harness.core.setContext(reentrantContext);
		const stale = createDefault();
		stale.dispose = () => {
			staleEvents.push('disposed');
			return null;
		};
		return stale;
	});
	harness.core.setContext({
		...harness.context,
		workmuxScroll: { ...harness.scroll },
	});
	assert.deepEqual(staleEvents, ['disposed']);
	const executorCount = harness.executors.length;
	harness.core.setContext(reentrantContext);
	assert.equal(harness.executors.length, executorCount);
});

void test('scrollback factory throw after reentrant context does not null newer executor', () => {
	const harness = createScrollbackHarness();
	const reentrantScroll = { ...harness.scroll };
	const reentrantContext = {
		...harness.context,
		workmuxScroll: reentrantScroll,
	};
	harness.setExecutorFactoryOverride(() => {
		harness.setExecutorFactoryOverride(null);
		harness.core.setContext(reentrantContext);
		throw new Error('stale factory failed');
	});
	assert.doesNotThrow(() =>
		harness.core.setContext({
			...harness.context,
			workmuxScroll: { ...harness.scroll },
		}),
	);
	const executorCount = harness.executors.length;
	harness.core.setContext(reentrantContext);
	assert.equal(harness.executors.length, executorCount);
});

for (const completion of ['return', 'throw'] as const) {
	void test(`scrollback factory ${completion} after reentrant dispose cannot install an executor`, () => {
		const harness = createScrollbackHarness();
		const staleEvents: string[] = [];
		harness.setExecutorFactoryOverride((_input, createDefault) => {
			harness.setExecutorFactoryOverride(null);
			harness.core.dispose();
			if (completion === 'throw')
				throw new Error('factory failed after dispose');
			const stale = createDefault();
			stale.dispose = () => {
				staleEvents.push('disposed');
				return null;
			};
			return stale;
		});
		assert.doesNotThrow(() =>
			harness.core.setContext({
				...harness.context,
				workmuxScroll: { ...harness.scroll },
			}),
		);
		if (completion === 'return') assert.deepEqual(staleEvents, ['disposed']);
		const executorCount = harness.executors.length;
		harness.core.setContext({
			...harness.context,
			workmuxScroll: { ...harness.scroll },
		});
		assert.equal(harness.executors.length, executorCount);
	});
}

void test('scrollback current executor factory failure stays contained and retryable', () => {
	const harness = createScrollbackHarness();
	harness.setExecutorFactoryOverride(() => {
		throw new Error('current factory failed');
	});
	const replacementContext = {
		...harness.context,
		workmuxScroll: { ...harness.scroll },
	};
	assert.doesNotThrow(() => harness.core.setContext(replacementContext));
	assert.deepEqual(harness.warnings, [
		'Workmux scrollback executor creation failed',
	]);
	harness.setExecutorFactoryOverride(null);
	const executorCount = harness.executors.length;
	harness.core.setContext(replacementContext);
	assert.equal(harness.executors.length, executorCount + 1);
});

void test('scrollback disposal publishes once and every later command is a no-op', async () => {
	const harness = createScrollbackHarness();
	let notifications = 0;
	harness.core.subscribe(() => {
		notifications += 1;
	});
	harness.core.onTerminalRuntimeChanged('instance-1');
	const beforeDispose = notifications;
	harness.core.dispose();
	assert.equal(notifications, beforeDispose + 1);
	harness.core.dispose();
	harness.core.invalidate('unmount');
	harness.core.onTerminalRuntimeChanged('instance-2');
	harness.core.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-2',
	});
	await harness.core.onScrollbackEnterRequested({
		instanceId: 'instance-2',
		requestId: 2,
	});
	harness.core.onScrollbackBatch({
		direction: 'down',
		pages: 0,
		lines: 1,
		pageStep: 24,
		instanceId: 'instance-2',
		source: 'selection-handle',
	});
	harness.core.jumpToLive();
	assert.equal(harness.core.clear(), null);
	assert.deepEqual(await harness.core.sendSegments([]), {
		status: 'unavailable',
	});
	assert.equal(notifications, beforeDispose + 1);
});
