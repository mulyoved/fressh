import assert from 'node:assert/strict';
import test from 'node:test';

import { fromByteArray } from 'base64-js';

import { HERDR_MAX_INCOMPLETE_LINE_BYTES } from '../../src/lib/herdr/protocol';
import {
	createHerdrTerminalOwner,
	type HerdrCommandStream,
	type HerdrCommandStreamEvent,
	type HerdrTerminalConnection,
	type HerdrTerminalOwner,
	type HerdrTerminalState,
} from '../../src/lib/herdr/terminal-owner';

const encoder = new TextEncoder();

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
}

function stdout(bytes: Uint8Array): HerdrCommandStreamEvent {
	return { type: 'stdout', bytes: arrayBuffer(bytes) };
}

function stdoutLine(value: unknown): HerdrCommandStreamEvent {
	return stdout(encoder.encode(`${JSON.stringify(value)}\n`));
}

function frame(input: {
	seq: number;
	full: boolean;
	bytes: readonly number[];
}): HerdrCommandStreamEvent {
	return stdoutLine({
		type: 'terminal.frame',
		seq: input.seq,
		encoding: 'ansi',
		width: 120,
		height: 40,
		full: input.full,
		bytes: fromByteArray(Uint8Array.from(input.bytes)),
	});
}

async function flushMicrotasks(): Promise<void> {
	for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

type Timer = Readonly<{
	id: number;
	dueMs: number;
	callback: () => void;
}>;

class FakeClock {
	nowMs = 0;
	private nextTimerId = 1;
	private timers = new Map<number, Timer>();

	readonly now = () => this.nowMs;

	readonly setTimeout = ((callback: () => void, delayMs?: number) => {
		const id = this.nextTimerId++;
		this.timers.set(id, {
			id,
			dueMs: this.nowMs + (delayMs ?? 0),
			callback,
		});
		return id;
	}) as unknown as typeof setTimeout;

	readonly clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
		this.timers.delete(handle as unknown as number);
	}) as typeof clearTimeout;

	pendingDelays(): number[] {
		return [...this.timers.values()]
			.map((timer) => timer.dueMs - this.nowMs)
			.sort((left, right) => left - right);
	}

	advanceBy(elapsedMs: number): void {
		const targetMs = this.nowMs + elapsedMs;
		while (true) {
			const next = [...this.timers.values()]
				.filter((timer) => timer.dueMs <= targetMs)
				.sort(
					(left, right) => left.dueMs - right.dueMs || left.id - right.id,
				)[0];
			if (!next) break;
			this.timers.delete(next.id);
			this.nowMs = next.dueMs;
			next.callback();
		}
		this.nowMs = targetMs;
	}
}

type Deferred<T = void> = Readonly<{
	promise: Promise<T>;
	resolve(value?: T): void;
	reject(error: unknown): void;
}>;

function deferred<T = void>(): Deferred<T> {
	let resolve!: (value?: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = (value) => onResolve(value as T);
		reject = onReject;
	});
	return { promise, resolve, reject };
}

class FakeStream implements HerdrCommandStream {
	readonly sent: Uint8Array[] = [];
	readonly pendingSends: Deferred[] = [];
	closeCalls = 0;
	controlSends = false;
	rejectSends = false;
	controlClose = false;
	closeError: unknown = null;
	readonly pendingCloses: Deferred[] = [];

	async sendData(data: ArrayBuffer): Promise<void> {
		this.sent.push(new Uint8Array(data).slice());
		if (this.rejectSends) throw new Error('release rejected');
		if (!this.controlSends) return;
		const pending = deferred();
		this.pendingSends.push(pending);
		return pending.promise;
	}

	async close(): Promise<void> {
		this.closeCalls += 1;
		if (this.closeError) throw this.closeError;
		if (!this.controlClose) return;
		const pending = deferred();
		this.pendingCloses.push(pending);
		return pending.promise;
	}

	sentRecords(): unknown[] {
		return this.sent.map((bytes) =>
			JSON.parse(new TextDecoder().decode(bytes)),
		);
	}
}

type StartCall = Readonly<{
	command: string;
	onEvent(event: HerdrCommandStreamEvent): void;
	abortSignal?: AbortSignal;
}>;

