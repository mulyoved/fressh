import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ConnectionRunAbortedError,
	createConnectionRunContext,
} from '../../src/lib/connection-run-context';

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

function requireSignal(signal: AbortSignal | null): AbortSignal {
	if (signal === null) {
		throw new assert.AssertionError({
			message: 'Expected operation to capture an AbortSignal',
		});
	}
	return signal;
}

function harness() {
	let nextId = 1;
	const timers: Timer[] = [];
	return {
		timers,
		createRun: (
			options: Parameters<typeof createConnectionRunContext>[0] = {},
		) =>
			createConnectionRunContext({
				...options,
				setTimeout: (callback, delayMs) => {
					const timer = {
						id: nextId,
						delayMs,
						callback,
						cleared: false,
					};
					nextId += 1;
					timers.push(timer);
					return timer;
				},
				clearTimeout: (timer) => {
					(timer as Timer).cleared = true;
				},
			}),
	};
}

void test('operation timeout aborts run and operation signal', async () => {
	const fixture = harness();
	const run = fixture.createRun({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});
	const scope = run.createOperationScope('operation');
	const signal = scope.signal;

	assert.equal(signal.aborted, false);
	assert.equal(fixture.timers[0]?.delayMs, 50);

	fixture.timers[0]?.callback();

	assert.equal(run.signal.aborted, true);
	assert.equal(signal.aborted, true);
	assert.equal(run.abortReason, 'timeout');
	assert.equal(run.timeoutKind, 'operation');
	await assert.rejects(
		() => Promise.resolve().then(() => run.throwIfAborted()),
		{
			name: 'ConnectionRunAbortedError',
		},
	);
});

void test('recovery timeout is separate from operation timeout', async () => {
	const fixture = harness();
	const run = fixture.createRun({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});
	const scope = run.createOperationScope('recovery');
	const signal = scope.signal;

	assert.equal(fixture.timers[0]?.delayMs, 80);
	fixture.timers[0]?.callback();

	assert.equal(signal.aborted, true);
	assert.equal(run.abortReason, 'timeout');
	assert.equal(run.timeoutKind, 'recovery');
});

void test('caller abort propagates to child operation signal', () => {
	const caller = new AbortController();
	const fixture = harness();
	const run = fixture.createRun({
		callerSignal: caller.signal,
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});
	const shellScope = run.createOperationScope('operation');
	const shellSignal = shellScope.signal;

	caller.abort();

	assert.equal(run.signal.aborted, true);
	assert.equal(shellSignal.aborted, true);
	assert.equal(run.abortReason, 'caller-aborted');
});

void test('stale run suppresses late successful operation result', async () => {
	const fixture = harness();
	let current = true;
	const run = fixture.createRun({
		isCurrent: () => current,
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});
	let resolveOperation: (value: string) => void = () => {};

	const operation = run.runOperation('operation', () => {
		return new Promise<string>((resolve) => {
			resolveOperation = resolve;
		});
	});

	current = false;
	resolveOperation('late-success');

	assert.deepEqual(await operation, {
		status: 'aborted',
		reason: 'stale-run',
		timeoutKind: null,
	});
});

