import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellTransportKey } from '../../src/lib/shell-controllers/source-keys';
import {
	createHarness,
	deferred,
} from './shell-terminal-lifecycle-controller-test-support';
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

void test('runtime publication reentrancy cannot let stale initialization win', () => {
	let harness!: ReturnType<typeof createHarness>;
	harness = createHarness('android', {
		onRuntimeChanged: (runtimeKey, instanceId) => {
			if (runtimeKey && instanceId === 'instance-1') {
				harness.core.handleLoadStart();
			}
		},
	});
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	assert.deepEqual(
		harness.runtimeChanges.map(({ instanceId }) => instanceId),
		['instance-1', null],
	);
	assert.equal(harness.core.getSnapshot().ready, false);
	assert.equal(harness.core.getRuntimeKey(), null);
});

void test('throwing runtime subscribers surface only after ownership is consistent', async () => {
	const error = new Error('runtime callback failed');
	const harness = createHarness('android', {
		onRuntimeChanged: () => {
			throw error;
		},
	});
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	assert.throws(() => harness.core.handleInitialized('instance-1'), error);
	assert.equal(harness.core.getSnapshot().ready, true);
	await harness.core.attach();
	assert.equal(harness.core.isAttached(), true);
	assert.throws(() => harness.core.handleLoadStart(), error);
	assert.equal(harness.core.getSnapshot().ready, false);
	assert.equal(harness.core.isAttached(), false);
	assert.deepEqual(harness.shellA.removedListenerIds, [1n]);
	assert.ok(harness.sizeCalls.includes('invalidate:runtime-reset'));
});

void test('repeated invalidation and disposal notify the null runtime transition once', () => {
	const harness = createHarness();
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	harness.core.handleLoadStart();
	harness.core.invalidate('runtime-reset');
	harness.core.dispose();
	assert.equal(
		harness.runtimeChanges.filter(
			({ runtimeKey, instanceId }) =>
				runtimeKey === null && instanceId === null,
		).length,
		1,
	);
});

