import assert from 'node:assert/strict';
import test from 'node:test';
import { createWisprNativeControlAuthority } from '../../src/lib/shell-controllers/wispr-native-control-authority';
import { settled } from './shell-wispr-controller-test-support';

void test('authority grants one lease and waits for its owner to release', async () => {
	const authority = createWisprNativeControlAuthority();
	const first = authority.acquire();
	const firstOutcome = await first.outcome;
	assert.equal(firstOutcome.status, 'acquired');
	if (firstOutcome.status !== 'acquired') return;

	let secondSettled = false;
	const second = authority.acquire();
	void second.outcome.then(() => {
		secondSettled = true;
	});
	await settled();
	assert.equal(secondSettled, false);

	firstOutcome.lease.release();
	const secondOutcome = await second.outcome;
	assert.equal(secondOutcome.status, 'acquired');
	if (secondOutcome.status !== 'acquired') return;
	const third = authority.acquire();
	assert.equal(third.status, 'waiting');
	firstOutcome.lease.release();
	let thirdSettled = false;
	void third.outcome.then(() => {
		thirdSettled = true;
	});
	await settled();
	assert.equal(thirdSettled, false);
	secondOutcome.lease.release();
	assert.equal((await third.outcome).status, 'acquired');
});

void test('authority keeps only the latest observable pending acquisition', async () => {
	const authority = createWisprNativeControlAuthority();
	const owner = await authority.acquire().outcome;
	assert.equal(owner.status, 'acquired');
	if (owner.status !== 'acquired') return;

	const replaced = authority.acquire();
	const latest = authority.acquire();
	assert.deepEqual(await replaced.outcome, { status: 'superseded' });
	owner.lease.release();
	assert.equal((await latest.outcome).status, 'acquired');
});

void test('waiting acquisition cancellation affects only its own request', async () => {
	const authority = createWisprNativeControlAuthority();
	const owner = await authority.acquire().outcome;
	assert.equal(owner.status, 'acquired');
	if (owner.status !== 'acquired') return;

	const cancelled = authority.acquire();
	assert.equal(cancelled.status, 'waiting');
	if (cancelled.status !== 'waiting') return;
	cancelled.cancel();
	cancelled.cancel();
	assert.deepEqual(await cancelled.outcome, { status: 'cancelled' });

	const successor = authority.acquire();
	owner.lease.release();
	assert.equal((await successor.outcome).status, 'acquired');
});

void test('owner poison blocks the current waiter and every future acquisition', async () => {
	const authority = createWisprNativeControlAuthority();
	const owner = authority.acquire();
	assert.equal(owner.status, 'acquired');
	if (owner.status !== 'acquired') return;

	const waiting = authority.acquire();
	assert.equal(waiting.status, 'waiting');
	owner.lease.poison();
	assert.deepEqual(await waiting.outcome, { status: 'blocked' });

	const future = authority.acquire();
	assert.equal(future.status, 'blocked');
	assert.deepEqual(await future.outcome, { status: 'blocked' });
});

void test('stale owner poison cannot block or release a successor', async () => {
	const authority = createWisprNativeControlAuthority();
	const first = authority.acquire();
	assert.equal(first.status, 'acquired');
	if (first.status !== 'acquired') return;

	const successor = authority.acquire();
	first.lease.release();
	const successorOutcome = await successor.outcome;
	assert.equal(successorOutcome.status, 'acquired');
	if (successorOutcome.status !== 'acquired') return;

	const latest = authority.acquire();
	first.lease.poison();
	first.lease.release();
	let latestSettled = false;
	void latest.outcome.then(() => {
		latestSettled = true;
	});
	await settled();
	assert.equal(latestSettled, false);

	successorOutcome.lease.release();
	assert.equal((await latest.outcome).status, 'acquired');
});
