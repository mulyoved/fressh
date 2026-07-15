import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellTargetKey } from '../../src/lib/shell-controllers/source-keys';
import { type WorkmuxScrollbackPageCommand } from '../../src/lib/workmux-scrollback-batch';
import {
	createDeferred,
	createRecordingCleanupBarrier,
	createScrollbackHarness,
	flushPromises,
} from './shell-scrollback-controller-test-support';

const enterEvent = { instanceId: 'instance-1', requestId: 7 };
const batchEvent = {
	direction: 'up' as const,
	pages: 1,
	lines: 0,
	pageStep: 24,
	instanceId: 'instance-1',
	seq: 11,
	ts: 17,
	source: 'touch-scroll' as const,
};

void test('scrollback acknowledges only a current successful enter', async () => {
	const harness = createScrollbackHarness();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.runEnterCommand = async (targetName) => targetName === 'main';
	harness.core.onTerminalRuntimeChanged('instance-1');
	const generationBeforeEnter = harness.remoteCopyModeGeneration.current;

	await harness.core.onScrollbackEnterRequested(enterEvent);

	assert.deepEqual(harness.enterAcks, [enterEvent]);
	assert.equal(harness.remoteCopyModeActive.current, true);
	assert.equal(
		harness.remoteCopyModeGeneration.current,
		generationBeforeEnter + 1,
	);
});

void test('scrollback registers retiring cleanup only while it owns remote copy mode', async () => {
	const harness = createScrollbackHarness();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.runEnterCommand = async () => true;
	harness.core.onTerminalRuntimeChanged('instance-1');
	assert.equal(harness.workmuxBeforeDispose.size, 0);

	await harness.core.onScrollbackEnterRequested(enterEvent);

	assert.equal(harness.workmuxBeforeDispose.size, 1);
	const cleanup = [...harness.workmuxBeforeDispose.values()][0];
	assert.ok(cleanup);
	const exits: string[] = [];
	await cleanup({
		exitScroll: async ({ sessionName }) => {
			exits.push(sessionName);
			return { status: 'completed' };
		},
	});
	assert.deepEqual(exits, ['main']);

	harness.core.dispose();
	assert.equal(harness.workmuxBeforeDispose.size, 0);
	assert.equal(harness.workmuxUnregisterCount(), 1);
});

void test('scrollback focus invalidation rolls back an in-flight enter without ack', async () => {
	const harness = createScrollbackHarness();
	const entered = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.runEnterCommand = () => entered.promise;
	harness.core.onTerminalRuntimeChanged('instance-1');
	const pending = harness.core.onScrollbackEnterRequested(enterEvent);
	harness.setActivitySnapshot({ focused: false, interactive: false });
	harness.core.invalidate('focus-lost');
	entered.resolve(true);
	await pending;

	assert.deepEqual(harness.enterAcks, []);
	assert.equal(harness.remoteCopyModeActive.current, true);
	assert.ok(harness.resetCalls.length >= 1);
	assert.deepEqual(harness.resetCalls.at(-1), {
		targetName: 'main',
		failurePolicy: 'suppress',
	});
});

void test('scrollback stale enter cannot overwrite a reentrant newer target', async () => {
	const harness = createScrollbackHarness();
	const entered = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.runEnterCommand = () => entered.promise;
	harness.core.onTerminalRuntimeChanged('instance-1');
	const pending = harness.core.onScrollbackEnterRequested(enterEvent);
	const replacementScroll = { ...harness.scroll };
	harness.core.setContext({
		...harness.context,
		targetKey: createShellTargetKey('transport' as never, 'other'),
		targetName: 'other',
		workmux: { ...harness.context.workmux, scroll: replacementScroll },
	});
	entered.resolve(true);
	await pending;

	assert.deepEqual(harness.enterAcks, []);
	assert.equal(harness.remoteCopyModeActive.current, false);
});

