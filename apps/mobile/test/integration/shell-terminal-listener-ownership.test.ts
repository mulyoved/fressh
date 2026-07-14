import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellTransportKey } from '../../src/lib/shell-controllers/source-keys';
import { type TerminalLifecycleShell } from '../../src/lib/shell-controllers/terminal-lifecycle-core';
import {
	createHarness,
	deferred,
} from './shell-terminal-lifecycle-test-harness';

type Harness = ReturnType<typeof createHarness>;

async function createCommittedListenerHarness() {
	const harness = createHarness();
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	const listener = harness.shellA.listeners.get(1n);
	assert.ok(listener);
	return { harness, listener };
}

void test('terminal lifecycle replays head buffer on first attach then uses live cursor', async () => {
	const harness = createHarness();
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	assert.deepEqual(harness.shellA.readModes, ['head']);
	assert.deepEqual(harness.shellA.listenerCursors, [{ mode: 'seq', seq: 9n }]);
	assert.deepEqual(harness.writes, [[[1, 2]]]);

	harness.core.detach();
	await harness.core.attach();
	assert.deepEqual(harness.shellA.listenerCursors[1], { mode: 'live' });
});

void test('attached listener writes to the current xterm after a benign handle replacement', async () => {
	const harness = createHarness();
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();

	const listener = harness.shellA.listeners.get(1n);
	assert.ok(listener);
	listener({
		seq: 10n,
		tMs: 1,
		stream: 'stdout',
		bytes: new Uint8Array([3]).buffer,
	});

	const replacementWrites: number[][] = [];
	harness.setXterm({
		...harness.xterm,
		write: (bytes: Uint8Array) => {
			replacementWrites.push(Array.from(bytes));
		},
	});
	listener({
		seq: 11n,
		tMs: 2,
		stream: 'stdout',
		bytes: new Uint8Array([4, 5]).buffer,
	});

	assert.equal(harness.core.isAttached(), true);
	assert.deepEqual(
		harness.calls.filter((call) => call.startsWith('write:')),
		['write:3'],
	);
	assert.deepEqual(replacementWrites, [[4, 5]]);
	assert.deepEqual(harness.core.getOutputDiagnostics()?.listener, {
		events: 2,
		bytes: 3,
		lastSeq: '11',
		droppedEvents: 0,
	});
});

const committedListenerInvalidations: readonly {
	name: string;
	invalidate(harness: Harness): void;
}[] = [
	{
		name: 'detach',
		invalidate: (harness) => harness.core.detach(),
	},
	{
		name: 'shell replacement',
		invalidate: (harness) =>
			harness.core.setShell(
				createShellTransportKey('connection-a', 7),
				harness.shellB,
			),
	},
	{
		name: 'runtime replacement',
		invalidate: (harness) => harness.core.handleInitialized('instance-2'),
	},
	{
		name: 'runtime invalidation',
		invalidate: (harness) => harness.core.invalidate('runtime-reset'),
	},
	{
		name: 'load start',
		invalidate: (harness) => harness.core.handleLoadStart(),
	},
	{
		name: 'disposal',
		invalidate: (harness) => harness.core.dispose(),
	},
];

for (const { name, invalidate } of committedListenerInvalidations) {
	void test(`committed listener rejects a retained callback after ${name}`, async () => {
		const { harness, listener } = await createCommittedListenerHarness();
		invalidate(harness);
		const listenerDiagnostics = harness.core.getOutputDiagnostics()?.listener;
		const calls = [...harness.calls];
		const payload = `DO_NOT_LOG_STALE_LISTENER_PAYLOAD_${name}`;

		assert.doesNotThrow(() =>
			listener({
				seq: 10n,
				tMs: 1,
				stream: 'stdout',
				bytes: new TextEncoder().encode(payload).buffer,
			}),
		);

		assert.deepEqual(harness.calls, calls);
		assert.deepEqual(
			harness.core.getOutputDiagnostics()?.listener,
			listenerDiagnostics,
		);
		assert.equal(
			harness.calls.some((call) => call.includes(payload)),
			false,
		);
	});
}

