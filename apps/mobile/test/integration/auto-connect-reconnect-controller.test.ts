import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createAutoConnectReconnectController,
	type AutoConnectReconnectSnapshot,
} from '../../src/lib/auto-connect-reconnect-controller';

type Timer = {
	id: number;
	delayMs: number;
	callback: () => void;
	cleared: boolean;
};

function flushPromises() {
	return new Promise<void>((resolve) => {
		setImmediate(resolve);
	});
}

function eventKinds(events: unknown[]) {
	return events.map((event) => (event as { kind: string }).kind);
}

function clearTestTimer(timers: Timer[], timer: Timer) {
	timer.cleared = true;
	const index = timers.indexOf(timer);
	if (index !== -1) timers.splice(index, 1);
}

function harness(
	opts: Partial<AutoConnectReconnectSnapshot> & {
		delaysMs?: readonly number[];
		windowMs?: number;
		attemptResults?: boolean[];
		attemptAutoConnect?: (signal: AbortSignal) => Promise<boolean>;
	} = {},
) {
	let nowMs = 0;
	let nextTimerId = 1;
	let reconnecting = opts.isReconnecting ?? false;
	const timers: Timer[] = [];
	const setReconnectingCalls: boolean[] = [];
	const attempts: number[] = [];
	const events: unknown[] = [];
	const logs: { level: 'info' | 'warn'; message: string }[] = [];
	const snapshot: AutoConnectReconnectSnapshot = {
		isAutoConnecting: opts.isAutoConnecting ?? false,
		isReconnecting: reconnecting,
		resetInFlight: opts.resetInFlight ?? false,
		platformOS: opts.platformOS ?? 'ios',
		appActive: opts.appActive ?? true,
		backgroundWorkAllowed: opts.backgroundWorkAllowed ?? false,
		foregroundServiceRequired: opts.foregroundServiceRequired ?? false,
	};
	const attemptResults = [...(opts.attemptResults ?? [false])];

	const setTestTimeout = (callback: () => void, delayMs: number) => {
		const timer = {
			id: nextTimerId,
			delayMs,
			callback,
			cleared: false,
		};
		nextTimerId += 1;
		timers.push(timer);
		return timer;
	};
	const clearTestTimeout = (timer: unknown) => {
		clearTestTimer(timers, timer as Timer);
	};

	const controller = createAutoConnectReconnectController({
		delaysMs: opts.delaysMs ?? [10, 20, 30],
		windowMs: opts.windowMs ?? 100,
		now: () => nowMs,
		setTimeout: setTestTimeout,
		clearTimeout: clearTestTimeout,
		getSnapshot: () => ({
			...snapshot,
			isReconnecting: reconnecting,
		}),
		setReconnecting: (next) => {
			reconnecting = next;
			setReconnectingCalls.push(next);
		},
		attemptAutoConnect:
			opts.attemptAutoConnect ??
			(async () => {
				attempts.push(nowMs);
				return attemptResults.shift() ?? false;
			}),
		logger: {
			info: (message) => {
				logs.push({ level: 'info', message });
			},
			warn: (message) => {
				logs.push({ level: 'warn', message });
			},
		},
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	return {
		controller,
		timers,
		attempts,
		events,
		logs,
		setReconnectingCalls,
		snapshot,
		setTimeout: setTestTimeout,
		clearTimeout: clearTestTimeout,
		setNow: (next: number) => {
			nowMs = next;
		},
		runTimer: async (timer: Timer) => {
			assert.equal(timer.cleared, false);
			timer.callback();
			await flushPromises();
		},
	};
}

void test('starts once and schedules retry after failed attempt', async () => {
	const context = harness({ attemptResults: [false] });

	assert.equal(context.controller.start('shell-drop'), true);
	await flushPromises();

	assert.equal(context.controller.isRunning(), true);
	assert.deepEqual(context.attempts, [0]);
	assert.equal(context.timers.length, 1);
	assert.equal(context.timers[0]?.delayMs, 10);
	assert.deepEqual(context.setReconnectingCalls, [true]);
	assert.deepEqual(eventKinds(context.events), [
		'reconnect.started',
		'reconnect.attempt.started',
		'reconnect.attempt.failed',
		'reconnect.retry.scheduled',
	]);
	assert.deepEqual(context.events[0], {
		kind: 'reconnect.started',
		source: 'reconnect-controller',
		message: 'shell-drop',
		reason: 'shell-drop',
		windowMs: 100,
	});
	assert.deepEqual(context.events[2], {
		kind: 'reconnect.attempt.failed',
		source: 'reconnect-controller',
		message: undefined,
		reconnectElapsedMs: 0,
	});
	assert.deepEqual(context.events[3], {
		kind: 'reconnect.retry.scheduled',
		source: 'reconnect-controller',
		message: undefined,
		attemptIndex: 0,
		delayMs: 10,
	});
});

void test('rejected reconnect attempt records failure and schedules retry', async () => {
	let attemptCount = 0;
	const reconnectError = new Error('latest saved connection failed');
	const context = harness({
		attemptAutoConnect: async () => {
			attemptCount += 1;
			throw reconnectError;
		},
	});

	assert.equal(context.controller.start('shell-drop'), true);
	await flushPromises();

	assert.equal(context.controller.isRunning(), true);
	assert.equal(attemptCount, 1);
	assert.equal(context.timers.length, 1);
	assert.equal(context.timers[0]?.delayMs, 10);
	assert.deepEqual(context.setReconnectingCalls, [true]);
	assert.deepEqual(eventKinds(context.events), [
		'reconnect.started',
		'reconnect.attempt.started',
		'reconnect.attempt.failed',
		'reconnect.retry.scheduled',
	]);
	assert.equal(
		context.logs.some((log) => log.message === 'Reconnect attempt threw'),
		true,
	);
});

void test('rejected reconnect attempt stops when reset starts', async () => {
	let attemptCount = 0;
	const context = harness({
		attemptAutoConnect: async () => {
			attemptCount += 1;
			context.snapshot.resetInFlight = true;
			throw new Error('latest saved connection failed');
		},
	});

	assert.equal(context.controller.start('shell-drop'), true);
	await flushPromises();

	assert.equal(context.controller.isRunning(), false);
	assert.equal(attemptCount, 1);
	assert.deepEqual(context.setReconnectingCalls, [true, false]);
	assert.deepEqual(eventKinds(context.events), [
		'reconnect.started',
		'reconnect.attempt.started',
		'reconnect.attempt.failed',
		'reconnect.stopped',
	]);
	assert.deepEqual(context.events.at(-1), {
		kind: 'reconnect.stopped',
		source: 'reconnect-controller',
		message: 'tailscale-reset-in-progress',
		reason: 'tailscale-reset-in-progress',
	});
});

void test('hung reconnect attempt stops at the reconnect window', async () => {
	let attemptAborted = false;
	const context = harness({
		windowMs: 15,
		attemptAutoConnect: (signal) => {
			attemptAborted = signal.aborted;
			signal.addEventListener('abort', () => {
				attemptAborted = true;
			});
			return new Promise<boolean>(() => undefined);
		},
	});

	assert.equal(context.controller.start('shell-drop'), true);
	await flushPromises();

	assert.equal(context.controller.isRunning(), true);
	assert.equal(context.timers[0]?.delayMs, 15);

	context.setNow(15);
	await context.runTimer(context.timers[0]!);

	assert.equal(attemptAborted, true);
	assert.equal(context.controller.isRunning(), false);
	assert.deepEqual(context.setReconnectingCalls, [true, false]);
	assert.deepEqual(eventKinds(context.events), [
		'reconnect.started',
		'reconnect.attempt.started',
		'reconnect.timeout',
		'reconnect.stopped',
	]);
	assert.deepEqual(context.events.at(-2), {
		kind: 'reconnect.timeout',
		source: 'reconnect-controller',
		message: undefined,
		reconnectElapsedMs: 15,
		windowMs: 15,
	});
	assert.deepEqual(context.events.at(-1), {
		kind: 'reconnect.stopped',
		source: 'reconnect-controller',
		message: 'retry-timeout',
		reason: 'retry-timeout',
	});
});

void test('hung retry uses only the remaining reconnect window', async () => {
	let attemptCount = 0;
	const context = harness({
		windowMs: 100,
		delaysMs: [10],
		attemptAutoConnect: async () => {
			attemptCount += 1;
			if (attemptCount === 1) return false;
			return new Promise<boolean>(() => undefined);
		},
	});

	assert.equal(context.controller.start('shell-drop'), true);
	await flushPromises();

	assert.equal(context.timers[0]?.delayMs, 10);
	context.setNow(70);
	await context.runTimer(context.timers[0]!);

	assert.equal(attemptCount, 2);
	const deadlineTimer = context.timers.find(
		(timer) => !timer.cleared && timer.delayMs === 30,
	);
	assert.ok(deadlineTimer);

	context.setNow(100);
	await context.runTimer(deadlineTimer);

	assert.equal(context.controller.isRunning(), false);
	assert.deepEqual(eventKinds(context.events).slice(-2), [
		'reconnect.timeout',
		'reconnect.stopped',
	]);
});

void test('blocks duplicate starts', async () => {
	const context = harness({ attemptResults: [false] });

	assert.equal(context.controller.start('shell-drop'), true);
	assert.equal(context.controller.start('app-resume-no-shell'), false);
	await flushPromises();

	assert.deepEqual(context.attempts, [0]);
	assert.equal(context.timers.length, 1);
	assert.deepEqual(context.setReconnectingCalls, [true]);
	assert.deepEqual(context.events[2], {
		kind: 'reconnect.start.blocked',
		source: 'reconnect-controller',
		message: 'app-resume-no-shell',
		reason: 'app-resume-no-shell',
		isAutoConnecting: false,
		isReconnecting: true,
		resetInFlight: false,
	});
});

void test('blocks start while auto-connect is already in flight', () => {
	const context = harness({ isAutoConnecting: true });

	assert.equal(context.controller.start('shell-drop'), false);

	assert.equal(context.controller.isRunning(), false);
	assert.deepEqual(context.attempts, []);
	assert.equal(context.timers.length, 0);
	assert.deepEqual(context.setReconnectingCalls, []);
	assert.deepEqual(context.events, [
		{
			kind: 'reconnect.start.blocked',
			source: 'reconnect-controller',
			message: 'shell-drop',
			reason: 'shell-drop',
			isAutoConnecting: true,
			isReconnecting: false,
			resetInFlight: false,
		},
	]);
});

void test('blocks start while reconnect state already exists', () => {
	const context = harness({ isReconnecting: true });

	assert.equal(context.controller.start('shell-drop'), false);

	assert.equal(context.controller.isRunning(), false);
	assert.deepEqual(context.attempts, []);
	assert.equal(context.timers.length, 0);
	assert.deepEqual(context.setReconnectingCalls, []);
	assert.deepEqual(context.events, [
		{
			kind: 'reconnect.start.blocked',
			source: 'reconnect-controller',
			message: 'shell-drop',
			reason: 'shell-drop',
			isAutoConnecting: false,
			isReconnecting: true,
			resetInFlight: false,
		},
	]);
});

void test('replacement stops current loop and starts a new one', async () => {
	const context = harness({ attemptResults: [false, false] });

	assert.equal(context.controller.start('shell-drop'), true);
	await flushPromises();
	const firstTimer = context.timers[0];
	assert.ok(firstTimer);

	assert.equal(context.controller.replace('tailscale-reset-action'), true);
	await flushPromises();

	assert.equal(firstTimer.cleared, true);
	assert.equal(context.controller.isRunning(), true);
	assert.deepEqual(context.attempts, [0, 0]);
	assert.deepEqual(context.setReconnectingCalls, [true, false, true]);
	assert.equal(context.timers.length, 1);
	assert.equal(context.timers[0]?.delayMs, 10);
	assert.equal(
		eventKinds(context.events).includes('reconnect.stopped'),
		true,
	);
	assert.deepEqual(
		context.events.find(
			(event) => (event as { kind: string }).kind === 'reconnect.stopped',
		),
		{
			kind: 'reconnect.stopped',
			source: 'reconnect-controller',
			message: 'tailscale-reset-action-restart',
			reason: 'tailscale-reset-action-restart',
		},
	);
});

void test('in-flight attempt resolving after replacement cannot update the new loop', async () => {
	const attemptCalls: number[] = [];
	const resolvers: ((value: boolean) => void)[] = [];
	const context = harness({
		attemptAutoConnect: () => {
			attemptCalls.push(attemptCalls.length + 1);
			return new Promise<boolean>((resolve) => {
				resolvers.push(resolve);
			});
		},
	});

	assert.equal(context.controller.start('shell-drop'), true);
	assert.deepEqual(attemptCalls, [1]);

	assert.equal(context.controller.replace('tailscale-reset-action'), true);
	assert.deepEqual(attemptCalls, [1, 2]);

	resolvers[0]?.(false);
	await flushPromises();

	assert.equal(context.controller.isRunning(), true);
	assert.equal(context.timers.length, 1);
	assert.equal(context.timers[0]?.delayMs, 100);
	assert.deepEqual(context.setReconnectingCalls, [true, false, true]);

	resolvers[1]?.(false);
	await flushPromises();

	assert.equal(context.controller.isRunning(), true);
	assert.equal(context.timers.length, 1);
	assert.equal(context.timers[0]?.delayMs, 10);
});

void test('replace aborts the replaced reconnect attempt', async () => {
	const attemptSignals: AbortSignal[] = [];
	const context = harness({
		attemptAutoConnect: (signal) => {
			attemptSignals.push(signal);
			return new Promise<boolean>(() => undefined);
		},
	});

	assert.equal(context.controller.start('shell-drop'), true);
	assert.equal(attemptSignals[0]?.aborted, false);

	assert.equal(context.controller.replace('tailscale-reset-action'), true);

	assert.equal(attemptSignals[0]?.aborted, true);
	assert.equal(attemptSignals[1]?.aborted, false);
});

void test('replace starts a new loop while the aborted attempt still marks auto-connecting', async () => {
	const attemptSignals: AbortSignal[] = [];
	const context = harness({
		attemptAutoConnect: (signal) => {
			attemptSignals.push(signal);
			context.snapshot.isAutoConnecting = true;
			return new Promise<boolean>(() => undefined);
		},
	});

	assert.equal(context.controller.start('shell-drop'), true);
	assert.equal(context.controller.replace('tailscale-reset-action'), true);

	assert.equal(attemptSignals.length, 2);
	assert.equal(attemptSignals[0]?.aborted, true);
	assert.equal(attemptSignals[1]?.aborted, false);
	assert.equal(context.controller.isRunning(), true);
	assert.deepEqual(context.setReconnectingCalls, [true, false, true]);
});

void test('stale in-flight attempt rejection after replacement is ignored', async () => {
	const rejecters: ((error: unknown) => void)[] = [];
	const context = harness({
		attemptAutoConnect: () =>
			new Promise<boolean>((_resolve, reject) => {
				rejecters.push(reject);
			}),
	});

	assert.equal(context.controller.start('shell-drop'), true);
	assert.equal(context.controller.replace('tailscale-reset-action'), true);

	rejecters[0]?.(new Error('stale attempt failed'));
	await flushPromises();

	assert.equal(context.controller.isRunning(), true);
	assert.equal(context.timers.length, 1);
	assert.equal(context.timers[0]?.delayMs, 100);
	assert.deepEqual(eventKinds(context.events), [
		'reconnect.started',
		'reconnect.attempt.started',
		'reconnect.stopped',
		'reconnect.started',
		'reconnect.attempt.started',
	]);
});

void test('stop aborts the active reconnect attempt', async () => {
	let attemptAborted = false;
	const context = harness({
		attemptAutoConnect: (signal) => {
			attemptAborted = signal.aborted;
			signal.addEventListener('abort', () => {
				attemptAborted = true;
			});
			return new Promise<boolean>(() => undefined);
		},
	});

	assert.equal(context.controller.start('shell-drop'), true);
	assert.equal(attemptAborted, false);

	context.controller.stop('test-stop');

	assert.equal(attemptAborted, true);
	assert.equal(context.controller.isRunning(), false);
});

void test('stopped loops cannot schedule another retry', async () => {
	const context = harness({ attemptResults: [false] });

	assert.equal(context.controller.start('shell-drop'), true);
	context.controller.stop('test-stop');
	await flushPromises();

	assert.equal(context.controller.isRunning(), false);
	assert.equal(context.timers.length, 0);
	assert.deepEqual(context.attempts, [0]);
	assert.deepEqual(eventKinds(context.events).slice(-1), [
		'reconnect.stopped',
	]);
	assert.deepEqual(context.events.at(-1), {
		kind: 'reconnect.stopped',
		source: 'reconnect-controller',
		message: 'test-stop',
		reason: 'test-stop',
	});
});

void test('stale loops cannot schedule another retry', async () => {
	let resolveAttempt: (value: boolean) => void = () => {};
	const context = harness({
		attemptAutoConnect: () =>
			new Promise<boolean>((resolve) => {
				resolveAttempt = resolve;
			}),
	});

	assert.equal(context.controller.start('shell-drop'), true);
	context.controller.stop('test-stop');
	resolveAttempt(false);
	await flushPromises();

	assert.equal(context.controller.isRunning(), false);
	assert.equal(context.timers.length, 0);
});

void test('timeout stops the loop', async () => {
	const context = harness({ attemptResults: [false, false], windowMs: 15 });

	assert.equal(context.controller.start('shell-drop'), true);
	await flushPromises();
	context.setNow(20);
	await context.runTimer(context.timers[0]!);

	assert.equal(context.controller.isRunning(), false);
	assert.deepEqual(context.attempts, [0]);
	assert.deepEqual(context.setReconnectingCalls, [true, false]);
	assert.deepEqual(eventKinds(context.events).slice(-2), [
		'reconnect.timeout',
		'reconnect.stopped',
	]);
	assert.deepEqual(context.events.at(-2), {
		kind: 'reconnect.timeout',
		source: 'reconnect-controller',
		message: undefined,
		reconnectElapsedMs: 20,
		windowMs: 15,
	});
	assert.deepEqual(context.events.at(-1), {
		kind: 'reconnect.stopped',
		source: 'reconnect-controller',
		message: 'retry-timeout',
		reason: 'retry-timeout',
	});
	assert.equal(
		context.logs.some((log) => log.message === 'Reconnect timeout reached'),
		true,
	);
});

void test('successful reconnect stops the loop', async () => {
	const context = harness({ attemptResults: [true] });

	assert.equal(context.controller.start('shell-drop'), true);
	await flushPromises();

	assert.equal(context.controller.isRunning(), false);
	assert.deepEqual(context.attempts, [0]);
	assert.equal(context.timers.length, 0);
	assert.deepEqual(context.setReconnectingCalls, [true, false]);
	assert.deepEqual(eventKinds(context.events), [
		'reconnect.started',
		'reconnect.attempt.started',
		'reconnect.attempt.connected',
		'reconnect.stopped',
	]);
	assert.deepEqual(context.events[2], {
		kind: 'reconnect.attempt.connected',
		source: 'reconnect-controller',
		message: undefined,
		reconnectElapsedMs: 0,
	});
	assert.deepEqual(context.events[3], {
		kind: 'reconnect.stopped',
		source: 'reconnect-controller',
		message: 'reconnected',
		reason: 'reconnected',
	});
	assert.equal(
		context.logs.some((log) => log.message === 'Reconnected successfully'),
		true,
	);
});

void test('reset-in-flight snapshot blocks start and retry', async () => {
	const startBlocked = harness({ resetInFlight: true });
	assert.equal(startBlocked.controller.start('tailscale-reset-action'), false);
	assert.deepEqual(startBlocked.attempts, []);
	assert.deepEqual(startBlocked.setReconnectingCalls, []);

	const retryBlocked = harness({ attemptResults: [false, false] });
	assert.equal(retryBlocked.controller.start('shell-drop'), true);
	await flushPromises();
	retryBlocked.snapshot.resetInFlight = true;
	await retryBlocked.runTimer(retryBlocked.timers[0]!);

	assert.equal(retryBlocked.controller.isRunning(), false);
	assert.deepEqual(retryBlocked.attempts, [0]);
	assert.deepEqual(retryBlocked.setReconnectingCalls, [true, false]);
});

void test('reset-in-flight after a failed attempt stops without scheduling retry', async () => {
	let attemptCount = 0;
	let resolveAttempt: (value: boolean) => void = () => {};
	const context = harness({
		attemptAutoConnect: () => {
			attemptCount += 1;
			return new Promise<boolean>((resolve) => {
				resolveAttempt = resolve;
			});
		},
	});

	assert.equal(context.controller.start('shell-drop'), true);
	assert.equal(attemptCount, 1);

	context.snapshot.resetInFlight = true;
	resolveAttempt(false);
	await flushPromises();

	assert.equal(context.controller.isRunning(), false);
	assert.equal(context.timers.length, 0);
	assert.equal(attemptCount, 1);
	assert.deepEqual(context.setReconnectingCalls, [true, false]);
});

void test('background not allowed stops with app-not-active', async () => {
	const context = harness({
		platformOS: 'ios',
		appActive: false,
		backgroundWorkAllowed: false,
	});

	assert.equal(context.controller.start('shell-drop'), true);
	await flushPromises();

	assert.equal(context.controller.isRunning(), false);
	assert.deepEqual(context.attempts, []);
	assert.deepEqual(context.setReconnectingCalls, [true, false]);
	assert.deepEqual(eventKinds(context.events), [
		'reconnect.started',
		'reconnect.stopped',
	]);
	assert.equal(
		context.logs.some((log) => log.message === 'Reconnect cycle stopped'),
		true,
	);
});

void test('foreground coverage wait schedules next attempt without calling attemptAutoConnect', async () => {
	const context = harness({
		platformOS: 'android',
		appActive: false,
		backgroundWorkAllowed: false,
		foregroundServiceRequired: true,
	});

	assert.equal(context.controller.start('shell-drop'), true);
	await flushPromises();

	assert.equal(context.controller.isRunning(), true);
	assert.deepEqual(context.attempts, []);
	assert.equal(context.timers.length, 1);
	assert.equal(context.timers[0]?.delayMs, 10);
	assert.deepEqual(eventKinds(context.events), [
		'reconnect.started',
		'reconnect.retry.scheduled',
	]);
	assert.deepEqual(context.events[1], {
		kind: 'reconnect.retry.scheduled',
		source: 'reconnect-controller',
		message: undefined,
		attemptIndex: 0,
		delayMs: 10,
	});
});

void test('foreground coverage wait retries once background work becomes available', async () => {
	const context = harness({
		platformOS: 'android',
		appActive: false,
		backgroundWorkAllowed: false,
		foregroundServiceRequired: true,
		attemptResults: [false],
	});

	assert.equal(context.controller.start('shell-drop'), true);
	await flushPromises();
	assert.deepEqual(context.attempts, []);
	assert.equal(context.timers.length, 1);

	context.snapshot.backgroundWorkAllowed = true;
	await context.runTimer(context.timers[0]!);

	assert.deepEqual(context.attempts, [0]);
	assert.equal(context.controller.isRunning(), true);
	assert.equal(context.timers.length, 2);
	assert.equal(context.timers[1]?.delayMs, 20);
});

void test('retry backoff progresses and caps at the final configured delay', async () => {
	const context = harness({
		delaysMs: [10, 20],
		attemptResults: [false, false, false, false],
	});

	assert.equal(context.controller.start('shell-drop'), true);
	await flushPromises();
	assert.equal(context.timers[0]?.delayMs, 10);

	await context.runTimer(context.timers[0]!);
	assert.equal(context.timers[1]?.delayMs, 20);

	await context.runTimer(context.timers[1]!);
	assert.equal(context.timers[2]?.delayMs, 20);
});

void test('records reconnect lifecycle trace events', async () => {
	const context = harness({ attemptResults: [false], delaysMs: [10] });
	const events: unknown[] = [];
	const tracedController = createAutoConnectReconnectController({
		delaysMs: [10],
		windowMs: 100,
		now: () => 0,
		setTimeout: context.setTimeout,
		clearTimeout: context.clearTimeout,
		getSnapshot: () => ({
			...context.snapshot,
			isReconnecting: false,
		}),
		setReconnecting: () => {},
		attemptAutoConnect: async () => false,
		logger: {
			info: () => {},
			warn: () => {},
		},
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.equal(tracedController.start('shell-drop'), true);
	await flushPromises();

	assert.deepEqual(
		events.map((event) => (event as { kind: string }).kind),
		[
			'reconnect.started',
			'reconnect.attempt.started',
			'reconnect.attempt.failed',
			'reconnect.retry.scheduled',
		],
	);
	assert.deepEqual(events[0], {
		kind: 'reconnect.started',
		source: 'reconnect-controller',
		message: 'shell-drop',
		reason: 'shell-drop',
		windowMs: 100,
	});
	assert.deepEqual(events[2], {
		kind: 'reconnect.attempt.failed',
		source: 'reconnect-controller',
		message: undefined,
		reconnectElapsedMs: 0,
	});
	assert.deepEqual(events[3], {
		kind: 'reconnect.retry.scheduled',
		source: 'reconnect-controller',
		message: undefined,
		attemptIndex: 0,
		delayMs: 10,
	});
});

void test('records blocked reconnect start trace event', () => {
	const events: unknown[] = [];
	const context = harness({ isAutoConnecting: true });
	const blockedController = createAutoConnectReconnectController({
		delaysMs: [10],
		windowMs: 100,
		now: () => 0,
		setTimeout: context.setTimeout,
		clearTimeout: context.clearTimeout,
		getSnapshot: () => ({
			...context.snapshot,
			isAutoConnecting: true,
		}),
		setReconnecting: () => {},
		attemptAutoConnect: async () => false,
		logger: {
			info: () => {},
			warn: () => {},
		},
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.equal(blockedController.start('shell-drop'), false);
	assert.deepEqual(events, [
		{
			kind: 'reconnect.start.blocked',
			source: 'reconnect-controller',
			message: 'shell-drop',
			reason: 'shell-drop',
			isAutoConnecting: true,
			isReconnecting: false,
			resetInFlight: false,
		},
	]);
});

void test('swallows reconnect trace event failures', async () => {
	const context = harness({ attemptResults: [true] });
	const warnings: unknown[] = [];
	const controller = createAutoConnectReconnectController({
		delaysMs: [10],
		windowMs: 100,
		now: () => 0,
		setTimeout: context.setTimeout,
		clearTimeout: context.clearTimeout,
		getSnapshot: () => ({
			...context.snapshot,
			isReconnecting: false,
		}),
		setReconnecting: () => {},
		attemptAutoConnect: async () => true,
		logger: {
			info: () => {},
			warn: (_message, context) => {
				warnings.push(context);
			},
		},
		trace: {
			event: () => {
				throw new Error('trace sink failed');
			},
		},
	});

	assert.equal(controller.start('shell-drop'), true);
	await flushPromises();

	assert.equal(controller.isRunning(), false);
	assert.equal(warnings.length > 0, true);
});

void test('trace payload mutation cannot change reconnect backoff', async () => {
	const context = harness({ attemptResults: [false] });
	const controller = createAutoConnectReconnectController({
		delaysMs: [10],
		windowMs: 100,
		now: () => 0,
		setTimeout: context.setTimeout,
		clearTimeout: context.clearTimeout,
		getSnapshot: () => ({
			...context.snapshot,
			isReconnecting: false,
		}),
		setReconnecting: () => {},
		attemptAutoConnect: async () => false,
		logger: {
			info: () => {},
			warn: () => {},
		},
		trace: {
			event: (event) => {
				if (event.kind !== 'reconnect.started') return;
				event.windowMs = 999;
			},
		},
	});

	assert.equal(controller.start('shell-drop'), true);
	await flushPromises();

	assert.equal(context.timers[0]?.delayMs, 10);
});

void test('records reconnect timeout and stopped trace events', async () => {
	const context = harness({ attemptResults: [false], windowMs: 15 });
	const events: unknown[] = [];
	const controller = createAutoConnectReconnectController({
		delaysMs: [10],
		windowMs: 15,
		now: () => (context.timers.length ? 20 : 0),
		setTimeout: context.setTimeout,
		clearTimeout: context.clearTimeout,
		getSnapshot: () => ({
			...context.snapshot,
			isReconnecting: false,
		}),
		setReconnecting: () => {},
		attemptAutoConnect: async () => false,
		logger: {
			info: () => {},
			warn: () => {},
		},
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.equal(controller.start('shell-drop'), true);
	await flushPromises();
	await context.runTimer(context.timers[0]!);

	assert.deepEqual(
		events.map((event) => (event as { kind: string }).kind),
		[
			'reconnect.started',
			'reconnect.attempt.started',
			'reconnect.attempt.failed',
			'reconnect.retry.scheduled',
			'reconnect.timeout',
			'reconnect.stopped',
		],
	);
	assert.deepEqual(events.at(-1), {
		kind: 'reconnect.stopped',
		source: 'reconnect-controller',
		message: 'retry-timeout',
		reason: 'retry-timeout',
	});
});

void test('records successful reconnect trace events', async () => {
	const events: unknown[] = [];
	const context = harness({ attemptResults: [true] });
	const controller = createAutoConnectReconnectController({
		delaysMs: [10],
		windowMs: 100,
		now: () => 0,
		setTimeout: context.setTimeout,
		clearTimeout: context.clearTimeout,
		getSnapshot: () => ({
			isAutoConnecting: false,
			isReconnecting: false,
			resetInFlight: false,
			platformOS: 'ios',
			appActive: true,
			backgroundWorkAllowed: false,
			foregroundServiceRequired: false,
		}),
		setReconnecting: () => {},
		attemptAutoConnect: async () => true,
		logger: {
			info: () => {},
			warn: () => {},
		},
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.equal(controller.start('shell-drop'), true);
	await flushPromises();

	assert.deepEqual(
		events.map((event) => (event as { kind: string }).kind),
		[
			'reconnect.started',
			'reconnect.attempt.started',
			'reconnect.attempt.connected',
			'reconnect.stopped',
		],
	);
	assert.deepEqual(events.at(-1), {
		kind: 'reconnect.stopped',
		source: 'reconnect-controller',
		message: 'reconnected',
		reason: 'reconnected',
	});
});