void test('scrollback superseded enter failure logs without a stale alert', async () => {
	const harness = createScrollbackHarness();
	const firstEnter = createDeferred<boolean>();
	const callback = harness.executorInputs[0]?.onFailure;
	const executor = harness.executors[0];
	assert.ok(callback);
	assert.ok(executor);
	let calls = 0;
	executor.runEnterCommand = async (_targetName, operationOwner) => {
		calls += 1;
		if (calls === 1) {
			const result = await firstEnter.promise;
			callback('stale enter failure', {
				commandKind: 'enter',
				operationOwner,
			});
			return result;
		}
		return true;
	};
	harness.core.onTerminalRuntimeChanged('instance-1');
	const stale = harness.core.onScrollbackEnterRequested(enterEvent);
	const current = harness.core.onScrollbackEnterRequested({
		...enterEvent,
		requestId: 8,
	});
	await current;
	firstEnter.resolve(false);
	await stale;

	assert.deepEqual(harness.alerts, []);
	assert.ok(harness.warnings.includes('stale enter failure'));
	assert.deepEqual(harness.enterAcks, [
		{ instanceId: 'instance-1', requestId: 8 },
	]);
});

void test('scrollback current guarded enter clears local UI without a command', async () => {
	const harness = createScrollbackHarness();
	let enterCalls = 0;
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.runEnterCommand = async () => {
		enterCalls += 1;
		return true;
	};
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.setSelectionModeEnabled(true);

	await harness.core.onScrollbackEnterRequested(enterEvent);

	assert.equal(enterCalls, 0);
	assert.deepEqual(harness.localExitMessages, [
		{ requestId: 1, instanceId: 'instance-1' },
	]);
});

void test('scrollback inactive current enter clears local UI while stale enter is ignored', async () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.setActivitySnapshot({ appActive: false, interactive: false });

	await harness.core.onScrollbackEnterRequested(enterEvent);
	await harness.core.onScrollbackEnterRequested({
		instanceId: 'stale',
		requestId: 8,
	});

	assert.deepEqual(harness.localExitMessages, [
		{ requestId: 1, instanceId: 'instance-1' },
	]);
});

void test('scrollback local exit request is consumed once without a second reset', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	const resetsBeforeJump = harness.resetCalls.length;
	harness.core.jumpToLive();
	const request = harness.localExitMessages.at(-1);
	assert.ok(request);
	assert.equal(harness.resetCalls.length, resetsBeforeJump + 1);

	harness.core.onScrollbackModeChange({
		active: false,
		phase: 'active',
		instanceId: 'instance-1',
		requestId: request.requestId,
	});
	assert.equal(harness.resetCalls.length, resetsBeforeJump + 1);
	harness.core.onScrollbackModeChange({
		active: false,
		phase: 'active',
		instanceId: 'instance-1',
		requestId: request.requestId,
	});
	assert.equal(harness.resetCalls.length, resetsBeforeJump + 2);
});

void test('scrollback remote-origin mode exit performs one reset', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.remoteCopyModeActive.current = true;
	const before = harness.resetCalls.length;
	harness.core.onScrollbackModeChange({
		active: false,
		phase: 'active',
		instanceId: 'instance-1',
	});
	assert.equal(harness.resetCalls.length, before + 1);
});

void test('scrollback accepts current batches and preserves event metadata in trace', async () => {
	const harness = createScrollbackHarness();
	const batches: WorkmuxScrollbackPageCommand[][] = [];
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.enqueueScrollBatch = async (commands) => {
		batches.push(commands);
		return true;
	};
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.core.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-1',
	});
	harness.remoteCopyModeActive.current = true;

	harness.core.onScrollbackBatch(batchEvent);
	await Promise.resolve();

	assert.deepEqual(batches, [
		[{ sessionName: 'main', direction: 'up', unit: 'page', count: 1 }],
	]);
	assert.ok(
		harness.traces.some(
			(event) =>
				event.event === 'rn.batch.accepted' &&
				event.seq === 11 &&
				event.webviewTs === 17 &&
				event.source === 'touch-scroll',
		),
	);
});

