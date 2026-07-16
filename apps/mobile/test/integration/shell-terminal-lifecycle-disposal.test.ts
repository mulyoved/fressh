import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellTransportKey } from '../../src/lib/shell-controllers/source-keys';
import {
	createTerminalLifecycleController,
	type TerminalLifecycleShell,
} from '../../src/lib/shell-controllers/terminal-lifecycle-core';
import { createShellTerminalTransport } from '../../src/lib/shell-controllers/terminal-transport';
import {
	createHarness,
	deferred,
} from './shell-terminal-lifecycle-controller-test-support';

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

void test('dispose finishes listener, publisher, transport, and runtime publication cleanup when size throws', async () => {
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
		readBuffer: () => ({ chunks: [], nextSeq: 1n }),
		addListener: () => 1n,
		removeListener: () => {
			order.push('listener:remove');
			throw new Error('remove failed');
		},
	};
	const xterm = {
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
