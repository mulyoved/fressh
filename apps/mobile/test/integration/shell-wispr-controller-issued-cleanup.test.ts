import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createWisprNativeControlAuthority,
	type WisprNativeControlAuthority,
} from '../../src/lib/shell-controllers/wispr-native-control-authority';
import {
	blockedCleanupFailure,
	createHarness,
	openReady,
	settled,
	shareNativeControl,
	startRecording,
} from './shell-wispr-controller-test-support';

function createCountingAuthority() {
	const settlements: ('release' | 'poison')[] = [];
	const authority: WisprNativeControlAuthority = {
		acquire: () => {
			const lease = {
				release: () => settlements.push('release'),
				poison: () => settlements.push('poison'),
			};
			return {
				status: 'acquired',
				lease,
				outcome: Promise.resolve({ status: 'acquired', lease }),
			};
		},
	};
	return { authority, settlements };
}

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

void test('repeated close during pending start reconciles one close and one exact lease', async () => {
	const { authority, settlements } = createCountingAuthority();
	const harness = createHarness('android', undefined, authority);
	harness.core.setAutoStart(true);
	await openReady(harness);
	harness.core.onTextEntryFocused('pending');

	harness.core.closeTextEntry();
	harness.core.closeTextEntry();
	assert.equal(harness.taps.length, 1);
	harness.taps[0]!.resolve('started');
	await settled();
	assert.equal(harness.taps.length, 2);
	harness.taps[1]!.resolve('closed');
	await settled();
	assert.deepEqual(settlements, ['release']);

	await harness.clock.advance(5_000);
	assert.equal(harness.taps.length, 2);
	assert.deepEqual(settlements, ['release']);
});

void test('repeated close during recording issues one close and settles one exact lease', async () => {
	const { authority, settlements } = createCountingAuthority();
	const harness = createHarness('android', undefined, authority);
	await startRecording(harness);

	harness.core.closeTextEntry();
	harness.core.closeTextEntry();
	assert.equal(harness.taps.length, 2);
	harness.taps[1]!.resolve('closed');
	await settled();
	assert.deepEqual(settlements, ['release']);

	await harness.clock.advance(5_000);
	assert.equal(harness.taps.length, 2);
	assert.deepEqual(settlements, ['release']);
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
