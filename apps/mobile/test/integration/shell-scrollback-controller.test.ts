import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createShellScrollbackControllerCore,
	type ShellScrollbackContext,
} from '../../src/lib/shell-controllers/scrollback-core';
import { createShellTargetKey } from '../../src/lib/shell-controllers/source-keys';
import { createTmuxScrollbackLineAccumulator } from '../../src/lib/workmux-scrollback-batch';
import {
	type WorkmuxScrollbackCommandExecutor,
	type createWorkmuxScrollbackCommandExecutor,
} from '../../src/lib/workmux-scrollback-executor';
import { createWorkmuxScrollbackLiveInputCleanupBarrier } from '../../src/lib/workmux-scrollback-live-input';

const targetKey = createShellTargetKey('transport' as never, 'main');

function createScrollbackHarness() {
	const events: string[] = [];
	const remoteCopyModeActive = { current: false };
	const remoteCopyModeGeneration = { current: 0 };
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const resetCalls: unknown[] = [];
	const warnings: string[] = [];
	const executorInputs: Parameters<
		typeof createWorkmuxScrollbackCommandExecutor
	>[0][] = [];
	let executorNumber = 0;
	const executors: WorkmuxScrollbackCommandExecutor[] = [];
	const createExecutor = (
		input: Parameters<typeof createWorkmuxScrollbackCommandExecutor>[0],
	): WorkmuxScrollbackCommandExecutor => {
		executorInputs.push(input);
		executorNumber += 1;
		const id = executorNumber;
		const executor: WorkmuxScrollbackCommandExecutor = {
			runEnterCommand: async () => false,
			enqueueScrollBatch: async () => false,
			reset: (options) => {
				events.push(`reset:${id}`);
				resetCalls.push(options);
				return null;
			},
			dispose: () => {
				events.push(`dispose:${id}`);
				return null;
			},
		};
		executors.push(executor);
		return executor;
	};

	const terminalView = {
		getRuntimeKey: () => null,
		getRuntimeInstanceId: () => null,
		isCurrentInstance: () => false,
		fit: () => {},
		setSystemKeyboardEnabled: () => {},
		setSelectionModeEnabled: () => {},
		getSelection: async () => '',
		exitScrollback: () => {},
		sendScrollbackEnterAck: () => {},
	};
	const terminalTransport = {
		captureLease: () => null,
		isLeaseCurrent: () => false,
		sendBatch: async () => {},
	};
	const scroll = {
		enter: async () => ({ success: true, output: '' }),
		move: async () => ({ success: true, output: '' }),
		exit: async () => ({ success: true, output: '' }),
	};
	const context: ShellScrollbackContext = {
		targetKey,
		targetName: 'main',
		connectionAvailable: true,
		shellAvailable: true,
		tmuxEnabled: true,
		getActivitySnapshot: () => ({
			focused: true,
			appState: 'active',
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getSelectionModeEnabled: () => false,
		terminalTransport,
		terminalView,
		workmuxScroll: scroll,
		trace: () => {},
		feedback: { alert: () => {}, copyMessage: () => {} },
		logger: {
			warn: (message) => warnings.push(message),
		},
	};
	const core = createShellScrollbackControllerCore({
		createExecutor,
		lineAccumulator,
		cleanupBarrier: createWorkmuxScrollbackLiveInputCleanupBarrier(),
		remoteCopyModeActive,
		remoteCopyModeGeneration,
	});
	core.setContext(context);

	return {
		core,
		context,
		events,
		executorInputs,
		executors,
		lineAccumulator,
		remoteCopyModeActive,
		remoteCopyModeGeneration,
		resetCalls,
		scroll,
		warnings,
	};
}

void test('scrollback runtime replacement clears local and remote state', () => {
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
	assert.equal(harness.remoteCopyModeActive.current, false);
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
	assert.deepEqual(observations, ['false:0']);
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
