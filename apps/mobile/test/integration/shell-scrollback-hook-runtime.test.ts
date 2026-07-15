import assert from 'node:assert/strict';
import test from 'node:test';
import { createReplaySafeDisposer } from '../../src/lib/shell-controllers/controller-core';
import {
	createShellScrollbackHookRuntime,
	type ShellScrollbackHookRuntimeFactories,
} from '../../src/lib/shell-controllers/scrollback';
import { createShellTargetKey } from '../../src/lib/shell-controllers/source-keys';
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
			runtimeInstanceId: null,
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

void test('hook target replacement immediately hides active scrollback without replacing Workmux ownership', () => {
	const fixture = createFixture();
	fixture.runtime.commit({
		...fixture.runtime.getInput(),
		runtimeInstanceId: 'instance-1',
	});
	fixture.runtime.xtermProps.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-1',
	});
	assert.equal(fixture.runtime.core.getSnapshot().active, true);
	fixture.runtime.commit({
		...fixture.runtime.getInput(),
		context: {
			...fixture.runtime.getInput().context,
			targetKey: createShellTargetKey('transport' as never, 'target-b'),
			targetName: 'target-b',
		},
	});
	assert.deepEqual(fixture.runtime.core.getSnapshot(), {
		active: false,
		phase: 'active',
		runtimeInstanceId: 'instance-1',
	});
});

void test('hook runtime owns one core and keeps input and xterm ports stable across current context updates', async () => {
	const fixture = createFixture();
	const inputPort = fixture.runtime.input;
	const xtermProps = fixture.runtime.xtermProps;
	assert.equal(fixture.createCount(), 1);

	fixture.runtime.commit({
		runtimeInstanceId: 'instance-2',
		context: { ...fixture.harness.context, targetName: 'next' },
	});
	fixture.runtime.onActivityChanged();

	assert.equal(fixture.runtime.input, inputPort);
	assert.equal(fixture.runtime.xtermProps, xtermProps);
	assert.ok(fixture.calls.includes('context:next'));
	assert.ok(fixture.calls.includes('activity'));
	assert.ok(fixture.calls.includes('runtime:instance-2'));
	assert.deepEqual(await inputPort.sendSegments([]), { status: 'unavailable' });
});

void test('commit reconciles the terminal runtime instance without a screen callback', () => {
	const fixture = createFixture();
	const nextInput = {
		...fixture.runtime.getInput(),
		runtimeInstanceId: 'instance-from-terminal',
	};

	fixture.runtime.commit(nextInput as never);

	assert.ok(fixture.calls.includes('runtime:instance-from-terminal'));
	assert.equal(
		fixture.runtime.core.getSnapshot().runtimeInstanceId,
		'instance-from-terminal',
	);
});

void test('hook runtime defers ordinary unmount and suppresses Strict Mode replay', () => {
	const ordinary = createFixture();
	const cleanup = ordinary.runtime.setupDisposal();
	cleanup();
	assert.equal(ordinary.calls.includes('invalidate:unmount'), false);
	assert.equal(ordinary.calls.includes('dispose'), false);
	ordinary.deferredTasks.shift()?.();
	assert.equal(
		ordinary.calls.filter((call) => call === 'invalidate:unmount').length,
		1,
	);
	assert.equal(ordinary.calls.filter((call) => call === 'dispose').length, 1);

	const strict = createFixture();
	const first = strict.runtime.setupDisposal();
	first();
	const replay = strict.runtime.setupDisposal();
	strict.deferredTasks.shift()?.();
	assert.equal(strict.calls.includes('invalidate:unmount'), false);
	assert.equal(strict.calls.includes('dispose'), false);
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
			logger: { warn: (message) => warnings.push(message) },
		},
	});
	const cleanup = fixture.runtime.setupDisposal();
	cleanup();
	assert.equal(invalidations, 0);
	assert.equal(disposals, 0);
	assert.doesNotThrow(() => fixture.deferredTasks.shift()?.());
	assert.equal(invalidations, 1);
	assert.equal(disposals, 1);
	assert.deepEqual(warnings, ['Failed to dispose scrollback controller']);
});

void test('jump-to-live observes async rejection through the current logger', async () => {
	const fixture = createFixture();
	const cleanup = createDeferred<boolean>();
	const oldWarnings: string[] = [];
	const currentWarnings: string[] = [];
	fixture.runtime.commit({
		...fixture.runtime.getInput(),
		runtimeInstanceId: 'instance-1',
	});
	const executor = fixture.harness.executors[0];
	assert.ok(executor);
	executor.reset = () => cleanup.promise;
	fixture.runtime.commit({
		...fixture.runtime.getInput(),
		context: {
			...fixture.runtime.getInput().context,
			logger: { warn: (message) => oldWarnings.push(message) },
		},
	});
	fixture.runtime.jumpToLive();
	fixture.runtime.commit({
		...fixture.runtime.getInput(),
		context: {
			...fixture.runtime.getInput().context,
			logger: { warn: (message) => currentWarnings.push(message) },
		},
	});
	cleanup.reject(new Error('cleanup failed'));
	await flushPromises();
	assert.deepEqual(oldWarnings, []);
	assert.deepEqual(currentWarnings, ['Workmux scrollback reset failed']);
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
	assert.deepEqual(events, ['mode', 'enter', 'batch']);
});
