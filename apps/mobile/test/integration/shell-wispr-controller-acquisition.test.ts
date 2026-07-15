import assert from 'node:assert/strict';
import test from 'node:test';
import { createWisprCloseCoordinator } from '../../src/lib/shell-controllers/wispr-close-coordinator';
import { createWisprNativeControlAuthority } from '../../src/lib/shell-controllers/wispr-native-control-authority';
import { createWisprTapRunner } from '../../src/lib/shell-controllers/wispr-tap-runner';
import { tapWisprControlWithTimeout } from '../../src/lib/wispr-automation';
import {
	createHarness,
	deferred,
	openReady,
	settled,
	shareNativeControl,
	startRecording,
} from './shell-wispr-controller-test-support';

for (const lateSettlement of ['resolve', 'reject'] as const) {
	void test(`retry after uncertain timeout preserves original transaction through late ${lateSettlement}`, async () => {
		const authority = createWisprNativeControlAuthority();
		const harness = createHarness('android', undefined, authority);
		const successor = createHarness('android', undefined, authority);
		const native = shareNativeControl(harness, successor);

		harness.core.setAutoStart(true);
		await openReady(harness);
		harness.core.onTextEntryFocused('original');
		assert.equal(native.taps.length, 1);
		await harness.clock.advance(750);
		assert.equal(harness.core.getSnapshot().automation.phase, 'failed');

		const retry = harness.core.openTextEditor();
		assert.equal(harness.statusRequests.length, 1);
		assert.deepEqual(await retry, { status: 'superseded' });
		assert.equal(harness.core.getSnapshot().busy, true);
		assert.equal(native.taps.length, 1);

		if (lateSettlement === 'resolve') {
			native.taps[0]!.resolve('late original start');
			await settled();
			assert.equal(native.active, true);
			assert.deepEqual(harness.core.getSnapshot().automation, {
				phase: 'recording',
				textBeforeStart: 'original',
			});

			harness.core.closeTextEntry();
			assert.equal(native.taps.length, 2);
			successor.core.setAutoStart(true);
			await openReady(successor);
			successor.core.onTextEntryFocused('successor');
			assert.equal(native.taps.length, 2);

			native.taps[1]!.resolve('original close');
			await settled();
			assert.equal(native.active, false);
			assert.equal(native.taps.length, 3);
			native.taps[2]!.resolve('successor start');
			await settled();
			assert.equal(native.active, true);
			assert.equal(successor.core.getSnapshot().automation.phase, 'recording');
			successor.core.closeTextEntry();
			native.taps[3]!.resolve('successor close');
			await settled();
			assert.equal(native.active, false);
		} else {
			native.taps[0]!.reject(new Error('late original rejection'));
			await settled();
			assert.equal(native.active, false);
			assert.equal(harness.core.getSnapshot().busy, false);

			const fresh = harness.core.openTextEditor();
			assert.equal(harness.statusRequests.length, 2);
			harness.statusRequests[1]!.resolve({
				serviceEnabled: true,
				serviceConnected: true,
			});
			assert.deepEqual(await fresh, { status: 'completed' });
			harness.core.onTextEntryFocused('retry');
			assert.equal(native.taps.length, 2);
			native.taps[1]!.resolve('retry start');
			await settled();
			assert.equal(native.active, true);
			harness.core.closeTextEntry();
			native.taps[2]!.resolve('retry close');
			await settled();
			assert.equal(native.active, false);
		}
	});
}

void test('auto-start re-enable cannot replace an uncertain native transaction', async () => {
	const authority = createWisprNativeControlAuthority();
	const harness = createHarness('android', undefined, authority);

	harness.core.setAutoStart(true);
	await openReady(harness);
	harness.core.onTextEntryFocused('original');
	assert.equal(harness.taps.length, 1);
	await harness.clock.advance(750);
	assert.equal(harness.core.getSnapshot().automation.phase, 'failed');

	harness.core.setAutoStart(false);
	harness.core.setAutoStart(true);
	assert.equal(harness.core.getSnapshot().automation.phase, 'failed');
	assert.equal(harness.core.getSnapshot().busy, true);
	assert.equal(harness.taps.length, 1);

	harness.taps[0]!.reject(new Error('late original rejection'));
	await settled();
	assert.equal(harness.core.getSnapshot().busy, false);

	harness.core.setAutoStart(false);
	harness.core.setAutoStart(true);
	assert.equal(harness.core.getSnapshot().automation.phase, 'openingTextEntry');
	harness.core.onTextEntryFocused('retry');
	assert.equal(harness.taps.length, 2);
	harness.taps[1]!.resolve('retry start');
	await settled();
	assert.equal(harness.nativeActive, true);
	harness.core.closeTextEntry();
	harness.taps[2]!.resolve('retry close');
	await settled();
	assert.equal(harness.nativeActive, false);
});

