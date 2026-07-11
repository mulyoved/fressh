import assert from 'node:assert/strict';
import test from 'node:test';
import { createReplaySafeDisposer } from '../../src/lib/shell-controllers/controller-core';
import {
	createShellScrollbackHookRuntime,
	type ShellScrollbackHookRuntimeFactories,
} from '../../src/lib/shell-controllers/scrollback';
import {
	disposeWorkmuxControlChannelAfterCleanup,
	reportWorkmuxScrollbackCleanupTeardownError,
} from '../../src/lib/workmux-control-channel';
import {
	createDeferred,
	createScrollbackHarness,
	flushPromises,
} from './shell-scrollback-controller-test-support';

function createFixture(
	onTeardownCleanup?: (
		cleanup: Promise<boolean> | null,
		reason: 'channel-replaced' | 'unmount',
	) => void,
) {
	const harness = createScrollbackHarness();
	const calls: string[] = [];
	const deferredTasks: (() => void)[] = [];
	let createCount = 0;
	const original = {
		setContext: harness.core.setContext,
		onActivityChanged: harness.core.onActivityChanged,
		onTerminalRuntimeChanged: harness.core.onTerminalRuntimeChanged,
		invalidate: harness.core.invalidate,
		dispose: harness.core.dispose,
	};
	harness.core.setContext = (context) => {
		calls.push(`context:${context.targetName}`);
		original.setContext(context);
	};
	harness.core.onActivityChanged = () => {
		calls.push('activity');
		original.onActivityChanged();
	};
	harness.core.onTerminalRuntimeChanged = (instanceId) => {
		calls.push(`runtime:${instanceId}`);
		original.onTerminalRuntimeChanged(instanceId);
	};
	harness.core.invalidate = (reason) => {
		calls.push(`invalidate:${reason}`);
		original.invalidate(reason);
	};
	harness.core.dispose = () => {
		calls.push('dispose');
		original.dispose();
	};
	const factories: ShellScrollbackHookRuntimeFactories = {
		createCore: () => {
			createCount += 1;
			return harness.core;
		},
		createDisposer: (dispose, defer) =>
			createReplaySafeDisposer(dispose, defer),
	};
	const runtime = createShellScrollbackHookRuntime({
		input: {
			activity: {
				getSnapshot: harness.context.getActivitySnapshot,
				subscribe: () => () => {},
				snapshot: harness.context.getActivitySnapshot(),
			},
			context: harness.context,
			onTeardownCleanup,
		},
		factories,
		deferDisposal: (task) => deferredTasks.push(task),
	});
	return {
		calls,
		createCount: () => createCount,
		deferredTasks,
		harness,
		runtime,
	};
}

void test('real unmount starts scrollback rollback before handing its composite cleanup to channel teardown', async () => {
	const order: string[] = [];
	let handedCleanup: Promise<boolean> | null | undefined;
	const fixture = createFixture((cleanup, reason) => {
		order.push(`teardown:${reason}`);
		handedCleanup = cleanup;
	});
	fixture.runtime.onTerminalRuntimeChanged('instance-1');
	fixture.harness.remoteCopyModeActive.current = true;
	const rollback = createDeferred<boolean>();
	const executor = fixture.harness.executors[0];
	assert.ok(executor);
	executor.dispose = () => {
		order.push('rollback');
		return rollback.promise;
	};

	const cleanupEffect = fixture.runtime.setupDisposal();
	cleanupEffect();
	assert.deepEqual(order, []);
	fixture.deferredTasks.shift()?.();
	assert.deepEqual(order, ['rollback', 'teardown:unmount']);
	assert.ok(handedCleanup);
	let settled = false;
	void handedCleanup.then(() => {
		settled = true;
	});
	await flushPromises();
	assert.equal(settled, false);
	rollback.resolve(true);
	assert.equal(await handedCleanup, true);
});

void test('Strict Mode replay performs neither rollback nor channel teardown', () => {
	const reasons: string[] = [];
	const fixture = createFixture((_cleanup, reason) => reasons.push(reason));
	const firstCleanup = fixture.runtime.setupDisposal();
	firstCleanup();
	const replayCleanup = fixture.runtime.setupDisposal();
	fixture.deferredTasks.shift()?.();
	assert.deepEqual(reasons, []);
	assert.equal(fixture.calls.includes('invalidate:unmount'), false);
	assert.equal(fixture.calls.includes('dispose'), false);
	replayCleanup();
});

