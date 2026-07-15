import assert from 'node:assert/strict';
import test from 'node:test';
import { createWisprNativeControlAuthority } from '../../src/lib/shell-controllers/wispr-native-control-authority';
import {
	blockedCleanupFailure,
	createHarness,
	openReady,
	settled,
	shareNativeControl,
} from './shell-wispr-controller-test-support';

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