class FakeConnection implements HerdrTerminalConnection {
	readonly calls: StartCall[] = [];
	readonly streams: FakeStream[] = [];
	readonly pendingStarts: Deferred<HerdrCommandStream>[] = [];
	controlStarts = false;
	disconnectCalls = 0;

	startCommandStream(input: StartCall): Promise<HerdrCommandStream> {
		this.calls.push(input);
		const stream = new FakeStream();
		this.streams.push(stream);
		if (this.controlStarts) {
			const pending = deferred<HerdrCommandStream>();
			this.pendingStarts.push(pending);
			return pending.promise;
		}
		return Promise.resolve(stream);
	}

	disconnect(): void {
		this.disconnectCalls += 1;
	}
}

type Harness = Readonly<{
	owner: HerdrTerminalOwner;
	connection: FakeConnection;
	clock: FakeClock;
	replaced: number[][];
	appended: number[][];
	states: HerdrTerminalState[];
	logs: unknown[];
}>;

function createHarness(terminalId = 'terminal-stable'): Harness {
	const connection = new FakeConnection();
	const clock = new FakeClock();
	const replaced: number[][] = [];
	const appended: number[][] = [];
	const states: HerdrTerminalState[] = [];
	const logs: unknown[] = [];
	const owner = createHerdrTerminalOwner({
		terminalId,
		connection,
		renderer: {
			replace(bytes) {
				replaced.push(Array.from(bytes));
			},
			append(bytes) {
				appended.push(Array.from(bytes));
			},
		},
		logger: {
			debug(message, metadata) {
				logs.push({ level: 'debug', message, metadata });
			},
			warn(message, metadata) {
				logs.push({ level: 'warn', message, metadata });
			},
		},
		clock: {
			now: clock.now,
			setTimeout: clock.setTimeout,
			clearTimeout: clock.clearTimeout,
		},
	});
	owner.subscribe((state) => states.push(state));
	return {
		owner,
		connection,
		clock,
		replaced,
		appended,
		states,
		logs,
	};
}

void test('start opens one stable-ID stream and accepts only a full baseline', async () => {
	const harness = createHarness("terminal-'stable");

	harness.owner.start({ cols: 100, rows: 30 });

	assert.equal(harness.connection.calls.length, 1);
	assert.equal(
		harness.connection.calls[0]?.command,
		"herdr terminal session control 'terminal-'\\''stable' --cols 100 --rows 30",
	);
	assert.deepEqual(harness.states, [{ phase: 'starting', generation: 1 }]);
	assert.deepEqual(harness.clock.pendingDelays(), [10_000]);

	harness.connection.calls[0]?.onEvent(
		frame({ seq: 7, full: true, bytes: [0x1b, 0x5b, 0x48] }),
	);

	assert.deepEqual(harness.replaced, [[0x1b, 0x5b, 0x48]]);
	assert.deepEqual(harness.appended, []);
	assert.deepEqual(harness.owner.getState(), {
		phase: 'active',
		generation: 1,
	});
	assert.deepEqual(harness.clock.pendingDelays(), []);
	assert.equal(
		JSON.stringify(harness.logs).includes(
			fromByteArray(Uint8Array.of(27, 91, 72)),
		),
		false,
	);
});

void test('a partial first frame fails synchronization before renderer delivery', async () => {
	const harness = createHarness();
	harness.owner.start({ cols: 80, rows: 24 });
	await flushMicrotasks();

	harness.connection.calls[0]?.onEvent(
		frame({ seq: 1, full: false, bytes: [1, 2, 3] }),
	);
	await flushMicrotasks();

	assert.deepEqual(harness.replaced, []);
	assert.deepEqual(harness.appended, []);
	assert.deepEqual(harness.owner.getState(), {
		phase: 'error',
		generation: 1,
		kind: 'synchronization',
		reason: 'Herdr terminal output lost synchronization.',
	});
	assert.equal(harness.owner.sendInput(Uint8Array.of(9)), false);
	assert.deepEqual(harness.connection.streams[0]?.sentRecords(), [
		{ type: 'terminal.release' },
	]);
	assert.equal(harness.connection.streams[0]?.closeCalls, 1);
});

