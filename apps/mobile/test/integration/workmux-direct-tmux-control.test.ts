import assert from 'node:assert/strict';
import test from 'node:test';
import { TERMINAL_REFLOW_HISTORY_LINES } from '../../src/lib/terminal-reflow';
import {
	buildDirectTmuxCapturePaneCommand,
	buildDirectTmuxScrollEnterCommand,
	buildDirectTmuxScrollExitCommand,
	buildDirectTmuxScrollMoveCommand,
	createDirectTmuxControlTransport,
} from '../../src/lib/workmux-direct-tmux-control';

function fakeShell() {
	const writes: string[] = [];
	return {
		writes,
		shell: {
			channelId: 7,
			addListener: () => 1n,
			removeListener: () => {},
			sendData: async (bytes: ArrayBuffer) => {
				writes.push(new TextDecoder().decode(bytes));
			},
			close: async () => {
				writes.push('__closed__');
			},
		},
	};
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

void test('DirectMux command builders escape targets and counts', () => {
	assert.equal(
		buildDirectTmuxScrollEnterCommand("main'bad"),
		"tmux copy-mode -t 'main'\\''bad'",
	);
	assert.equal(
		buildDirectTmuxScrollMoveCommand({
			sessionName: 'main',
			direction: 'down',
			unit: 'line',
			count: 3,
		}),
		'tmux send-keys -t main -N 3 -X scroll-down',
	);
	assert.equal(
		buildDirectTmuxScrollMoveCommand({
			sessionName: 'main',
			direction: 'up',
			unit: 'page',
			count: 2,
		}),
		'tmux send-keys -t main -N 2 -X page-up',
	);
	assert.equal(
		buildDirectTmuxScrollExitCommand('main'),
		'tmux send-keys -t main -X cancel',
	);
});

void test('DirectMux scroll move rejects invalid direction, unit, and count', () => {
	assert.throws(
		() =>
			buildDirectTmuxScrollMoveCommand({
				sessionName: 'main',
				direction: 'left' as never,
				unit: 'line',
				count: 1,
			}),
		/Invalid DirectMux direction: left/,
	);
	assert.throws(
		() =>
			buildDirectTmuxScrollMoveCommand({
				sessionName: 'main',
				direction: 'up',
				unit: 'chunk' as never,
				count: 1,
			}),
		/Invalid DirectMux unit: chunk/,
	);
	for (const count of [0, -1, 1.5]) {
		assert.throws(
			() =>
				buildDirectTmuxScrollMoveCommand({
					sessionName: 'main',
					direction: 'up',
					unit: 'line',
					count,
				}),
			new RegExp(`Invalid DirectMux count: ${count}`),
		);
	}
});

void test('DirectMux capture pane command uses joined printed pane capture', () => {
	assert.equal(
		buildDirectTmuxCapturePaneCommand({
			paneId: '%1',
			historyLines: TERMINAL_REFLOW_HISTORY_LINES,
		}),
		`tmux capture-pane -J -p -t '%1' -S -${TERMINAL_REFLOW_HISTORY_LINES} -E -`,
	);
});

void test('DirectMux capture pane command shell-quotes pane targets', () => {
	assert.equal(
		buildDirectTmuxCapturePaneCommand({
			paneId: `%pane 'quoted' target`,
			historyLines: 42,
		}),
		`tmux capture-pane -J -p -t '%pane '\\''quoted'\\'' target' -S -42 -E -`,
	);
});

void test('DirectMux capture pane command accepts inclusive history edges', () => {
	assert.equal(
		buildDirectTmuxCapturePaneCommand({ paneId: '%1', historyLines: 1 }),
		"tmux capture-pane -J -p -t '%1' -S -1 -E -",
	);
	assert.equal(
		buildDirectTmuxCapturePaneCommand({ paneId: '%1', historyLines: 10_000 }),
		"tmux capture-pane -J -p -t '%1' -S -10000 -E -",
	);
});

void test('DirectMux capture pane command rejects unsafe pane targets', () => {
	for (const paneId of ['   ', '%1\nwhoami', '%1\rwhoami', '%1\n', '\r%1']) {
		assert.throws(
			() =>
				buildDirectTmuxCapturePaneCommand({
					paneId,
					historyLines: TERMINAL_REFLOW_HISTORY_LINES,
				}),
			paneId.trim() === ''
				? /paneId must be non-empty/
				: /paneId must not contain CR or LF/,
		);
	}
});

void test('DirectMux capture pane command rejects invalid history ranges', () => {
	for (const historyLines of [0, -1, 10001, 1.5, Number.NaN]) {
		assert.throws(
			() => buildDirectTmuxCapturePaneCommand({ paneId: '%1', historyLines }),
			/historyLines must be a safe integer from 1 through 10000/,
		);
	}
});

void test('DirectMux transport reuses one hidden shell and closes it', async () => {
	const created = fakeShell();
	const startOptions: unknown[] = [];
	let startCount = 0;
	const transport = createDirectTmuxControlTransport({
		connection: {
			startShell: async (options) => {
				startCount += 1;
				startOptions.push(options);
				return created.shell;
			},
		},
	});

	await transport.send('tmux display-message first');
	await transport.send('tmux display-message second');
	await transport.dispose();

	assert.equal(startCount, 1);
	assert.deepEqual(startOptions, [
		{
			term: 'Xterm',
			useTmux: false,
			tmuxSessionName: '',
			registerInStore: false,
		},
	]);
	assert.deepEqual(created.writes, [
		'tmux display-message first\n',
		'tmux display-message second\n',
		'__closed__',
	]);
});

void test('DirectMux transport closes failed shell and retries with replacement', async () => {
	const first = fakeShell();
	const second = fakeShell();
	let startCount = 0;
	first.shell.sendData = async () => {
		throw new Error('write failed');
	};
	const transport = createDirectTmuxControlTransport({
		connection: {
			startShell: async () => {
				startCount += 1;
				return startCount === 1 ? first.shell : second.shell;
			},
		},
	});

	assert.equal(await transport.send('tmux display-message first'), false);
	assert.equal(await transport.send('tmux display-message second'), true);
	await transport.dispose();

	assert.equal(startCount, 2);
	assert.deepEqual(first.writes, ['__closed__']);
	assert.deepEqual(second.writes, [
		'tmux display-message second\n',
		'__closed__',
	]);
});

void test('DirectMux transport rejects embedded line breaks without writing', async () => {
	const created = fakeShell();
	let startCount = 0;
	const transport = createDirectTmuxControlTransport({
		connection: {
			startShell: async () => {
				startCount += 1;
				return created.shell;
			},
		},
	});

	assert.equal(await transport.send('tmux display-message bad\nnext'), false);
	assert.equal(await transport.send('tmux display-message bad\rnext'), false);
	await transport.dispose();

	assert.equal(startCount, 0);
	assert.deepEqual(created.writes, []);
});

void test('DirectMux transport returns false after dispose', async () => {
	const created = fakeShell();
	const transport = createDirectTmuxControlTransport({
		connection: {
			startShell: async () => created.shell,
		},
	});

	await transport.dispose();

	assert.equal(await transport.send('tmux display-message after'), false);
	assert.deepEqual(created.writes, []);
});

void test('DirectMux transport serializes sends and dispose waits for queue', async () => {
	const created = fakeShell();
	const firstStarted = deferred();
	const releaseFirst = deferred();
	let activeWrites = 0;
	let maxActiveWrites = 0;
	let isFirstWrite = true;
	created.shell.sendData = async (bytes: ArrayBuffer) => {
		const command = new TextDecoder().decode(bytes);
		activeWrites += 1;
		maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
		created.writes.push(`start:${command}`);
		if (isFirstWrite) {
			isFirstWrite = false;
			firstStarted.resolve();
			await releaseFirst.promise;
		}
		created.writes.push(`finish:${command}`);
		activeWrites -= 1;
	};
	const transport = createDirectTmuxControlTransport({
		connection: {
			startShell: async () => created.shell,
		},
	});

	const firstSend = transport.send('tmux display-message first');
	await firstStarted.promise;
	const secondSend = transport.send('tmux display-message second');
	const dispose = transport.dispose();
	releaseFirst.resolve();

	assert.equal(await firstSend, true);
	assert.equal(await secondSend, true);
	await dispose;

	assert.equal(maxActiveWrites, 1);
	assert.deepEqual(created.writes, [
		'start:tmux display-message first\n',
		'finish:tmux display-message first\n',
		'start:tmux display-message second\n',
		'finish:tmux display-message second\n',
		'__closed__',
	]);
});

void test('DirectMux transport overlapping dispose closes hidden shell once', async () => {
	const created = fakeShell();
	const sendStarted = deferred();
	const releaseSend = deferred();
	const closeStarted = deferred();
	const releaseClose = deferred();
	let closeCount = 0;
	created.shell.sendData = async (bytes: ArrayBuffer) => {
		created.writes.push(new TextDecoder().decode(bytes));
		sendStarted.resolve();
		await releaseSend.promise;
	};
	created.shell.close = async () => {
		closeCount += 1;
		created.writes.push('__closed__');
		closeStarted.resolve();
		await releaseClose.promise;
	};
	const transport = createDirectTmuxControlTransport({
		connection: {
			startShell: async () => created.shell,
		},
	});

	const send = transport.send('tmux display-message pending');
	await sendStarted.promise;
	const firstDispose = transport.dispose();
	const secondDispose = transport.dispose();
	releaseSend.resolve();

	assert.equal(await send, true);
	await closeStarted.promise;
	let secondDisposeResolved = false;
	void secondDispose.then(() => {
		secondDisposeResolved = true;
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(secondDisposeResolved, false);
	releaseClose.resolve();
	await Promise.all([firstDispose, secondDispose]);

	assert.equal(closeCount, 1);
	assert.deepEqual(created.writes, [
		'tmux display-message pending\n',
		'__closed__',
	]);
});