void test('committed listener suppresses a null current xterm and recovers on the next event', async () => {
	const { harness, listener } = await createCommittedListenerHarness();
	const listenerDiagnostics = harness.core.getOutputDiagnostics()?.listener;
	const calls = [...harness.calls];
	const payload = 'DO_NOT_LOG_NULL_XTERM_PAYLOAD';
	harness.setXterm(null);

	assert.doesNotThrow(() =>
		listener({
			seq: 10n,
			tMs: 1,
			stream: 'stdout',
			bytes: new TextEncoder().encode(payload).buffer,
		}),
	);
	assert.deepEqual(harness.calls, calls);
	assert.deepEqual(
		harness.core.getOutputDiagnostics()?.listener,
		listenerDiagnostics,
	);
	assert.equal(
		harness.calls.some((call) => call.includes(payload)),
		false,
	);

	const restoredWrites: number[][] = [];
	harness.setXterm({
		...harness.xterm,
		write: (bytes: Uint8Array) => restoredWrites.push(Array.from(bytes)),
	});
	listener({
		seq: 11n,
		tMs: 2,
		stream: 'stdout',
		bytes: new Uint8Array([7, 8]).buffer,
	});
	assert.deepEqual(restoredWrites, [[7, 8]]);
	assert.deepEqual(harness.core.getOutputDiagnostics()?.listener, {
		events: 1,
		bytes: 2,
		lastSeq: '11',
		droppedEvents: 0,
	});
});

void test('committed listener contains a throwing current-xterm lookup and recovers on the next event', async () => {
	const { harness, listener } = await createCommittedListenerHarness();
	const listenerDiagnostics = harness.core.getOutputDiagnostics()?.listener;
	const calls = [...harness.calls];
	const payload = 'DO_NOT_LOG_THROWING_XTERM_PAYLOAD';
	harness.setGetXtermError(new Error(payload));

	assert.doesNotThrow(() =>
		listener({
			seq: 10n,
			tMs: 1,
			stream: 'stdout',
			bytes: new TextEncoder().encode(payload).buffer,
		}),
	);
	harness.setGetXtermError(null);
	assert.deepEqual(harness.calls, calls);
	assert.deepEqual(
		harness.core.getOutputDiagnostics()?.listener,
		listenerDiagnostics,
	);
	assert.equal(
		harness.calls.some((call) => call.includes(payload)),
		false,
	);

	const restoredWrites: number[][] = [];
	harness.setXterm({
		...harness.xterm,
		write: (bytes: Uint8Array) => restoredWrites.push(Array.from(bytes)),
	});
	listener({
		seq: 11n,
		tMs: 2,
		stream: 'stdout',
		bytes: new Uint8Array([9]).buffer,
	});
	assert.deepEqual(restoredWrites, [[9]]);
	assert.deepEqual(harness.core.getOutputDiagnostics()?.listener, {
		events: 1,
		bytes: 1,
		lastSeq: '11',
		droppedEvents: 0,
	});
});

void test('a WebView reload starts fresh first-attach ownership even when its instance ID repeats', async () => {
	const harness = createHarness();
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	harness.core.handleLoadStart();
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	assert.deepEqual(harness.shellA.readModes, ['head', 'head']);
	assert.deepEqual(harness.shellA.listenerCursors[1], {
		mode: 'seq',
		seq: 9n,
	});
});

void test('terminal lifecycle removes listener from recorded owner after shell replacement', async () => {
	const harness = createHarness();
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	harness.core.setShell(
		createShellTransportKey('connection-b', 8),
		harness.shellB,
	);
	assert.deepEqual(harness.shellA.removedListenerIds, [1n]);
	assert.deepEqual(harness.shellB.removedListenerIds, []);
});

void test('failed first attach does not consume head ownership', async () => {
	const harness = createHarness();
	let attempts = 0;
	harness.shellA.addListener = () => {
		attempts += 1;
		if (attempts === 1) throw new Error('attach failed');
		harness.shellA.listenerCursors.push({ mode: 'seq', seq: 9n });
		return 10n;
	};
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await assert.rejects(harness.core.attach(), /attach failed/);
	await harness.core.attach();
	assert.deepEqual(harness.shellA.readModes, ['head', 'head']);
});