void test('scrollback rejects stale batches and only selection-handle batches bypass selection mode', async () => {
	const harness = createScrollbackHarness();
	const batches: WorkmuxScrollbackPageCommand[][] = [];
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.enqueueScrollBatch = async (commands) => {
		batches.push(commands);
		return true;
	};
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.core.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-1',
	});
	harness.remoteCopyModeActive.current = true;
	harness.setSelectionModeEnabled(true);
	harness.core.onScrollbackBatch({ ...batchEvent, instanceId: 'stale' });
	harness.core.onScrollbackBatch(batchEvent);
	harness.core.onScrollbackBatch({
		...batchEvent,
		source: 'selection-handle',
	});
	await Promise.resolve();
	assert.equal(batches.length, 1);
});

void test('scrollback clear returns the exact executor cleanup and clears local UI', async () => {
	const harness = createScrollbackHarness();
	const cleanup = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.reset = () => cleanup.promise;
	harness.core.onTerminalRuntimeChanged('instance-1');
	const result = harness.core.clear({ failurePolicy: 'suppress' });
	assert.equal(result, cleanup.promise);
	assert.deepEqual(harness.localExitMessages.at(-1), {
		requestId: 1,
		instanceId: 'instance-1',
	});
	cleanup.resolve(true);
	assert.equal(await result, true);
});

void test('scrollback jumpToLive is fail closed without a current runtime', () => {
	const harness = createScrollbackHarness();
	harness.core.jumpToLive();
	assert.deepEqual(harness.localExitMessages, []);
	assert.deepEqual(harness.resetCalls, []);
});

void test('scrollback current focused command failure alerts and offers copy', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	const callback = harness.executorInputs[0]?.onFailure;
	assert.ok(callback);
	callback('Update Workmux', { commandKind: 'enter' });
	assert.deepEqual(harness.alerts, [
		{ title: 'Workmux scroll unavailable', message: 'Update Workmux' },
	]);
	assert.equal(harness.localExitMessages.length, 1);
});

void test('scrollback executor failures use the latest equivalent context feedback', () => {
	const harness = createScrollbackHarness();
	const latestAlerts: string[] = [];
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.core.setContext({
		...harness.context,
		feedback: {
			alert: (_title, message) => latestAlerts.push(message),
			copyMessage: () => {},
		},
	});
	const callback = harness.executorInputs[0]?.onFailure;
	assert.ok(callback);
	callback('latest feedback', { commandKind: 'enter' });
	assert.deepEqual(latestAlerts, ['latest feedback']);
	assert.deepEqual(harness.alerts, []);
});

void test('scrollback bounds locally requested exits', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	for (let index = 0; index < 105; index += 1) {
		harness.core.jumpToLive();
	}
	assert.equal(harness.localExitMessages.length, 105);
	assert.equal(harness.localExitRequestIds.size, 100);
	assert.equal(harness.localExitRequestIds.has(1), false);
	assert.equal(harness.localExitRequestIds.has(6), true);
});

void test('scrollback inactive command failure suppresses alert and resets with suppress policy', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.setActivitySnapshot({ focused: false, interactive: false });
	const callback = harness.executorInputs[0]?.onFailure;
	assert.ok(callback);
	callback('Update Workmux', { commandKind: 'enter' });
	assert.deepEqual(harness.alerts, []);
	assert.deepEqual(harness.resetCalls.at(-1), {
		targetName: undefined,
		failurePolicy: 'suppress',
	});
});

void test('scrollback not-in-mode scroll failure clears ownership without recursive reset', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.remoteCopyModeActive.current = true;
	const callback = harness.executorInputs[0]?.onFailure;
	assert.ok(callback);
	const before = harness.resetCalls.length;
	callback('target is not in a mode', { commandKind: 'scroll' });
	assert.equal(harness.remoteCopyModeActive.current, false);
	assert.equal(harness.resetCalls.length, before);
	assert.equal(harness.localExitMessages.length, 1);
});

