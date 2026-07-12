import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerminalSizeController } from '../../src/lib/shell-controllers/terminal-size-core';

type TimerId = number;

type FakeClock = ReturnType<typeof createFakeClock>;

function createFakeClock() {
	let now = 0;
	let nextId = 1;
	const timers = new Map<TimerId, { at: number; task: () => void }>();

	return {
		setTimeout: (task: () => void, delayMs: number): TimerId => {
			const id = nextId++;
			timers.set(id, { at: now + delayMs, task });
			return id;
		},
		clearTimeout: (id: TimerId): void => {
			timers.delete(id);
		},
		advanceBy: (durationMs: number): void => {
			const target = now + durationMs;
			while (true) {
				const due = [...timers.entries()]
					.filter(([, timer]) => timer.at <= target)
					.sort(
						([firstId, first], [secondId, second]) =>
							first.at - second.at || firstId - secondId,
					)[0];
				if (!due) break;
				const [id, timer] = due;
				timers.delete(id);
				now = timer.at;
				timer.task();
			}
			now = target;
		},
		pending: (): TimerId[] => [...timers.keys()].sort((a, b) => a - b),
		settled: async (): Promise<void> => {
			await Promise.resolve();
			await Promise.resolve();
		},
	};
}

function createSizeDeps(clock: FakeClock) {
	return {
		setTimeout: clock.setTimeout,
		clearTimeout: clock.clearTimeout,
		resizePty: async (_cols: number, _rows: number): Promise<void> => {},
		warn: (_message: string, _error: unknown): void => {},
	};
}

void test('terminal size controller resolves fit waiters and debounces PTY resize', async () => {
	const clock = createFakeClock();
	const resized: string[] = [];
	const core = createTerminalSizeController({
		setTimeout: clock.setTimeout,
		clearTimeout: clock.clearTimeout,
		resizePty: async (cols, rows) => {
			resized.push(`${cols}x${rows}`);
		},
		warn: () => {},
	});
	const waiting = core.waitForSizeAfterFit();
	core.handleResize(80, 24);
	assert.deepEqual(await waiting, { cols: 80, rows: 24 });
	core.handleResize(100, 30);
	clock.advanceBy(99);
	assert.deepEqual(resized, []);
	clock.advanceBy(1);
	await clock.settled();
	assert.deepEqual(resized, ['100x30']);
});

void test('terminal size disposal settles waiters and cancels resize', async () => {
	const clock = createFakeClock();
	const core = createTerminalSizeController(createSizeDeps(clock));
	core.handleResize(80, 24);
	const waiting = core.waitForSizeAfterFit();
	core.dispose();
	clock.advanceBy(100);
	assert.deepEqual(await waiting, { cols: 80, rows: 24 });
	assert.deepEqual(clock.pending(), []);
});

void test('terminal size debounce fires at 100 ms and rapid changes keep only the latest size', async () => {
	const clock = createFakeClock();
	const resized: string[] = [];
	const core = createTerminalSizeController({
		...createSizeDeps(clock),
		resizePty: async (cols, rows) => {
			resized.push(`${cols}x${rows}`);
		},
	});

	core.handleResize(80, 24);
	const firstTimer = clock.pending();
	clock.advanceBy(40);
	core.handleResize(81, 25);
	assert.equal(clock.pending().length, 1);
	assert.notDeepEqual(clock.pending(), firstTimer);
	clock.advanceBy(99);
	assert.deepEqual(resized, []);
	clock.advanceBy(1);
	await clock.settled();

	assert.deepEqual(resized, ['81x25']);
	assert.deepEqual(clock.pending(), []);
});