void test('frames append only at the exact next sequence and ignore duplicates', () => {
	const harness = createHarness();
	harness.owner.start({ cols: 80, rows: 24 });
	const events = harness.connection.calls[0];
	events?.onEvent(frame({ seq: 7, full: true, bytes: [7] }));
	events?.onEvent(frame({ seq: 8, full: false, bytes: [8] }));
	events?.onEvent(frame({ seq: 7, full: false, bytes: [70] }));

	assert.deepEqual(harness.replaced, [[7]]);
	assert.deepEqual(harness.appended, [[8]]);
	assert.equal(harness.owner.getState().phase, 'active');
});

void test('a forward sequence gap retires the generation before any later render', async () => {
	const harness = createHarness();
	harness.owner.start({ cols: 80, rows: 24 });
	await flushMicrotasks();
	const events = harness.connection.calls[0];
	events?.onEvent(frame({ seq: 7, full: true, bytes: [7] }));
	events?.onEvent(frame({ seq: 9, full: false, bytes: [9] }));
	events?.onEvent(frame({ seq: 8, full: false, bytes: [8] }));
	events?.onEvent(frame({ seq: 10, full: true, bytes: [10] }));
	await flushMicrotasks();

	assert.deepEqual(harness.replaced, [[7]]);
	assert.deepEqual(harness.appended, []);
	assert.equal(
		harness.states.filter((state) => state.phase === 'error').length,
		1,
	);
	assert.equal(harness.connection.streams[0]?.closeCalls, 1);
});

void test('retry creates a non-takeover generation requiring a new full baseline', async () => {
	const harness = createHarness();
	harness.owner.takeOver({ cols: 80, rows: 24 });
	await flushMicrotasks();
	harness.connection.calls[0]?.onEvent(
		frame({ seq: 2, full: false, bytes: [2] }),
	);
	await flushMicrotasks();

	harness.owner.retry({ cols: 100, rows: 40 });
	await flushMicrotasks();

	assert.equal(harness.connection.calls.length, 2);
	assert.match(harness.connection.calls[0]?.command ?? '', /--takeover$/);
	assert.doesNotMatch(harness.connection.calls[1]?.command ?? '', /takeover/);
	assert.deepEqual(harness.owner.getState(), {
		phase: 'starting',
		generation: 2,
	});
	harness.connection.calls[0]?.onEvent(
		frame({ seq: 100, full: true, bytes: [100] }),
	);
	harness.connection.calls[1]?.onEvent(
		frame({ seq: 3, full: false, bytes: [3] }),
	);
	harness.connection.calls[1]?.onEvent(
		frame({ seq: 4, full: true, bytes: [4] }),
	);
	await flushMicrotasks();

	assert.deepEqual(harness.replaced, []);
	assert.equal(harness.owner.getState().generation, 2);
	assert.equal(harness.owner.getState().phase, 'error');
});

void test('malformed terminal output retires exactly once and ignores late events', async (t) => {
	const scenarios: readonly Readonly<{
		name: string;
		event: () => HerdrCommandStreamEvent;
	}>[] = [
		{
			name: 'invalid JSON',
			event: () => stdout(encoder.encode('{broken\n')),
		},
		{
			name: 'malformed known record',
			event: () =>
				stdoutLine({
					type: 'terminal.frame',
					seq: 1,
					encoding: 'ansi',
					width: 80,
					height: 24,
					bytes: '',
				}),
		},
		{
			name: 'invalid Base64',
			event: () =>
				stdoutLine({
					type: 'terminal.frame',
					seq: 1,
					encoding: 'ansi',
					width: 80,
					height: 24,
					full: true,
					bytes: 'not-base64!',
				}),
		},
		{
			name: 'invalid UTF-8',
			event: () => stdout(Uint8Array.of(0xc3, 0x28, 0x0a)),
		},
		{
			name: 'oversized incomplete line',
			event: () =>
				stdout(new Uint8Array(HERDR_MAX_INCOMPLETE_LINE_BYTES + 1).fill(0x61)),
		},
	];

	for (const scenario of scenarios) {
		await t.test(scenario.name, async () => {
			const harness = createHarness();
			harness.owner.start({ cols: 80, rows: 24 });
			await flushMicrotasks();
			const events = harness.connection.calls[0];

			events?.onEvent(scenario.event());
			events?.onEvent(frame({ seq: 1, full: true, bytes: [1] }));
			events?.onEvent({
				type: 'stderr',
				bytes: arrayBuffer(encoder.encode('late')),
			});
			events?.onEvent({ type: 'exitStatus', exitStatus: 1 });
			events?.onEvent({ type: 'exitSignal', signalName: 'TERM' });
			events?.onEvent({ type: 'closed' });
			await flushMicrotasks();

			assert.deepEqual(harness.replaced, []);
			assert.deepEqual(harness.appended, []);
			assert.equal(harness.owner.sendInput(Uint8Array.of(1)), false);
			const errorStates = harness.states.filter(
				(state) => state.phase === 'error',
			);
			assert.deepEqual(errorStates, [
				{
					phase: 'error',
					generation: 1,
					kind: 'synchronization',
					reason: 'Herdr terminal output lost synchronization.',
				},
			]);
			assert.deepEqual(harness.owner.getState(), errorStates[0]);
			assert.deepEqual(harness.connection.streams[0]?.sentRecords(), [
				{ type: 'terminal.release' },
			]);
			assert.equal(harness.connection.streams[0]?.closeCalls, 1);
		});
	}
});

