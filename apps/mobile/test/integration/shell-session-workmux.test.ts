import assert from 'node:assert/strict';
import test from 'node:test';
import { type ConnectionDiagnosticEvent } from '../../src/lib/connection-diagnostics';
import { type MdevBridgeDisposeOptions } from '../../src/lib/mdev-bridge-client';
import { createShellDiagnosticPort } from '../../src/lib/shell-controllers/session-diagnostics';
import { createShellSessionWorkmuxOwner } from '../../src/lib/shell-controllers/session-workmux';
import { type ShellTargetKey } from '../../src/lib/shell-controllers/source-keys';
import {
	type WorkmuxControlChannel,
	type WorkmuxControlCommandResult,
} from '../../src/lib/workmux-control-channel';

type DiagnosticWarning = { message: string; error?: unknown };

type ShellSessionWorkmuxInput = Parameters<
	typeof createShellSessionWorkmuxOwner
>[0];

function targetKey(value: string): ShellTargetKey {
	return value as ShellTargetKey;
}

function deferred<T = void>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function createClock() {
	type Timer = { task: () => void; dueAt: number; cleared: boolean };
	let now = 0;
	const timers: Timer[] = [];
	return {
		setTimeout: (task: () => void, delayMs: number): unknown => {
			const timer = { task, dueAt: now + delayMs, cleared: false };
			timers.push(timer);
			return timer;
		},
		clearTimeout: (timer: unknown): void => {
			(timer as Timer).cleared = true;
		},
		advanceBy: (durationMs: number): void => {
			now += durationMs;
			for (const timer of timers) {
				if (timer.cleared || timer.dueAt > now) continue;
				timer.cleared = true;
				timer.task();
			}
		},
	};
}

function createChannel({
	label,
	events,
	onPrepare,
	onDispose,
}: {
	label: string;
	events: string[];
	onPrepare?: () => void;
	onDispose?: () => Promise<void>;
}): WorkmuxControlChannel {
	const success = (output: string): WorkmuxControlCommandResult => ({
		success: true,
		output,
	});
	return {
		command: async (argv) => {
			events.push(`${label}:command:${argv.join(' ')}`);
			return success(`${label}:command-output`);
		},
		operation: async (request) => {
			events.push(`${label}:operation:${request.operation}`);
			return success(`${label}:operation-output`);
		},
		scroll: {
			enter: async ({ sessionName }) => {
				events.push(`${label}:enter:${sessionName}`);
				return success('');
			},
			move: async ({ sessionName }) => {
				events.push(`${label}:move:${sessionName}`);
				return success('');
			},
			exit: async ({ sessionName }) => {
				events.push(`${label}:exit:${sessionName}`);
				return success('');
			},
		},
		prepareDispose: (_options?: MdevBridgeDisposeOptions) => {
			events.push(`${label}:prepare`);
			onPrepare?.();
		},
		dispose: async (_options?: MdevBridgeDisposeOptions) => {
			events.push(`${label}:dispose`);
			await onDispose?.();
		},
	};
}

function createHarness(
	initialTarget: string,
	options: {
		cleanupTimeoutMs?: number;
		createChannel?: (label: string, events: string[]) => WorkmuxControlChannel;
		diagnostics?: { warn(message: string, error?: unknown): void };
		clearTimeout?: (timer: unknown) => void;
	} = {},
) {
	const events: string[] = [];
	const diagnostics: DiagnosticWarning[] = [];
	const clock = createClock();
	let channelNumber = 0;
	const labels = ['old', 'new', 'newer'];
	const createInput = (target: string): ShellSessionWorkmuxInput => ({
		key: targetKey(target),
		connection: null,
		diagnostics: {
			event: () => {},
			warn: (message, error) => {
				diagnostics.push({ message, error });
				options.diagnostics?.warn(message, error);
			},
		},
		createChannel: () => {
			const label = labels[channelNumber] ?? `channel-${channelNumber}`;
			channelNumber += 1;
			return (
				options.createChannel?.(label, events) ??
				createChannel({ label, events })
			);
		},
		cleanupTimeoutMs: options.cleanupTimeoutMs ?? 5_000,
		setTimeout: clock.setTimeout,
		clearTimeout: options.clearTimeout ?? clock.clearTimeout,
	});
	const runtime = createShellSessionWorkmuxOwner(createInput(initialTarget));
	return {
		clock,
		createInput,
		diagnostics,
		events,
		getChannelCount: () => channelNumber,
		port: runtime.getPort(),
		runtime,
	};
}