void test('throwing size invalidation cannot prevent load-start ownership cleanup', async () => {
	const error = new Error('size subscriber failed');
	const harness = createHarness('android', {
		onSizeInvalidate: () => {
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
	assert.equal(harness.core.getSnapshot().ready, false);
	assert.equal(harness.core.getRuntimeKey(), null);
	assert.equal(harness.core.isAttached(), false);
	assert.deepEqual(harness.shellA.removedListenerIds, [1n]);
	assert.deepEqual(harness.transportCalls.at(-1), 'clear');
	assert.deepEqual(harness.runtimeChanges.at(-1), {
		runtimeKey: null,
		instanceId: null,
	});
});

void test('reentrant size invalidation preserves the newer initialized runtime', () => {
	let harness!: ReturnType<typeof createHarness>;
	let reentered = false;
	harness = createHarness('android', {
		onSizeInvalidate: () => {
			if (reentered) return;
			reentered = true;
			harness.core.handleInitialized('instance-2');
		},
	});
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	harness.core.invalidate('runtime-reset');
	assert.equal(harness.core.getSnapshot().ready, true);
	assert.equal(harness.core.getRuntimeInstanceId(), 'instance-2');
	assert.equal(harness.runtimeChanges.at(-1)?.instanceId, 'instance-2');
});

void test('initialization publishes runtime state and applies current view modes on attach', async () => {
	const harness = createHarness();
	harness.setModes(false, true);
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	assert.deepEqual(harness.transportCalls, ['set:instance-1']);
	assert.equal(harness.core.getSnapshot().ready, true);
	assert.equal(harness.core.getSnapshot().hasRendered, true);
	assert.equal(harness.runtimeChanges.length, 1);
	assert.deepEqual(harness.runtimeChanges[0], {
		runtimeKey: harness.core.getRuntimeKey(),
		instanceId: 'instance-1',
	});
	assert.ok(harness.calls.includes('keyboard:false'));
	assert.ok(harness.calls.includes('selection:true'));
});

void test('reentrant readiness publication cannot resurrect an invalidated runtime', () => {
	const harness = createHarness();
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	const unsubscribe = harness.core.subscribe(() => {
		if (harness.core.getSnapshot().ready) harness.core.handleLoadStart();
	});
	harness.core.handleInitialized('instance-1');
	unsubscribe();
	assert.equal(harness.core.getSnapshot().ready, false);
	assert.equal(harness.core.getRuntimeKey(), null);
	assert.deepEqual(harness.runtimeChanges, [
		{
			runtimeKey: JSON.stringify([
				createShellTransportKey('connection-a', 7),
				'instance-1',
			]),
			instanceId: 'instance-1',
		},
		{ runtimeKey: null, instanceId: null },
	]);
});

void test('throwing publication still commits initialization before surfacing the error', async () => {
	const harness = createHarness();
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	const error = new Error('subscriber failed');
	const unsubscribe = harness.core.subscribe(() => {
		throw error;
	});
	assert.throws(() => harness.core.handleInitialized('instance-1'), error);
	unsubscribe();
	assert.equal(harness.core.getSnapshot().ready, true);
	assert.equal(harness.runtimeChanges.length, 1);
	await harness.core.attach();
	assert.equal(harness.core.isAttached(), true);
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

void test('platform defaults apply Android keyboard on and iOS keyboard off', async () => {
	const android = createHarness('android');
	android.core.setShell(
		createShellTransportKey('connection-a', 7),
		android.shellA,
	);
	android.core.handleInitialized('android-instance');
	await android.core.attach();
	assert.ok(android.calls.includes('keyboard:true'));

	const ios = createHarness('ios');
	ios.core.setShell(createShellTransportKey('connection-b', 8), ios.shellB);
	ios.core.handleInitialized('ios-instance');
	await ios.core.attach();
	assert.ok(ios.calls.includes('keyboard:false'));
});

void test('listener writes output and contains dropped-event logger errors', async () => {
	const harness = createHarness();
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	const listener = harness.shellA.listeners.get(1n);
	assert.ok(listener);
	assert.doesNotThrow(() =>
		listener({ kind: 'dropped', fromSeq: 1n, toSeq: 2n }),
	);
	listener({
		seq: 2n,
		tMs: 2,
		stream: 'stdout',
		bytes: new Uint8Array([8]).buffer,
	});
	assert.ok(harness.calls.includes('write:8'));
});

void test('head-read logging invalidation suppresses stale replay and listener creation', async () => {
	let harness!: ReturnType<typeof createHarness>;
	harness = createHarness('android', {
		onInfo: (message) => {
			if (message === 'readBuffer(head)') harness.core.handleLoadStart();
		},
	});
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	assert.deepEqual(harness.writes, []);
	assert.deepEqual(harness.shellA.listenerCursors, []);
	assert.equal(harness.core.isAttached(), false);
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

void test('throwing loggers stay contained across attach, events, focus, and removal', async () => {
	const harness = createHarness('ios', {
		onInfo: () => {
			throw new Error('info failed');
		},
		onWarn: () => {
			throw new Error('warn failed');
		},
	});
	harness.xterm.focus = () => {
		throw new Error('focus failed');
	};
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await assert.doesNotReject(harness.core.attach());
	const listener = harness.shellA.listeners.get(1n);
	assert.ok(listener);
	assert.doesNotThrow(() =>
		listener({ kind: 'dropped', fromSeq: 1n, toSeq: 2n }),
	);
	harness.xterm.write = () => {
		throw new Error('write failed');
	};
	assert.doesNotThrow(() =>
		listener({
			seq: 2n,
			tMs: 2,
			stream: 'stdout',
			bytes: new Uint8Array([1]).buffer,
		}),
	);
	harness.shellA.removeListener = () => {
		throw new Error('remove failed');
	};
	assert.doesNotThrow(() => harness.core.detach());
	assert.equal(harness.core.isAttached(), false);
});

void test('removal logger reentrancy keeps the newer shell and initialization authoritative', async () => {
	let harness!: ReturnType<typeof createHarness>;
	let reentered = false;
	harness = createHarness('android', {
		onWarn: (message) => {
			if (message !== 'Failed to remove prior shell listener' || reentered)
				return;
			reentered = true;
			harness.core.handleInitialized('instance-2');
		},
	});
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	harness.shellA.removeListener = () => {
		throw new Error('remove failed');
	};
	const keyB = createShellTransportKey('connection-b', 8);
	harness.core.setShell(keyB, harness.shellB);
	await harness.core.attach();
	assert.equal(harness.core.getRuntimeInstanceId(), 'instance-2');
	assert.equal(
		harness.core.getRuntimeKey(),
		JSON.stringify([keyB, 'instance-2']),
	);
	assert.equal(harness.shellB.listenerCursors.length, 1);
});