void test('scrollback superseded successful enter registers durable rollback in the cleanup barrier', async () => {
	const recording = createRecordingCleanupBarrier();
	const harness = createScrollbackHarness({
		cleanupBarrier: recording.barrier,
	});
	const entered = createDeferred<boolean>();
	const rollback = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.runEnterCommand = () => entered.promise;
	executor.reset = (options) =>
		options?.targetName === 'main' ? rollback.promise : null;
	harness.core.onTerminalRuntimeChanged('instance-1');
	const pending = harness.core.onScrollbackEnterRequested(enterEvent);
	void harness.core.onScrollbackEnterRequested({
		instanceId: 'stale',
		requestId: 8,
	});
	entered.resolve(true);
	await flushPromises();
	assert.notEqual(recording.barrier.current(), null);
	assert.equal(harness.remoteCopyModeActive.current, true);
	rollback.resolve(true);
	await pending;
	assert.equal(harness.remoteCopyModeActive.current, false);
});

void test('scrollback throwing acknowledgement registers durable rollback in the cleanup barrier', async () => {
	const recording = createRecordingCleanupBarrier();
	const harness = createScrollbackHarness({
		cleanupBarrier: recording.barrier,
	});
	const rollback = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.runEnterCommand = async () => true;
	executor.reset = () => rollback.promise;
	harness.context.terminalView.sendScrollbackEnterAck = () => {
		throw new Error('ack failed');
	};
	harness.core.onTerminalRuntimeChanged('instance-1');
	const pending = harness.core.onScrollbackEnterRequested(enterEvent);
	await flushPromises();
	assert.notEqual(recording.barrier.current(), null);
	assert.equal(harness.remoteCopyModeActive.current, true);
	rollback.resolve(true);
	await pending;
	assert.equal(harness.remoteCopyModeActive.current, false);
});

void test('scrollback acknowledgement reentry rolls back acquired ownership', async () => {
	const recording = createRecordingCleanupBarrier();
	const harness = createScrollbackHarness({
		cleanupBarrier: recording.barrier,
	});
	const rollback = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.runEnterCommand = async () => true;
	executor.reset = () => rollback.promise;
	let ackCalls = 0;
	harness.context.terminalView.sendScrollbackEnterAck = () => {
		ackCalls += 1;
		harness.core.onTerminalRuntimeChanged('instance-2');
	};
	harness.core.onTerminalRuntimeChanged('instance-1');
	const pending = harness.core.onScrollbackEnterRequested(enterEvent);
	await flushPromises();
	assert.equal(ackCalls, 1);
	assert.notEqual(recording.barrier.current(), null);
	assert.equal(harness.remoteCopyModeActive.current, true);
	rollback.resolve(true);
	await pending;
	assert.equal(harness.remoteCopyModeActive.current, false);
});

for (const boundary of [
	'terminal',
	'activity',
	'selection',
	'trace',
] as const) {
	void test(`scrollback revalidates request after reentrant ${boundary} callback`, async () => {
		const harness = createScrollbackHarness();
		const executor = harness.executors[0];
		assert.ok(executor);
		let enterCalls = 0;
		executor.runEnterCommand = async () => {
			enterCalls += 1;
			return true;
		};
		harness.core.onTerminalRuntimeChanged('instance-1');
		let reentered = false;
		const reenter = () => {
			if (reentered) return;
			reentered = true;
			harness.core.onTerminalRuntimeChanged('instance-2');
		};
		if (boundary === 'terminal') {
			harness.context.terminalView.isCurrentInstance = () => {
				reenter();
				return true;
			};
		} else if (boundary === 'activity') {
			harness.core.setContext({
				...harness.context,
				activity: {
					...harness.context.activity,
					getSnapshot: () => {
						reenter();
						return harness.context.activity.getSnapshot();
					},
				},
			});
		} else if (boundary === 'selection') {
			harness.core.setContext({
				...harness.context,
				terminalView: {
					...harness.context.terminalView,
					getSelectionModeEnabled: () => {
						reenter();
						return false;
					},
				},
			});
		} else {
			harness.core.setContext({
				...harness.context,
				trace: () => reenter(),
			});
		}
		await harness.core.onScrollbackEnterRequested(enterEvent);
		assert.equal(enterCalls, 0);
		assert.deepEqual(harness.enterAcks, []);
		assert.equal(harness.remoteCopyModeActive.current, false);
	});
}