void test('unknown valid records are ignored before the baseline', () => {
	const harness = createHarness();
	harness.owner.start({ cols: 80, rows: 24 });
	harness.connection.calls[0]?.onEvent(
		stdoutLine({ type: 'future.record', payload: 'ignored' }),
	);

	assert.equal(harness.owner.getState().phase, 'starting');
	assert.deepEqual(harness.replaced, []);

	harness.connection.calls[0]?.onEvent(
		frame({ seq: 1, full: true, bytes: [1] }),
	);
	assert.deepEqual(harness.replaced, [[1]]);
});

void test('the missing full baseline times out at exactly ten seconds', async () => {
	const harness = createHarness();
	harness.owner.start({ cols: 80, rows: 24 });
	await flushMicrotasks();

	harness.clock.advanceBy(9_999);
	assert.equal(harness.owner.getState().phase, 'starting');
	assert.equal(harness.connection.streams[0]?.closeCalls, 0);

	harness.clock.advanceBy(1);
	await flushMicrotasks();

	assert.deepEqual(harness.owner.getState(), {
		phase: 'error',
		generation: 1,
		kind: 'timeout',
		reason: 'Herdr terminal did not provide an initial frame in time.',
	});
	assert.equal(harness.owner.sendInput(Uint8Array.of(1)), false);
	assert.deepEqual(harness.connection.streams[0]?.sentRecords(), [
		{ type: 'terminal.release' },
	]);
	assert.equal(harness.connection.streams[0]?.closeCalls, 1);
});

void test('outbound input, coalesced resize, and scroll preserve admission order', async () => {
	const harness = createHarness();
	harness.owner.start({ cols: 80, rows: 24 });
	await flushMicrotasks();
	harness.connection.calls[0]?.onEvent(
		frame({ seq: 1, full: true, bytes: [1] }),
	);
	const stream = harness.connection.streams[0];
	assert.ok(stream);
	stream.controlSends = true;

	assert.equal(harness.owner.sendInput(Uint8Array.of(0x61)), true);
	assert.equal(harness.owner.sendInput(Uint8Array.of(0x1b, 0x5b, 0x41)), true);
	assert.equal(harness.owner.resize(90, 30), true);
	assert.equal(harness.owner.resize(0, 40), false);
	assert.equal(harness.owner.resize(100, 40), true);
	assert.equal(harness.owner.scroll('up', 0), true);
	assert.equal(harness.owner.scroll('down', 100_000), true);
	await flushMicrotasks();

	assert.equal(stream.sent.length, 1);
	harness.clock.advanceBy(100);
	stream.pendingSends[0]?.resolve();
	await flushMicrotasks();
	assert.equal(stream.sent.length, 2);
	stream.pendingSends[1]?.resolve();
	await flushMicrotasks();
	assert.equal(stream.sent.length, 3);
	stream.pendingSends[2]?.resolve();
	await flushMicrotasks();
	assert.equal(stream.sent.length, 4);
	stream.pendingSends[3]?.resolve();
	await flushMicrotasks();
	assert.equal(stream.sent.length, 5);
	stream.pendingSends[4]?.resolve();
	await flushMicrotasks();

	assert.deepEqual(stream.sentRecords(), [
		{ type: 'terminal.input', bytes: 'YQ==' },
		{ type: 'terminal.input', bytes: 'G1tB' },
		{
			type: 'terminal.resize',
			cols: 100,
			rows: 40,
			cell_width_px: 0,
			cell_height_px: 0,
		},
		{ type: 'terminal.scroll', direction: 'up', lines: 1, source: 'wheel' },
		{
			type: 'terminal.scroll',
			direction: 'down',
			lines: 65_535,
			source: 'wheel',
		},
	]);
	assert.equal(JSON.stringify(harness.logs).includes('YQ=='), false);
});

