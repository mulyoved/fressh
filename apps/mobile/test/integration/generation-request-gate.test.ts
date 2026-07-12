import assert from 'node:assert/strict';
import test from 'node:test';
import { createGenerationRequestGate } from '../../src/lib/shell-controllers/generation-request-gate';

function createDeferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

void test('generation gate lets a replacement own work after stale completion', async () => {
	const gate = createGenerationRequestGate();
	const requestA = createDeferred();
	const requestB = createDeferred();
	const effects: string[] = [];

	const run = async (name: string, pending: Promise<void>) => {
		const token = gate.begin();
		if (token === null) assert.fail(`${name} did not acquire the gate`);
		await pending;
		if (gate.isCurrent(token)) effects.push(name);
		gate.finish(token);
	};

	const pendingA = run('A', requestA.promise);
	gate.invalidate();
	const pendingB = run('B', requestB.promise);

	requestA.resolve();
	await pendingA;
	assert.deepEqual(effects, []);
	assert.equal(gate.begin(), null);

	requestB.resolve();
	await pendingB;
	assert.deepEqual(effects, ['B']);
	assert.notEqual(gate.begin(), null);
});

void test('generation gate rejects a second begin while its owner is active', () => {
	const gate = createGenerationRequestGate();
	const owner = gate.begin();
	if (owner === null) assert.fail('initial request did not acquire the gate');
	assert.equal(gate.begin(), null);
	assert.equal(gate.isCurrent(owner), true);

	gate.finish(owner);
	assert.equal(gate.isCurrent(owner), false);
	assert.notEqual(gate.begin(), null);
});
