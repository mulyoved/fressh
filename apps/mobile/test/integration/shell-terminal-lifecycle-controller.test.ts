import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellTransportKey } from '../../src/lib/shell-controllers/source-keys';
import {
	createHarness,
	deferred,
} from './shell-terminal-lifecycle-controller-test-support';
void test('terminal lifecycle composes exact native, listener, and Xterm diagnostics without payloads', async () => {
	const harness = createHarness();
	harness.shellA.getNativeOutputDiagnostics = () => ({
		currentSeq: '9007199254740993',
		ringBytesCount: '1000',
		usedBytes: '20',
		headSeq: '4',
		tailSeq: '8',
		droppedBytesTotal: '0',
		chunksCount: '5',
	});
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	const listener = [...harness.shellA.listeners.values()][0];
	const sentinel = 'must-not-appear-in-diagnostics';
	listener?.({
		seq: 10n,
		tMs: 1,
		stream: 'stdout',
		bytes: new TextEncoder().encode(sentinel).buffer,
	});
	listener?.({ kind: 'dropped', fromSeq: 11n, toSeq: 12n });

	const snapshot = harness.core.getOutputDiagnostics();
	assert.deepEqual(snapshot, {
		connectionId: 'connection-a',
		channelId: 7,
		runtimeInstanceId: 'instance-1',
		native: {
			currentSeq: '9007199254740993',
			ringBytesCount: '1000',
			usedBytes: '20',
			headSeq: '4',
			tailSeq: '8',
			droppedBytesTotal: '0',
			chunksCount: '5',
		},
		listener: {
			events: 1,
			bytes: sentinel.length,
			lastSeq: '10',
			droppedEvents: 1,
		},
		xterm: harness.xterm.getOutputDiagnostics(),
	});
	assert.notEqual(harness.core.getOutputDiagnostics(), snapshot);
	assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(sentinel));
});

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

void test('terminal lifecycle publishes its current runtime instance', () => {
	const harness = createHarness();
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-owned');
	assert.equal(
		(harness.core.getSnapshot() as { runtimeInstanceId?: string | null })
			.runtimeInstanceId,
		'instance-owned',
	);
	harness.core.handleLoadStart();
	assert.equal(
		(harness.core.getSnapshot() as { runtimeInstanceId?: string | null })
			.runtimeInstanceId,
		null,
	);
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

void test('load start invalidates runtime before detach and readiness publication', async () => {
	const harness = createHarness();
	const order: string[] = [];
	harness.transportCalls.push = ((value: string) => {
		order.push(`transport:${value}`);
		return 0;
	}) as typeof harness.transportCalls.push;
	harness.shellA.removeListener = () => {
		order.push('detach');
	};
	harness.core.subscribe(() => {
		order.push(`ready:${harness.core.getSnapshot().ready}`);
	});
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	order.length = 0;
	harness.core.handleLoadStart();
	assert.deepEqual(order.slice(0, 3), [
		'transport:clear',
		'detach',
		'ready:false',
	]);
	assert.equal(harness.core.getRuntimeKey(), null);
});

void test('runtime publications cover init-before-shell, shell keys, and load start', () => {
	const harness = createHarness();
	harness.core.handleInitialized('instance-1');
	const keyA = createShellTransportKey('connection-a', 7);
	const keyB = createShellTransportKey('connection-b', 8);
	harness.core.setShell(keyA, harness.shellA);
	harness.core.setShell(keyB, harness.shellB);
	harness.core.handleLoadStart();
	assert.deepEqual(harness.runtimeChanges, [
		{ runtimeKey: null, instanceId: 'instance-1' },
		{
			runtimeKey: JSON.stringify([keyA, 'instance-1']),
			instanceId: 'instance-1',
		},
		{
			runtimeKey: JSON.stringify([keyB, 'instance-1']),
			instanceId: 'instance-1',
		},
		{ runtimeKey: null, instanceId: null },
	]);
});

void test('ready lifecycle attaches across null-to-key and same-shell key replacement', async () => {
	const harness = createHarness();
	harness.core.setShell(null, harness.shellA);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	assert.equal(harness.shellA.listenerCursors.length, 0);

	const keyA = createShellTransportKey('connection-a', 7);
	harness.core.setShell(keyA, harness.shellA);
	await harness.core.attach();
	assert.equal(harness.shellA.listenerCursors.length, 1);
	assert.equal(harness.core.isAttached(), true);

	const keyB = createShellTransportKey('connection-b', 8);
	harness.core.setShell(keyB, harness.shellA);
	await harness.core.attach();
	assert.equal(harness.shellA.listenerCursors.length, 2);
	assert.deepEqual(harness.shellA.removedListenerIds, [1n]);
	assert.equal(harness.core.isAttached(), true);
});

void test('load-start clears old transport before reentrant removal logging initializes a new runtime', async () => {
	let transportWasCleared = false;
	let harness!: ReturnType<typeof createHarness>;
	harness = createHarness('android', {
		onTransportClear: () => {
			transportWasCleared = true;
		},
		onWarn: (message) => {
			if (message === 'Failed to remove prior shell listener') {
				harness.core.handleInitialized('instance-2');
			}
		},
	});
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	harness.shellA.removeListener = () => {
		assert.equal(transportWasCleared, true);
		throw new Error('remove failed');
	};
	harness.core.handleLoadStart();
	assert.equal(harness.core.getRuntimeInstanceId(), 'instance-2');
	assert.equal(harness.core.getSnapshot().ready, true);
	assert.equal(harness.transportCalls.at(-1), 'set:instance-2');
});

void test('throwing transport clear still detaches the old listener and publishes not-ready', async () => {
	const error = new Error('clear runtime failed');
	const harness = createHarness('android', {
		onTransportClear: () => {
			throw error;
		},
	});
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	assert.throws(() => harness.core.handleLoadStart(), error);
	assert.deepEqual(harness.shellA.removedListenerIds, [1n]);
	assert.equal(harness.core.isAttached(), false);
	assert.equal(harness.core.getSnapshot().ready, false);
});
