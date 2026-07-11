import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellScrollbackControllerCore } from '../../src/lib/shell-controllers/scrollback-core';
import { createShellTargetKey } from '../../src/lib/shell-controllers/source-keys';
import { createTmuxScrollbackLineAccumulator } from '../../src/lib/workmux-scrollback-batch';
import { createScrollbackHarness } from './shell-scrollback-controller-test-support';

void test('scrollback runtime replacement clears local state and retains unconfirmed remote ownership', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.core.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-1',
	});
	harness.remoteCopyModeActive.current = true;
	harness.lineAccumulator.lines = 3;
	harness.lineAccumulator.direction = 'up';
	harness.core.onTerminalRuntimeChanged('instance-2');
	assert.deepEqual(harness.core.getSnapshot(), {
		active: false,
		phase: 'active',
		runtimeInstanceId: 'instance-2',
	});
	assert.equal(harness.remoteCopyModeActive.current, true);
	assert.equal(harness.lineAccumulator.lines, 0);
	assert.equal(harness.lineAccumulator.direction, null);
});

void test('scrollback ignores mode events from a stale terminal instance', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-2');
	harness.core.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-1',
	});
	assert.equal(harness.core.getSnapshot().active, false);
});

void test('scrollback treats null as a runtime transition and repeated identities as idempotent', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	const afterFirst = harness.resetCalls.length;
	harness.core.onTerminalRuntimeChanged('instance-1');
	assert.equal(harness.resetCalls.length, afterFirst);
	harness.core.onTerminalRuntimeChanged(null);
	assert.equal(harness.resetCalls.length, afterFirst + 1);
	harness.core.onTerminalRuntimeChanged(null);
	assert.equal(harness.resetCalls.length, afterFirst + 1);
});

void test('scrollback replaces executor only for semantic target or command-port changes', () => {
	const harness = createScrollbackHarness();
	assert.equal(harness.executors.length, 1);
	harness.core.setContext({
		...harness.context,
		getActivitySnapshot: harness.context.getActivitySnapshot,
		logger: { warn: () => {} },
	});
	assert.equal(harness.executors.length, 1);

	const replacementScroll = { ...harness.scroll };
	harness.core.setContext({
		...harness.context,
		workmuxScroll: replacementScroll,
	});
	assert.deepEqual(harness.events.slice(-1), ['dispose:1']);
	assert.equal(harness.executors.length, 2);

	const otherTarget = createShellTargetKey('transport' as never, 'other');
	harness.core.setContext({
		...harness.context,
		targetKey: otherTarget,
		targetName: 'other',
		workmuxScroll: replacementScroll,
	});
	assert.deepEqual(harness.events.slice(-1), ['dispose:2']);
	assert.equal(harness.executors.length, 3);
});

void test('scrollback runtime cleanup completes before publishing replacement', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.remoteCopyModeActive.current = true;
	harness.lineAccumulator.lines = 4;
	const observations: string[] = [];
	harness.core.subscribe(() => {
		observations.push(
			`${harness.remoteCopyModeActive.current}:${harness.lineAccumulator.lines}`,
		);
	});
	harness.core.onTerminalRuntimeChanged('instance-2');
	assert.deepEqual(observations, ['true:0']);
});

void test('scrollback suppresses callbacks from a replaced executor', () => {
	const harness = createScrollbackHarness();
	const staleExecutorInput = harness.executorInputs[0];
	assert.ok(staleExecutorInput);
	harness.core.setContext({
		...harness.context,
		workmuxScroll: { ...harness.scroll },
	});
	staleExecutorInput.onFailure('stale failure', { commandKind: 'enter' });
	staleExecutorInput.onDisposeExitFailure?.('stale dispose failure');
	staleExecutorInput.onTrace?.({ event: 'stale.trace' });
	assert.deepEqual(harness.warnings, []);
});

void test('scrollback live input remains fail-closed while event commands stay runtime guarded', async () => {
	const harness = createScrollbackHarness();
	const before = harness.core.getSnapshot();
	const beforeEvents = [...harness.events];
	await harness.core.onScrollbackEnterRequested({
		instanceId: 'instance-1',
		requestId: 1,
	});
	harness.core.onScrollbackBatch({
		direction: 'up',
		pages: 1,
		lines: 0,
		pageStep: 24,
		instanceId: 'instance-1',
		source: 'touch-scroll',
	});
	assert.deepEqual(await harness.core.sendSegments([new Uint8Array([0x61])]), {
		status: 'unavailable',
	});
	assert.equal(harness.core.clear(), null);
	harness.core.jumpToLive();
	assert.deepEqual(harness.events, [...beforeEvents, 'reset:1']);
	assert.deepEqual(harness.core.getSnapshot(), before);
});

void test('scrollback records runtime before context and accepts matching mode after context arrives', () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	lineAccumulator.lines = 4;
	const core = createShellScrollbackControllerCore({ lineAccumulator });
	core.onTerminalRuntimeChanged('instance-before-context');
	assert.deepEqual(core.getSnapshot(), {
		active: false,
		phase: 'active',
		runtimeInstanceId: 'instance-before-context',
	});
	assert.equal(lineAccumulator.lines, 0);
	const harness = createScrollbackHarness();
	core.setContext(harness.context);
	core.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-before-context',
	});
	assert.equal(core.getSnapshot().active, true);
	core.dispose();

	const nullFirst = createShellScrollbackControllerCore();
	nullFirst.onTerminalRuntimeChanged('temporary');
	nullFirst.onTerminalRuntimeChanged(null);
	assert.equal(nullFirst.getSnapshot().runtimeInstanceId, null);
	nullFirst.dispose();
});