void test('unchanged resize events settle waiters without replacing a pending debounce', async () => {
	const clock = createFakeClock();
	const resized: string[] = [];
	const core = createTerminalSizeController({
		...createSizeDeps(clock),
		resizePty: async (cols, rows) => {
			resized.push(`${cols}x${rows}`);
		},
	});

	core.handleResize(80, 24);
	const pendingResize = clock.pending();
	const waiting = core.waitForSizeAfterFit();
	core.handleResize(80, 24);

	assert.deepEqual(await waiting, { cols: 80, rows: 24 });
	assert.deepEqual(clock.pending(), pendingResize);
	clock.advanceBy(100);
	await clock.settled();
	assert.deepEqual(resized, ['80x24']);

	const nextWaiting = core.waitForSizeAfterFit();
	core.handleResize(80, 24);
	assert.deepEqual(await nextWaiting, { cols: 80, rows: 24 });
	assert.deepEqual(clock.pending(), []);
	clock.advanceBy(100);
	await clock.settled();
	assert.deepEqual(resized, ['80x24']);
});

void test('fit waiter waits for a fresh event and falls back at exactly 250 ms', async () => {
	const clock = createFakeClock();
	const core = createTerminalSizeController(createSizeDeps(clock));
	core.handleResize(80, 24);
	clock.advanceBy(100);
	await clock.settled();

	let settled = false;
	const waiting = core.waitForSizeAfterFit().then((size) => {
		settled = true;
		return size;
	});
	await clock.settled();
	assert.equal(settled, false);
	clock.advanceBy(249);
	await clock.settled();
	assert.equal(settled, false);
	clock.advanceBy(1);

	assert.deepEqual(await waiting, { cols: 80, rows: 24 });
	assert.deepEqual(clock.pending(), []);
});

void test('fit waiter fallback can resolve null before the first resize', async () => {
	const clock = createFakeClock();
	const core = createTerminalSizeController(createSizeDeps(clock));
	const waiting = core.waitForSizeAfterFit();

	clock.advanceBy(250);

	assert.equal(await waiting, null);
	assert.deepEqual(clock.pending(), []);
});

void test('a resize settles all fit waiters once and clears their independent timers', async () => {
	const clock = createFakeClock();
	const core = createTerminalSizeController(createSizeDeps(clock));
	const settlements: ({ cols: number; rows: number } | null)[] = [];
	const first = core.waitForSizeAfterFit().then((size) => {
		settlements.push(size);
		return size;
	});
	clock.advanceBy(10);
	const second = core.waitForSizeAfterFit().then((size) => {
		settlements.push(size);
		return size;
	});
	assert.equal(clock.pending().length, 2);

	core.handleResize(90, 27);

	assert.deepEqual(await Promise.all([first, second]), [
		{ cols: 90, rows: 27 },
		{ cols: 90, rows: 27 },
	]);
	assert.equal(clock.pending().length, 1);
	clock.advanceBy(250);
	await clock.settled();
	assert.deepEqual(settlements, [
		{ cols: 90, rows: 27 },
		{ cols: 90, rows: 27 },
	]);
});

void test('invalidation cancels resize, settles old waiters, clears stale size, and remains reusable', async () => {
	const clock = createFakeClock();
	const resized: string[] = [];
	const core = createTerminalSizeController({
		...createSizeDeps(clock),
		resizePty: async (cols, rows) => {
			resized.push(`${cols}x${rows}`);
		},
	});
	core.handleResize(80, 24);
	const oldRuntimeWaiting = core.waitForSizeAfterFit();

	core.invalidate('runtime-reset');

	assert.deepEqual(await oldRuntimeWaiting, { cols: 80, rows: 24 });
	assert.deepEqual(core.getSnapshot(), { lastSize: null });
	assert.deepEqual(clock.pending(), []);
	const newRuntimeWaiting = core.waitForSizeAfterFit();
	clock.advanceBy(250);
	assert.equal(await newRuntimeWaiting, null);
	core.handleResize(100, 30);
	clock.advanceBy(100);
	await clock.settled();
	assert.deepEqual(core.getSnapshot(), {
		lastSize: { cols: 100, rows: 30 },
	});
	assert.deepEqual(resized, ['100x30']);
});