void test('channel replacement releases old authority through only the old teardown callback', async () => {
	const oldCalls: (Promise<boolean> | null)[] = [];
	const newCalls: (Promise<boolean> | null)[] = [];
	const fixture = createFixture((cleanup) => oldCalls.push(cleanup));
	fixture.runtime.onTerminalRuntimeChanged('instance-1');
	fixture.harness.remoteCopyModeActive.current = true;
	const rollback = createDeferred<boolean>();
	const oldExecutor = fixture.harness.executors[0];
	assert.ok(oldExecutor);
	oldExecutor.dispose = () => rollback.promise;
	const replacementScroll = {
		enter: fixture.harness.context.workmuxScroll.enter,
		move: fixture.harness.context.workmuxScroll.move,
		exit: fixture.harness.context.workmuxScroll.exit,
	};

	fixture.runtime.commit({
		...fixture.runtime.getInput(),
		context: {
			...fixture.runtime.getInput().context,
			workmuxScroll: replacementScroll,
		},
		onTeardownCleanup: (cleanup) => newCalls.push(cleanup),
	});
	assert.equal(oldCalls.length, 1);
	assert.equal(newCalls.length, 0);
	assert.ok(oldCalls[0]);
	let settled = false;
	void oldCalls[0]?.then(() => {
		settled = true;
	});
	await flushPromises();
	assert.equal(settled, false);
	rollback.resolve(true);
	assert.equal(await oldCalls[0], true);
	assert.equal(newCalls.length, 0);
});

void test('channel teardown waits for rejected rollback before disposing and leaves cleanup logging to its owner', async () => {
	const events: string[] = [];
	const teardownWarnings: string[] = [];
	const fixture = createFixture((cleanup) => {
		disposeWorkmuxControlChannelAfterCleanup({
			cleanup,
			prepareDispose: () => events.push('prepare'),
			dispose: async () => {
				events.push('dispose');
			},
			onCleanupError: (error) =>
				reportWorkmuxScrollbackCleanupTeardownError(error, (message) => {
					teardownWarnings.push(message);
				}),
		});
	});
	const warningCount = fixture.harness.warnings.length;
	fixture.runtime.onTerminalRuntimeChanged('instance-1');
	fixture.harness.remoteCopyModeActive.current = true;
	const rollback = createDeferred<boolean>();
	const executor = fixture.harness.executors[0];
	assert.ok(executor);
	executor.dispose = () => rollback.promise;
	const cleanupEffect = fixture.runtime.setupDisposal();
	cleanupEffect();
	fixture.deferredTasks.shift()?.();
	assert.deepEqual(events, ['prepare']);
	const failure = new Error('rollback failed');
	rollback.reject(failure);
	await flushPromises();
	assert.deepEqual(events, ['prepare', 'dispose']);
	assert.equal(fixture.harness.warnings.length, warningCount + 1);
	assert.deepEqual(teardownWarnings, []);
});

void test('channel teardown waits for false rollback and logs exactly once through the cleanup owner', async () => {
	const events: string[] = [];
	const fixture = createFixture((cleanup) => {
		disposeWorkmuxControlChannelAfterCleanup({
			cleanup,
			prepareDispose: () => events.push('prepare'),
			dispose: async () => {
				events.push('dispose');
			},
		});
	});
	const warningCount = fixture.harness.warnings.length;
	fixture.runtime.onTerminalRuntimeChanged('instance-1');
	fixture.harness.remoteCopyModeActive.current = true;
	const rollback = createDeferred<boolean>();
	const executor = fixture.harness.executors[0];
	assert.ok(executor);
	executor.dispose = () => rollback.promise;
	const cleanupEffect = fixture.runtime.setupDisposal();
	cleanupEffect();
	fixture.deferredTasks.shift()?.();
	assert.deepEqual(events, ['prepare']);
	rollback.resolve(false);
	await flushPromises();
	assert.deepEqual(events, ['prepare', 'dispose']);
	assert.equal(fixture.harness.warnings.length, warningCount + 1);
});

