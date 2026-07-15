import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellTerminalSourcePort } from '../../src/lib/shell-controllers/session-terminal-source';
import { createShellTransportKey } from '../../src/lib/shell-controllers/source-keys';

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function createDeferredTerminalSourceHarness() {
	let generation = 41;
	const read = deferred<{
		chunks: [];
		nextSeq: bigint;
		dropped?: { fromSeq: bigint; toSeq: bigint };
	}>();
	const listener = deferred<bigint>();
	const send = deferred<void>();
	const resize = deferred<void>();
	const removedListenerIds: bigint[] = [];
	const sentPayloads: number[][] = [];
	const resizeCalls: [number, number][] = [];
	const shell = {
		bufferStats: () => ({
			ringBytesCount: 0n,
			usedBytes: 0n,
			headSeq: 0n,
			tailSeq: 0n,
			droppedBytesTotal: 0n,
			chunksCount: 0n,
		}),
		currentSeq: () => 0n,
		readBuffer: () => read.promise,
		addListener: () => listener.promise,
		removeListener: (id: bigint) => removedListenerIds.push(id),
		sendData: (bytes: ArrayBuffer) => {
			sentPayloads.push([...new Uint8Array(bytes)]);
			return send.promise;
		},
		resizePty: (cols: number, rows: number) => {
			resizeCalls.push([cols, rows]);
			return resize.promise;
		},
	} as Parameters<typeof createShellTerminalSourcePort>[0]['shell'];
	const port = createShellTerminalSourcePort({
		channelId: 7,
		connectionId: 'connection-1',
		generation,
		getCurrentGeneration: () => generation,
		key: createShellTransportKey('connection-1', 7),
		shell,
	});
	return {
		port,
		read,
		listener,
		send,
		resize,
		removedListenerIds,
		sentPayloads,
		resizeCalls,
		rotate: () => {
			generation += 1;
		},
	};
}

void test('terminal source preserves native bigint diagnostics and hides stale generations', () => {
	let generation = 41;
	const values = {
		currentSeq: 9_007_199_254_740_993n,
		ringBytesCount: 9_007_199_254_740_994n,
		usedBytes: 9_007_199_254_740_995n,
		headSeq: 9_007_199_254_740_996n,
		tailSeq: 9_007_199_254_740_997n,
		droppedBytesTotal: 9_007_199_254_740_998n,
		chunksCount: 9_007_199_254_740_999n,
	};
	const shell = {
		bufferStats: () => ({
			ringBytesCount: values.ringBytesCount,
			usedBytes: values.usedBytes,
			headSeq: values.headSeq,
			tailSeq: values.tailSeq,
			droppedBytesTotal: values.droppedBytesTotal,
			chunksCount: values.chunksCount,
		}),
		currentSeq: () => values.currentSeq,
	} as Parameters<typeof createShellTerminalSourcePort>[0]['shell'];
	const port = createShellTerminalSourcePort({
		channelId: 7,
		connectionId: 'connection-1',
		generation,
		getCurrentGeneration: () => generation,
		key: createShellTransportKey('connection-1', 7),
		shell,
	});

	assert.deepEqual(port.getNativeOutputDiagnostics(), {
		currentSeq: values.currentSeq.toString(),
		ringBytesCount: values.ringBytesCount.toString(),
		usedBytes: values.usedBytes.toString(),
		headSeq: values.headSeq.toString(),
		tailSeq: values.tailSeq.toString(),
		droppedBytesTotal: values.droppedBytesTotal.toString(),
		chunksCount: values.chunksCount.toString(),
	});
	generation += 1;
	assert.equal(port.getNativeOutputDiagnostics(), null);
});

void test('in-flight buffer reads reject instead of returning retired shell output', async () => {
	const harness = createDeferredTerminalSourceHarness();
	const pending = Promise.resolve(harness.port.readBuffer({ mode: 'head' }));
	harness.rotate();
	harness.read.resolve({ chunks: [], nextSeq: 12n });

	await assert.rejects(pending, /Shell terminal source superseded/);
});

void test('late listener registration is removed once and never becomes usable', async () => {
	const harness = createDeferredTerminalSourceHarness();
	const pending = harness.port.addListener(() => {}, {
		cursor: { mode: 'live' },
	});
	harness.rotate();
	harness.listener.resolve(73n);

	await assert.rejects(pending, /Shell terminal source superseded/);
	assert.deepEqual(harness.removedListenerIds, [73n]);
});

void test('in-flight sends reject after source rotation without replaying bytes', async () => {
	const harness = createDeferredTerminalSourceHarness();
	const pending = harness.port.sendData(new Uint8Array([1, 2, 3]));
	harness.rotate();
	harness.send.resolve();

	await assert.rejects(pending, /Shell terminal source superseded/);
	assert.deepEqual(harness.sentPayloads, [[1, 2, 3]]);
});

void test('in-flight resizes reject after source rotation without replaying dimensions', async () => {
	const harness = createDeferredTerminalSourceHarness();
	const pending = harness.port.resizePty(120, 40);
	harness.rotate();
	harness.resize.resolve();

	await assert.rejects(pending, /Shell terminal source superseded/);
	assert.deepEqual(harness.resizeCalls, [[120, 40]]);
});
