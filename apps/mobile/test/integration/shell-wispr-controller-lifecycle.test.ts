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
	startRecording,
} from './shell-wispr-controller-test-support';

function shareNativeControl(...harnesses: ReturnType<typeof createHarness>[]) {
	const taps: ReturnType<typeof deferred<unknown>>[] = [];
	let active = false;
	const tapControl = () => {
		const tap = deferred<unknown>();
		taps.push(tap);
		return tap.promise.then((result) => {
			active = !active;
			return result;
		});
	};
	for (const harness of harnesses) harness.native.tapControl = tapControl;
	return {
		taps,
		get active() {
			return active;
		},
	};
}

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

for (const reason of ['focus-lost', 'app-inactive', 'source-change'] as const) {
	void test(`${reason} reconciles an issued start before closing native recording`, async () => {
		const harness = createHarness();
		harness.core.setAutoStart(true);
		await openReady(harness);
		harness.core.onTextEntryFocused('');

		harness.core.invalidate(reason);
		assert.equal(harness.taps.length, 1);
		harness.taps[0]!.resolve('started after invalidation');
		await settled();

		assert.equal(harness.nativeActive, true);
		assert.equal(harness.taps.length, 2);
		harness.taps[1]!.resolve('closed');
		await settled();
		assert.equal(harness.nativeActive, false);
		assert.equal(harness.taps.length, 2);
	});
}

void test('invalidation after start settlement issues one compensating close', async () => {
	const harness = createHarness();
	await startRecording(harness);
	assert.equal(harness.nativeActive, true);

	harness.core.invalidate('focus-lost');
	assert.equal(harness.taps.length, 2);
	harness.taps[1]!.resolve('closed');
	await settled();

	assert.equal(harness.nativeActive, false);
	assert.equal(harness.taps.length, 2);
});

void test('late uncertain start success is reconciled after invalidation', async () => {
	const harness = createHarness();
	harness.core.setAutoStart(true);
	await openReady(harness);
	harness.core.onTextEntryFocused('');
	await harness.clock.advance(750);

	harness.core.invalidate('app-inactive');
	harness.taps[0]!.resolve('late start');
	await settled();
	assert.equal(harness.nativeActive, true);
	assert.equal(harness.taps.length, 2);

	harness.taps[1]!.resolve('closed');
	await settled();
	assert.equal(harness.nativeActive, false);
	assert.equal(harness.taps.length, 2);
});

void test('rejected issued start after invalidation needs no blind close', async () => {
	const harness = createHarness();
	harness.core.setAutoStart(true);
	await openReady(harness);
	harness.core.onTextEntryFocused('');

	harness.core.invalidate('source-change');
	harness.taps[0]!.reject(new Error('start rejected'));
	await settled();
	await harness.clock.advance(2_500);

	assert.equal(harness.nativeActive, false);
	assert.equal(harness.taps.length, 1);
});

void test('replacement session waits for retired native cleanup and then starts independently', async () => {
	const harness = createHarness();
	harness.core.setAutoStart(true);
	await openReady(harness);
	harness.core.onTextEntryFocused('old');
	harness.core.invalidate('source-change');

	await openReady(harness);
	harness.core.onTextEntryFocused('new');
	assert.equal(harness.taps.length, 1);

	harness.taps[0]!.resolve('old start');
	await settled();
	assert.equal(harness.taps.length, 2);
	harness.taps[1]!.resolve('old close');
	await settled();
	assert.equal(harness.nativeActive, false);
	assert.equal(harness.core.getSnapshot().automation.phase, 'openingTextEntry');

	harness.core.onTextEntryFocused('new');
	assert.equal(harness.taps.length, 3);
	harness.taps[2]!.resolve('new start');
	await settled();
	assert.equal(harness.nativeActive, true);
	assert.deepEqual(harness.core.getSnapshot().automation, {
		phase: 'recording',
		textBeforeStart: 'new',
	});
});

