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
		'getLastSize',
		'runtimeInstanceId',
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
	assert.match(source, /\[lifecycleState\.ready, runtime, source\]/);
});