for (const settlement of ['resolve', 'reject'] as const) {
	void test(`close clears pending status before stale ${settlement}`, async () => {
		const harness = createHarness();
		const stale = harness.core.openTextEditor();
		harness.core.closeTextEntry();
		const fresh = harness.core.openTextEditor();
		assert.equal(harness.statusRequests.length, 2);
		if (settlement === 'resolve') {
			harness.statusRequests[0]!.resolve({
				serviceEnabled: true,
				serviceConnected: true,
			});
		} else {
			harness.statusRequests[0]!.reject(new Error('stale status'));
		}
		assert.deepEqual(await stale, { status: 'superseded' });
		harness.statusRequests[1]!.resolve({
			serviceEnabled: true,
			serviceConnected: true,
		});
		assert.deepEqual(await fresh, { status: 'completed' });
	});
}

void test('close after failed start tap prevents another native attempt', async () => {
	const harness = createHarness();
	harness.core.setAutoStart(true);
	await openReady(harness);
	harness.core.onTextEntryFocused('');
	harness.taps[0]!.reject(new Error('bubble not found'));
	harness.core.closeTextEntry();
	await settled();
	await harness.clock.advance(2_500);
	assert.equal(harness.taps.length, 1);
});

void test('close during retry delay prevents another native attempt', async () => {
	const harness = createHarness();
	harness.core.setAutoStart(true);
	await openReady(harness);
	harness.core.onTextEntryFocused('');
	harness.taps[0]!.reject(new Error('bubble not found'));
	await settled();
	harness.core.closeTextEntry();
	await harness.clock.advance(200);
	assert.equal(harness.taps.length, 1);
});

void test('close during retry delay lets a fresh open start immediately', async () => {
	const harness = createHarness();
	harness.core.setAutoStart(true);
	await openReady(harness);
	harness.core.onTextEntryFocused('old');
	harness.taps[0]!.reject(new Error('bubble not found'));
	await settled();
	harness.core.closeTextEntry();
	await openReady(harness);
	assert.equal(harness.core.getSnapshot().automation.phase, 'openingTextEntry');
	harness.core.onTextEntryFocused('fresh');
	assert.equal(harness.taps.length, 2);
});

void test('false close expiry cannot discard a fresh auto-start', async () => {
	const harness = createHarness();
	harness.core.setAutoStart(true);
	await openReady(harness);
	harness.core.onTextEntryFocused('old');
	harness.taps[0]!.reject(new Error('bubble not found'));
	await settled();
	harness.core.closeTextEntry();
	await openReady(harness);
	harness.core.onTextEntryFocused('fresh');
	assert.equal(harness.taps.length, 2);
	harness.taps[1]!.resolve('started');
	await settled();
	await harness.clock.advance(5_000);
	assert.deepEqual(harness.core.getSnapshot().automation, {
		phase: 'recording',
		textBeforeStart: 'fresh',
	});
	assert.equal(harness.taps.length, 2);
});

void test('dispose closes an auto-start obligation after text returned idle', async () => {
	const harness = createHarness();
	await startRecording(harness);
	harness.core.onTextChanged('before dictated');
	assert.equal(harness.core.getSnapshot().automation.phase, 'idle');
	harness.core.dispose();
	assert.equal(harness.taps.length, 2);
});

void test('dispose after definitive failure cancels retry without cleanup', async () => {
	const harness = createHarness();
	harness.core.setAutoStart(true);
	await openReady(harness);
	harness.core.onTextEntryFocused('');
	harness.taps[0]!.reject(new Error('bubble not found'));
	await settled();
	harness.core.dispose();
	assert.equal(harness.taps.length, 1);
	assert.equal(harness.clock.timers.size, 0);
});

