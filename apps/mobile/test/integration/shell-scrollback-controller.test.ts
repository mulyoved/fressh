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

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

async function flushPromises() {
	await Promise.resolve();
	await new Promise<void>((resolve) => setImmediate(resolve));
}

function createRecordingCleanupBarrier() {
	let currentCleanup: Promise<boolean> | null = null;
	const trackedInputs: Promise<boolean>[] = [];
	return {
		barrier: {
			current: () => currentCleanup,
			track: (cleanup?: Promise<boolean> | null) => {
				if (!cleanup) return currentCleanup;
				trackedInputs.push(cleanup);
				const tracked = cleanup.finally(() => {
					if (currentCleanup === tracked) currentCleanup = null;
				});
				currentCleanup = tracked;
				return tracked;
			},
		},
		trackedInputs,
	};
}

function createScrollbackHarness(
	options: {
		cleanupBarrier?: ReturnType<
			typeof createWorkmuxScrollbackLiveInputCleanupBarrier
		>;
		logger?: ShellScrollbackContext['logger'];
	} = {},
) {
	const events: string[] = [];
	const remoteCopyModeActive = { current: false };
	const remoteCopyModeGeneration = { current: 0 };
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const localExitRequestIds = new Set<number>();
	const resetCalls: unknown[] = [];
	const warnings: string[] = [];
	const executorInputs: Parameters<
		typeof createWorkmuxScrollbackCommandExecutor
	>[0][] = [];
	let executorNumber = 0;
	const executors: WorkmuxScrollbackCommandExecutor[] = [];
	let executorFactoryOverride:
		| ((
				input: Parameters<typeof createWorkmuxScrollbackCommandExecutor>[0],
				createDefault: () => WorkmuxScrollbackCommandExecutor,
		  ) => WorkmuxScrollbackCommandExecutor)
		| null = null;
	const createDefaultExecutor = (
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
	const createExecutor = (
		input: Parameters<typeof createWorkmuxScrollbackCommandExecutor>[0],
	): WorkmuxScrollbackCommandExecutor =>
		executorFactoryOverride?.(input, () => createDefaultExecutor(input)) ??
		createDefaultExecutor(input);

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
		logger:
			options.logger ??
			({
				warn: (message) => warnings.push(message),
			} satisfies ShellScrollbackContext['logger']),
	};
	const core = createShellScrollbackControllerCore({
		createExecutor,
		lineAccumulator,
		cleanupBarrier:
			options.cleanupBarrier ??
			createWorkmuxScrollbackLiveInputCleanupBarrier(),
		localExitRequestIds,
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
		localExitRequestIds,
		remoteCopyModeActive,
		remoteCopyModeGeneration,
		resetCalls,
		scroll,
		setExecutorFactoryOverride: (override: typeof executorFactoryOverride) => {
			executorFactoryOverride = override;
		},
		warnings,
	};
}

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

void test('scrollback later-task commands are fail-closed and inert', async () => {
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
	assert.deepEqual(harness.events, beforeEvents);
	assert.deepEqual(harness.core.getSnapshot(), before);
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

void test('scrollback stale cleanup settlement cannot clear the newer barrier', async () => {
	const recording = createRecordingCleanupBarrier();
	const harness = createScrollbackHarness({
		cleanupBarrier: recording.barrier,
	});
	const staleCleanup = createDeferred<boolean>();
	const currentCleanup = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	let resetCount = 0;
	executor.reset = () => {
		resetCount += 1;
		return resetCount === 1 ? staleCleanup.promise : currentCleanup.promise;
	};
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.core.onTerminalRuntimeChanged('instance-2');
	assert.deepEqual(recording.trackedInputs, [
		staleCleanup.promise,
		currentCleanup.promise,
	]);
	const newerBarrier = recording.barrier.current();
	assert.notEqual(newerBarrier, null);
	staleCleanup.resolve(true);
	await flushPromises();
	assert.equal(recording.barrier.current(), newerBarrier);
	currentCleanup.resolve(true);
	await flushPromises();
	assert.equal(recording.barrier.current(), null);
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
