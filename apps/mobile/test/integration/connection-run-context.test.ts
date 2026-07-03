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

function createNoReasonAbortController(): AbortController {
	const realController = new AbortController();
	const signal = {
		get aborted() {
			return realController.signal.aborted;
		},
		get onabort() {
			return realController.signal.onabort;
		},
		set onabort(handler) {
			realController.signal.onabort = handler;
		},
		get reason() {
			return undefined;
		},
		addEventListener: realController.signal.addEventListener.bind(
			realController.signal,
		),
		dispatchEvent: realController.signal.dispatchEvent.bind(
			realController.signal,
		),
		removeEventListener: realController.signal.removeEventListener.bind(
			realController.signal,
		),
		throwIfAborted: () => {
			if (realController.signal.aborted) {
				throw new DOMException('Aborted', 'AbortError');
			}
		},
	} as AbortSignal;

	return {
		signal,
		abort: () => {
			realController.abort();
		},
	} as AbortController;
}

type TrackedAbortController = AbortController & {
	abortListeners: Set<EventListenerOrEventListenerObject>;
};

function createTrackedAbortController(
	controllers: TrackedAbortController[],
): AbortController {
	const controller = new AbortController();
	const abortListeners = new Set<EventListenerOrEventListenerObject>();
	const originalAddEventListener = controller.signal.addEventListener.bind(
		controller.signal,
	) as (
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	) => void;
	const originalRemoveEventListener =
		controller.signal.removeEventListener.bind(controller.signal) as (
			type: string,
			listener: EventListenerOrEventListenerObject,
			options?: boolean | EventListenerOptions,
		) => void;

	controller.signal.addEventListener = ((
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | AddEventListenerOptions,
	) => {
		if (type === 'abort' && listener !== null) {
			abortListeners.add(listener);
		}
		if (listener !== null) {
			originalAddEventListener(type, listener, options);
		}
	}) as AbortSignal['addEventListener'];
	controller.signal.removeEventListener = ((
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | EventListenerOptions,
	) => {
		if (type === 'abort' && listener !== null) {
			abortListeners.delete(listener);
		}
		if (listener !== null) {
			originalRemoveEventListener(type, listener, options);
		}
	}) as AbortSignal['removeEventListener'];

	const trackedController = Object.assign(controller, { abortListeners });
	controllers.push(trackedController);
	return trackedController;
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

void test('throwIfAborted preserves existing abort before stale-run', () => {
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
	const scope = run.createOperationScope('operation');

	fixture.timers[0]?.callback();
	current = false;

	assert.throws(
		() => {
			run.throwIfAborted();
		},
		(error) => {
			assert.equal(error instanceof ConnectionRunAbortedError, true);
			assert.equal((error as ConnectionRunAbortedError).reason, 'timeout');
			assert.equal(
				(error as ConnectionRunAbortedError).timeoutKind,
				'operation',
			);
			return true;
		},
	);
	assert.equal(scope.signal.aborted, true);
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

void test('runOperation returns aborted if run stops before ok result returns', async () => {
	const fixture = harness();
	const run = fixture.createRun({
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

	resolveOperation('connected');
	queueMicrotask(() => {
		run.abort('replaced');
	});

	assert.deepEqual(await operation, {
		status: 'aborted',
		reason: 'replaced',
		timeoutKind: null,
	});
});

void test('stale non-cleanup operation does not start work', async () => {
	const fixture = harness();
	const run = fixture.createRun({
		isCurrent: () => false,
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});
	let called = false;

	const result = await run.runOperation('operation', async () => {
		called = true;
		return 'started';
	});

	assert.equal(called, false);
	assert.deepEqual(result, {
		status: 'aborted',
		reason: 'stale-run',
		timeoutKind: null,
	});
});

void test('stale manual operation scope starts aborted', () => {
	const fixture = harness();
	const run = fixture.createRun({
		isCurrent: () => false,
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	const scope = run.createOperationScope('operation');

	assert.equal(scope.signal.aborted, true);
	assert.equal(scope.signal.reason instanceof ConnectionRunAbortedError, true);
	assert.equal(scope.signal.reason.reason, 'stale-run');
	assert.equal(scope.signal.reason.timeoutKind, null);
});

void test('stale manual recovery scope starts aborted', () => {
	const fixture = harness();
	const run = fixture.createRun({
		isCurrent: () => false,
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	const scope = run.createOperationScope('recovery');

	assert.equal(scope.signal.aborted, true);
	assert.equal(scope.signal.reason instanceof ConnectionRunAbortedError, true);
	assert.equal(scope.signal.reason.reason, 'stale-run');
	assert.equal(scope.signal.reason.timeoutKind, null);
});

void test('stale manual cleanup scope remains live', () => {
	const fixture = harness();
	const run = fixture.createRun({
		isCurrent: () => false,
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	const scope = run.createOperationScope('cleanup');

	assert.equal(scope.signal.aborted, false);
});

void test('stale cleanup success is not rewritten to stale-run', async () => {
	const fixture = harness();
	const run = fixture.createRun({
		isCurrent: () => false,
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	assert.deepEqual(await run.runOperation('cleanup', async () => 'cleaned'), {
		status: 'ok',
		value: 'cleaned',
	});
});

void test('stale cleanup failure is thrown instead of rewritten', async () => {
	const fixture = harness();
	const run = fixture.createRun({
		isCurrent: () => false,
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	await assert.rejects(
		run.runOperation('cleanup', async () => {
			throw new Error('cleanup failed');
		}),
		/cleanup failed/,
	);
});

void test('runOperation preserves thrown abort error metadata', async () => {
	const fixture = harness();
	const run = fixture.createRun({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	const result = await run.runOperation('operation', async () => {
		throw new ConnectionRunAbortedError('stale-run', null);
	});

	assert.deepEqual(result, {
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

void test('cleanup abort-like failure after operation timeout is thrown while cleanup is live', async () => {
	const abortLikeErrors = [
		Object.assign(new Error('The operation was aborted.'), {
			name: 'AbortError',
		}),
		new Error('operation aborted by signal'),
	];

	for (const cleanupError of abortLikeErrors) {
		const fixture = harness();
		const run = fixture.createRun({
			timeouts: {
				operationTimeoutMs: 50,
				recoveryTimeoutMs: 80,
				cleanupTimeoutMs: 25,
			},
		});
		let cleanupSignal: AbortSignal | null = null;

		run.createOperationScope('operation');
		fixture.timers[0]?.callback();

		await assert.rejects(
			run.runOperation('cleanup', async (signal) => {
				cleanupSignal = signal;
				assert.equal(signal.aborted, false);
				throw cleanupError;
			}),
			(error) => {
				assert.equal(error, cleanupError);
				return true;
			},
		);
		assert.equal(requireSignal(cleanupSignal).aborted, false);
	}
});

void test('caller abort stops cleanup started after operation timeout', () => {
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

	run.createOperationScope('operation');
	fixture.timers[0]?.callback();
	const cleanupScope = run.createOperationScope('cleanup');

	caller.abort();

	assert.equal(run.abortReason, 'timeout');
	assert.equal(run.timeoutKind, 'operation');
	assert.equal(cleanupScope.signal.aborted, true);
	assert.equal(
		cleanupScope.signal.reason instanceof ConnectionRunAbortedError,
		true,
	);
	assert.equal(cleanupScope.signal.reason.reason, 'caller-aborted');
	assert.equal(cleanupScope.signal.reason.timeoutKind, null);
});

void test('manual abort stops cleanup started after operation timeout', () => {
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
	const cleanupScope = run.createOperationScope('cleanup');

	run.abort('replaced');

	assert.equal(run.abortReason, 'timeout');
	assert.equal(run.timeoutKind, 'operation');
	assert.equal(cleanupScope.signal.aborted, true);
	assert.equal(
		cleanupScope.signal.reason instanceof ConnectionRunAbortedError,
		true,
	);
	assert.equal(cleanupScope.signal.reason.reason, 'replaced');
	assert.equal(cleanupScope.signal.reason.timeoutKind, null);
});

void test('cleanup created after later stop sees remembered stop reason', () => {
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
	run.abort('replaced');

	const cleanupScope = run.createOperationScope('cleanup');

	assert.equal(run.abortReason, 'timeout');
	assert.equal(run.timeoutKind, 'operation');
	assert.equal(cleanupScope.signal.aborted, true);
	assert.equal(
		cleanupScope.signal.reason instanceof ConnectionRunAbortedError,
		true,
	);
	assert.equal(cleanupScope.signal.reason.reason, 'replaced');
	assert.equal(cleanupScope.signal.reason.timeoutKind, null);
});

void test('cleanup created after caller stop sees remembered stop reason', () => {
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

	run.createOperationScope('operation');
	fixture.timers[0]?.callback();
	caller.abort();

	const cleanupScope = run.createOperationScope('cleanup');

	assert.equal(run.abortReason, 'timeout');
	assert.equal(run.timeoutKind, 'operation');
	assert.equal(cleanupScope.signal.aborted, true);
	assert.equal(
		cleanupScope.signal.reason instanceof ConnectionRunAbortedError,
		true,
	);
	assert.equal(cleanupScope.signal.reason.reason, 'caller-aborted');
	assert.equal(cleanupScope.signal.reason.timeoutKind, null);
});

void test('caller abort propagates to active cleanup scope', () => {
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
	const cleanupScope = run.createOperationScope('cleanup');

	caller.abort();

	assert.equal(run.abortReason, 'caller-aborted');
	assert.equal(cleanupScope.signal.aborted, true);
	assert.equal(
		cleanupScope.signal.reason instanceof ConnectionRunAbortedError,
		true,
	);
	assert.equal(cleanupScope.signal.reason.reason, 'caller-aborted');
	assert.equal(cleanupScope.signal.reason.timeoutKind, null);
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

void test('cleanup timeout metadata survives abort signals without reason', async () => {
	const fixture = harness();
	let abortControllerCount = 0;
	const run = fixture.createRun({
		createAbortController: () => {
			abortControllerCount += 1;
			return createNoReasonAbortController();
		},
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
	await flushPromises();

	assert.equal(abortControllerCount > 0, true);
	assert.deepEqual(await cleanup, {
		status: 'aborted',
		reason: 'timeout',
		timeoutKind: 'cleanup',
	});
});

void test('operation timeout metadata survives abort signals without reason', async () => {
	const fixture = harness();
	let abortControllerCount = 0;
	const run = fixture.createRun({
		createAbortController: () => {
			abortControllerCount += 1;
			return createNoReasonAbortController();
		},
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	const operation = run.runOperation('operation', () => {
		return new Promise<string>(() => undefined);
	});

	fixture.timers[0]?.callback();
	await flushPromises();

	assert.equal(abortControllerCount > 0, true);
	assert.deepEqual(await operation, {
		status: 'aborted',
		reason: 'timeout',
		timeoutKind: 'operation',
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

void test('finish prevents later abort from stopping active cleanup scope', () => {
	const fixture = harness();
	const run = fixture.createRun({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});
	const cleanupScope = run.createOperationScope('cleanup');

	run.finish();
	run.abort('stopped');

	assert.equal(cleanupScope.signal.aborted, false);
});

void test('finish removes active scope run abort listeners', () => {
	const controllers: TrackedAbortController[] = [];
	const fixture = harness();
	const run = fixture.createRun({
		createAbortController: () => createTrackedAbortController(controllers),
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});
	const runController = controllers[0];
	if (!runController) {
		throw new assert.AssertionError({
			message: 'Expected run AbortController to be created',
		});
	}

	run.createOperationScope('operation');
	run.createOperationScope('recovery');
	run.createOperationScope('cleanup');

	assert.equal(runController.abortListeners.size, 3);

	run.finish();

	assert.equal(runController.abortListeners.size, 0);
});

void test('runOperation removes scope abort listener after successful operation', async () => {
	const controllers: TrackedAbortController[] = [];
	const fixture = harness();
	const run = fixture.createRun({
		createAbortController: () => createTrackedAbortController(controllers),
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	assert.deepEqual(
		await run.runOperation('operation', async () => 'connected'),
		{
			status: 'ok',
			value: 'connected',
		},
	);

	const operationController = controllers[1];
	if (!operationController) {
		throw new assert.AssertionError({
			message: 'Expected operation AbortController to be created',
		});
	}
	assert.equal(operationController.abortListeners.size, 0);
});

void test('finish removes pending runOperation scope abort listener', async () => {
	const controllers: TrackedAbortController[] = [];
	const fixture = harness();
	const run = fixture.createRun({
		createAbortController: () => createTrackedAbortController(controllers),
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

	const operationController = controllers[1];
	if (!operationController) {
		throw new assert.AssertionError({
			message: 'Expected operation AbortController to be created',
		});
	}
	assert.equal(operationController.abortListeners.size, 2);

	run.finish();

	assert.equal(operationController.abortListeners.size, 0);

	resolveOperation('connected');
	assert.deepEqual(await operation, {
		status: 'ok',
		value: 'connected',
	});
});

void test('finish removes caller abort listener', () => {
	const caller = new AbortController();
	const listeners = new Set<EventListenerOrEventListenerObject>();
	const originalAddEventListener = caller.signal.addEventListener.bind(
		caller.signal,
	) as (
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

void test('classifyError leaves SSH connection abort text as failure', () => {
	const fixture = harness();
	const run = fixture.createRun({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	assert.equal(
		run.classifyError(new Error('software caused connection abort')),
		'failed',
	);
});

void test('runOperation surfaces network abort text when signal is not aborted', async () => {
	const fixture = harness();
	const run = fixture.createRun({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	await assert.rejects(
		run.runOperation('operation', async () => {
			throw new Error('software caused connection abort');
		}),
		/software caused connection abort/,
	);
});

void test('runOperation preserves actual run abort over non-abort error text', async () => {
	const fixture = harness();
	const run = fixture.createRun({
		timeouts: {
			operationTimeoutMs: 50,
			recoveryTimeoutMs: 80,
			cleanupTimeoutMs: 25,
		},
	});

	const result = await run.runOperation('operation', () => {
		run.abort('stopped');
		throw new Error('software caused connection abort');
	});

	assert.deepEqual(result, {
		status: 'aborted',
		reason: 'stopped',
		timeoutKind: null,
	});
});
