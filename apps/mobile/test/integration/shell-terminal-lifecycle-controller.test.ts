import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createShellTransportKey } from '../../src/lib/shell-controllers/source-keys';
import {
	createTerminalLifecycleController,
	type TerminalLifecycleShell,
} from '../../src/lib/shell-controllers/terminal-lifecycle-core';
import { createShellTerminalTransport } from '../../src/lib/shell-controllers/terminal-transport';
import {
	createHarness,
} from './shell-terminal-lifecycle-test-harness';

void test('terminal lifecycle snapshots native, listener, and xterm output progress without payloads', async () => {
	const harness = createHarness();
	const exactCurrentSeq = 9_007_199_254_740_993n;
	harness.shellA.bufferStats = () => ({
		ringBytesCount: 1_000n,
		usedBytes: 20n,
		headSeq: 4n,
		tailSeq: 8n,
		droppedBytesTotal: 0n,
		chunksCount: 5n,
	});
	harness.shellA.currentSeq = () => exactCurrentSeq;
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	const listener = harness.shellA.listeners.get(1n);
	assert.ok(listener);
	listener({
		seq: 8n,
		tMs: 1,
		stream: 'stdout',
		bytes: new Uint8Array([1, 2]).buffer,
	});
	listener({
		seq: 9n,
		tMs: 2,
		stream: 'stdout',
		bytes: new Uint8Array([3]).buffer,
	});

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
		listener: { events: 2, bytes: 3, lastSeq: '9', droppedEvents: 0 },
		xterm: harness.xterm.getOutputDiagnostics(),
	});
	assert.deepEqual(harness.core.getOutputDiagnostics(), snapshot);
	assert.notEqual(harness.core.getOutputDiagnostics(), snapshot);
});