void test('expired resize windows retain their own queue slot and dimensions', async () => {
	const harness = createHarness();
	harness.owner.start({ cols: 80, rows: 24 });
	await flushMicrotasks();
	harness.connection.calls[0]?.onEvent(
		frame({ seq: 1, full: true, bytes: [1] }),
	);
	const stream = harness.connection.streams[0];
	assert.ok(stream);
	stream.controlSends = true;

	assert.equal(harness.owner.sendInput(Uint8Array.of(0x41)), true);
	assert.equal(harness.owner.resize(90, 30), true);
	await flushMicrotasks();
	assert.equal(stream.sent.length, 1);

	harness.clock.advanceBy(100);
	assert.equal(harness.owner.sendInput(Uint8Array.of(0x42)), true);
	assert.equal(harness.owner.resize(120, 50), true);
	harness.clock.advanceBy(100);

	stream.pendingSends[0]?.resolve();
	await flushMicrotasks();
	assert.equal(stream.sent.length, 2);
	stream.pendingSends[1]?.resolve();
	await flushMicrotasks();
	assert.equal(stream.sent.length, 3);
	stream.pendingSends[2]?.resolve();
	await flushMicrotasks();
	assert.equal(stream.sent.length, 4);
	stream.pendingSends[3]?.resolve();
	await flushMicrotasks();

	assert.deepEqual(stream.sentRecords(), [
		{ type: 'terminal.input', bytes: 'QQ==' },
		{
			type: 'terminal.resize',
			cols: 90,
			rows: 30,
			cell_width_px: 0,
			cell_height_px: 0,
		},
		{ type: 'terminal.input', bytes: 'Qg==' },
		{
			type: 'terminal.resize',
			cols: 120,
			rows: 50,
			cell_width_px: 0,
			cell_height_px: 0,
		},
	]);
});

void test('terminal failure preserves sanitized diagnostics and discards raw stderr', async () => {
	const harness = createHarness();
	harness.owner.start({ cols: 80, rows: 24 });
	await flushMicrotasks();
	const events = harness.connection.calls[0];
	events?.onEvent({
		type: 'stderr',
		bytes: arrayBuffer(encoder.encode('private \u0000 diagnostic')),
	});
	events?.onEvent({ type: 'closed' });
	await flushMicrotasks();

	assert.deepEqual(harness.owner.getState(), {
		phase: 'error',
		generation: 1,
		kind: 'closed',
		reason: 'private diagnostic',
	});
	assert.match(
		JSON.stringify(harness.logs),
		/Herdr terminal diagnostic buffer discarded/,
	);
	assert.equal(JSON.stringify(harness.logs).includes('private'), false);
});

void test('explicit retirement discards raw stderr without logging it', async () => {
	const harness = createHarness();
	harness.owner.start({ cols: 80, rows: 24 });
	await flushMicrotasks();
	harness.connection.calls[0]?.onEvent({
		type: 'stderr',
		bytes: arrayBuffer(encoder.encode('retired-private-data')),
	});

	await harness.owner.retire('unmount');

	assert.match(
		JSON.stringify(harness.logs),
		/Herdr terminal diagnostic buffer discarded/,
	);
	assert.equal(
		JSON.stringify(harness.logs).includes('retired-private-data'),
		false,
	);
});