void test('rejected listener creation preserves first-attach ownership for retry', async () => {
	const harness = createHarness();
	const originalAdd = harness.shellA.addListener.bind(harness.shellA);
	let attempts = 0;
	harness.shellA.addListener = (listener, options) => {
		attempts += 1;
		if (attempts === 1) return Promise.reject(new Error('listener failed'));
		return originalAdd(listener, options);
	};
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await assert.rejects(harness.core.attach(), /listener failed/);
	await harness.core.attach();
	assert.equal(attempts, 2);
	assert.deepEqual(harness.shellA.readModes, ['head', 'head']);
});

void test('rejected head read preserves first-attach ownership for retry', async () => {
	const harness = createHarness();
	const originalRead = harness.shellA.readBuffer.bind(harness.shellA);
	let attempts = 0;
	harness.shellA.readBuffer = (cursor) => {
		attempts += 1;
		if (attempts === 1) return Promise.reject(new Error('read failed'));
		return originalRead(cursor);
	};
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await assert.rejects(harness.core.attach(), /read failed/);
	await harness.core.attach();
	assert.equal(attempts, 2);
	assert.deepEqual(harness.shellA.listenerCursors, [{ mode: 'seq', seq: 9n }]);
});

void test('superseded async attach removes its late listener and cannot publish ownership', async () => {
	const harness = createHarness();
	const lateId = deferred<bigint>();
	harness.shellA.addListener = () => lateId.promise;
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	const attaching = harness.core.attach();
	await Promise.resolve();
	harness.core.handleLoadStart();
	lateId.resolve(44n);
	await attaching;
	assert.deepEqual(harness.shellA.removedListenerIds, [44n]);
	assert.equal(harness.core.getSnapshot().ready, false);
});

void test('attachment logging invalidation suppresses stale iOS focus and leaves no owner', async () => {
	let harness!: ReturnType<typeof createHarness>;
	harness = createHarness('ios', {
		onInfo: (message) => {
			if (message === 'shell listener attached') harness.core.handleLoadStart();
		},
	});
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	assert.equal(harness.calls.includes('focus'), false);
	assert.deepEqual(harness.shellA.removedListenerIds, [1n]);
	assert.equal(harness.core.isAttached(), false);
});

void test('detached or replaced xterm suppresses deferred replay and stale listener ownership', async () => {
	const read = deferred<Awaited<ReturnType<typeof harnessShellRead>>>();
	function harnessShellRead() {
		return createHarness().shellA.readBuffer({ mode: 'head' });
	}
	const harness = createHarness('ios');
	harness.shellA.readBuffer = () => read.promise;
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	const attaching = harness.core.attach();
	harness.setXterm(null);
	read.resolve(await harnessShellRead());
	await attaching;
	assert.deepEqual(harness.writes, []);
	assert.deepEqual(harness.shellA.listenerCursors, []);
	assert.equal(harness.calls.includes('focus'), false);

	const addId = deferred<bigint>();
	harness.setXterm(harness.xterm);
	harness.core.handleInitialized('instance-2');
	harness.shellA.addListener = () => addId.promise;
	const adding = harness.core.attach();
	await Promise.resolve();
	harness.setXterm({ ...harness.xterm });
	addId.resolve(91n);
	await adding;
	assert.deepEqual(harness.shellA.removedListenerIds, [91n]);
	assert.equal(harness.core.isAttached(), false);
	harness.shellA.addListener = () => 92n;
	await harness.core.attach();
	assert.equal(harness.core.isAttached(), true);
});

void test('listener keeps strict xterm identity until attachment ownership commits', async () => {
	const harness = createHarness();
	const listenerId = deferred<bigint>();
	let pendingListener:
		| Parameters<TerminalLifecycleShell['addListener']>[0]
		| undefined;
	harness.shellA.addListener = (listener, options) => {
		pendingListener = listener;
		harness.shellA.listenerCursors.push(options.cursor);
		return listenerId.promise;
	};
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	const attaching = harness.core.attach();
	await Promise.resolve();
	assert.ok(pendingListener);

	harness.setXterm({ ...harness.xterm });
	pendingListener({
		seq: 10n,
		tMs: 1,
		stream: 'stdout',
		bytes: new Uint8Array([6]).buffer,
	});
	assert.deepEqual(harness.core.getOutputDiagnostics()?.listener, {
		events: 0,
		bytes: 0,
		lastSeq: null,
		droppedEvents: 0,
	});

	listenerId.resolve(93n);
	await attaching;
	assert.deepEqual(harness.shellA.removedListenerIds, [93n]);
	assert.equal(harness.core.isAttached(), false);
});

