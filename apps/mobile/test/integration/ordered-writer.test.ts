import assert from 'node:assert/strict';
import test from 'node:test';
import { OrderedWriter } from '../../src/lib/ordered-writer';

const bytes = (values: number[]) => new Uint8Array(values);

void test('ordered writer stops delayed batch when request becomes stale', async () => {
	let current = true;
	const writes: number[][] = [];
	const writer = new OrderedWriter(async (segment) => {
		writes.push(Array.from(segment));
		current = false;
	});

	await writer.sendBatch([bytes([0x68, 0x69]), bytes([0x0d])], {
		interSegmentDelayMs: 1,
		isCurrent: () => current,
	});

	assert.deepEqual(writes, [[0x68, 0x69]]);
});

void test('ordered writer checks freshness before first batch segment', async () => {
	const writes: number[][] = [];
	const writer = new OrderedWriter(async (segment) => {
		writes.push(Array.from(segment));
	});

	await writer.sendBatch([bytes([0x0d])], {
		isCurrent: () => false,
	});

	assert.deepEqual(writes, []);
});

void test('ordered writer interrupts an inter-segment delay without cancelling an active write', async () => {
	const writes: number[][] = [];
	const controller = new AbortController();
	let firstWriteResolve!: () => void;
	const firstWrite = new Promise<void>((resolve) => {
		firstWriteResolve = resolve;
	});
	const writer = new OrderedWriter(async (segment) => {
		writes.push(Array.from(segment));
		firstWriteResolve();
	});

	const batch = writer.sendBatch([bytes([1]), bytes([2])], {
		interSegmentDelayMs: 10_000,
		signal: controller.signal,
	});
	await firstWrite;
	await new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});
	controller.abort();
	await Promise.race([
		batch,
		new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error('delay was not interrupted')), 200);
		}),
	]);

	assert.deepEqual(writes, [[1]]);
});