void test('writes are rejected as soon as retirement begins', async () => {
	const harness = createHarness();
	harness.owner.start({ cols: 80, rows: 24 });
	await flushMicrotasks();
	const retirement = harness.owner.retire('unmount');

	assert.equal(harness.owner.sendInput(Uint8Array.of(1)), false);
	assert.equal(harness.owner.resize(100, 40), false);
	assert.equal(harness.owner.scroll('down', 2), false);

	await retirement;
	assert.equal(harness.connection.streams[0]?.closeCalls, 1);
});

void test('controller conflict is owned elsewhere until explicit takeover', async () => {
	const harness = createHarness();
	harness.owner.start({ cols: 80, rows: 24 });
	await flushMicrotasks();
	const reason =
		'controller already has an attached client; retry with --takeover';

	harness.connection.calls[0]?.onEvent(
		stdoutLine({ type: 'terminal.closed', reason }),
	);
	await flushMicrotasks();

	assert.deepEqual(harness.owner.getState(), {
		phase: 'owned-elsewhere',
		generation: 1,
		reason,
	});
	assert.equal(harness.connection.calls.length, 1);
	assert.equal(harness.connection.streams[0]?.closeCalls, 1);
	assert.equal(harness.owner.sendInput(Uint8Array.of(1)), false);

	harness.owner.takeOver({ cols: 100, rows: 40 });
	await flushMicrotasks();

	assert.equal(harness.connection.calls.length, 2);
	assert.match(harness.connection.calls[1]?.command ?? '', /--takeover$/);
	assert.deepEqual(harness.owner.getState(), {
		phase: 'starting',
		generation: 2,
	});
});

void test('normal, retry, and foreground starts never add takeover', async () => {
	const harness = createHarness();
	harness.owner.start({ cols: 80, rows: 24 });
	await flushMicrotasks();
	assert.doesNotMatch(harness.connection.calls[0]?.command ?? '', /takeover/);

	harness.owner.background();
	harness.owner.start({ cols: 90, rows: 30 });
	await flushMicrotasks();
	assert.equal(harness.connection.calls.length, 2);
	assert.doesNotMatch(harness.connection.calls[1]?.command ?? '', /takeover/);

	harness.owner.retry({ cols: 100, rows: 40 });
	await flushMicrotasks();
	assert.equal(harness.connection.calls.length, 3);
	assert.doesNotMatch(harness.connection.calls[2]?.command ?? '', /takeover/);
	assert.equal(harness.connection.disconnectCalls, 0);
});

void test('graceful retirement is idempotent and closes after a bounded release window', async (t) => {
	for (const reason of [
		'back',
		'switch',
		'retry',
		'failure',
		'unmount',
	] as const) {
		await t.test(reason, async () => {
			const harness = createHarness();
			harness.owner.start({ cols: 80, rows: 24 });
			await flushMicrotasks();
			const stream = harness.connection.streams[0];
			assert.ok(stream);
			stream.controlSends = true;

			if (reason === 'failure') {
				harness.connection.calls[0]?.onEvent(
					stdout(encoder.encode('{broken\n')),
				);
			}
			const first = harness.owner.retire(reason);
			const second = harness.owner.retire(reason);
			assert.strictEqual(first, second);
			assert.equal(harness.owner.sendInput(Uint8Array.of(1)), false);
			await flushMicrotasks();

			assert.deepEqual(stream.sentRecords(), [{ type: 'terminal.release' }]);
			assert.equal(stream.closeCalls, 0);
			const delays = harness.clock.pendingDelays();
			assert.equal(delays.length, 1);
			assert.ok((delays[0] ?? 0) > 0);
			harness.clock.advanceBy(delays[0] ?? 0);
			await flushMicrotasks();

			await first;
			assert.equal(stream.closeCalls, 1);
			assert.deepEqual(stream.sentRecords(), [{ type: 'terminal.release' }]);
			assert.equal(harness.connection.disconnectCalls, 0);
		});
	}
});

void test('graceful retirement closes after release rejection and does not await close settlement', async () => {
	const harness = createHarness();
	harness.owner.start({ cols: 80, rows: 24 });
	await flushMicrotasks();
	const stream = harness.connection.streams[0];
	assert.ok(stream);
	stream.rejectSends = true;
	stream.controlClose = true;

	let settled = false;
	const retirement = harness.owner.retire('unmount').then(() => {
		settled = true;
	});
	await flushMicrotasks();

	assert.equal(stream.closeCalls, 1);
	assert.equal(stream.pendingCloses.length, 1);
	assert.equal(settled, true);
	assert.deepEqual(stream.sentRecords(), [{ type: 'terminal.release' }]);
	assert.equal(harness.connection.disconnectCalls, 0);
	stream.pendingCloses[0]?.resolve();
	await retirement;
});

