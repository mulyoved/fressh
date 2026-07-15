import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createWisprTimerOwner,
	WisprDelayCancelledError,
} from '../../src/lib/shell-controllers/wispr-timer-owner';

function createTimers() {
	const tasks = new Map<object, () => void>();
	const cleared: object[] = [];
	return {
		cleared,
		deps: {
			setTimeout: (task: () => void) => {
				const handle = {};
				tasks.set(handle, task);
				return handle;
			},
			clearTimeout: (handle: unknown) => {
				cleared.push(handle as object);
			},
		},
		fire: (handle: object) => tasks.get(handle)?.(),
	};
}

void test('ordinary Wispr timers cancel without a fake cancellation callback', () => {
	const timers = createTimers();
	const owner = createWisprTimerOwner(timers.deps);
	let fired = false;
	const handle = owner.setTimeout(() => {
		fired = true;
	}, 10) as object;

	owner.clearTimeout(handle);
	timers.fire(handle);

	assert.equal(fired, false);
	assert.equal(timers.cleared.length, 1);
});

void test('cancellable Wispr sleep rejects once when all timers are cancelled', async () => {
	const timers = createTimers();
	const owner = createWisprTimerOwner(timers.deps);
	const sleep = owner.sleep(10);

	owner.cancelAll();
	owner.cancelAll();

	await assert.rejects(sleep, WisprDelayCancelledError);
	assert.equal(timers.cleared.length, 1);
});
