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

function harness() {
	let nextId = 1;
	const timers: Timer[] = [];
	return {
		timers,
		createContext: (
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
	const context = harness();
	const run = context.createContext({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});
	const signal = run.createOperationSignal('operation');

	assert.equal(signal.aborted, false);
	assert.equal(context.timers[0]?.delayMs, 50);

	context.timers[0]?.callback();

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
	const context = harness();
	const run = context.createContext({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});
	const signal = run.createOperationSignal('recovery');

	assert.equal(context.timers[0]?.delayMs, 80);
	context.timers[0]?.callback();

	assert.equal(signal.aborted, true);
	assert.equal(run.abortReason, 'timeout');
	assert.equal(run.timeoutKind, 'recovery');
});

void test('caller abort propagates to child operation signal', () => {
	const caller = new AbortController();
	const context = harness();
	const run = context.createContext({
		callerSignal: caller.signal,
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});
	const shellSignal = run.createOperationSignal('operation');

	caller.abort();

	assert.equal(run.signal.aborted, true);
	assert.equal(shellSignal.aborted, true);
	assert.equal(run.abortReason, 'caller-aborted');
});

void test('stale run suppresses late successful operation result', async () => {
	const context = harness();
	let current = true;
	const run = context.createContext({
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
	const context = harness();
	const run = context.createContext({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	run.createOperationSignal('operation');
	context.timers[0]?.callback();

	let cleanupSignal: AbortSignal | null = null;
	const cleanup = run.runOperation('cleanup', (signal) => {
		cleanupSignal = signal;
		return Promise.resolve('cleaned');
	});

	assert.equal(cleanupSignal?.aborted, false);
	assert.equal(context.timers[1]?.delayMs, 25);
	assert.deepEqual(await cleanup, { status: 'ok', value: 'cleaned' });
});

void test('cleanup timeout aborts hanging cleanup operation', async () => {
	const context = harness();
	const run = context.createContext({
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

	assert.equal(context.timers[0]?.delayMs, 25);
	context.timers[0]?.callback();
	await flushPromises();

	assert.equal(cleanupSignal?.aborted, true);
	assert.deepEqual(await cleanup, {
		status: 'aborted',
		reason: 'timeout',
		timeoutKind: 'cleanup',
	});
});

void test('finish clears timers and prevents late timeout abort', () => {
	const context = harness();
	const run = context.createContext({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	run.createOperationSignal('operation');
	run.finish();
	context.timers[0]?.callback();

	assert.equal(context.timers[0]?.cleared, true);
	assert.equal(run.signal.aborted, false);
});

void test('classifyError recognizes context and DOM-style aborts', () => {
	const context = harness();
	const run = context.createContext({
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
