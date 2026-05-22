import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { startSshJsonlListener } from '../../src/lib/ssh-jsonl-listener';

function bytes(text: string): ArrayBuffer {
	return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

type TestEvent = { bytes: ArrayBuffer; stream: 'stdout' | 'stderr' };
type TestListener = (event: TestEvent) => void;

function createTestConnection(options?: {
	sendData?: (data: ArrayBuffer) => Promise<void>;
	close?: () => Promise<void>;
}) {
	const sent: string[] = [];
	const removed: bigint[] = [];
	const startShellOptions: unknown[] = [];
	let listener: TestListener | null = null;
	let closed = 0;

	const shell = {
		channelId: 7,
		addListener: (cb: TestListener) => {
			listener = cb;
			return 99n;
		},
		removeListener: (id: bigint) => {
			removed.push(id);
		},
		sendData:
			options?.sendData ??
			(async (data: ArrayBuffer) => {
				sent.push(new TextDecoder().decode(data));
			}),
		close:
			options?.close ??
			(async () => {
				closed += 1;
			}),
	};

	const connection = {
		startShell: async (input: unknown) => {
			startShellOptions.push(input);
			return shell;
		},
	};

	return {
		connection,
		emit: (event: TestEvent) => listener?.(event),
		sent,
		removed,
		get closed() {
			return closed;
		},
		startShellOptions,
	};
}

void test('startSshJsonlListener opens non-tmux shell and sends command', async () => {
	const fixture = createTestConnection();
	const lines: string[] = [];

	const handle = await startSshJsonlListener({
		connection: fixture.connection as never,
		command: 'mdev tmux notifications listen --session main',
		onLine: (line) => lines.push(line),
		onExit: () => {},
	});

	assert.deepEqual(fixture.startShellOptions, [
		{ term: 'Xterm', useTmux: false, tmuxSessionName: '' },
	]);
	assert.deepEqual(fixture.sent, [
		'mdev tmux notifications listen --session main\n',
	]);

	await handle.stop();
});

void test('startSshJsonlListener splits stdout chunks and ignores blank lines', async () => {
	const fixture = createTestConnection();
	const lines: string[] = [];

	const handle = await startSshJsonlListener({
		connection: fixture.connection as never,
		command: 'listen',
		onLine: (line) => lines.push(line),
		onExit: () => {},
	});

	fixture.emit({ bytes: bytes('{"a":'), stream: 'stdout' });
	fixture.emit({ bytes: bytes('1}\r\n  \n{"b":2}\n  {"c"'), stream: 'stdout' });
	fixture.emit({ bytes: bytes(':3}\n'), stream: 'stdout' });
	fixture.emit({ bytes: bytes('{"ignored":true}\n'), stream: 'stderr' });

	assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);

	await handle.stop();
});

void test('startSshJsonlListener removes listener and closes shell on stop', async () => {
	const fixture = createTestConnection();
	const lines: string[] = [];

	const handle = await startSshJsonlListener({
		connection: fixture.connection as never,
		command: 'listen',
		onLine: (line) => lines.push(line),
		onExit: () => {},
	});

	await handle.stop();
	fixture.emit({ bytes: bytes('{"after":"stop"}\n'), stream: 'stdout' });

	assert.deepEqual(fixture.removed, [99n]);
	assert.equal(fixture.closed, 1);
	assert.deepEqual(lines, []);
});

void test('startSshJsonlListener reports send failures through onExit', async () => {
	const error = new Error('send failed');
	const warn = mock.method(console, 'warn', () => {});
	const fixture = createTestConnection({
		sendData: async () => {
			throw error;
		},
	});
	const exits: unknown[] = [];

	const handle = await startSshJsonlListener({
		connection: fixture.connection as never,
		command: 'listen',
		onLine: () => {},
		onExit: (exitError) => exits.push(exitError),
	});

	assert.deepEqual(exits, [error]);
	assert.equal(warn.mock.callCount(), 1);

	await handle.stop();
});

void test('startSshJsonlListener logs and ignores close failures on stop', async () => {
	const closeError = new Error('close failed');
	const warn = mock.method(console, 'warn', () => {});
	const fixture = createTestConnection({
		close: async () => {
			throw closeError;
		},
	});

	const handle = await startSshJsonlListener({
		connection: fixture.connection as never,
		command: 'listen',
		onLine: () => {},
		onExit: () => {},
	});

	await handle.stop();

	assert.deepEqual(fixture.removed, [99n]);
	assert.equal(warn.mock.callCount(), 1);
	assert.equal(warn.mock.calls[0]?.arguments[1], closeError);
});
