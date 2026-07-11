import assert from 'node:assert/strict';
import test from 'node:test';
import { createReplaySafeDisposer } from '../../src/lib/shell-controllers/controller-core';
import {
	createShellScrollbackHookRuntime,
	type ShellScrollbackHookRuntimeFactories,
} from '../../src/lib/shell-controllers/scrollback';
import {
	createDeferred,
	createScrollbackHarness,
	flushPromises,
} from './shell-scrollback-controller-test-support';

function createFixture() {
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

void test('hook runtime ordinary and Strict Mode unmount invalidates synchronously and disposes once', () => {
	const ordinary = createFixture();
	const cleanup = ordinary.runtime.setupDisposal();
	cleanup();
	assert.ok(ordinary.calls.includes('invalidate:unmount'));
	assert.equal(ordinary.calls.includes('dispose'), false);
	ordinary.deferredTasks.shift()?.();
	assert.equal(ordinary.calls.filter((call) => call === 'dispose').length, 1);

	const strict = createFixture();
	const first = strict.runtime.setupDisposal();
	first();
	const replay = strict.runtime.setupDisposal();
	strict.deferredTasks.shift()?.();
	assert.equal(strict.calls.includes('dispose'), false);
	replay();
	strict.deferredTasks.shift()?.();
	assert.equal(strict.calls.filter((call) => call === 'dispose').length, 1);
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
