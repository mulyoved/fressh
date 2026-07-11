import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createShellTransportKey } from '../../src/lib/shell-controllers/source-keys';
import {
	createTerminalLifecycleController,
	type TerminalLifecycleShell,
} from '../../src/lib/shell-controllers/terminal-lifecycle-core';

type Deferred<T> = {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
};

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function createHarness(
	platformOS: 'android' | 'ios' = 'android',
	logHooks: {
		onInfo?(message: string): void;
		onWarn?(message: string): void;
	} = {},
) {
	const writes: number[][][] = [];
	const calls: string[] = [];
	const runtimeChanges: (string | null)[] = [];
	const transportCalls: string[] = [];
	const sizeCalls: string[] = [];
	let systemKeyboardEnabled = platformOS === 'android';
	let selectionModeEnabled = false;
	let nextListenerId = 1n;
	type TestShell = TerminalLifecycleShell & {
		readModes: string[];
		listenerCursors: unknown[];
		removedListenerIds: bigint[];
		listeners: Map<
			bigint,
			Parameters<TerminalLifecycleShell['addListener']>[0]
		>;
	};

	const createShell = (connectionId: string, channelId: number) => {
		const shell: TestShell = {
			connectionId,
			channelId,
			readModes: [] as string[],
			listenerCursors: [] as unknown[],
			removedListenerIds: [] as bigint[],
			listeners: new Map(),
			readBuffer(cursor: { mode: string }) {
				this.readModes.push(cursor.mode);
				return {
					chunks: [
						{
							seq: 1n,
							tMs: 1,
							stream: 'stdout' as const,
							bytes: new Uint8Array([1, 2]).buffer,
						},
					],
					nextSeq: 9n,
				};
			},
			addListener(
				listener: Parameters<TerminalLifecycleShell['addListener']>[0],
				options: Parameters<TerminalLifecycleShell['addListener']>[1],
			) {
				const id = nextListenerId++;
				this.listenerCursors.push(options.cursor);
				this.listeners.set(id, listener);
				return id;
			},
			removeListener(id: bigint) {
				this.removedListenerIds.push(id);
				this.listeners.delete(id);
			},
		};
		return shell;
	};

	const xterm = {
		write: (bytes: Uint8Array) => {
			calls.push(`write:${Array.from(bytes)}`);
		},
		writeMany: (chunks: Uint8Array[]) => {
			writes.push(chunks.map((chunk) => Array.from(chunk)));
		},
		flush: () => {
			calls.push('flush');
		},
		focus: () => {
			calls.push('focus');
		},
		setSystemKeyboardEnabled: (enabled: boolean) => {
			calls.push(`keyboard:${enabled}`);
		},
		setSelectionModeEnabled: (enabled: boolean) => {
			calls.push(`selection:${enabled}`);
		},
	};
	const transport = {
		setRuntimeInstance: (id: string) => transportCalls.push(`set:${id}`),
		clearRuntime: () => transportCalls.push('clear'),
		invalidate: (reason: string) => transportCalls.push(`invalidate:${reason}`),
	};
	const size = {
		invalidate: (reason: string) => sizeCalls.push(`invalidate:${reason}`),
	};
	const core = createTerminalLifecycleController({
		getXterm: () => xterm,
		transport,
		size,
		platformOS,
		logger: {
			info: (message) => {
				calls.push(`info:${message}`);
				logHooks.onInfo?.(message);
			},
			warn: (message) => {
				calls.push(`warn:${message}`);
				logHooks.onWarn?.(message);
			},
		},
		onRuntimeChanged: (runtimeKey) => runtimeChanges.push(runtimeKey),
	});
	const shellA = createShell('connection-a', 7);
	const shellB = createShell('connection-b', 8);
	return {
		core,
		shellA,
		shellB,
		xterm,
		writes,
		calls,
		runtimeChanges,
		transportCalls,
		sizeCalls,
		setModes(system: boolean, selection: boolean) {
			systemKeyboardEnabled = system;
			selectionModeEnabled = selection;
			core.setViewModes({ systemKeyboardEnabled, selectionModeEnabled });
		},
	};
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
	assert.equal(harness.runtimeChanges[0], harness.core.getRuntimeKey());
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
	assert.deepEqual(harness.runtimeChanges, []);
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
	for (const command of [
		'fit',
		'setSystemKeyboardEnabled',
		'setSelectionModeEnabled',
		'getSelection',
		'exitScrollback',
		'sendScrollbackEnterAck',
	]) {
		assert.match(source, new RegExp(`\\b${command}\\b`));
	}
});