void test('target replacement retires cleanup before disposing the old channel', async () => {
	const owner = createHarness('target-1');
	owner.port.registerBeforeDispose('scrollback', async (retiring) => {
		owner.events.push('cleanup:start');
		await retiring.exitScroll({ sessionName: 'main' });
		owner.events.push('cleanup:end');
	});

	owner.runtime.replace(owner.createInput('target-2'));
	await owner.runtime.drain();

	assert.deepEqual(owner.events, [
		'old:prepare',
		'cleanup:start',
		'old:exit:main',
		'cleanup:end',
		'old:dispose',
	]);
});

void test('failed commands preserve actionable output when error is empty', async () => {
	const owner = createHarness('target-1', {
		createChannel: (label, events) => ({
			...createChannel({ label, events }),
			command: async () => ({
				success: false,
				output: 'tmux server reported the actionable failure',
				error: '',
			}),
		}),
	});

	assert.deepEqual(await owner.port.command(['tmux', 'failing-command']), {
		status: 'failed',
		failure: { message: 'tmux server reported the actionable failure' },
		output: 'tmux server reported the actionable failure',
	});
});

void test('channel factory failures leave an unavailable port that activation can retry', async () => {
	const events: string[] = [];
	const warnings: DiagnosticWarning[] = [];
	let attempts = 0;
	const input: ShellSessionWorkmuxInput = {
		key: targetKey('target-1'),
		connection: null,
		diagnostics: {
			event: () => {},
			warn: (message, error) => warnings.push({ message, error }),
		},
		createChannel: () => {
			attempts += 1;
			if (attempts === 1) throw new Error('factory failed');
			return createChannel({ label: 'recovered', events });
		},
		setTimeout,
		clearTimeout,
	};

	const owner = createShellSessionWorkmuxOwner(input);
	assert.deepEqual(await owner.getPort().command(['before-retry']), {
		status: 'unavailable',
	});
	assert.match(warnings[0]?.message ?? '', /factory|create/i);

	owner.activate();
	assert.deepEqual(await owner.getPort().command(['after-retry']), {
		status: 'completed',
		output: 'recovered:command-output',
	});
});

void test('successor factory failure settles retirement and remains retryable', async () => {
	const owner = createHarness('target-1', {
		createChannel: (label, events) => {
			if (label === 'new') throw new Error('successor factory failed');
			return createChannel({ label, events });
		},
	});

	owner.runtime.replace(owner.createInput('target-2'));
	await owner.runtime.drain();
	assert.equal(owner.runtime.getPort().key, targetKey('target-2'));
	assert.deepEqual(await owner.runtime.getPort().command(['unavailable']), {
		status: 'unavailable',
	});
	assert.match(owner.diagnostics.at(-1)?.message ?? '', /factory/i);

	owner.runtime.activate();
	assert.deepEqual(await owner.runtime.getPort().command(['recovered']), {
		status: 'completed',
		output: 'newer:command-output',
	});
});