void test('retry and takeover wait until prior native close is invoked', async (t) => {
	for (const action of ['retry', 'takeover'] as const) {
		await t.test(action, async () => {
			const harness = createHarness();
			harness.owner.start({ cols: 80, rows: 24 });
			await flushMicrotasks();
			const stream = harness.connection.streams[0];
			assert.ok(stream);
			stream.controlSends = true;

			if (action === 'retry') {
				harness.owner.retry({ cols: 90, rows: 30 });
			} else {
				harness.owner.takeOver({ cols: 90, rows: 30 });
			}
			await flushMicrotasks();
			assert.equal(harness.connection.calls.length, 1);
			assert.equal(stream.closeCalls, 0);

			const delays = harness.clock.pendingDelays();
			assert.equal(delays.length, 1);
			harness.clock.advanceBy(delays[0] ?? 0);
			assert.equal(stream.closeCalls, 1);
			assert.equal(harness.connection.calls.length, 1);
			await flushMicrotasks();

			assert.equal(harness.connection.calls.length, 2);
			if (action === 'takeover') {
				assert.match(harness.connection.calls[1]?.command ?? '', /--takeover$/);
			} else {
				assert.doesNotMatch(
					harness.connection.calls[1]?.command ?? '',
					/takeover/,
				);
			}
		});
	}
});

void test('background synchronously stops admission, publishes, and invokes native close', async () => {
	const harness = createHarness();
	harness.owner.start({ cols: 80, rows: 24 });
	await flushMicrotasks();
	const stream = harness.connection.streams[0];
	assert.ok(stream);
	stream.controlSends = true;

	harness.owner.background();

	assert.deepEqual(harness.owner.getState(), {
		phase: 'backgrounded',
		generation: 1,
	});
	assert.equal(harness.owner.sendInput(Uint8Array.of(1)), false);
	assert.equal(stream.closeCalls, 1);
	assert.deepEqual(stream.sentRecords(), [{ type: 'terminal.release' }]);
	assert.equal(harness.connection.disconnectCalls, 0);
});

void test('a stream resolving after background closes immediately and stays inert', async () => {
	const harness = createHarness();
	harness.connection.controlStarts = true;
	harness.owner.start({ cols: 80, rows: 24 });
	const events = harness.connection.calls[0];
	const stream = harness.connection.streams[0];
	assert.ok(stream);
	stream.closeError = new Error('private close details');

	harness.owner.background();
	assert.deepEqual(harness.owner.getState(), {
		phase: 'backgrounded',
		generation: 1,
	});
	assert.equal(harness.owner.sendInput(Uint8Array.of(1)), false);
	assert.equal(stream.closeCalls, 0);

	harness.connection.pendingStarts[0]?.resolve(stream);
	await flushMicrotasks();
	assert.equal(stream.closeCalls, 1);

	events?.onEvent(frame({ seq: 1, full: true, bytes: [1] }));
	events?.onEvent({
		type: 'stderr',
		bytes: arrayBuffer(encoder.encode('late private stderr')),
	});
	events?.onEvent({ type: 'exitStatus', exitStatus: 1 });
	events?.onEvent({ type: 'exitSignal', signalName: 'TERM' });
	events?.onEvent({ type: 'closed' });
	await flushMicrotasks();

	assert.deepEqual(harness.owner.getState(), {
		phase: 'backgrounded',
		generation: 1,
	});
	assert.deepEqual(harness.replaced, []);
	assert.deepEqual(harness.appended, []);
	const serializedLogs = JSON.stringify(harness.logs);
	assert.match(serializedLogs, /Herdr terminal cleanup failed/);
	assert.match(serializedLogs, /"operation":"close"/);
	assert.match(serializedLogs, /"errorClass":"Error"/);
	assert.equal(serializedLogs.includes('private close details'), false);
	assert.equal(serializedLogs.includes('late private stderr'), false);
});