void test('late uncertain rejection releases an independent replacement session without closing', async () => {
	const harness = createHarness();
	harness.core.setAutoStart(true);
	await openReady(harness);
	harness.core.onTextEntryFocused('old');
	await harness.clock.advance(750);
	harness.core.invalidate('source-change');

	await openReady(harness);
	assert.equal(harness.core.getSnapshot().automation.phase, 'idle');
	harness.taps[0]!.reject(new Error('late start rejection'));
	await settled();
	assert.equal(harness.nativeActive, false);
	assert.equal(harness.taps.length, 1);
	assert.equal(harness.core.getSnapshot().automation.phase, 'openingTextEntry');

	harness.core.onTextEntryFocused('new');
	assert.equal(harness.taps.length, 2);
	harness.taps[1]!.resolve('new start');
	await settled();
	assert.equal(harness.nativeActive, true);
	assert.deepEqual(harness.core.getSnapshot().automation, {
		phase: 'recording',
		textBeforeStart: 'new',
	});
});

void test('dispose waits for an issued start before one non-retrying cleanup', async () => {
	const harness = createHarness();
	harness.core.setAutoStart(true);
	await openReady(harness);
	harness.core.onTextEntryFocused('');

	harness.core.dispose();
	assert.equal(harness.taps.length, 1);
	harness.taps[0]!.resolve('started after dispose');
	await settled();
	assert.equal(harness.nativeActive, true);
	assert.equal(harness.taps.length, 2);

	harness.taps[1]!.resolve('closed');
	await settled();
	assert.equal(harness.nativeActive, false);
	assert.equal(harness.taps.length, 2);
});

void test('dispose after issued start rejection performs no cleanup toggle or retry', async () => {
	const harness = createHarness();
	harness.core.setAutoStart(true);
	await openReady(harness);
	harness.core.onTextEntryFocused('');

	harness.core.dispose();
	harness.taps[0]!.reject(new Error('start rejected'));
	await settled();
	await harness.clock.advance(2_500);

	assert.equal(harness.nativeActive, false);
	assert.equal(harness.taps.length, 1);
});

void test('successor core waits for a disposed core native transaction', async () => {
	const authority = createWisprNativeControlAuthority();
	const predecessor = createHarness('android', undefined, authority);
	const successor = createHarness('android', undefined, authority);
	const native = shareNativeControl(predecessor, successor);

	predecessor.core.setAutoStart(true);
	await openReady(predecessor);
	predecessor.core.onTextEntryFocused('old');
	assert.equal(native.taps.length, 1);
	predecessor.core.dispose();

	successor.core.setAutoStart(true);
	await openReady(successor);
	successor.core.onTextEntryFocused('new');
	assert.equal(native.taps.length, 1);
	assert.equal(native.active, false);

	native.taps[0]!.resolve('old start');
	await settled();
	assert.equal(native.active, true);
	assert.equal(native.taps.length, 2);
	native.taps[1]!.resolve('old close');
	await settled();
	assert.equal(native.active, false);
	assert.equal(native.taps.length, 3);
	native.taps[2]!.resolve('successor start');
	await settled();
	successor.core.dispose();
	assert.equal(native.taps.length, 4);
	native.taps[3]!.resolve('successor close');
	await settled();
	assert.equal(native.active, false);
	assert.equal(native.taps.length, 4);
});

void test('successor waits when predecessor start settles before disposal', async () => {
	const authority = createWisprNativeControlAuthority();
	const predecessor = createHarness('android', undefined, authority);
	const successor = createHarness('android', undefined, authority);
	const native = shareNativeControl(predecessor, successor);

	predecessor.core.setAutoStart(true);
	await openReady(predecessor);
	predecessor.core.onTextEntryFocused('old');
	native.taps[0]!.resolve('old start');
	await settled();
	assert.equal(native.active, true);
	predecessor.core.dispose();
	assert.equal(native.taps.length, 2);

	successor.core.setAutoStart(true);
	await openReady(successor);
	successor.core.onTextEntryFocused('new');
	assert.equal(native.taps.length, 2);
	native.taps[1]!.resolve('old close');
	await settled();
	assert.equal(native.active, false);
	assert.equal(native.taps.length, 3);
	native.taps[2]!.resolve('successor start');
	await settled();
	assert.equal(native.active, true);
	successor.core.dispose();
	assert.equal(native.taps.length, 4);
	native.taps[3]!.resolve('successor close');
	await settled();
	assert.equal(native.active, false);
});