void test('synchronous zero-tap timeout creates no close or cleanup obligation', async () => {
	const closeDelays: number[] = [];
	const closeHarness = createHarness('android', (clock) => {
		clock.setTimeout = (task, delayMs) => {
			closeDelays.push(delayMs);
			task();
			return clock.nextId++;
		};
		clock.clearTimeout = () => {};
	});
	closeHarness.core.setAutoStart(true);
	await openReady(closeHarness);
	await settled();
	assert.equal(closeHarness.taps.length, 0);
	assert.deepEqual(closeDelays, [750, 750]);
	closeHarness.core.closeTextEntry();
	assert.deepEqual(closeDelays, [750, 750]);

	const disposeDelays: number[] = [];
	const disposeHarness = createHarness('android', (clock) => {
		clock.setTimeout = (task, delayMs) => {
			disposeDelays.push(delayMs);
			task();
			return clock.nextId++;
		};
		clock.clearTimeout = () => {};
	});
	disposeHarness.core.setAutoStart(true);
	await openReady(disposeHarness);
	await settled();
	assert.equal(disposeHarness.taps.length, 0);
	assert.deepEqual(disposeDelays, [750, 750]);
	disposeHarness.core.dispose();
	assert.deepEqual(disposeDelays, [750, 750]);
});

void test('stale text-field priming rejection does not warn', async () => {
	const harness = createHarness();
	const priming = deferred<unknown>();
	harness.native.tapScreen = () => priming.promise;
	harness.core.setAutoStart(true);
	await openReady(harness);
	harness.core.onTextEntryFocused('', {
		x: 10,
		y: 20,
		width: 100,
		height: 80,
	});
	harness.core.invalidate('focus-lost');
	priming.reject(new Error('stale prime'));
	await settled();
	assert.deepEqual(harness.warnings, []);
});

void test('rejected retry delay rechecks freshness after invalidation', async () => {
	let current = true;
	const runner = createWisprTapRunner({
		tapControl: async () => {
			throw new Error('bubble not found');
		},
		now: () => 0,
		setTimeout: () => 'timeout',
		clearTimeout: () => {},
		sleep: async () => {
			current = false;
			throw new Error('cancelled delay');
		},
	});
	assert.deepEqual(
		await runner.run({
			retry: true,
			isCurrent: () => current,
			acceptLateResult: () => current,
		}),
		{ status: 'superseded' },
	);
});

void test('throwing timeout setup never issues the native toggle', async () => {
	let taps = 0;
	await assert.rejects(
		tapWisprControlWithTimeout({
			tapWisprControl: async () => {
				taps += 1;
			},
			timeoutMs: 750,
			setTimeout: () => {
				throw new Error('timer unavailable');
			},
			clearTimeout: () => {},
		}),
		/timer unavailable/,
	);
	assert.equal(taps, 0);
});

void test('coordinator invalidation preserves an issued native cleanup obligation', () => {
	let closes = 0;
	const coordinator = createWisprCloseCoordinator({
		close: async () => {
			closes += 1;
			return true;
		},
		onDeferredReady: () => {},
		onTransactionSettled: () => {},
	});
	coordinator.requestAfterStart({ requestId: 3, retryClose: true });
	coordinator.retireDeferredStart();
	assert.equal(coordinator.blocksAutoStart(), true);
	assert.equal(coordinator.consumeStartResult(3, true), true);
	assert.equal(closes, 1);
});

void test('coordinator disposal preserves an issued native cleanup obligation', () => {
	let closes = 0;
	const coordinator = createWisprCloseCoordinator({
		close: async () => {
			closes += 1;
			return true;
		},
		onDeferredReady: () => {},
		onTransactionSettled: () => {},
	});
	coordinator.requestAfterStart({ requestId: 5, retryClose: false });
	coordinator.dispose();
	assert.equal(coordinator.consumeStartResult(5, true), true);
	assert.equal(closes, 1);
});

void test('stale fallback cannot focus a replacement when cancellation throws', async () => {
	const harness = createHarness('android', (clock) => {
		clock.clearTimeout = () => {
			throw new Error('clear failed');
		};
	});
	harness.core.setAutoStart(true);
	await openReady(harness);
	await harness.clock.advance(100);
	harness.core.closeTextEntry();
	await openReady(harness);
	await harness.clock.advance(650);
	assert.equal(harness.taps.length, 0);
	await harness.clock.advance(100);
	assert.equal(harness.taps.length, 1);
});
