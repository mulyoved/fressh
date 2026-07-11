import assert from 'node:assert/strict';
import test from 'node:test';
import { createScrollbackHarness } from './shell-scrollback-controller-test-support';

void test('scrollback mode currentness reentry preserves newer runtime authority', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	let reentered = false;
	harness.context.terminalView.isCurrentInstance = () => {
		if (!reentered) {
			reentered = true;
			harness.core.onTerminalRuntimeChanged('instance-2');
		}
		return true;
	};
	const resetsBefore = harness.resetCalls.length;
	harness.core.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-1',
	});
	assert.deepEqual(harness.core.getSnapshot(), {
		active: false,
		phase: 'active',
		runtimeInstanceId: 'instance-2',
	});
	assert.equal(harness.resetCalls.length, resetsBefore + 1);
});

void test('scrollback mode trace reentry cannot publish or reset stale mode', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	let reentered = false;
	harness.core.setContext({
		...harness.context,
		trace: () => {
			if (!reentered) {
				reentered = true;
				harness.core.onTerminalRuntimeChanged('instance-2');
			}
		},
	});
	const resetsBefore = harness.resetCalls.length;
	harness.core.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-1',
	});
	assert.deepEqual(harness.core.getSnapshot(), {
		active: false,
		phase: 'active',
		runtimeInstanceId: 'instance-2',
	});
	assert.equal(harness.resetCalls.length, resetsBefore + 1);
});

void test('scrollback stale jump reentry allocates nothing and newer jump uses exact instance', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	let reentered = false;
	harness.context.terminalView.isCurrentInstance = () => {
		if (!reentered) {
			reentered = true;
			harness.core.onTerminalRuntimeChanged('instance-2');
		}
		return true;
	};
	const resetsBefore = harness.resetCalls.length;
	harness.core.jumpToLive();
	assert.deepEqual(harness.localExitMessages, []);
	assert.equal(harness.localExitRequestIds.size, 0);
	assert.equal(harness.resetCalls.length, resetsBefore + 1);

	harness.context.terminalView.isCurrentInstance = () => true;
	harness.core.jumpToLive();
	assert.deepEqual(harness.localExitMessages, [
		{ requestId: 1, instanceId: 'instance-2' },
	]);
});