void test('predecessor rejection releases waiting successor without a blind close', async () => {
	const authority = createWisprNativeControlAuthority();
	const predecessor = createHarness('android', undefined, authority);
	const successor = createHarness('android', undefined, authority);
	const native = shareNativeControl(predecessor, successor);

	predecessor.core.setAutoStart(true);
	await openReady(predecessor);
	predecessor.core.onTextEntryFocused('old');
	predecessor.core.dispose();
	successor.core.setAutoStart(true);
	await openReady(successor);
	successor.core.onTextEntryFocused('new');
	assert.equal(native.taps.length, 1);

	native.taps[0]!.reject(new Error('old start rejected'));
	await settled();
	assert.equal(native.active, false);
	assert.equal(native.taps.length, 2);
	native.taps[1]!.resolve('successor start');
	await settled();
	assert.equal(native.active, true);
	successor.core.dispose();
	assert.equal(native.taps.length, 3);
	native.taps[2]!.resolve('successor close');
	await settled();
	assert.equal(native.active, false);
});

for (const lateSettlement of ['resolve', 'reject'] as const) {
	void test(`uncertain predecessor ${lateSettlement} settles before successor native start`, async () => {
		const authority = createWisprNativeControlAuthority();
		const predecessor = createHarness('android', undefined, authority);
		const successor = createHarness('android', undefined, authority);
		const native = shareNativeControl(predecessor, successor);

		predecessor.core.setAutoStart(true);
		await openReady(predecessor);
		predecessor.core.onTextEntryFocused('old');
		await predecessor.clock.advance(750);
		predecessor.core.dispose();
		successor.core.setAutoStart(true);
		await openReady(successor);
		successor.core.onTextEntryFocused('new');
		assert.equal(native.taps.length, 1);

		if (lateSettlement === 'resolve') {
			native.taps[0]!.resolve('late old start');
			await settled();
			assert.equal(native.active, true);
			assert.equal(native.taps.length, 2);
			native.taps[1]!.resolve('old close');
			await settled();
			assert.equal(native.active, false);
		} else {
			native.taps[0]!.reject(new Error('late old rejection'));
			await settled();
			assert.equal(native.active, false);
		}
		const successorStartIndex = lateSettlement === 'resolve' ? 2 : 1;
		assert.equal(native.taps.length, successorStartIndex + 1);
		native.taps[successorStartIndex]!.resolve('successor start');
		await settled();
		assert.equal(native.active, true);
		successor.core.dispose();
		assert.equal(native.taps.length, successorStartIndex + 2);
		native.taps[successorStartIndex + 1]!.resolve('successor close');
		await settled();
		assert.equal(native.active, false);
	});
}

for (const retirement of ['close', 'invalidate', 'dispose'] as const) {
	for (const lateSettlement of ['resolve', 'reject'] as const) {
		void test(`${retirement} before start timeout bounds the issued native obligation and ignores late ${lateSettlement}`, async () => {
			const authority = createWisprNativeControlAuthority();
			const predecessor = createHarness('android', undefined, authority);
			const successor = createHarness('android', undefined, authority);
			const native = shareNativeControl(predecessor, successor);

			predecessor.core.setAutoStart(true);
			await openReady(predecessor);
			predecessor.core.onTextEntryFocused('old');
			assert.equal(native.taps.length, 1);
			if (retirement === 'close') predecessor.core.closeTextEntry();
			else if (retirement === 'invalidate') {
				predecessor.core.invalidate('source-change');
			} else predecessor.core.dispose();

			successor.core.setAutoStart(true);
			await openReady(successor);
			successor.core.onTextEntryFocused('new');
			await predecessor.clock.advance(4_999);
			assert.equal(
				successor.core.getSnapshot().automation.phase,
				'waitingForBubble',
			);
			await predecessor.clock.advance(1);
			assert.deepEqual(
				successor.core.getSnapshot().automation,
				blockedCleanupFailure,
			);
			assert.equal(authority.acquire().status, 'blocked');
			assert.equal(native.taps.length, 1);
			if (lateSettlement === 'resolve') {
				native.taps[0]!.resolve('late old start');
			} else {
				native.taps[0]!.reject(new Error('late old start rejection'));
			}
			await settled();
			assert.deepEqual(
				successor.core.getSnapshot().automation,
				blockedCleanupFailure,
			);
			assert.equal(authority.acquire().status, 'blocked');
			assert.equal(native.taps.length, 1);
		});
	}
}

