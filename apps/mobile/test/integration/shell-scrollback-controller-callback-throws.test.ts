import assert from 'node:assert/strict';
import test from 'node:test';
import { createScrollbackHarness } from './shell-scrollback-controller-test-support';

const enterEvent = { instanceId: 'instance-1', requestId: 1 };
const batchEvent = {
	direction: 'up' as const,
	pages: 1,
	lines: 0,
	pageStep: 24,
	instanceId: 'instance-1',
};

function prepareActiveHarness() {
	let warningCalls = 0;
	const harness = createScrollbackHarness({
		logger: {
			warn: () => {
				warningCalls += 1;
				throw new Error('warning failed');
			},
		},
	});
	const executor = harness.executors[0];
	assert.ok(executor);
	let enterCalls = 0;
	let enqueueCalls = 0;
	executor.runEnterCommand = async () => {
		enterCalls += 1;
		return true;
	};
	executor.enqueueScrollBatch = async () => {
		enqueueCalls += 1;
		return true;
	};
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.core.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-1',
	});
	harness.remoteCopyModeActive.current = false;
	return {
		harness,
		getEnterCalls: () => enterCalls,
		getEnqueueCalls: () => enqueueCalls,
		getWarningCalls: () => warningCalls,
	};
}

void test('scrollback throwing trace remains observational with throwing warning', async () => {
	const fixture = prepareActiveHarness();
	fixture.harness.core.setContext({
		...fixture.harness.context,
		trace: () => {
			throw new Error('trace failed');
		},
	});

	await assert.doesNotReject(() =>
		fixture.harness.core.onScrollbackEnterRequested(enterEvent),
	);
	assert.doesNotThrow(() => fixture.harness.core.onScrollbackBatch(batchEvent));
	assert.equal(fixture.getEnterCalls(), 1);
	assert.equal(fixture.getEnqueueCalls(), 1);
	assert.deepEqual(fixture.harness.enterAcks, [enterEvent]);
	assert.ok(fixture.getWarningCalls() > 0);

	fixture.harness.core.setContext(fixture.harness.context);
	await fixture.harness.core.onScrollbackEnterRequested({
		...enterEvent,
		requestId: 2,
	});
	fixture.harness.core.onScrollbackBatch(batchEvent);
	assert.equal(fixture.getEnterCalls(), 2);
	assert.equal(fixture.getEnqueueCalls(), 2);
});

for (const boundary of [
	'terminal-currentness',
	'activity',
	'selection',
] as const) {
	void test(`scrollback throwing ${boundary} fails closed and later work remains usable`, async () => {
		const fixture = prepareActiveHarness();
		const getSelectionModeEnabled =
			fixture.harness.context.terminalView.getSelectionModeEnabled;
		const remoteBefore = fixture.harness.remoteCopyModeActive.current;
		const generationBefore = fixture.harness.remoteCopyModeGeneration.current;
		if (boundary === 'terminal-currentness') {
			fixture.harness.context.terminalView.isCurrentInstance = () => {
				throw new Error('currentness failed');
			};
		} else if (boundary === 'activity') {
			fixture.harness.core.setContext({
				...fixture.harness.context,
				activity: {
					...fixture.harness.context.activity,
					getSnapshot: () => {
						throw new Error('activity failed');
					},
				},
			});
		} else {
			fixture.harness.context.terminalView.getSelectionModeEnabled = () => {
				throw new Error('selection failed');
			};
		}

		await assert.doesNotReject(() =>
			fixture.harness.core.onScrollbackEnterRequested(enterEvent),
		);
		if (boundary !== 'activity') {
			assert.doesNotThrow(() =>
				fixture.harness.core.onScrollbackBatch(batchEvent),
			);
		}
		assert.equal(fixture.getEnterCalls(), 0);
		assert.equal(fixture.getEnqueueCalls(), 0);
		assert.deepEqual(fixture.harness.enterAcks, []);
		assert.deepEqual(Array.from(fixture.harness.localExitRequestIds), []);
		assert.equal(fixture.harness.remoteCopyModeActive.current, remoteBefore);
		assert.equal(
			fixture.harness.remoteCopyModeGeneration.current,
			generationBefore,
		);
		assert.ok(fixture.getWarningCalls() > 0);

		fixture.harness.context.terminalView.isCurrentInstance = () => true;
		fixture.harness.context.terminalView.getSelectionModeEnabled =
			getSelectionModeEnabled;
		fixture.harness.core.setContext(fixture.harness.context);
		await fixture.harness.core.onScrollbackEnterRequested({
			...enterEvent,
			requestId: 2,
		});
		fixture.harness.core.onScrollbackBatch(batchEvent);
		assert.equal(fixture.getEnterCalls(), 1);
		assert.equal(fixture.getEnqueueCalls(), 1);
		assert.deepEqual(fixture.harness.enterAcks, [
			{ ...enterEvent, requestId: 2 },
		]);
	});
}
