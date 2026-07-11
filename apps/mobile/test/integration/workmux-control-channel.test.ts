import assert from 'node:assert/strict';
import test from 'node:test';
import { type ConnectionDiagnosticEvent } from '../../src/lib/connection-diagnostics';
import {
	type MdevBridgeClient,
	type MdevBridgeDisposeOptions,
	type MdevBridgeStreamEvent,
} from '../../src/lib/mdev-bridge-client';
import { WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS } from '../../src/lib/workmux-bridge-operations';
import {
	createWorkmuxControlChannel,
	disposeWorkmuxControlChannelAfterCleanup,
	reportWorkmuxScrollbackCleanupTeardownError,
	WorkmuxControlChannelCleanupTimeoutError,
	type WorkmuxControlConnection,
	type WorkmuxControlCommandResult,
} from '../../src/lib/workmux-control-channel';

function bytes(text: string): ArrayBuffer {
	return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function text(bytes: ArrayBuffer): string {
	return new TextDecoder().decode(bytes);
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function createFakeConnection(): WorkmuxControlConnection {
	return {
		startCommandStream: async () => {
			throw new Error('Default bridge client should not be used');
		},
		startShell: async () => ({
			channelId: 1,
			sendData: async () => {},
			close: async () => {},
		}),
	};
}

function createRecordingBridgeClient(
	result: WorkmuxControlCommandResult = { success: true, output: 'ok\n' },
) {
	const calls: {
		operation: string;
		params: Record<string, unknown>;
		timeoutMs?: number;
	}[] = [];
	const prepareDisposeOptions: (MdevBridgeDisposeOptions | undefined)[] = [];
	const disposeOptions: (MdevBridgeDisposeOptions | undefined)[] = [];
	let disposeCount = 0;
	const bridgeClient: MdevBridgeClient = {
		runOperation: async (input) => {
			calls.push(input);
			return result;
		},
		prepareDispose: (opts) => {
			prepareDisposeOptions.push(opts);
		},
		dispose: async (opts) => {
			disposeOptions.push(opts);
			disposeCount += 1;
		},
	};
	return {
		bridgeClient,
		calls,
		prepareDisposeOptions,
		disposeOptions,
		getDisposeCount: () => disposeCount,
	};
}

function createSequencedBridgeClient(results: WorkmuxControlCommandResult[]) {
	const calls: {
		operation: string;
		params: Record<string, unknown>;
		timeoutMs?: number;
	}[] = [];
	const prepareDisposeOptions: (MdevBridgeDisposeOptions | undefined)[] = [];
	const disposeOptions: (MdevBridgeDisposeOptions | undefined)[] = [];
	let disposeCount = 0;
	const bridgeClient: MdevBridgeClient = {
		runOperation: async (input) => {
			calls.push(input);
			return (
				results.shift() ?? {
					success: false,
					output: '',
					error: 'Unexpected bridge call',
				}
			);
		},
		prepareDispose: (opts) => {
			prepareDisposeOptions.push(opts);
		},
		dispose: async (opts) => {
			disposeOptions.push(opts);
			disposeCount += 1;
		},
	};
	return {
		bridgeClient,
		calls,
		prepareDisposeOptions,
		disposeOptions,
		getDisposeCount: () => disposeCount,
	};
}

void test('WorkmuxControlChannel.command routes mapped argv through bridge operations, preserving timeout', async () => {
	const bridge = createRecordingBridgeClient();
	const channel = createWorkmuxControlChannel({
		connection: createFakeConnection(),
		bridgeClient: bridge.bridgeClient,
	});

	const result = await channel.command(
		['tmux', 'app', 'nav', 'next-all', '--session', 'main'],
		{ timeoutMs: 1234 },
	);

	assert.deepEqual(result, { success: true, output: 'ok\n' });
	assert.deepEqual(bridge.calls, [
		{
			operation: 'tmux.app.nav',
			params: { action: 'next-all', session: 'main' },
			timeoutMs: 1234,
		},
	]);
});

void test('WorkmuxControlChannel.command routes scoped nav argv through bridge operations, preserving timeout', async () => {
	const bridge = createRecordingBridgeClient();
	const channel = createWorkmuxControlChannel({
		connection: createFakeConnection(),
		bridgeClient: bridge.bridgeClient,
	});

	const result = await channel.command(
		['tmux', 'app', 'nav', 'next', '--session', 'main', '--scope', 'visible'],
		{ timeoutMs: 1234 },
	);

	assert.deepEqual(result, { success: true, output: 'ok\n' });
	assert.deepEqual(bridge.calls, [
		{
			operation: 'tmux.app.nav',
			params: { action: 'next', session: 'main', scope: 'visible' },
			timeoutMs: 1234,
		},
	]);
});

void test('workmux command exposes disposed-by-reconnect bridge classification', async () => {
	const channel = createWorkmuxControlChannel({
		connection: createFakeConnection(),
		bridgeClient: {
			runOperation: async () => ({
				success: false,
				output: '',
				error: 'mdev bridge stream closed.',
				failureClass: 'disposedByReconnect',
			}),
			prepareDispose: () => {},
			dispose: async () => undefined,
		},
	});

	const result = await channel.command([
		'tmux',
		'app',
		'nav',
		'next',
		'--session',
		'main',
	]);

	assert.equal(result.success, false);
	assert.equal(result.error, 'mdev bridge stream closed.');
	assert.equal(result.failureClass, 'disposedByReconnect');
});

void test('WorkmuxControlChannel.command retries scoped nav without scope for older bridges', async () => {
	const bridge = createSequencedBridgeClient([
		{ success: false, output: '', error: 'Unrecognized key: "scope"' },
		{ success: true, output: 'ok\n' },
	]);
	const channel = createWorkmuxControlChannel({
		connection: createFakeConnection(),
		bridgeClient: bridge.bridgeClient,
	});

	const result = await channel.command(
		['tmux', 'app', 'nav', 'next', '--session', 'main', '--scope', 'visible'],
		{ timeoutMs: 1234 },
	);

	assert.deepEqual(result, { success: true, output: 'ok\n' });
	assert.deepEqual(bridge.calls, [
		{
			operation: 'tmux.app.nav',
			params: { action: 'next', session: 'main', scope: 'visible' },
			timeoutMs: 1234,
		},
		{
			operation: 'tmux.app.nav',
			params: { action: 'next', session: 'main' },
			timeoutMs: 1234,
		},
	]);
});

void test('WorkmuxControlChannel.command retries all-scope nav as legacy all-window nav for older bridges', async () => {
	const bridge = createSequencedBridgeClient([
		{ success: false, output: '', error: 'Unrecognized key: "scope"' },
		{ success: true, output: 'ok\n' },
	]);
	const channel = createWorkmuxControlChannel({
		connection: createFakeConnection(),
		bridgeClient: bridge.bridgeClient,
	});

	const result = await channel.command(
		['tmux', 'app', 'nav', 'prev', '--session', 'main', '--scope', 'all'],
		{ timeoutMs: 1234 },
	);

	assert.deepEqual(result, { success: true, output: 'ok\n' });
	assert.deepEqual(bridge.calls, [
		{
			operation: 'tmux.app.nav',
			params: { action: 'prev', session: 'main', scope: 'all' },
			timeoutMs: 1234,
		},
		{
			operation: 'tmux.app.nav',
			params: { action: 'prev-all', session: 'main' },
			timeoutMs: 1234,
		},
	]);
});

void test('WorkmuxControlChannel.command uses default bridge timeout', async () => {
	const bridge = createRecordingBridgeClient();
	const channel = createWorkmuxControlChannel({
		connection: createFakeConnection(),
		bridgeClient: bridge.bridgeClient,
	});

	await channel.command(['tmux', 'nav', 'cycle', 'main:']);

	assert.deepEqual(bridge.calls, [
		{
			operation: 'tmux.nav',
			params: { action: 'cycle', target: 'main:' },
			timeoutMs: 10_000,
		},
	]);
});

void test('WorkmuxControlChannel.command rejects missing connection locally without default bridge', async () => {
	const bridge = createRecordingBridgeClient();
	const channel = createWorkmuxControlChannel({
		connection: null,
		bridgeClient: bridge.bridgeClient,
		directTmuxTransport: {
			send: async () => {
				throw new Error('DirectMux transport should not be used');
			},
			dispose: async () => {},
		},
	});

	assert.deepEqual(
		await channel.command(['tmux', 'app', 'nav', 'next', '--session', 'main']),
		{
			success: false,
			output: '',
			error: 'No SSH connection available.',
		},
	);
	assert.deepEqual(bridge.calls, []);
});

void test('WorkmuxControlChannel.operation routes structured bridge operations, preserving timeout', async () => {
	const bridge = createRecordingBridgeClient();
	const channel = createWorkmuxControlChannel({
		connection: createFakeConnection(),
		bridgeClient: bridge.bridgeClient,
	});

	const result = await channel.operation(
		{ operation: 'codex.restart', params: { target: 'main:@12' } },
		{ timeoutMs: 4321 },
	);

	assert.deepEqual(result, { success: true, output: 'ok\n' });
	assert.deepEqual(bridge.calls, [
		{
			operation: 'codex.restart',
			params: { target: 'main:@12' },
			timeoutMs: 4321,
		},
	]);
});

void test('WorkmuxControlChannel.operation uses default bridge timeout', async () => {
	const bridge = createRecordingBridgeClient();
	const channel = createWorkmuxControlChannel({
		connection: createFakeConnection(),
		bridgeClient: bridge.bridgeClient,
	});

	await channel.operation({
		operation: 'codex.restart',
		params: { target: 'main:@12' },
	});

	assert.deepEqual(bridge.calls, [
		{
			operation: 'codex.restart',
			params: { target: 'main:@12' },
			timeoutMs: 10_000,
		},
	]);
});

void test('WorkmuxControlChannel.operation rejects missing connection locally', async () => {
	const bridge = createRecordingBridgeClient();
	const channel = createWorkmuxControlChannel({
		connection: null,
		bridgeClient: bridge.bridgeClient,
		directTmuxTransport: {
			send: async () => {
				throw new Error('DirectMux transport should not be used');
			},
			dispose: async () => {},
		},
	});

	assert.deepEqual(
		await channel.operation({
			operation: 'codex.restart',
			params: { target: 'main:@12' },
		}),
		{
			success: false,
			output: '',
			error: 'No SSH connection available.',
		},
	);
	assert.deepEqual(bridge.calls, []);
});

void test('WorkmuxControlChannel.command rejects unsupported argv locally without bridge', async () => {
	const bridge = createRecordingBridgeClient();
	const channel = createWorkmuxControlChannel({
		connection: createFakeConnection(),
		bridgeClient: bridge.bridgeClient,
	});

	const result = await channel.command([
		'tmux',
		'app',
		'scroll',
		'line-down',
		'--session',
		'main',
	]);

	assert.equal(result.success, false);
	assert.equal(result.output, '');
	assert.match(result.error ?? '', /Unsupported Workmux bridge command/);
	assert.deepEqual(bridge.calls, []);
});

void test('WorkmuxControlChannel.scroll delegates to DirectMux transport', async () => {
	const sent: string[] = [];
	const bridge = createRecordingBridgeClient();
	const channel = createWorkmuxControlChannel({
		connection: null,
		bridgeClient: bridge.bridgeClient,
		directTmuxTransport: {
			send: async (command) => {
				sent.push(command);
				return true;
			},
			dispose: async () => {
				sent.push('__disposed__');
			},
		},
	});

	assert.deepEqual(await channel.scroll.enter({ sessionName: 'main' }), {
		success: true,
		output: '',
	});
	assert.deepEqual(
		await channel.scroll.move({
			sessionName: 'main',
			direction: 'down',
			unit: 'line',
			count: 4,
		}),
		{ success: true, output: '' },
	);
	assert.deepEqual(await channel.scroll.exit({ sessionName: 'main' }), {
		success: true,
		output: '',
	});
	await channel.dispose();

	assert.deepEqual(sent, [
		'tmux copy-mode -t main',
		'tmux send-keys -t main -N 4 -X scroll-down',
		'tmux send-keys -t main -X cancel',
		'__disposed__',
	]);
	assert.deepEqual(bridge.calls, []);
});

void test('WorkmuxControlChannel.scroll reports failed DirectMux send', async () => {
	const channel = createWorkmuxControlChannel({
		connection: null,
		bridgeClient: createRecordingBridgeClient().bridgeClient,
		directTmuxTransport: {
			send: async () => false,
			dispose: async () => {},
		},
	});

	const result: WorkmuxControlCommandResult = await channel.scroll.exit({
		sessionName: 'main',
	});

	assert.deepEqual(result, {
		success: false,
		output: '',
		error: 'DirectMux control unavailable.',
	});
});

void test('WorkmuxControlChannel.dispose delegates to bridge and DirectMux transports', async () => {
	const bridge = createRecordingBridgeClient();
	let directMuxDisposeCount = 0;
	const channel = createWorkmuxControlChannel({
		connection: null,
		bridgeClient: bridge.bridgeClient,
		directTmuxTransport: {
			send: async () => true,
			dispose: async () => {
				directMuxDisposeCount += 1;
			},
		},
	});

	await channel.dispose();

	assert.equal(bridge.getDisposeCount(), 1);
	assert.equal(directMuxDisposeCount, 1);
});

void test('WorkmuxControlChannel.dispose forwards reconnect reason to bridge client', async () => {
	const bridge = createRecordingBridgeClient();
	const channel = createWorkmuxControlChannel({
		connection: null,
		bridgeClient: bridge.bridgeClient,
		directTmuxTransport: {
			send: async () => true,
			dispose: async () => {},
		},
	});

	await channel.dispose({ reason: 'reconnect' });

	assert.deepEqual(bridge.disposeOptions, [{ reason: 'reconnect' }]);
});

void test('WorkmuxControlChannel.prepareDispose forwards reconnect reason before deferred dispose', async () => {
	const bridge = createRecordingBridgeClient();
	const channel = createWorkmuxControlChannel({
		connection: null,
		bridgeClient: bridge.bridgeClient,
		directTmuxTransport: {
			send: async () => true,
			dispose: async () => {},
		},
	});

	channel.prepareDispose({ reason: 'reconnect' });

	assert.deepEqual(bridge.prepareDisposeOptions, [{ reason: 'reconnect' }]);
	assert.equal(bridge.getDisposeCount(), 0);
});

void test('WorkmuxControlChannel forwards lifecycle trace to production bridge client', async () => {
	const bridgeStream = {
		onEvent: null as ((event: MdevBridgeStreamEvent) => void) | null,
	};
	const writes: string[] = [];
	const events: ConnectionDiagnosticEvent[] = [];
	const connection: WorkmuxControlConnection = {
		startCommandStream: async (opts) => {
			bridgeStream.onEvent = opts.onEvent;
			return {
				sendData: async (data) => {
					writes.push(text(data));
				},
				close: async () => {},
			};
		},
		startShell: async () => ({
			channelId: 1,
			sendData: async () => {},
			close: async () => {},
		}),
	};
	const emitBridgeEvent = (event: MdevBridgeStreamEvent) => {
		if (!bridgeStream.onEvent) assert.fail('bridge stream should be started');
		bridgeStream.onEvent(event);
	};
	const channel = createWorkmuxControlChannel({
		connection,
		directTmuxTransport: {
			send: async () => true,
			dispose: async () => {},
		},
		trace: { event: (event) => events.push(event) },
	});

	const resultPromise = channel.command(
		['tmux', 'app', 'nav', 'next', '--session', 'main'],
		{ timeoutMs: 1_000 },
	);
	await settle();
	assert.equal(writes.length, 1);
	emitBridgeEvent({
		type: 'stdout',
		bytes: bytes(
			`${JSON.stringify({
				id: 'mdev-bridge-1',
				ok: true,
				protocolVersion: 1,
				supportedRequestTypes: ['operation'],
				operations: WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS,
			})}\n`,
		),
	});
	await settle();
	assert.equal(writes.length, 2);
	emitBridgeEvent({
		type: 'stdout',
		bytes: bytes(
			`${JSON.stringify({
				id: 'mdev-bridge-2',
				ok: true,
				result: { selected: true },
			})}\n`,
		),
	});

	assert.deepEqual(await resultPromise, {
		success: true,
		output: '{"selected":true}\n',
	});
	assert.deepEqual(
		events
			.filter((event) => event.kind === 'mdev-bridge.lifecycle')
			.map((event) => event.stage),
		[
			'stream-starting',
			'request-started',
			'hello-complete',
			'request-completed',
			'request-started',
			'request-completed',
		],
	);
});

void test('WorkmuxControlChannel rejects commands after dispose', async () => {
	const bridge = createRecordingBridgeClient();
	const channel = createWorkmuxControlChannel({
		connection: null,
		bridgeClient: bridge.bridgeClient,
		directTmuxTransport: {
			send: async () => true,
			dispose: async () => {},
		},
	});

	await channel.dispose();

	assert.deepEqual(await channel.command(['tmux', 'app', 'nav', 'next']), {
		success: false,
		output: '',
		error: 'Workmux control channel disposed.',
	});
	assert.deepEqual(bridge.calls, []);
});

void test('WorkmuxControlChannel rejects structured operations after dispose', async () => {
	const bridge = createRecordingBridgeClient();
	const channel = createWorkmuxControlChannel({
		connection: createFakeConnection(),
		bridgeClient: bridge.bridgeClient,
		directTmuxTransport: {
			send: async () => true,
			dispose: async () => {},
		},
	});

	await channel.dispose();

	assert.deepEqual(
		await channel.operation({
			operation: 'codex.restart',
			params: { target: 'main:@12' },
		}),
		{
			success: false,
			output: '',
			error: 'Workmux control channel disposed.',
		},
	);
	assert.deepEqual(bridge.calls, []);
});

void test('WorkmuxControlChannel rejects scroll after dispose', async () => {
	const sent: string[] = [];
	const channel = createWorkmuxControlChannel({
		connection: null,
		bridgeClient: createRecordingBridgeClient().bridgeClient,
		directTmuxTransport: {
			send: async (command) => {
				sent.push(command);
				return true;
			},
			dispose: async () => {},
		},
	});

	await channel.dispose();

	assert.deepEqual(await channel.scroll.enter({ sessionName: 'main' }), {
		success: false,
		output: '',
		error: 'Workmux control channel disposed.',
	});
	assert.deepEqual(
		await channel.scroll.move({
			sessionName: 'main',
			direction: 'down',
			unit: 'line',
			count: 0,
		}),
		{
			success: false,
			output: '',
			error: 'Workmux control channel disposed.',
		},
	);
	assert.deepEqual(sent, []);
});

void test('disposeWorkmuxControlChannelAfterCleanup waits for scrollback cleanup', async () => {
	const cleanup = deferred<void>();
	const events: string[] = [];

	disposeWorkmuxControlChannelAfterCleanup({
		cleanup: cleanup.promise,
		dispose: async () => {
			events.push('dispose');
		},
	});

	await settle();
	assert.deepEqual(events, []);

	cleanup.resolve();
	await cleanup.promise;
	await settle();

	assert.deepEqual(events, ['dispose']);
});

void test('disposeWorkmuxControlChannelAfterCleanup prepares disposal before scrollback cleanup settles', async () => {
	const cleanup = deferred<void>();
	const events: string[] = [];

	disposeWorkmuxControlChannelAfterCleanup({
		cleanup: cleanup.promise,
		prepareDispose: () => {
			events.push('prepare');
		},
		dispose: async () => {
			events.push('dispose');
		},
	});

	await settle();
	assert.deepEqual(events, ['prepare']);

	cleanup.resolve();
	await cleanup.promise;
	await settle();

	assert.deepEqual(events, ['prepare', 'dispose']);
});

void test('disposeWorkmuxControlChannelAfterCleanup disposes after cleanup timeout', async () => {
	const cleanup = deferred<void>();
	const events: string[] = [];
	const timers: (() => void)[] = [];
	const clearedTimers: unknown[] = [];
	const timer = { id: 1 };

	disposeWorkmuxControlChannelAfterCleanup({
		cleanup: cleanup.promise,
		cleanupTimeoutMs: 50,
		setTimeout: (callback, delayMs) => {
			events.push(`timer:${delayMs}`);
			timers.push(callback);
			return timer;
		},
		clearTimeout: (clearedTimer) => {
			clearedTimers.push(clearedTimer);
		},
		dispose: async () => {
			events.push('dispose');
		},
		onCleanupError: (error) => {
			events.push(
				error instanceof Error ? `cleanup:${error.message}` : String(error),
			);
		},
	});

	await settle();
	assert.deepEqual(events, ['timer:50']);
	assert.equal(timers.length, 1);

	timers[0]?.();
	await settle();

	assert.deepEqual(events, [
		'timer:50',
		'cleanup:Workmux control channel cleanup timed out.',
		'dispose',
	]);
	assert.deepEqual(clearedTimers, [timer]);

	cleanup.reject('late cleanup failure');
	await cleanup.promise.catch(() => {});
	await settle();

	assert.deepEqual(events, [
		'timer:50',
		'cleanup:Workmux control channel cleanup timed out.',
		'dispose',
	]);
});

void test('disposeWorkmuxControlChannelAfterCleanup disposes after failed cleanup', async () => {
	const cleanup = deferred<void>();
	const events: string[] = [];

	disposeWorkmuxControlChannelAfterCleanup({
		cleanup: cleanup.promise,
		dispose: async () => {
			events.push('dispose');
		},
		onCleanupError: (error) => {
			events.push(`cleanup:${String(error)}`);
		},
	});

	cleanup.reject('exit failed');
	await cleanup.promise.catch(() => {});
	await settle();

	assert.deepEqual(events, ['cleanup:exit failed', 'dispose']);
});

void test('scrollback teardown reports timeout once, ignores core-owned rejection, and contains logger failure', () => {
	const warnings: { message: string; error: unknown }[] = [];
	const timeout = new WorkmuxControlChannelCleanupTimeoutError();
	reportWorkmuxScrollbackCleanupTeardownError(timeout, (message, error) => {
		warnings.push({ message, error });
	});
	reportWorkmuxScrollbackCleanupTeardownError(
		new Error('core-owned rollback rejection'),
		(message, error) => warnings.push({ message, error }),
	);
	assert.deepEqual(warnings, [
		{
			message:
				'Workmux scrollback cleanup timed out before control channel disposal',
			error: timeout,
		},
	]);
	assert.doesNotThrow(() =>
		reportWorkmuxScrollbackCleanupTeardownError(timeout, () => {
			throw new Error('logger failed');
		}),
	);
});