void test('terminal lifecycle resets listener progress only with the runtime revision and never serializes event bytes', async () => {
	const harness = createHarness();
	const keyA = createShellTransportKey('connection-a', 7);
	harness.core.setShell(keyA, harness.shellA);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	const listener = harness.shellA.listeners.get(1n);
	assert.ok(listener);
	const sentinel = 'DO_NOT_LOG_TERMINAL_PAYLOAD_4f9d';
	listener({
		seq: 10n,
		tMs: 1,
		stream: 'stdout',
		bytes: new TextEncoder().encode(sentinel).buffer,
	});
	listener({ kind: 'dropped', fromSeq: 11n, toSeq: 12n });
	assert.deepEqual(harness.core.getOutputDiagnostics()?.listener, {
		events: 1,
		bytes: sentinel.length,
		lastSeq: '10',
		droppedEvents: 1,
	});
	assert.doesNotMatch(
		JSON.stringify(harness.core.getOutputDiagnostics()),
		new RegExp(sentinel),
	);

	harness.core.setShell(keyA, harness.shellA);
	assert.equal(harness.core.getOutputDiagnostics()?.listener.events, 1);
	harness.core.setShell(
		createShellTransportKey('connection-b', 8),
		harness.shellB,
	);
	harness.core.handleInitialized('instance-2');
	await harness.core.attach();
	assert.deepEqual(harness.core.getOutputDiagnostics()?.listener, {
		events: 0,
		bytes: 0,
		lastSeq: null,
		droppedEvents: 0,
	});
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

void test('runtime notifications cover init-before-shell, shell keys, and load start', () => {
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

void test('runtime notification reentrancy cannot let stale initialization win', () => {
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

void test('throwing runtime notifications surface only after ownership is consistent', async () => {
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

void test('same transport key avoids rebuild while owner replacement detaches safely', async () => {
	const harness = createHarness();
	const key = createShellTransportKey('connection-a', 7);
	harness.core.setShell(key, harness.shellA);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	harness.core.setShell(key, harness.shellA);
	assert.deepEqual(harness.shellA.removedListenerIds, []);

	const replacement = {
		...harness.shellA,
		removedListenerIds: [] as bigint[],
		removeListener(id: bigint) {
			this.removedListenerIds.push(id);
		},
	};
	harness.core.setShell(key, replacement);
	assert.deepEqual(harness.shellA.removedListenerIds, [1n]);
	await harness.core.attach();
	assert.deepEqual(replacement.listenerCursors.at(-1), { mode: 'live' });
});

void test('dispose finishes listener, publisher, transport, and runtime notification cleanup when size throws', async () => {
	const error = new Error('dispose size failed');
	const harness = createHarness('android', {
		onSizeInvalidate: () => {
			throw error;
		},
	});
	let publications = 0;
	harness.core.subscribe(() => {
		publications += 1;
	});
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	assert.throws(() => harness.core.dispose(), error);
	assert.equal(harness.core.isAttached(), false);
	assert.deepEqual(harness.shellA.removedListenerIds, [1n]);
	assert.equal(harness.transportCalls.at(-1), 'clear');
	assert.deepEqual(harness.runtimeChanges.at(-1), {
		runtimeKey: null,
		instanceId: null,
	});
	const publicationsAfterDispose = publications;
	harness.core.setShell(null, null);
	assert.equal(publications, publicationsAfterDispose);
});

void test('dispose stales the real transport lease before removal warning can send', async () => {
	const writes: number[][] = [];
	const order: string[] = [];
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	const key = createShellTransportKey('connection-a', 7);
	transport.setShell(key, async (bytes) => {
		writes.push(Array.from(bytes));
	});
	const lifecycleTransport = {
		...transport,
		clearRuntime: () => {
			order.push('transport:clear');
			transport.clearRuntime();
		},
	};
	let attemptedSend: Promise<void> | null = null;
	let sendCapturedLease: (() => Promise<void>) | null = null;
	const shell: TerminalLifecycleShell = {
		connectionId: 'connection-a',
		channelId: 7,
		bufferStats: () => ({
			ringBytesCount: 0n,
			usedBytes: 0n,
			headSeq: 0n,
			tailSeq: 0n,
			droppedBytesTotal: 0n,
			chunksCount: 0n,
		}),
		currentSeq: () => 0n,
		readBuffer: () => ({ chunks: [], nextSeq: 1n }),
		addListener: () => 1n,
		removeListener: () => {
			order.push('listener:remove');
			throw new Error('remove failed');
		},
	};
	const xterm = {
		getOutputDiagnostics: () => ({
			webViewInstanceId: null,
			rnQueuedMessages: 0,
			rnQueuedBytes: 0,
			rnFlushes: 0,
			rnSentMessages: 0,
			rnSentBytes: 0,
			webViewReceivedMessages: 0,
			webViewReceivedBytes: 0,
			webViewCompletedWrites: 0,
		}),
		write: () => {},
		writeMany: () => {},
		flush: () => {},
		focus: () => {},
		setSystemKeyboardEnabled: () => {},
		setSelectionModeEnabled: () => {},
	};
	const core = createTerminalLifecycleController({
		getXterm: () => xterm,
		transport: lifecycleTransport,
		size: { invalidate: () => order.push('size:invalidate') },
		platformOS: 'android',
		logger: {
			info: () => {},
			warn: (message) => {
				if (message !== 'Failed to remove prior shell listener') return;
				assert.ok(sendCapturedLease);
				attemptedSend = sendCapturedLease();
			},
		},
		onRuntimeChanged: () => {},
	});
	core.setShell(key, shell);
	core.handleInitialized('instance-1');
	await core.attach();
	assert.equal(core.isAttached(), true);
	const preDisposeLease = transport.captureLease();
	assert.ok(preDisposeLease);
	sendCapturedLease = () =>
		transport.sendBatch(preDisposeLease, [new Uint8Array([1])]);
	core.dispose();
	if (attemptedSend) await attemptedSend;
	assert.deepEqual(order.slice(0, 2), ['transport:clear', 'listener:remove']);
	assert.deepEqual(writes, []);
});

void test('terminal hook publishes the exact controller ports and guarded xterm commands', () => {
	const source = readFileSync(
		join(process.cwd(), 'src/lib/shell-controllers/terminal.tsx'),
		'utf8',
	);
	for (const member of [
		'xtermRef',
		'ready',
		'hasRendered',
		'runtimeKey',
		'lastSize',
		'transport',
		'view',
		'onLoadStart',
		'onInitialized',
		'onResize',
		'waitForSizeAfterFit',
		'retry',
	]) {
		assert.match(source, new RegExp(`\\b${member}\\b`));
	}
	assert.match(source, /createShellTerminalHookRuntime/);
	assert.match(source, /view: runtime\.view/);
	assert.match(
		source,
		/\[lifecycleState\.ready, runtime, shell, transportKey\]/,
	);
});
