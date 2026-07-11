import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellTargetKey } from '../../src/lib/shell-controllers/source-keys';
import { createScrollbackHarness } from './shell-scrollback-controller-test-support';

function replaceAuthority(harness: ReturnType<typeof createScrollbackHarness>) {
	harness.core.setContext({
		...harness.context,
		targetKey: createShellTargetKey('transport' as never, 'other'),
		targetName: 'other',
		workmuxScroll: { ...harness.scroll },
	});
	harness.core.onTerminalRuntimeChanged('instance-2');
}

void test('scrollback clear publish reentry cannot reset replacement executor', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.core.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-1',
	});
	let reentered = false;
	harness.core.subscribe(() => {
		if (reentered) return;
		reentered = true;
		replaceAuthority(harness);
	});
	void harness.core.clear();
	assert.equal(harness.events.filter((event) => event === 'reset:2').length, 1);
	assert.deepEqual(harness.localExitMessages, []);

	harness.context.terminalView.isCurrentInstance = () => true;
	void harness.core.clear();
	assert.equal(harness.events.filter((event) => event === 'reset:2').length, 2);
});

void test('scrollback clear terminal reentry cannot exit or reset replacement', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	let reentered = false;
	harness.context.terminalView.isCurrentInstance = () => {
		if (!reentered) {
			reentered = true;
			replaceAuthority(harness);
		}
		return true;
	};
	void harness.core.clear();
	assert.deepEqual(harness.localExitMessages, []);
	assert.equal(harness.events.filter((event) => event === 'reset:2').length, 1);

	harness.context.terminalView.isCurrentInstance = () => true;
	void harness.core.clear();
	assert.deepEqual(harness.localExitMessages, [
		{ requestId: 1, instanceId: 'instance-2' },
	]);
	assert.equal(harness.events.filter((event) => event === 'reset:2').length, 2);
});

void test('scrollback contains throwing exit and later clear remains usable', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.context.terminalView.exitScrollback = () => {
		throw new Error('exit failed');
	};
	assert.doesNotThrow(() => {
		void harness.core.clear();
	});
	harness.context.terminalView.exitScrollback = (message) =>
		harness.localExitMessages.push(message);
	void harness.core.clear();
	assert.deepEqual(harness.localExitMessages, [
		{ requestId: 2, instanceId: 'instance-1' },
	]);
});

void test('scrollback exit reentry removes stale local ID and later clear works', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.context.terminalView.exitScrollback = () => replaceAuthority(harness);
	void harness.core.clear();
	assert.equal(harness.localExitRequestIds.size, 0);
	harness.context.terminalView.exitScrollback = (message) =>
		harness.localExitMessages.push(message);
	void harness.core.clear();
	assert.deepEqual(harness.localExitMessages, [
		{ requestId: 2, instanceId: 'instance-2' },
	]);
});
