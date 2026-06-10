import assert from 'node:assert/strict';
import test from 'node:test';
import { TERMINAL_REFLOW_HISTORY_LINES } from '../../src/lib/terminal-reflow';
import {
	createManualTerminalReflowRunner,
	type ManualTerminalReflowRunnerDeps,
	type ManualTerminalReflowXterm,
} from '../../src/lib/terminal-reflow-runner';

type Connection = { id: string };

function createHarness(
	overrides: Partial<ManualTerminalReflowRunnerDeps<Connection>> = {},
) {
	const calls: string[] = [];
	const writes: string[] = [];
	const failures: { title: string; message: string }[] = [];
	let liveChunks: Uint8Array[] = [];
	const decoder = new TextDecoder();
	const connection = { id: 'connection' };
	const xterm: ManualTerminalReflowXterm = {
		clear: () => calls.push('clear'),
		reset: () => calls.push('reset'),
		write: (bytes) => {
			writes.push(decoder.decode(bytes));
			calls.push(`write:${decoder.decode(bytes)}`);
		},
		flush: () => calls.push('flush'),
		fit: () => calls.push('fit'),
	};

	const deps: ManualTerminalReflowRunnerDeps<Connection> = {
		getConnection: () => connection,
		isTmuxEnabled: () => true,
		getTerminalSize: () => ({ cols: 20, rows: 10 }),
		getXterm: () => xterm,
		resolvePaneContext: async () => ({ paneId: '%34' }),
		executeSideChannelCommand: async () => ({
			success: true,
			output: 'START:abcdefghijklmnopqrstuvwxyz:END',
		}),
		beginLiveBuffer: () => {
			calls.push('begin');
		},
		endLiveBuffer: () => {
			calls.push('end');
			return liveChunks;
		},
		showFailure: (title, message) => {
			failures.push({ title, message });
			calls.push(`failure:${title}:${message}`);
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
		...overrides,
	};

	return {
		calls,
		connection,
		deps,
		failures,
		liveChunks,
		run: () => createManualTerminalReflowRunner(deps).run(),
		setLiveChunks: (chunks: string[]) => {
			liveChunks = chunks.map((chunk) => new TextEncoder().encode(chunk));
		},
		writes,
	};
}

void test('manual terminal reflow captures active pane and rebuilds xterm view', async () => {
	const harness = createHarness();
	const commands: string[] = [];
	harness.setLiveChunks(['LIVE']);
	harness.deps.executeSideChannelCommand = async (
		connection,
		command,
		timeoutMs,
	) => {
		assert.equal(connection, harness.connection);
		assert.equal(timeoutMs, 30_000);
		commands.push(command);
		return {
			success: true,
			output: 'START:abcdefghijklmnopqrstuvwxyz:END',
		};
	};

	await harness.run();

	assert.deepEqual(commands, [
		`tmux capture-pane -J -p -t '%34' -S -${TERMINAL_REFLOW_HISTORY_LINES} -E -`,
	]);
	assert.deepEqual(harness.writes, [
		'START:abcdefghijklmn\r\nopqrstuvwxyz:END\r\n',
		'LIVE',
	]);
	assert.deepEqual(harness.calls, [
		'begin',
		'end',
		'reset',
		'write:START:abcdefghijklmn\r\nopqrstuvwxyz:END\r\n',
		'flush',
		'write:LIVE',
		'flush',
	]);
	assert.deepEqual(harness.failures, []);
});

void test('manual terminal reflow prompts fit when terminal size is missing', async () => {
	const harness = createHarness({
		getTerminalSize: () => null,
	});

	await harness.run();

	assert.deepEqual(harness.calls, [
		'fit',
		'failure:Reflow terminal failed:Terminal size is not ready yet. Try again.',
	]);
	assert.deepEqual(harness.writes, []);
});

void test('manual terminal reflow rejects missing connection without clearing', async () => {
	const harness = createHarness({
		getConnection: () => null,
	});

	await harness.run();

	assert.deepEqual(harness.calls, [
		'failure:Reflow terminal failed:No SSH connection is available.',
	]);
	assert.deepEqual(harness.writes, []);
});

void test('manual terminal reflow rejects non-tmux sessions without clearing', async () => {
	const harness = createHarness({
		isTmuxEnabled: () => false,
	});

	await harness.run();

	assert.deepEqual(harness.calls, [
		'failure:Reflow terminal unavailable:Reflow terminal requires a Workmux-enabled connection.',
	]);
	assert.deepEqual(harness.writes, []);
});

void test('manual terminal reflow keeps existing view when capture fails', async () => {
	const harness = createHarness({
		executeSideChannelCommand: async () => ({
			success: false,
			output: '',
			error: 'capture failed',
		}),
	});
	harness.setLiveChunks(['LIVE']);

	await harness.run();

	assert.deepEqual(harness.calls, [
		'begin',
		'end',
		'write:LIVE',
		'flush',
		'failure:Reflow terminal failed:capture failed',
	]);
	assert.deepEqual(harness.writes, ['LIVE']);
});

void test('manual terminal reflow keeps existing view when capture is empty', async () => {
	const harness = createHarness({
		executeSideChannelCommand: async () => ({
			success: true,
			output: '\n\n  \n',
		}),
	});
	harness.setLiveChunks(['LIVE']);

	await harness.run();

	assert.deepEqual(harness.calls, [
		'begin',
		'end',
		'write:LIVE',
		'flush',
		'failure:Reflow terminal failed:Captured pane text was empty.',
	]);
	assert.deepEqual(harness.writes, ['LIVE']);
});

void test('manual terminal reflow flushes live buffer when pane resolution throws', async () => {
	const harness = createHarness({
		resolvePaneContext: async () => {
			throw new Error('no pane');
		},
	});
	harness.setLiveChunks(['LIVE']);

	await harness.run();

	assert.deepEqual(harness.calls, [
		'begin',
		'end',
		'write:LIVE',
		'flush',
		'failure:Reflow terminal failed:no pane',
	]);
	assert.deepEqual(harness.writes, ['LIVE']);
});
