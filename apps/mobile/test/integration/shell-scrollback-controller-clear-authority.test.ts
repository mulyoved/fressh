import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellTargetKey } from '../../src/lib/shell-controllers/source-keys';
import { createScrollbackHarness } from './shell-scrollback-controller-test-support';

function replaceAuthority(harness: ReturnType<typeof createScrollbackHarness>) {
	harness.core.setContext({
		...harness.context,
		targetKey: createShellTargetKey('transport' as never, 'other'),
		targetName: 'other',
		workmux: {
			...harness.context.workmux,
			scroll: { ...harness.scroll },
		},
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

void test('scrollback stale clear preserves replacement batch accumulator state', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.core.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-1',
	});
	let reentered = false;
	const replacementBatches: unknown[] = [];
	harness.core.subscribe(() => {
		if (reentered) return;
		reentered = true;
		replaceAuthority(harness);
		harness.core.onScrollbackModeChange({
			active: true,
			phase: 'active',
			instanceId: 'instance-2',
		});
		harness.remoteCopyModeActive.current = true;
		const replacementExecutor = harness.executors.at(-1);
		assert.ok(replacementExecutor);
		replacementExecutor.enqueueScrollBatch = async (commands) => {
			replacementBatches.push(commands);
			return true;
		};
		harness.core.onScrollbackBatch({
			direction: 'up',
			pages: 0,
			lines: 1.5,
			pageStep: 24,
			instanceId: 'instance-2',
		});
		// Represents the replacement generation's retained fractional remainder.
		harness.lineAccumulator.direction = 'up';
		harness.lineAccumulator.lines = 0.5;
	});

	void harness.core.clear();

	assert.deepEqual(harness.lineAccumulator, { direction: 'up', lines: 0.5 });
	harness.core.onScrollbackBatch({
		direction: 'up',
		pages: 0,
		lines: 1,
		pageStep: 24,
		instanceId: 'instance-2',
	});
	assert.deepEqual(replacementBatches, [
		[{ sessionName: 'other', direction: 'up', unit: 'line', count: 1 }],
		[{ sessionName: 'other', direction: 'up', unit: 'line', count: 1 }],
	]);
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
	assert.deepEqual(Array.from(harness.localExitRequestIds), []);
	harness.context.terminalView.exitScrollback = (message) =>
		harness.localExitMessages.push(message);
	void harness.core.clear();
	assert.deepEqual(harness.localExitMessages, [
		{ requestId: 2, instanceId: 'instance-1' },
	]);
});

void test('scrollback stale outer exit cleanup preserves nested newer request', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	let reentered = false;
	harness.context.terminalView.exitScrollback = (message) => {
		harness.localExitMessages.push(message);
		if (reentered) return;
		reentered = true;
		replaceAuthority(harness);
		void harness.core.clear();
	};

	void harness.core.clear();

	assert.deepEqual(harness.localExitMessages, [
		{ requestId: 1, instanceId: 'instance-1' },
		{ requestId: 2, instanceId: 'instance-2' },
	]);
	assert.deepEqual(Array.from(harness.localExitRequestIds), [2]);
	const resetsBeforeConsumption = harness.resetCalls.length;
	harness.core.onScrollbackModeChange({
		active: false,
		phase: 'active',
		instanceId: 'instance-2',
		requestId: 2,
	});
	assert.deepEqual(Array.from(harness.localExitRequestIds), []);
	assert.equal(harness.resetCalls.length, resetsBeforeConsumption);
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