void test('channel teardown timeout disposes while an exact rollback remains pending', () => {
	const events: string[] = [];
	const warnings: string[] = [];
	let fireTimeout: (() => void) | undefined;
	const fixture = createFixture((cleanup) => {
		disposeWorkmuxControlChannelAfterCleanup({
			cleanup,
			cleanupTimeoutMs: 5,
			clearTimeout: () => {},
			setTimeout: (callback) => {
				fireTimeout = callback;
				return Symbol('timer');
			},
			prepareDispose: () => events.push('prepare'),
			dispose: async () => {
				events.push('dispose');
			},
			onCleanupError: (error) =>
				reportWorkmuxScrollbackCleanupTeardownError(error, (message) => {
					warnings.push(message);
				}),
		});
	});
	fixture.runtime.onTerminalRuntimeChanged('instance-1');
	fixture.harness.remoteCopyModeActive.current = true;
	const executor = fixture.harness.executors[0];
	assert.ok(executor);
	executor.dispose = () => new Promise<boolean>(() => {});
	const cleanupEffect = fixture.runtime.setupDisposal();
	cleanupEffect();
	fixture.deferredTasks.shift()?.();
	assert.deepEqual(events, ['prepare']);
	assert.ok(fireTimeout);
	fireTimeout();
	assert.deepEqual(events, ['prepare', 'dispose']);
	assert.deepEqual(warnings, [
		'Workmux scrollback cleanup timed out before control channel disposal',
	]);
	fireTimeout();
	assert.deepEqual(events, ['prepare', 'dispose']);
	assert.equal(warnings.length, 1);
});

void test('hook runtime owns one core and keeps input and xterm ports stable across current context updates', async () => {
	const fixture = createFixture();
	const inputPort = fixture.runtime.input;
	const xtermProps = fixture.runtime.xtermProps;
	assert.equal(fixture.createCount(), 1);

	fixture.runtime.commit({
		activity: {
			getSnapshot: fixture.harness.context.getActivitySnapshot,
			subscribe: () => () => {},
			snapshot: fixture.harness.context.getActivitySnapshot(),
		},
		context: { ...fixture.harness.context, targetName: 'next' },
	});
	fixture.runtime.onActivityChanged();
	fixture.runtime.onTerminalRuntimeChanged('instance-2');

	assert.equal(fixture.runtime.input, inputPort);
	assert.equal(fixture.runtime.xtermProps, xtermProps);
	assert.ok(fixture.calls.includes('context:next'));
	assert.ok(fixture.calls.includes('activity'));
	assert.ok(fixture.calls.includes('runtime:instance-2'));
	assert.deepEqual(await inputPort.sendSegments([]), { status: 'unavailable' });
});

void test('hook runtime defers ordinary unmount invalidation and disposal and suppresses Strict Mode replay', () => {
	const ordinary = createFixture();
	const ordinarySnapshot = ordinary.harness.core.getSnapshot();
	const cleanup = ordinary.runtime.setupDisposal();
	cleanup();
	assert.equal(ordinary.calls.includes('invalidate:unmount'), false);
	assert.equal(ordinary.calls.includes('dispose'), false);
	assert.equal(ordinary.harness.core.getSnapshot(), ordinarySnapshot);
	ordinary.deferredTasks.shift()?.();
	assert.equal(
		ordinary.calls.filter((call) => call === 'invalidate:unmount').length,
		1,
	);
	assert.equal(ordinary.calls.filter((call) => call === 'dispose').length, 1);

	const strict = createFixture();
	const strictEvents = strict.harness.events.length;
	const first = strict.runtime.setupDisposal();
	first();
	const replay = strict.runtime.setupDisposal();
	strict.deferredTasks.shift()?.();
	assert.equal(
		strict.calls.filter((call) => call === 'invalidate:unmount').length,
		0,
	);
	assert.equal(strict.calls.includes('dispose'), false);
	assert.equal(strict.harness.events.length, strictEvents);
	replay();
	strict.deferredTasks.shift()?.();
	assert.equal(
		strict.calls.filter((call) => call === 'invalidate:unmount').length,
		1,
	);
	assert.equal(strict.calls.filter((call) => call === 'dispose').length, 1);
});