void test('replacement exposes no successor until rejected cleanup and disposal settle', async () => {
	const releaseCleanup = deferred<void>();
	const owner = createHarness('target-1', {
		createChannel: (label, events) => {
			events.push(`${label}:create`);
			return createChannel({ label, events });
		},
	});
	owner.port.registerBeforeDispose('scrollback', async () => {
		owner.events.push('cleanup:start');
		await releaseCleanup.promise;
		owner.events.push('cleanup:reject');
		throw new Error('cleanup rejected');
	});

	owner.runtime.replace(owner.createInput('target-2'));

	assert.equal(owner.runtime.getPort().key, targetKey('target-1'));
	assert.equal(owner.getChannelCount(), 1);
	assert.deepEqual(
		await owner.runtime
			.getPort()
			.command(['must', 'not', 'reach', 'successor']),
		{ status: 'superseded' },
	);
	assert.deepEqual(owner.events, [
		'old:create',
		'old:prepare',
		'cleanup:start',
	]);

	releaseCleanup.resolve();
	await owner.runtime.drain();

	assert.equal(owner.runtime.getPort().key, targetKey('target-2'));
	assert.equal(owner.getChannelCount(), 2);
	assert.deepEqual(owner.events, [
		'old:create',
		'old:prepare',
		'cleanup:start',
		'cleanup:reject',
		'old:dispose',
		'new:create',
	]);
	assert.deepEqual(
		await owner.runtime.getPort().command(['successor', 'command']),
		{ status: 'completed', output: 'new:command-output' },
	);
});

void test('retiring port exposes only exitScroll', async () => {
	const owner = createHarness('target-1');
	let retiringPort: object | null = null;
	owner.port.registerBeforeDispose('scrollback', async (retiring) => {
		retiringPort = retiring;
	});

	owner.runtime.dispose('unmount');
	await owner.runtime.drain();

	assert.ok(retiringPort);
	assert.deepEqual(Object.keys(retiringPort), ['exitScroll']);
	assert.equal('command' in retiringPort, false);
	assert.equal('operation' in retiringPort, false);
	assert.equal('move' in retiringPort, false);
});

void test('retiring exit reports an unavailable cleanup capability without leaking channel failure details', async () => {
	const outcomes: unknown[] = [];
	const owner = createHarness('target-1', {
		createChannel: (label, events) => {
			const channel = createChannel({ label, events });
			return {
				...channel,
				scroll: {
					...channel.scroll,
					exit: async () => ({
						success: false,
						output: '',
						error: 'raw transport detail',
					}),
				},
			};
		},
	});
	owner.port.registerBeforeDispose('scrollback', async (retiring) => {
		outcomes.push(await retiring.exitScroll({ sessionName: 'main' }));
	});

	owner.runtime.dispose('unmount');
	await owner.runtime.drain();

	assert.deepEqual(outcomes, [{ status: 'unavailable' }]);
});

void test('cleanup timeout records diagnostics and still disposes once', async () => {
	const owner = createHarness('target-1', { cleanupTimeoutMs: 5 });
	owner.port.registerBeforeDispose('scrollback', () => new Promise(() => {}));

	owner.runtime.dispose('unmount');
	owner.clock.advanceBy(5);
	await owner.runtime.drain();

	assert.equal(
		owner.events.filter((event) => event === 'old:dispose').length,
		1,
	);
	assert.match(owner.diagnostics.at(-1)?.message ?? '', /cleanup timed out/i);
});

void test('timeout closes retiring cleanup before diagnostic re-entry', async () => {
	const releaseFirstCleanup = deferred<void>();
	let retiringPort: {
		exitScroll(input: { sessionName: string }): Promise<unknown>;
	} | null = null;
	const owner = createHarness('target-1', {
		cleanupTimeoutMs: 5,
		diagnostics: {
			warn: (message) => {
				if (!/cleanup timed out/i.test(message)) return;
				owner.events.push('diagnostic:timeout');
				void retiringPort?.exitScroll({ sessionName: 'reentrant' });
				releaseFirstCleanup.resolve();
			},
		},
	});
	owner.port.registerBeforeDispose('first', async (retiring) => {
		owner.events.push('cleanup:first');
		retiringPort = retiring;
		await releaseFirstCleanup.promise;
	});
	owner.port.registerBeforeDispose('second', async () => {
		owner.events.push('cleanup:second');
	});

	owner.runtime.dispose('unmount');
	owner.clock.advanceBy(5);
	await owner.runtime.drain();

	assert.deepEqual(owner.events, [
		'old:prepare',
		'cleanup:first',
		'diagnostic:timeout',
		'old:dispose',
	]);
});