void test('synchronous listener reentrancy cleans up the half-created owner', async () => {
	const harness = createHarness();
	harness.shellA.addListener = (listener) => {
		listener({
			seq: 10n,
			tMs: 1,
			stream: 'stdout',
			bytes: new Uint8Array([5]).buffer,
		});
		return 55n;
	};
	harness.xterm.write = () => harness.core.handleLoadStart();
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	assert.deepEqual(harness.shellA.removedListenerIds, [55n]);
	assert.equal(harness.core.isAttached(), false);
	assert.equal(harness.core.getSnapshot().ready, false);
});

void test('iOS focuses only after listener ownership is committed', async () => {
	const harness = createHarness('ios');
	let focusedWithListener = false;
	harness.xterm.focus = () => {
		focusedWithListener = harness.core.isAttached();
	};
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	assert.equal(focusedWithListener, true);
});

void test('duplicate attach requests share one listener attempt', async () => {
	const harness = createHarness();
	const lateId = deferred<bigint>();
	let addCalls = 0;
	harness.shellA.addListener = () => {
		addCalls += 1;
		return lateId.promise;
	};
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	const first = harness.core.attach();
	const duplicate = harness.core.attach();
	lateId.resolve(20n);
	await Promise.all([first, duplicate]);
	assert.equal(addCalls, 1);
});

void test('same-key shell replacement starts a new attach while the old owner is in flight', async () => {
	const harness = createHarness();
	const key = createShellTransportKey('connection-a', 7);
	const lateOldId = deferred<bigint>();
	harness.shellA.addListener = () => lateOldId.promise;
	harness.core.setShell(key, harness.shellA);
	harness.core.handleInitialized('instance-1');
	const oldAttach = harness.core.attach();
	await Promise.resolve();

	harness.core.setShell(key, harness.shellB);
	const newAttach = harness.core.attach();
	lateOldId.resolve(81n);
	await Promise.all([oldAttach, newAttach]);

	assert.equal(harness.core.isAttached(), true);
	assert.equal(harness.shellB.listenerCursors.length, 1);
	assert.deepEqual(harness.shellA.removedListenerIds, [81n]);
	assert.deepEqual(harness.shellB.removedListenerIds, []);
});

void test('same-instance reload starts a new attach while the old runtime attach is in flight', async () => {
	const harness = createHarness();
	const lateOldId = deferred<bigint>();
	let addCalls = 0;
	harness.shellA.addListener = (listener, options) => {
		addCalls += 1;
		harness.shellA.listenerCursors.push(options.cursor);
		if (addCalls === 1) return lateOldId.promise;
		harness.shellA.listeners.set(82n, listener);
		return 82n;
	};
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	const oldAttach = harness.core.attach();
	await Promise.resolve();

	harness.core.handleLoadStart();
	harness.core.handleInitialized('instance-1');
	const newAttach = harness.core.attach();
	lateOldId.resolve(83n);
	await Promise.all([oldAttach, newAttach]);

	assert.equal(addCalls, 2);
	assert.equal(harness.core.isAttached(), true);
	assert.deepEqual(harness.shellA.removedListenerIds, [83n]);
});

void test('dispose is idempotent and late completion cannot attach', async () => {
	const harness = createHarness();
	const lateId = deferred<bigint>();
	harness.shellA.addListener = () => lateId.promise;
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	const attaching = harness.core.attach();
	await Promise.resolve();
	harness.core.dispose();
	harness.core.dispose();
	lateId.resolve(77n);
	await attaching;
	assert.deepEqual(harness.shellA.removedListenerIds, [77n]);
	assert.equal(harness.core.isAttached(), false);
});
