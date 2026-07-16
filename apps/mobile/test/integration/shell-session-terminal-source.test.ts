import assert from 'node:assert/strict';
import test from 'node:test';
import { type ShellTerminalListenerRegistration } from '../../src/lib/shell-controllers/session-contracts';
import {
	createShellTerminalSourcePort,
	type ShellTerminalNativeSource,
} from '../../src/lib/shell-controllers/session-terminal-source';
import { createShellTransportKey } from '../../src/lib/shell-controllers/source-keys';

type IsAssignable<From, To> = [From] extends [To] ? true : false;

const listenerRegistrationRejectsStructuralForgery: IsAssignable<
	Readonly<{ id: bigint }>,
	ShellTerminalListenerRegistration
> = false;
void listenerRegistrationRejectsStructuralForgery;

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function createNativeTerminalSource(
	overrides: Partial<ShellTerminalNativeSource> = {},
): ShellTerminalNativeSource {
	return {
		bufferStats: () => ({
			ringBytesCount: 0n,
			usedBytes: 0n,
			headSeq: 0n,
			tailSeq: 0n,
			droppedBytesTotal: 0n,
			chunksCount: 0n,
		}),
		currentSeq: () => 0n,
		readBuffer: async () => ({ chunks: [], nextSeq: 0n }),
		addListener: async () => 1n,
		removeListener: () => {},
		sendData: async () => {},
		resizePty: async () => {},
		...overrides,
	} satisfies ShellTerminalNativeSource;
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
	const nativeListeners: Parameters<
		ShellTerminalNativeSource['addListener']
	>[0][] = [];
	const sentPayloads: number[][] = [];
	const resizeCalls: [number, number][] = [];
	const shell = createNativeTerminalSource({
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
		addListener: (nativeListener) => {
			nativeListeners.push(nativeListener);
			return listener.promise;
		},
		removeListener: (id: bigint) => {
			removedListenerIds.push(id);
		},
		sendData: (bytes: ArrayBuffer) => {
			sentPayloads.push([...new Uint8Array(bytes)]);
			return send.promise;
		},
		resizePty: (cols: number, rows: number) => {
			resizeCalls.push([cols, rows]);
			return resize.promise;
		},
	});
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
		shell,
		read,
		listener,
		send,
		resize,
		removedListenerIds,
		nativeListeners,
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
	const shell = createNativeTerminalSource({
		bufferStats: () => ({
			ringBytesCount: values.ringBytesCount,
			usedBytes: values.usedBytes,
			headSeq: values.headSeq,
			tailSeq: values.tailSeq,
			droppedBytesTotal: values.droppedBytesTotal,
			chunksCount: values.chunksCount,
		}),
		currentSeq: () => values.currentSeq,
	});
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

void test('generation rotation silences an already registered native callback', async () => {
	const harness = createDeferredTerminalSourceHarness();
	const events: string[] = [];
	const registrationPromise = harness.port.addListener(
		() => {
			events.push('delivered');
		},
		{
			cursor: { mode: 'live' },
		},
	);
	harness.listener.resolve(72n);
	await registrationPromise;

	harness.nativeListeners[0]?.({
		kind: 'dropped',
		fromSeq: 1n,
		toSeq: 2n,
	});
	assert.deepEqual(events, ['delivered']);
	harness.rotate();
	harness.nativeListeners[0]?.({
		kind: 'dropped',
		fromSeq: 2n,
		toSeq: 3n,
	});

	assert.deepEqual(events, ['delivered']);
});

void test('generation rotation silences a native callback while registration is pending', async () => {
	const harness = createDeferredTerminalSourceHarness();
	const events: string[] = [];
	const pending = harness.port.addListener(
		() => {
			events.push('delivered');
		},
		{
			cursor: { mode: 'live' },
		},
	);
	harness.rotate();

	harness.nativeListeners[0]?.({
		kind: 'dropped',
		fromSeq: 1n,
		toSeq: 2n,
	});
	harness.listener.resolve(73n);

	await assert.rejects(pending, /Shell terminal source superseded/);
	assert.deepEqual(events, []);
	assert.deepEqual(harness.removedListenerIds, [73n]);
});

void test('late listener registration retries native retirement while preserving the superseded result', async () => {
	const harness = createDeferredTerminalSourceHarness();
	let removalAttempts = 0;
	harness.shell.removeListener = (id: bigint) => {
		harness.removedListenerIds.push(id);
		removalAttempts += 1;
		if (removalAttempts === 1) throw new Error('native removal failed');
	};
	const pending = harness.port.addListener(() => {}, {
		cursor: { mode: 'live' },
	});
	harness.rotate();
	harness.listener.resolve(74n);

	await assert.rejects(pending, /Shell terminal source superseded/);
	assert.deepEqual(harness.removedListenerIds, [74n, 74n]);
});

void test('ordinary listener removal retries one native failure and completes idempotently', async () => {
	const harness = createDeferredTerminalSourceHarness();
	let removalAttempts = 0;
	harness.shell.removeListener = (id: bigint) => {
		harness.removedListenerIds.push(id);
		removalAttempts += 1;
		if (removalAttempts === 1) throw new Error('native removal failed');
	};
	const registrationPromise = harness.port.addListener(() => {}, {
		cursor: { mode: 'live' },
	});
	harness.listener.resolve(75n);
	const registration = await registrationPromise;

	assert.doesNotThrow(() => harness.port.removeListener(registration));
	assert.doesNotThrow(() => harness.port.removeListener(registration));
	assert.deepEqual(harness.removedListenerIds, [75n, 75n]);
});

void test('listener retirement does not conflate reused native IDs', async () => {
	const harness = createDeferredTerminalSourceHarness();
	let removalAttempts = 0;
	harness.shell.addListener = async () => 75n;
	harness.shell.removeListener = () => {
		removalAttempts += 1;
		throw new Error('native removal failed');
	};
	const first = await harness.port.addListener(() => {}, {
		cursor: { mode: 'live' },
	});
	const second = await harness.port.addListener(() => {}, {
		cursor: { mode: 'live' },
	});

	assert.throws(
		() => harness.port.removeListener(first),
		/native removal failed/,
	);
	assert.equal(removalAttempts, 2);
	assert.throws(
		() => harness.port.removeListener(second),
		/native removal failed/,
	);
	assert.equal(removalAttempts, 4);
});

void test('listener removal silences its callback while native retirement retries', async () => {
	const harness = createDeferredTerminalSourceHarness();
	let removalAttempts = 0;
	harness.shell.removeListener = (id: bigint) => {
		harness.removedListenerIds.push(id);
		removalAttempts += 1;
		if (removalAttempts <= 2) throw new Error('native removal failed');
	};
	const events: string[] = [];
	const registrationPromise = harness.port.addListener(
		() => {
			events.push('delivered');
		},
		{
			cursor: { mode: 'live' },
		},
	);
	harness.listener.resolve(75n);
	const registration = await registrationPromise;

	assert.throws(
		() => harness.port.removeListener(registration),
		/native removal failed/,
	);
	harness.nativeListeners[0]?.({
		kind: 'dropped',
		fromSeq: 1n,
		toSeq: 2n,
	});
	await Promise.resolve();
	harness.nativeListeners[0]?.({
		kind: 'dropped',
		fromSeq: 2n,
		toSeq: 3n,
	});

	assert.deepEqual(events, []);
	assert.deepEqual(harness.removedListenerIds, [75n, 75n, 75n]);
});

void test('listener retirement stops automatically but permits a later explicit retry', async () => {
	const harness = createDeferredTerminalSourceHarness();
	let removalAttempts = 0;
	harness.shell.addListener = async () => 76n;
	harness.shell.removeListener = (id: bigint) => {
		harness.removedListenerIds.push(id);
		removalAttempts += 1;
		if (removalAttempts <= 3) throw new Error('native removal failed');
	};
	const registration = await harness.port.addListener(() => {}, {
		cursor: { mode: 'live' },
	});

	assert.throws(
		() => harness.port.removeListener(registration),
		/native removal failed/,
	);
	assert.deepEqual(harness.removedListenerIds, [76n, 76n]);
	await Promise.resolve();
	assert.deepEqual(harness.removedListenerIds, [76n, 76n, 76n]);
	assert.doesNotThrow(() => harness.port.removeListener(registration));
	assert.deepEqual(harness.removedListenerIds, [76n, 76n, 76n, 76n]);
	assert.doesNotThrow(() => harness.port.removeListener(registration));
	assert.deepEqual(harness.removedListenerIds, [76n, 76n, 76n, 76n]);
});

void test('pending retry from a later add completes the original registration once', async () => {
	const harness = createDeferredTerminalSourceHarness();
	let nextListenerId = 76n;
	harness.shell.addListener = async () => nextListenerId++;
	let removalAttempts = 0;
	harness.shell.removeListener = (id: bigint) => {
		harness.removedListenerIds.push(id);
		removalAttempts += 1;
		if (removalAttempts <= 2) throw new Error('native removal failed');
	};
	const original = await harness.port.addListener(() => {}, {
		cursor: { mode: 'live' },
	});

	assert.throws(
		() => harness.port.removeListener(original),
		/native removal failed/,
	);
	await harness.port.addListener(() => {}, { cursor: { mode: 'live' } });
	assert.doesNotThrow(() => harness.port.removeListener(original));
	assert.deepEqual(harness.removedListenerIds, [76n, 76n, 76n]);
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