void test('disposal without a size settles waiters, is idempotent, and rejects later work', async () => {
	const clock = createFakeClock();
	const resized: string[] = [];
	const core = createTerminalSizeController({
		...createSizeDeps(clock),
		resizePty: async (cols, rows) => {
			resized.push(`${cols}x${rows}`);
		},
	});
	const waiting = core.waitForSizeAfterFit();

	core.dispose();
	core.dispose();
	core.handleResize(80, 24);
	const afterDispose = core.waitForSizeAfterFit();
	clock.advanceBy(500);
	await clock.settled();

	assert.equal(await waiting, null);
	assert.equal(await afterDispose, null);
	assert.deepEqual(core.getSnapshot(), { lastSize: null });
	assert.deepEqual(resized, []);
	assert.deepEqual(clock.pending(), []);
});

void test('subscribers see every resize event and no publication after disposal', () => {
	const clock = createFakeClock();
	const core = createTerminalSizeController(createSizeDeps(clock));
	const seen: ({ cols: number; rows: number } | null)[] = [];
	core.subscribe(() => {
		seen.push(core.getSnapshot().lastSize);
	});

	core.handleResize(80, 24);
	core.handleResize(80, 24);
	core.invalidate('runtime-reset');
	core.handleResize(100, 30);
	core.dispose();
	core.handleResize(120, 40);

	assert.deepEqual(seen, [
		{ cols: 80, rows: 24 },
		{ cols: 80, rows: 24 },
		null,
		{ cols: 100, rows: 30 },
	]);
});

void test('synchronous resize failure warns once and a later resize recovers', async () => {
	const clock = createFakeClock();
	const firstError = new Error('sync failure');
	const warnings: [string, unknown][] = [];
	const resized: string[] = [];
	let calls = 0;
	const core = createTerminalSizeController({
		...createSizeDeps(clock),
		resizePty: (cols, rows) => {
			calls += 1;
			if (calls === 1) throw firstError;
			resized.push(`${cols}x${rows}`);
			return Promise.resolve();
		},
		warn: (message, error) => {
			warnings.push([message, error]);
		},
	});

	core.handleResize(80, 24);
	clock.advanceBy(100);
	core.handleResize(100, 30);
	clock.advanceBy(100);
	await clock.settled();

	assert.deepEqual(warnings, [['resizePty failed', firstError]]);
	assert.deepEqual(resized, ['100x30']);
	assert.deepEqual(clock.pending(), []);
});

void test('rejected resize and throwing warning stay contained while later resize recovers', async () => {
	const clock = createFakeClock();
	const rejectedError = new Error('rejected failure');
	const resized: string[] = [];
	let calls = 0;
	let warningCalls = 0;
	const core = createTerminalSizeController({
		...createSizeDeps(clock),
		resizePty: async (cols, rows) => {
			calls += 1;
			if (calls === 1) throw rejectedError;
			resized.push(`${cols}x${rows}`);
		},
		warn: (message, error) => {
			warningCalls += 1;
			assert.equal(message, 'resizePty failed');
			assert.equal(error, rejectedError);
			throw new Error('logger failure');
		},
	});

	core.handleResize(80, 24);
	clock.advanceBy(100);
	await clock.settled();
	core.handleResize(100, 30);
	clock.advanceBy(100);
	await clock.settled();

	assert.equal(warningCalls, 1);
	assert.deepEqual(resized, ['100x30']);
	assert.deepEqual(clock.pending(), []);
});

void test('subscriber disposal during resize publication prevents timer creation', async () => {
	const clock = createFakeClock();
	const resized: string[] = [];
	const core = createTerminalSizeController({
		...createSizeDeps(clock),
		resizePty: async (cols, rows) => {
			resized.push(`${cols}x${rows}`);
		},
	});
	core.subscribe(() => core.dispose());

	core.handleResize(80, 24);
	assert.deepEqual(clock.pending(), []);
	clock.advanceBy(100);
	await clock.settled();

	assert.deepEqual(resized, []);
	assert.deepEqual(clock.pending(), []);
});