void test('cleanup operation remains bounded after operation timeout', async () => {
	const fixture = harness();
	const run = fixture.createRun({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	run.createOperationScope('operation');
	fixture.timers[0]?.callback();

	let cleanupSignal: AbortSignal | null = null;
	const cleanup = run.runOperation('cleanup', (signal) => {
		cleanupSignal = signal;
		return Promise.resolve('cleaned');
	});

	assert.equal(requireSignal(cleanupSignal).aborted, false);
	assert.equal(fixture.timers[1]?.delayMs, 25);
	assert.deepEqual(await cleanup, { status: 'ok', value: 'cleaned' });
});

void test('cleanup timeout aborts hanging cleanup operation', async () => {
	const fixture = harness();
	const run = fixture.createRun({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});
	let cleanupSignal: AbortSignal | null = null;

	const cleanup = run.runOperation('cleanup', (signal) => {
		cleanupSignal = signal;
		return new Promise<string>(() => undefined);
	});

	assert.equal(fixture.timers[0]?.delayMs, 25);
	fixture.timers[0]?.callback();
	await flushPromises();

	assert.equal(requireSignal(cleanupSignal).aborted, true);
	assert.deepEqual(await cleanup, {
		status: 'aborted',
		reason: 'timeout',
		timeoutKind: 'cleanup',
	});
});

void test('stale run preserves already aborted cleanup timeout result', async () => {
	const fixture = harness();
	let current = true;
	const run = fixture.createRun({
		isCurrent: () => current,
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	const cleanup = run.runOperation('cleanup', () => {
		return new Promise<string>(() => undefined);
	});

	fixture.timers[0]?.callback();
	current = false;
	await flushPromises();

	assert.deepEqual(await cleanup, {
		status: 'aborted',
		reason: 'timeout',
		timeoutKind: 'cleanup',
	});
});

void test('finish clears timers and prevents late timeout abort', () => {
	const fixture = harness();
	const run = fixture.createRun({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	run.createOperationScope('operation');
	run.finish();
	fixture.timers[0]?.callback();

	assert.equal(fixture.timers[0]?.cleared, true);
	assert.equal(run.signal.aborted, false);
});

void test('finish removes caller abort listener', () => {
	const caller = new AbortController();
	const listeners = new Set<EventListenerOrEventListenerObject>();
	const originalAddEventListener = caller.signal.addEventListener.bind(caller.signal) as (
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	) => void;
	const originalRemoveEventListener = caller.signal.removeEventListener.bind(
		caller.signal,
	) as (
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | EventListenerOptions,
	) => void;
	caller.signal.addEventListener = ((
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | AddEventListenerOptions,
	) => {
		if (type === 'abort' && listener !== null) {
			listeners.add(listener);
		}
		if (listener !== null) {
			originalAddEventListener(type, listener, options);
		}
	}) as AbortSignal['addEventListener'];
	caller.signal.removeEventListener = ((
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | EventListenerOptions,
	) => {
		if (type === 'abort' && listener !== null) {
			listeners.delete(listener);
		}
		if (listener !== null) {
			originalRemoveEventListener(type, listener, options);
		}
	}) as AbortSignal['removeEventListener'];

	const fixture = harness();
	const run = fixture.createRun({
		callerSignal: caller.signal,
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	assert.equal(listeners.size, 1);

	run.finish();

	assert.equal(listeners.size, 0);
});

void test('operation scope finish clears timer and prevents late timeout abort', () => {
	const fixture = harness();
	const run = fixture.createRun({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});
	const scope = run.createOperationScope('operation');

	scope.finish();
	fixture.timers[0]?.callback();

	assert.equal(fixture.timers[0]?.cleared, true);
	assert.equal(run.signal.aborted, false);
	assert.equal(scope.signal.aborted, false);
});

void test('manual abort accepts lifecycle reasons', () => {
	const fixture = harness();
	const run = fixture.createRun({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});
	const scope = run.createOperationScope('operation');
	const signal = scope.signal;

	run.abort('replaced');

	assert.equal(run.signal.aborted, true);
	assert.equal(signal.aborted, true);
	assert.equal(run.abortReason, 'replaced');
	assert.equal(run.timeoutKind, null);
});

void test('classifyError recognizes context and DOM-style aborts', () => {
	const fixture = harness();
	const run = fixture.createRun({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	const contextError = new ConnectionRunAbortedError('stopped', null);
	const domAbort = Object.assign(new Error('The operation was aborted.'), {
		name: 'AbortError',
	});
	const nativeAbort = new Error('operation aborted by signal');
	const networkError = new Error('No route to host');

	assert.equal(run.classifyError(contextError), 'aborted');
	assert.equal(run.classifyError(domAbort), 'aborted');
	assert.equal(run.classifyError(nativeAbort), 'aborted');
	assert.equal(run.classifyError(networkError), 'failed');
});