for (const lateSettlement of ['resolve', 'reject'] as const) {
	void test(`disposing during issued close preserves its deadline and ignores late ${lateSettlement}`, async () => {
		const authority = createWisprNativeControlAuthority();
		const predecessor = createHarness('android', undefined, authority);
		const successor = createHarness('android', undefined, authority);
		const native = shareNativeControl(predecessor, successor);

		predecessor.core.setAutoStart(true);
		await openReady(predecessor);
		predecessor.core.onTextEntryFocused('old');
		native.taps[0]!.resolve('old start');
		await settled();
		assert.equal(predecessor.core.getSnapshot().automation.phase, 'recording');
		predecessor.core.closeTextEntry();
		assert.equal(native.taps.length, 2);
		predecessor.core.dispose();
		successor.core.setAutoStart(true);
		await openReady(successor);
		successor.core.onTextEntryFocused('new');
		await predecessor.clock.advance(750);
		assert.deepEqual(
			successor.core.getSnapshot().automation,
			blockedCleanupFailure,
		);
		assert.equal(authority.acquire().status, 'blocked');
		assert.equal(native.taps.length, 2);

		if (lateSettlement === 'resolve') {
			native.taps[1]!.resolve('late old close');
		} else {
			native.taps[1]!.reject(new Error('late old close rejection'));
		}
		await settled();
		assert.deepEqual(
			successor.core.getSnapshot().automation,
			blockedCleanupFailure,
		);
		assert.equal(authority.acquire().status, 'blocked');
		assert.equal(native.taps.length, 2);
	});
}

void test('cleanup deadline scheduling failure immediately poisons exact authority lease', async () => {
	const authority = createWisprNativeControlAuthority();
	const predecessor = createHarness(
		'android',
		(clock) => {
			const schedule = clock.setTimeout;
			clock.setTimeout = (task, delayMs) => {
				if (delayMs === 5_000) throw new Error('cleanup timer unavailable');
				return schedule(task, delayMs);
			};
		},
		authority,
	);
	const successor = createHarness('android', undefined, authority);
	const native = shareNativeControl(predecessor, successor);

	predecessor.core.setAutoStart(true);
	await openReady(predecessor);
	predecessor.core.onTextEntryFocused('old');
	successor.core.setAutoStart(true);
	await openReady(successor);
	successor.core.onTextEntryFocused('new');
	predecessor.core.dispose();
	await settled();

	assert.deepEqual(
		successor.core.getSnapshot().automation,
		blockedCleanupFailure,
	);
	assert.equal(authority.acquire().status, 'blocked');
	assert.equal(native.taps.length, 1);
});

void test('late uncertain rejection releases authority without requiring disposal', async () => {
	const authority = createWisprNativeControlAuthority();
	const predecessor = createHarness('android', undefined, authority);
	const successor = createHarness('android', undefined, authority);
	const native = shareNativeControl(predecessor, successor);

	predecessor.core.setAutoStart(true);
	await openReady(predecessor);
	predecessor.core.onTextEntryFocused('old');
	await predecessor.clock.advance(750);
	native.taps[0]!.reject(new Error('late old rejection'));
	await settled();
	assert.equal(native.active, false);

	successor.core.setAutoStart(true);
	await openReady(successor);
	successor.core.onTextEntryFocused('new');
	assert.equal(native.taps.length, 2);
});

void test('disposing a waiting core cancels only its acquisition', async () => {
	const authority = createWisprNativeControlAuthority();
	const predecessor = createHarness('android', undefined, authority);
	const cancelled = createHarness('android', undefined, authority);
	const native = shareNativeControl(predecessor, cancelled);

	predecessor.core.setAutoStart(true);
	await openReady(predecessor);
	predecessor.core.onTextEntryFocused('old');
	cancelled.core.setAutoStart(true);
	await openReady(cancelled);
	cancelled.core.onTextEntryFocused('cancelled');
	assert.equal(native.taps.length, 1);
	cancelled.core.dispose();

	predecessor.core.dispose();
	native.taps[0]!.resolve('old start');
	await settled();
	assert.equal(native.taps.length, 2);
	native.taps[1]!.resolve('old close');
	await settled();
	assert.equal(native.active, false);
	assert.equal(native.taps.length, 2);
});