void test('subscriber invalidation during resize publication suppresses stale resize and remains reusable', async () => {
	const clock = createFakeClock();
	const resized: string[] = [];
	const core = createTerminalSizeController({
		...createSizeDeps(clock),
		resizePty: async (cols, rows) => {
			resized.push(`${cols}x${rows}`);
		},
	});
	let shouldInvalidate = true;
	core.subscribe(() => {
		if (!shouldInvalidate) return;
		shouldInvalidate = false;
		core.invalidate('runtime-reset');
	});

	core.handleResize(80, 24);
	assert.deepEqual(core.getSnapshot(), { lastSize: null });
	assert.deepEqual(clock.pending(), []);

	core.handleResize(100, 30);
	clock.advanceBy(100);
	await clock.settled();
	assert.deepEqual(resized, ['100x30']);
});

void test('newer reentrant resize wins over stale outer resize scheduling', async () => {
	const clock = createFakeClock();
	const resized: string[] = [];
	const core = createTerminalSizeController({
		...createSizeDeps(clock),
		resizePty: async (cols, rows) => {
			resized.push(`${cols}x${rows}`);
		},
	});
	let shouldResize = true;
	core.subscribe(() => {
		if (!shouldResize) return;
		shouldResize = false;
		core.handleResize(100, 30);
	});

	core.handleResize(80, 24);
	clock.advanceBy(100);
	await clock.settled();

	assert.deepEqual(core.getSnapshot(), {
		lastSize: { cols: 100, rows: 30 },
	});
	assert.deepEqual(resized, ['100x30']);
});

void test('same-size reentrant first resize retains one exact debounce', async () => {
	const clock = createFakeClock();
	const resized: string[] = [];
	const core = createTerminalSizeController({
		...createSizeDeps(clock),
		resizePty: async (cols, rows) => {
			resized.push(`${cols}x${rows}`);
		},
	});
	let shouldEcho = true;
	core.subscribe(() => {
		if (!shouldEcho) return;
		shouldEcho = false;
		core.handleResize(80, 24);
	});

	core.handleResize(80, 24);
	assert.equal(clock.pending().length, 1);
	clock.advanceBy(99);
	assert.deepEqual(resized, []);
	clock.advanceBy(1);
	await clock.settled();

	assert.deepEqual(resized, ['80x24']);
	assert.deepEqual(clock.pending(), []);
});

void test('waiter registered during resize publication waits for a later event', async () => {
	const clock = createFakeClock();
	const core = createTerminalSizeController(createSizeDeps(clock));
	let waiting: Promise<{ cols: number; rows: number } | null> | undefined;
	let settled = false;
	let shouldRegister = true;
	core.subscribe(() => {
		if (!shouldRegister) return;
		shouldRegister = false;
		waiting = core.waitForSizeAfterFit().then((size) => {
			settled = true;
			return size;
		});
	});

	core.handleResize(80, 24);
	await clock.settled();
	assert.equal(settled, false);
	assert.ok(waiting);

	core.handleResize(100, 30);
	assert.deepEqual(await waiting, { cols: 100, rows: 30 });
});

void test('throwing subscriber cannot prevent waiter settlement or PTY resize scheduling', async () => {
	const clock = createFakeClock();
	const resized: string[] = [];
	const publishError = new Error('subscriber failure');
	const core = createTerminalSizeController({
		...createSizeDeps(clock),
		resizePty: async (cols, rows) => {
			resized.push(`${cols}x${rows}`);
		},
	});
	let waiterSettled = false;
	const waiting = core.waitForSizeAfterFit().then((size) => {
		waiterSettled = true;
		return size;
	});
	core.subscribe(() => {
		throw publishError;
	});

	let thrown: unknown;
	try {
		core.handleResize(80, 24);
	} catch (error) {
		thrown = error;
	}
	assert.equal(thrown, publishError);
	await clock.settled();
	assert.equal(waiterSettled, true);
	assert.deepEqual(await waiting, { cols: 80, rows: 24 });
	assert.equal(clock.pending().length, 1);
	clock.advanceBy(99);
	assert.deepEqual(resized, []);
	clock.advanceBy(1);
	await clock.settled();

	assert.deepEqual(resized, ['80x24']);
	assert.deepEqual(clock.pending(), []);
});
