import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellTargetKey } from '../../src/lib/shell-controllers/source-keys';
import {
	createDeferred,
	createScrollbackHarness,
	flushPromises,
} from './shell-scrollback-controller-test-support';

void test('scrollback suppresses alert after logger reenters a newer target', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	const replacementScroll = { ...harness.scroll };
	harness.core.setContext({
		...harness.context,
		logger: {
			warn: () => {
				harness.core.setContext({
					...harness.context,
					targetKey: createShellTargetKey('transport' as never, 'other'),
					targetName: 'other',
					workmuxScroll: replacementScroll,
				});
			},
		},
	});
	const callback = harness.executorInputs[0]?.onFailure;
	assert.ok(callback);
	callback('stale after logger', { commandKind: 'enter' });
	assert.deepEqual(harness.alerts, []);
});

void test('scrollback feedback reentry cannot reset the newer target executor', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	const replacementScroll = { ...harness.scroll };
	let alerts = 0;
	harness.core.setContext({
		...harness.context,
		feedback: {
			alert: () => {
				alerts += 1;
				harness.core.setContext({
					...harness.context,
					targetKey: createShellTargetKey('transport' as never, 'other'),
					targetName: 'other',
					workmuxScroll: replacementScroll,
				});
			},
			copyMessage: () => {},
		},
	});
	const callback = harness.executorInputs[0]?.onFailure;
	assert.ok(callback);
	callback('feedback reentry', { commandKind: 'enter' });
	assert.equal(alerts, 1);
	assert.equal(harness.events.includes('reset:2'), false);
});

void test('scrollback failure activity reentry suppresses stale feedback', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	const replacementScroll = { ...harness.scroll };
	harness.core.setContext({
		...harness.context,
		getActivitySnapshot: () => {
			harness.core.setContext({
				...harness.context,
				targetKey: createShellTargetKey('transport' as never, 'other'),
				targetName: 'other',
				workmuxScroll: replacementScroll,
			});
			return harness.context.getActivitySnapshot();
		},
	});
	const callback = harness.executorInputs[0]?.onFailure;
	assert.ok(callback);
	callback('stale after activity', { commandKind: 'enter' });
	assert.deepEqual(harness.alerts, []);
});

void test('scrollback not-in-mode trace reentry cannot mutate newer target state', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.remoteCopyModeActive.current = true;
	const replacementScroll = { ...harness.scroll };
	harness.core.setContext({
		...harness.context,
		trace: () => {
			harness.core.setContext({
				...harness.context,
				targetKey: createShellTargetKey('transport' as never, 'other'),
				targetName: 'other',
				workmuxScroll: replacementScroll,
			});
		},
	});
	const callback = harness.executorInputs[0]?.onFailure;
	assert.ok(callback);
	callback('not in a mode', { commandKind: 'scroll' });
	assert.equal(harness.localExitMessages.length, 0);
	assert.equal(harness.remoteCopyModeActive.current, false);
});

void test('scrollback batch rejection terminal reentry is stale and logger-safe', async () => {
	const harness = createScrollbackHarness({
		logger: {
			warn: () => {
				throw new Error('logger failed');
			},
		},
	});
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
	harness.core.onScrollbackBatch({
		direction: 'up',
		pages: 1,
		lines: 0,
		pageStep: 24,
		instanceId: 'instance-1',
	});
	harness.context.terminalView.isCurrentInstance = () => {
		harness.core.onTerminalRuntimeChanged('instance-2');
		return true;
	};
	rejected.reject(new Error('batch rejected'));
	await flushPromises();
	assert.deepEqual(harness.alerts, []);
});

void test('scrollback observes synchronous current batch enqueue throw once', async () => {
	const harness = createScrollbackHarness();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.enqueueScrollBatch = () => {
		throw new Error('sync batch failed');
	};
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.core.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-1',
	});
	harness.remoteCopyModeActive.current = true;
	harness.core.onScrollbackBatch({
		direction: 'up',
		pages: 1,
		lines: 0,
		pageStep: 24,
		instanceId: 'instance-1',
	});
	await flushPromises();
	assert.deepEqual(harness.alerts, [
		{ title: 'Workmux scroll unavailable', message: 'sync batch failed' },
	]);
});

void test('scrollback synchronous stale batch throw is suppressed and logger-safe', () => {
	const harness = createScrollbackHarness({
		logger: {
			warn: () => {
				throw new Error('logger failed');
			},
		},
	});
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.enqueueScrollBatch = () => {
		harness.core.onTerminalRuntimeChanged('instance-2');
		throw new Error('stale sync batch failed');
	};
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.core.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-1',
	});
	harness.remoteCopyModeActive.current = true;
	assert.doesNotThrow(() =>
		harness.core.onScrollbackBatch({
			direction: 'up',
			pages: 1,
			lines: 0,
			pageStep: 24,
			instanceId: 'instance-1',
		}),
	);
	assert.deepEqual(harness.alerts, []);
});

for (const boundary of ['selection', 'accepted-trace'] as const) {
	void test(`scrollback batch ${boundary} reentry enqueues nothing stale`, () => {
		const harness = createScrollbackHarness();
		const executor = harness.executors[0];
		assert.ok(executor);
		let enqueues = 0;
		executor.enqueueScrollBatch = async () => {
			enqueues += 1;
			return true;
		};
		harness.core.onTerminalRuntimeChanged('instance-1');
		harness.core.onScrollbackModeChange({
			active: true,
			phase: 'active',
			instanceId: 'instance-1',
		});
		harness.remoteCopyModeActive.current = true;
		if (boundary === 'selection') {
			harness.core.setContext({
				...harness.context,
				getSelectionModeEnabled: () => {
					harness.core.onTerminalRuntimeChanged('instance-2');
					return false;
				},
			});
		} else {
			harness.core.setContext({
				...harness.context,
				trace: (event) => {
					if (event.event === 'rn.batch.accepted')
						harness.core.onTerminalRuntimeChanged('instance-2');
				},
			});
		}
		harness.core.onScrollbackBatch({
			direction: 'up',
			pages: 1,
			lines: 0,
			pageStep: 24,
			instanceId: 'instance-1',
		});
		assert.equal(enqueues, 0);
	});
}