void test('newest waiting core supersedes the older waiter without stealing its cancellation', async () => {
	const authority = createWisprNativeControlAuthority();
	const predecessor = createHarness('android', undefined, authority);
	const superseded = createHarness('android', undefined, authority);
	const successor = createHarness('android', undefined, authority);
	const native = shareNativeControl(predecessor, superseded, successor);

	predecessor.core.setAutoStart(true);
	await openReady(predecessor);
	predecessor.core.onTextEntryFocused('old');
	superseded.core.setAutoStart(true);
	await openReady(superseded);
	superseded.core.onTextEntryFocused('superseded');
	successor.core.setAutoStart(true);
	await openReady(successor);
	successor.core.onTextEntryFocused('latest');
	await settled();

	assert.equal(superseded.core.getSnapshot().automation.phase, 'idle');
	assert.equal(
		successor.core.getSnapshot().automation.phase,
		'waitingForBubble',
	);
	assert.equal(native.taps.length, 1);
	superseded.core.dispose();
	predecessor.core.dispose();
	native.taps[0]!.resolve('old start');
	await settled();
	assert.equal(native.taps.length, 2);
	native.taps[1]!.resolve('old close');
	await settled();
	assert.equal(native.active, false);
	assert.equal(native.taps.length, 3);
	native.taps[2]!.resolve('latest start');
	await settled();
	assert.equal(native.active, true);
	successor.core.dispose();
	assert.equal(native.taps.length, 4);
	native.taps[3]!.resolve('latest close');
	await settled();
	assert.equal(native.active, false);
});

const blockedCleanupFailure = {
	phase: 'failed' as const,
	reason: 'tap-failed' as const,
	message: 'Wispr unavailable because prior cleanup failed.',
};

void test('rejected predecessor close blocks its waiting successor', async () => {
	const authority = createWisprNativeControlAuthority();
	const predecessor = createHarness('android', undefined, authority);
	const successor = createHarness('android', undefined, authority);
	const native = shareNativeControl(predecessor, successor);

	predecessor.core.setAutoStart(true);
	await openReady(predecessor);
	predecessor.core.onTextEntryFocused('old');
	native.taps[0]!.resolve('old start');
	await settled();
	predecessor.core.dispose();
	assert.equal(native.active, true);
	assert.equal(native.taps.length, 2);

	successor.core.setAutoStart(true);
	await openReady(successor);
	successor.core.onTextEntryFocused('new');
	assert.equal(native.taps.length, 2);
	native.taps[1]!.reject(new Error('close rejected'));
	await settled();

	assert.equal(native.active, true);
	assert.equal(native.taps.length, 2);
	assert.deepEqual(
		successor.core.getSnapshot().automation,
		blockedCleanupFailure,
	);
	assert.equal(authority.acquire().status, 'blocked');
});

void test('synchronous predecessor close throw blocks its waiting successor', async () => {
	const authority = createWisprNativeControlAuthority();
	const predecessor = createHarness('android', undefined, authority);
	const successor = createHarness('android', undefined, authority);
	const native = shareNativeControl(predecessor, successor);

	predecessor.core.setAutoStart(true);
	await openReady(predecessor);
	predecessor.core.onTextEntryFocused('old');
	native.taps[0]!.resolve('old start');
	await settled();
	let closeInvocations = 0;
	const throwClose = () => {
		closeInvocations += 1;
		throw new Error('close threw');
	};
	predecessor.native.tapControl = throwClose;
	successor.native.tapControl = throwClose;
	predecessor.core.dispose();

	successor.core.setAutoStart(true);
	await openReady(successor);
	successor.core.onTextEntryFocused('new');
	await settled();

	assert.equal(native.active, true);
	assert.equal(closeInvocations, 1);
	assert.deepEqual(
		successor.core.getSnapshot().automation,
		blockedCleanupFailure,
	);
	assert.equal(authority.acquire().status, 'blocked');
});