void test('retained timeout callback is inert after successful cleanup settlement', async () => {
	const owner = createHarness('target-1', {
		cleanupTimeoutMs: 5,
		clearTimeout: () => {
			throw new Error('clear timer failed');
		},
	});
	owner.port.registerBeforeDispose('scrollback', async () => {
		owner.events.push('cleanup:done');
	});

	owner.runtime.dispose('unmount');
	await owner.runtime.drain();
	const warningCountAfterDrain = owner.diagnostics.length;
	const eventsAfterDrain = [...owner.events];

	owner.clock.advanceBy(5);
	await Promise.resolve();

	assert.equal(
		owner.diagnostics.some(({ message }) => /cleanup timed out/i.test(message)),
		false,
	);
	assert.equal(owner.diagnostics.length, warningCountAfterDrain);
	assert.deepEqual(owner.events, eventsAfterDrain);
	assert.equal(
		owner.events.filter((event) => event === 'old:dispose').length,
		1,
	);
	assert.deepEqual(await owner.port.command(['tmux', 'nav', 'next']), {
		status: 'superseded',
	});
});

void test('stale ports cannot command a replacement channel', async () => {
	const owner = createHarness('target-1');
	const oldPort = owner.runtime.getPort();

	owner.runtime.replace(owner.createInput('target-2'));

	assert.deepEqual(await oldPort.command(['tmux', 'app', 'nav', 'next']), {
		status: 'superseded',
	});
	assert.deepEqual(
		await oldPort.operation({ operation: 'tmux.nav', params: {} }),
		{ status: 'superseded' },
	);
	assert.deepEqual(await oldPort.scroll.enter({ sessionName: 'main' }), {
		status: 'superseded',
	});
	assert.equal(
		owner.events.some((event) => event.startsWith('new:command:')),
		false,
	);
	assert.equal(
		owner.events.some((event) => event.startsWith('new:operation:')),
		false,
	);
	await owner.runtime.drain();
});

void test('full port is invalid before asynchronous cleanup begins', async () => {
	const owner = createHarness('target-1');
	const oldPort = owner.port;
	const cleanupStarted = deferred<void>();
	const releaseCleanup = deferred<void>();
	oldPort.registerBeforeDispose('scrollback', async () => {
		cleanupStarted.resolve();
		await releaseCleanup.promise;
	});

	owner.runtime.replace(owner.createInput('target-2'));
	assert.deepEqual(owner.events, ['old:prepare']);
	assert.deepEqual(await oldPort.command(['tmux', 'nav', 'next']), {
		status: 'superseded',
	});
	await cleanupStarted.promise;
	releaseCleanup.resolve();
	await owner.runtime.drain();
});

void test('an old command completion becomes superseded after replacement', async () => {
	const commandResult = deferred<WorkmuxControlCommandResult>();
	const owner = createHarness('target-1', {
		createChannel: (label, events) => {
			const channel = createChannel({ label, events });
			if (label !== 'old') return channel;
			return {
				...channel,
				command: async () => commandResult.promise,
			};
		},
	});
	const pending = owner.port.command(['tmux', 'nav', 'next']);

	owner.runtime.replace(owner.createInput('target-2'));
	commandResult.resolve({ success: true, output: 'stale output' });

	assert.deepEqual(await pending, { status: 'superseded' });
	await owner.runtime.drain();
});

void test('registered cleanup is ordered and one failure does not skip later owners', async () => {
	const owner = createHarness('target-1');
	owner.port.registerBeforeDispose('first', async () => {
		owner.events.push('cleanup:first');
		throw new Error('first cleanup failed');
	});
	owner.port.registerBeforeDispose('second', async () => {
		owner.events.push('cleanup:second');
	});

	owner.runtime.dispose('unmount');
	await owner.runtime.drain();

	assert.deepEqual(owner.events, [
		'old:prepare',
		'cleanup:first',
		'cleanup:second',
		'old:dispose',
	]);
	assert.match(owner.diagnostics[0]?.message ?? '', /first.*cleanup failed/i);
});