void test('deferred unmount attempts invalidate and dispose once and contains errors through the latest logger', () => {
	const fixture = createFixture();
	const oldWarnings: string[] = [];
	const warnings: string[] = [];
	let invalidations = 0;
	let disposals = 0;
	fixture.harness.core.invalidate = () => {
		invalidations += 1;
		throw new Error('invalidate failed');
	};
	fixture.harness.core.dispose = () => {
		disposals += 1;
		throw new Error('dispose failed');
	};
	fixture.runtime.commit({
		...fixture.runtime.getInput(),
		context: {
			...fixture.runtime.getInput().context,
			logger: { warn: (message) => oldWarnings.push(message) },
		},
	});
	const cleanup = fixture.runtime.setupDisposal();
	cleanup();
	fixture.runtime.commit({
		...fixture.runtime.getInput(),
		context: {
			...fixture.runtime.getInput().context,
			logger: { warn: (message) => warnings.push(message) },
		},
	});
	assert.equal(invalidations, 0);
	assert.equal(disposals, 0);
	assert.doesNotThrow(() => fixture.deferredTasks.shift()?.());
	assert.equal(invalidations, 1);
	assert.equal(disposals, 1);
	assert.deepEqual(oldWarnings, []);
	assert.deepEqual(warnings, ['Failed to dispose scrollback controller']);
});

void test('jump-to-live has one canonical async rejection observer and contains synchronous logger failure', async () => {
	const fixture = createFixture();
	const cleanup = createDeferred<boolean>();
	const oldWarnings: string[] = [];
	const currentWarnings: string[] = [];
	fixture.runtime.onTerminalRuntimeChanged('instance-1');
	const executor = fixture.harness.executors[0];
	assert.ok(executor);
	executor.reset = () => cleanup.promise;
	fixture.runtime.commit({
		activity: {
			getSnapshot: fixture.harness.context.getActivitySnapshot,
			metadata: 'ignored',
			subscribe: () => () => {},
			snapshot: fixture.harness.context.getActivitySnapshot(),
		} as never,
		context: {
			...fixture.harness.context,
			logger: { warn: (message) => oldWarnings.push(message) },
		},
	});
	fixture.runtime.jumpToLive();
	fixture.runtime.commit({
		activity: fixture.runtime.getInput().activity,
		context: {
			...fixture.runtime.getInput().context,
			logger: { warn: (message) => currentWarnings.push(message) },
		},
	});
	cleanup.reject(new Error('cleanup failed'));
	await flushPromises();
	assert.deepEqual(oldWarnings, []);
	assert.deepEqual(currentWarnings, ['Workmux scrollback reset failed']);

	fixture.runtime.commit({
		activity: fixture.runtime.getInput().activity,
		context: {
			...fixture.runtime.getInput().context,
			logger: {
				warn: () => {
					throw new Error('logger failed');
				},
			},
		},
	});
	fixture.harness.core.jumpToLive = () => {
		throw new Error('sync jump failure');
	};
	assert.doesNotThrow(() => fixture.runtime.jumpToLive());
	await Promise.resolve();
});

void test('scrollback hook module is Node-loadable without evaluating React Native', async () => {
	const loaded = await import('../../src/lib/shell-controllers/scrollback');
	assert.equal(typeof loaded.createShellScrollbackHookRuntime, 'function');
});

void test('stable xterm props forward every method after the current context commit', async () => {
	const fixture = createFixture();
	const xtermProps = fixture.runtime.xtermProps;
	const events: string[] = [];
	fixture.harness.core.onScrollbackModeChange = () => events.push('mode');
	fixture.harness.core.onScrollbackEnterRequested = async () => {
		events.push('enter');
	};
	fixture.harness.core.onScrollbackBatch = () => events.push('batch');
	fixture.runtime.commit({
		...fixture.runtime.getInput(),
		context: { ...fixture.runtime.getInput().context, targetName: 'latest' },
	});
	xtermProps.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-1',
	});
	await xtermProps.onScrollbackEnterRequested({
		instanceId: 'instance-1',
		requestId: 1,
	});
	xtermProps.onScrollbackBatch({
		direction: 'up',
		instanceId: 'instance-1',
		lines: 1,
		pages: 0,
		pageStep: 24,
	});
	assert.equal(fixture.runtime.xtermProps, xtermProps);
	assert.deepEqual(events, ['mode', 'enter', 'batch']);
});
