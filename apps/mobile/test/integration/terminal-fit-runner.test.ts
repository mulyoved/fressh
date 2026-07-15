import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createManualTerminalFitRunner,
	type ManualTerminalFitRunnerDeps,
	type ManualTerminalFitXterm,
} from '../../src/lib/terminal-fit-runner';

type Deferred<T> = {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
};

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function createHarness(overrides: Partial<ManualTerminalFitRunnerDeps> = {}) {
	const calls: string[] = [];
	const failures: { title: string; message: string }[] = [];
	const xterm: ManualTerminalFitXterm = {
		fit: () => calls.push('fit'),
	};

	const deps: ManualTerminalFitRunnerDeps = {
		getHostCommands: () => ({
			key: 'terminal-fit' as never,
			run: async (command, timeoutMs) => {
				calls.push(`tmux:${command}:${String(timeoutMs)}`);
				return { status: 'completed', output: '' };
			},
		}),
		isTmuxEnabled: () => true,
		getTerminalSize: () => ({ cols: 42, rows: 17 }),
		getXterm: () => xterm,
		getTargetName: () => 'main',
		waitForTerminalSizeAfterFit: undefined,
		resizePty: async (cols, rows) => {
			calls.push(`resizePty:${cols}x${rows}`);
		},
		showFailure: (title, message) => {
			failures.push({ title, message });
			calls.push(`failure:${title}:${message}`);
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
		...overrides,
	};
	const runner = createManualTerminalFitRunner(deps);

	return {
		calls,
		deps,
		failures,
		run: runner.run,
		cancel: runner.cancelCurrent,
	};
}

void test('manual terminal fit resizes local PTY and tmux window', async () => {
	const harness = createHarness();

	await harness.run();

	assert.deepEqual(harness.calls, [
		'fit',
		'resizePty:42x17',
		'tmux:tmux resize-window -t main -x 42 -y 17 \\; set-window-option -t main window-size manual:30000',
	]);
	assert.deepEqual(harness.failures, []);
});

void test('manual terminal fit waits for size measured after fit', async () => {
	const harness = createHarness({
		getTerminalSize: () => ({ cols: 120, rows: 40 }),
		waitForTerminalSizeAfterFit: async () => ({ cols: 42, rows: 17 }),
	});

	await harness.run();

	assert.deepEqual(harness.calls, [
		'fit',
		'resizePty:42x17',
		'tmux:tmux resize-window -t main -x 42 -y 17 \\; set-window-option -t main window-size manual:30000',
	]);
	assert.deepEqual(harness.failures, []);
});

void test('manual terminal fit resizes non-tmux PTY without tmux command', async () => {
	const harness = createHarness({
		isTmuxEnabled: () => false,
	});

	await harness.run();

	assert.deepEqual(harness.calls, ['fit', 'resizePty:42x17']);
	assert.deepEqual(harness.failures, []);
});

void test('manual terminal fit prompts fit when terminal size is missing', async () => {
	const harness = createHarness({
		getTerminalSize: () => null,
	});

	await harness.run();

	assert.deepEqual(harness.calls, [
		'fit',
		'failure:Fit terminal failed:Terminal size is not ready yet. Try again.',
	]);
	assert.deepEqual(harness.failures, [
		{
			title: 'Fit terminal failed',
			message: 'Terminal size is not ready yet. Try again.',
		},
	]);
});

void test('manual terminal fit reports tmux resize failures', async () => {
	const harness = createHarness({
		getHostCommands: () => ({
			key: 'terminal-fit' as never,
			run: async () => ({
				status: 'failed',
				failure: { message: 'resize failed' },
			}),
		}),
	});

	await harness.run();

	assert.deepEqual(harness.calls, [
		'fit',
		'resizePty:42x17',
		'failure:Fit terminal failed:resize failed',
	]);
});

void test('manual terminal fit silently drops a superseded host completion', async () => {
	const harness = createHarness({
		getHostCommands: () => ({
			key: 'terminal-fit' as never,
			run: async () => ({ status: 'superseded' }),
		}),
	});

	await harness.run();

	assert.deepEqual(harness.calls, ['fit', 'resizePty:42x17']);
	assert.deepEqual(harness.failures, []);
});

void test('manual terminal fit cancellation drops a stale local resize completion before host resize', async () => {
	const resize = createDeferred<void>();
	const harness = createHarness({
		resizePty: (cols, rows) => {
			harness.calls.push(`resizePty:${cols}x${rows}`);
			return resize.promise;
		},
	});

	const pending = harness.run();
	await Promise.resolve();
	harness.cancel();
	resize.resolve();
	await pending;

	assert.deepEqual(harness.calls, ['fit', 'resizePty:42x17']);
	assert.deepEqual(harness.failures, []);
});

void test('manual terminal fit cancellation drops a stale local resize rejection', async () => {
	const resize = createDeferred<void>();
	const harness = createHarness({
		resizePty: (cols, rows) => {
			harness.calls.push(`resizePty:${cols}x${rows}`);
			return resize.promise;
		},
	});

	const pending = harness.run();
	await Promise.resolve();
	harness.cancel();
	resize.reject(new Error('stale resize failure'));
	await pending;

	assert.deepEqual(harness.calls, ['fit', 'resizePty:42x17']);
	assert.deepEqual(harness.failures, []);
});

void test('manual terminal fit cancellation during size measurement prevents local and host resize', async () => {
	const size = createDeferred<{ cols: number; rows: number } | null>();
	const harness = createHarness({
		waitForTerminalSizeAfterFit: () => size.promise,
	});

	const pending = harness.run();
	await Promise.resolve();
	harness.cancel();
	size.resolve({ cols: 80, rows: 24 });
	await pending;

	assert.deepEqual(harness.calls, ['fit']);
	assert.deepEqual(harness.failures, []);
});

void test('manual terminal fit cancellation drops a stale host failure', async () => {
	const hostStarted = createDeferred<void>();
	const host = createDeferred<
		| { status: 'completed'; output: string }
		| { status: 'failed'; failure: { message: string } }
	>();
	const harness = createHarness({
		getHostCommands: () => ({
			key: 'terminal-fit' as never,
			run: (command, timeoutMs) => {
				harness.calls.push(`tmux:${command}:${String(timeoutMs)}`);
				hostStarted.resolve();
				return host.promise;
			},
		}),
	});

	const pending = harness.run();
	await hostStarted.promise;
	harness.cancel();
	host.resolve({
		status: 'failed',
		failure: { message: 'stale host failure' },
	});
	await pending;

	assert.deepEqual(harness.calls, [
		'fit',
		'resizePty:42x17',
		'tmux:tmux resize-window -t main -x 42 -y 17 \\; set-window-option -t main window-size manual:30000',
	]);
	assert.deepEqual(harness.failures, []);
});