void test('stale unregister cannot remove a newer cleanup for the same owner', async () => {
	const owner = createHarness('target-1');
	const unregisterOld = owner.port.registerBeforeDispose(
		'scrollback',
		async () => {
			owner.events.push('cleanup:old');
		},
	);
	owner.port.registerBeforeDispose('scrollback', async () => {
		owner.events.push('cleanup:new');
	});
	unregisterOld();

	owner.runtime.dispose('unmount');
	await owner.runtime.drain();

	assert.equal(owner.events.includes('cleanup:old'), false);
	assert.equal(owner.events.includes('cleanup:new'), true);
});

void test('cleanup replacement supersedes the pending successor before exposure', async () => {
	const owner = createHarness('target-1');
	owner.port.registerBeforeDispose('reentrant', async () => {
		owner.events.push('cleanup:replace');
		owner.runtime.replace(owner.createInput('target-3'));
	});

	owner.runtime.replace(owner.createInput('target-2'));
	await owner.runtime.drain();

	assert.deepEqual(owner.events, [
		'old:prepare',
		'cleanup:replace',
		'old:dispose',
	]);
	assert.equal(owner.runtime.getPort().key, targetKey('target-3'));
	assert.equal(owner.getChannelCount(), 2);
});

void test('dispose during retirement prevents pending successor construction', async () => {
	const firstCleanup = deferred<void>();
	const owner = createHarness('target-1');
	owner.port.registerBeforeDispose('first', async (retiring) => {
		owner.events.push('cleanup:first:start');
		await firstCleanup.promise;
		await retiring.exitScroll({ sessionName: 'one' });
	});

	owner.runtime.replace(owner.createInput('target-2'));
	const staleReplacementPort = owner.runtime.getPort();
	staleReplacementPort.registerBeforeDispose('second', async (retiring) => {
		owner.events.push('cleanup:second');
		await retiring.exitScroll({ sessionName: 'two' });
	});
	owner.runtime.dispose('reconnect');
	assert.deepEqual(
		await staleReplacementPort.command(['tmux', 'nav', 'next']),
		{ status: 'superseded' },
	);
	firstCleanup.resolve();
	await owner.runtime.drain();

	assert.equal(
		owner.events.filter((event) => event === 'old:dispose').length,
		1,
	);
	assert.equal(
		owner.events.filter((event) => event === 'new:dispose').length,
		0,
	);
	assert.equal(owner.events.includes('old:exit:one'), true);
	assert.equal(owner.events.includes('new:exit:two'), false);
	assert.equal(owner.getChannelCount(), 1);
});

void test('rejected disposal and throwing diagnostics are contained without a second dispose', async () => {
	const owner = createHarness('target-1', {
		createChannel: (label, events) =>
			createChannel({
				label,
				events,
				onDispose: async () => {
					throw new Error('dispose failed');
				},
			}),
		diagnostics: {
			warn: () => {
				throw new Error('logger failed');
			},
		},
	});

	owner.runtime.dispose('unmount');
	await owner.runtime.drain();
	owner.runtime.dispose('unmount');
	await owner.runtime.drain();

	assert.equal(
		owner.events.filter((event) => event === 'old:dispose').length,
		1,
	);
});

void test('throwing timer cleanup cannot prevent channel disposal', async () => {
	const owner = createHarness('target-1', {
		clearTimeout: () => {
			throw new Error('clear timer failed');
		},
	});

	owner.runtime.dispose('unmount');
	await owner.runtime.drain();

	assert.equal(
		owner.events.filter((event) => event === 'old:dispose').length,
		1,
	);
	assert.match(
		owner.diagnostics.at(-1)?.message ?? '',
		/cleanup timer.*failed/i,
	);
});

void test('a disposed owner does not create a replacement channel', async () => {
	const owner = createHarness('target-1');
	owner.runtime.dispose('unmount');
	owner.runtime.replace(owner.createInput('target-2'));
	await owner.runtime.drain();

	assert.equal(owner.getChannelCount(), 1);
	assert.equal(owner.runtime.getPort().key, targetKey('target-1'));
	assert.deepEqual(
		await owner.runtime.getPort().command(['tmux', 'nav', 'next']),
		{
			status: 'superseded',
		},
	);
});