void test('late rejected uncertain close blocks its waiting successor', async () => {
	const authority = createWisprNativeControlAuthority();
	const predecessor = createHarness('android', undefined, authority);
	const successor = createHarness('android', undefined, authority);
	const native = shareNativeControl(predecessor, successor);

	predecessor.core.setAutoStart(true);
	await openReady(predecessor);
	predecessor.core.onTextEntryFocused('old');
	native.taps[0]!.resolve('old start');
	await settled();
	predecessor.core.dispose();
	successor.core.setAutoStart(true);
	await openReady(successor);
	successor.core.onTextEntryFocused('new');
	await predecessor.clock.advance(750);
	assert.equal(native.taps.length, 2);

	native.taps[1]!.reject(new Error('late close rejection'));
	await settled();

	assert.equal(native.active, true);
	assert.equal(native.taps.length, 2);
	assert.deepEqual(
		successor.core.getSnapshot().automation,
		blockedCleanupFailure,
	);
	assert.equal(authority.acquire().status, 'blocked');
});

void test('uncertain close poisons authority even if native success arrives late', async () => {
	const authority = createWisprNativeControlAuthority();
	const predecessor = createHarness('android', undefined, authority);
	const successor = createHarness('android', undefined, authority);
	const native = shareNativeControl(predecessor, successor);

	predecessor.core.setAutoStart(true);
	await openReady(predecessor);
	predecessor.core.onTextEntryFocused('old');
	native.taps[0]!.resolve('old start');
	await settled();
	predecessor.core.dispose();
	successor.core.setAutoStart(true);
	await openReady(successor);
	successor.core.onTextEntryFocused('new');
	await predecessor.clock.advance(750);
	assert.equal(native.taps.length, 2);
	await settled();
	assert.deepEqual(
		successor.core.getSnapshot().automation,
		blockedCleanupFailure,
	);
	assert.equal(authority.acquire().status, 'blocked');

	native.taps[1]!.resolve('late close success');
	await settled();
	assert.equal(native.active, false);
	assert.equal(native.taps.length, 2);
});

void test('never-settling cleanup poisons authority at its bounded timeout', async () => {
	const authority = createWisprNativeControlAuthority();
	const predecessor = createHarness('android', undefined, authority);
	const successor = createHarness('android', undefined, authority);
	const native = shareNativeControl(predecessor, successor);

	predecessor.core.setAutoStart(true);
	await openReady(predecessor);
	predecessor.core.onTextEntryFocused('old');
	native.taps[0]!.resolve('old start');
	await settled();
	predecessor.core.dispose();
	assert.equal(native.taps.length, 2);

	successor.core.setAutoStart(true);
	await openReady(successor);
	successor.core.onTextEntryFocused('new');
	await predecessor.clock.advance(750);
	await settled();

	assert.deepEqual(
		successor.core.getSnapshot().automation,
		blockedCleanupFailure,
	);
	assert.equal(authority.acquire().status, 'blocked');
});

for (const lateSettlement of ['resolve', 'reject'] as const) {
	void test(`uncertain start cleanup deadline poisons authority and ignores late ${lateSettlement}`, async () => {
		const authority = createWisprNativeControlAuthority();
		const predecessor = createHarness('android', undefined, authority);
		const successor = createHarness('android', undefined, authority);
		const native = shareNativeControl(predecessor, successor);

		predecessor.core.setAutoStart(true);
		await openReady(predecessor);
		predecessor.core.onTextEntryFocused('old');
		assert.equal(native.taps.length, 1);
		await predecessor.clock.advance(750);
		assert.equal(predecessor.core.getSnapshot().automation.phase, 'failed');
		predecessor.core.dispose();

		successor.core.setAutoStart(true);
		await openReady(successor);
		successor.core.onTextEntryFocused('new');
		assert.equal(native.taps.length, 1);
		assert.equal(
			successor.core.getSnapshot().automation.phase,
			'waitingForBubble',
		);

		await predecessor.clock.advance(4_999);
		assert.equal(
			successor.core.getSnapshot().automation.phase,
			'waitingForBubble',
		);
		await predecessor.clock.advance(1);
		assert.deepEqual(
			successor.core.getSnapshot().automation,
			blockedCleanupFailure,
		);
		assert.equal(authority.acquire().status, 'blocked');
		assert.equal(native.taps.length, 1);

		if (lateSettlement === 'resolve') {
			native.taps[0]!.resolve('late old start');
		} else {
			native.taps[0]!.reject(new Error('late old start rejection'));
		}
		await settled();

		assert.deepEqual(
			successor.core.getSnapshot().automation,
			blockedCleanupFailure,
		);
		assert.equal(authority.acquire().status, 'blocked');
		assert.equal(native.taps.length, 1);
	});
}
