import assert from 'node:assert/strict';
import test from 'node:test';
import { createControllerPublisher } from '../../src/lib/shell-controllers/controller-core';
import {
	createShellTargetKey,
	createShellTransportKey,
} from '../../src/lib/shell-controllers/source-keys';

void test('controller publisher publishes snapshots and stops after disposal', () => {
	const publisher = createControllerPublisher({ count: 0 });
	const seen: number[] = [];
	const unsubscribe = publisher.subscribe(() => {
		seen.push(publisher.getSnapshot().count);
	});

	publisher.publish({ count: 1 });
	unsubscribe();
	publisher.publish({ count: 2 });
	publisher.disposePublisher();
	publisher.publish({ count: 3 });

	assert.deepEqual(seen, [1]);
	assert.deepEqual(publisher.getSnapshot(), { count: 2 });
});

void test('source keys are normalized and collision safe', () => {
	const first = createShellTransportKey('a:1', 2);
	const second = createShellTransportKey('a', 12);
	assert.notEqual(first, second);
	assert.equal(
		createShellTargetKey(first, '  '),
		JSON.stringify([first, 'main']),
	);
	assert.equal(
		createShellTargetKey(first, ' work '),
		JSON.stringify([first, 'work']),
	);
});