void test('diagnostic events use the active trace only for their captured generation', () => {
	let currentGeneration = 7;
	let traceReads = 0;
	const traced: ConnectionDiagnosticEvent[] = [];
	const warnings: DiagnosticWarning[] = [];
	const port = createShellDiagnosticPort({
		generation: 7,
		getCurrentGeneration: () => currentGeneration,
		getActiveTrace: () => {
			traceReads += 1;
			return {
				event: (event: ConnectionDiagnosticEvent) => traced.push(event),
			};
		},
		logger: {
			warn: (message, error) => warnings.push({ message, error }),
		},
	});
	const event: ConnectionDiagnosticEvent = {
		kind: 'mdev-bridge.lifecycle',
		source: 'mdev-bridge',
		stage: 'request-started',
		operation: 'tmux.nav',
	};

	port.event(event);
	currentGeneration += 1;
	port.event(event);

	assert.deepEqual(traced, [event]);
	assert.equal(traceReads, 1);
	assert.deepEqual(warnings, []);
});

void test('current-generation diagnostic events retain the detailed persistent log', () => {
	const details: unknown[] = [];
	const port = createShellDiagnosticPort({
		generation: 7,
		getCurrentGeneration: () => 7,
		getActiveTrace: () => null,
		getEventDetails: (event) => ({
			connectionId: 'connection-1',
			channelId: 9,
			kind: event.kind,
			fields: ['stage=request-started'],
			message: undefined,
			hasConnection: true,
			hasShell: true,
			connectionCount: 2,
			shellCount: 3,
		}),
		logger: {
			info: (message, value) => details.push({ message, value }),
			warn: () => {},
		},
	});

	port.event({
		kind: 'mdev-bridge.lifecycle',
		source: 'mdev-bridge',
		stage: 'request-started',
	});

	assert.deepEqual(details, [
		{
			message: 'Workmux diagnostic event',
			value: {
				connectionId: 'connection-1',
				channelId: 9,
				kind: 'mdev-bridge.lifecycle',
				fields: ['stage=request-started'],
				message: undefined,
				hasConnection: true,
				hasShell: true,
				connectionCount: 2,
				shellCount: 3,
			},
		},
	]);
});

void test('diagnostic failures are contained and report only formatted typed event fields', () => {
	const warnings: DiagnosticWarning[] = [];
	const port = createShellDiagnosticPort({
		generation: 3,
		getCurrentGeneration: () => 3,
		getActiveTrace: () => ({
			event: () => {
				throw new Error('trace failed');
			},
		}),
		logger: {
			warn: (message, error) => warnings.push({ message, error }),
		},
	});
	const event = {
		kind: 'mdev-bridge.lifecycle',
		source: 'mdev-bridge',
		stage: 'request-failed',
		operation: 'tmux.nav',
		secret: 'must-not-be-formatted',
	} as ConnectionDiagnosticEvent & { secret: string };

	assert.doesNotThrow(() => port.event(event));
	assert.match(warnings[0]?.message ?? '', /stage=request-failed/);
	assert.match(warnings[0]?.message ?? '', /operation=tmux.nav/);
	assert.doesNotMatch(warnings[0]?.message ?? '', /must-not-be-formatted/);

	const throwingPort = createShellDiagnosticPort({
		generation: 3,
		getCurrentGeneration: () => 3,
		getActiveTrace: () => ({
			event: () => {
				throw new Error('trace failed');
			},
		}),
		logger: {
			warn: () => {
				throw new Error('logger failed');
			},
		},
	});
	assert.doesNotThrow(() => throwingPort.event(event));
	assert.doesNotThrow(() => throwingPort.warn('cleanup failed'));
});

void test('diagnostic event contains a throwing generation read', () => {
	const port = createShellDiagnosticPort({
		generation: 3,
		getCurrentGeneration: () => {
			throw new Error('generation unavailable');
		},
		getActiveTrace: () => {
			throw new Error('trace should not be read');
		},
		logger: {
			warn: () => {
				throw new Error('logger failed');
			},
		},
	});

	assert.doesNotThrow(() =>
		port.event({
			kind: 'mdev-bridge.lifecycle',
			source: 'mdev-bridge',
			stage: 'request-started',
		}),
	);
});