void test('scrollback attributes concurrent enter failures to their exact requests', async () => {
	const harness = createScrollbackHarness();
	const first = createDeferred<boolean>();
	const second = createDeferred<boolean>();
	const callback = harness.executorInputs[0]?.onFailure as
		| ((
				message: string,
				context: { commandKind: 'enter'; operationOwner?: unknown },
		  ) => void)
		| undefined;
	const executor = harness.executors[0];
	assert.ok(callback);
	assert.ok(executor);
	let call = 0;
	executor.runEnterCommand = ((_: string, operationOwner?: unknown) => {
		call += 1;
		const callNumber = call;
		const completion = callNumber === 1 ? first : second;
		return completion.promise.then((result) => {
			callback(callNumber === 1 ? 'stale failure' : 'current failure', {
				commandKind: 'enter',
				operationOwner,
			});
			return result;
		});
	}) as typeof executor.runEnterCommand;
	harness.core.onTerminalRuntimeChanged('instance-1');
	const stale = harness.core.onScrollbackEnterRequested(enterEvent);
	const current = harness.core.onScrollbackEnterRequested({
		...enterEvent,
		requestId: 8,
	});
	second.resolve(false);
	await current;
	first.resolve(false);
	await stale;
	assert.deepEqual(harness.alerts, [
		{ title: 'Workmux scroll unavailable', message: 'current failure' },
	]);
	assert.ok(harness.warnings.includes('stale failure'));
});

for (const policies of [
	['suppress', 'notify'],
	['notify', 'suppress'],
] as const) {
	void test(`scrollback does not coalesce ${policies[0]} cleanup with ${policies[1]} clear`, () => {
		const harness = createScrollbackHarness();
		const pending = createDeferred<boolean>();
		const executor = harness.executors[0];
		assert.ok(executor);
		harness.core.onTerminalRuntimeChanged('instance-1');
		executor.reset = (options) => {
			harness.resetCalls.push(options);
			return pending.promise;
		};
		harness.resetCalls.length = 0;
		void harness.core.clear({ failurePolicy: policies[0] });
		void harness.core.clear({ failurePolicy: policies[1] });
		assert.deepEqual(
			harness.resetCalls.map(
				(options) => (options as { failurePolicy?: string }).failurePolicy,
			),
			policies,
		);
		pending.resolve(true);
	});
}

void test('scrollback observes current batch enqueue rejection through failure policy', async () => {
	const harness = createScrollbackHarness();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.enqueueScrollBatch = async () => {
		throw new Error('batch rejected');
	};
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.core.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-1',
	});
	harness.remoteCopyModeActive.current = true;
	harness.core.onScrollbackBatch(batchEvent);
	await flushPromises();
	assert.deepEqual(harness.alerts, [
		{ title: 'Workmux scroll unavailable', message: 'batch rejected' },
	]);
});

void test('scrollback observes stale batch enqueue rejection without stale alert', async () => {
	const harness = createScrollbackHarness();
	const rejected = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.enqueueScrollBatch = () => rejected.promise;
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.core.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-1',
	});
	harness.remoteCopyModeActive.current = true;
	harness.core.onScrollbackBatch(batchEvent);
	harness.core.onTerminalRuntimeChanged('instance-2');
	rejected.reject(new Error('stale batch rejected'));
	await flushPromises();
	assert.deepEqual(harness.alerts, []);
	assert.ok(
		harness.warnings.some((message) =>
			message.includes('stale batch rejected'),
		),
	);
});
