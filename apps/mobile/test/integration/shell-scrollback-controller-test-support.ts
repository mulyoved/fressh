import {
	createShellScrollbackControllerCore,
	type ShellScrollbackContext,
} from '../../src/lib/shell-controllers/scrollback-core';
import { createShellTargetKey } from '../../src/lib/shell-controllers/source-keys';
import { createTmuxScrollbackLineAccumulator } from '../../src/lib/workmux-scrollback-batch';
import {
	type WorkmuxScrollbackCommandExecutor,
	type createWorkmuxScrollbackCommandExecutor,
} from '../../src/lib/workmux-scrollback-executor';
import { createWorkmuxScrollbackLiveInputCleanupBarrier } from '../../src/lib/workmux-scrollback-live-input';

const targetKey = createShellTargetKey('transport' as never, 'main');

export function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

export async function flushPromises() {
	await Promise.resolve();
	await new Promise<void>((resolve) => setImmediate(resolve));
}

export function createRecordingCleanupBarrier() {
	let currentCleanup: Promise<boolean> | null = null;
	const trackedInputs: Promise<boolean>[] = [];
	return {
		barrier: {
			current: () => currentCleanup,
			track: (cleanup?: Promise<boolean> | null) => {
				if (!cleanup) return currentCleanup;
				trackedInputs.push(cleanup);
				const tracked = cleanup.finally(() => {
					if (currentCleanup === tracked) currentCleanup = null;
				});
				currentCleanup = tracked;
				return tracked;
			},
		},
		trackedInputs,
	};
}

export function createScrollbackHarness(
	options: {
		cleanupBarrier?: ReturnType<
			typeof createWorkmuxScrollbackLiveInputCleanupBarrier
		>;
		logger?: ShellScrollbackContext['logger'];
	} = {},
) {
	const events: string[] = [];
	const remoteCopyModeActive = { current: false };
	const remoteCopyModeGeneration = { current: 0 };
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const localExitRequestIds = new Set<number>();
	const resetCalls: unknown[] = [];
	const warnings: string[] = [];
	const executorInputs: Parameters<
		typeof createWorkmuxScrollbackCommandExecutor
	>[0][] = [];
	let executorNumber = 0;
	const executors: WorkmuxScrollbackCommandExecutor[] = [];
	let executorFactoryOverride:
		| ((
				input: Parameters<typeof createWorkmuxScrollbackCommandExecutor>[0],
				createDefault: () => WorkmuxScrollbackCommandExecutor,
		  ) => WorkmuxScrollbackCommandExecutor)
		| null = null;
	const createDefaultExecutor = (
		input: Parameters<typeof createWorkmuxScrollbackCommandExecutor>[0],
	): WorkmuxScrollbackCommandExecutor => {
		executorInputs.push(input);
		executorNumber += 1;
		const id = executorNumber;
		const executor: WorkmuxScrollbackCommandExecutor = {
			runEnterCommand: async () => false,
			enqueueScrollBatch: async () => false,
			reset: (options) => {
				events.push(`reset:${id}`);
				resetCalls.push(options);
				return null;
			},
			dispose: () => {
				events.push(`dispose:${id}`);
				return null;
			},
		};
		executors.push(executor);
		return executor;
	};
	const createExecutor = (
		input: Parameters<typeof createWorkmuxScrollbackCommandExecutor>[0],
	): WorkmuxScrollbackCommandExecutor =>
		executorFactoryOverride?.(input, () => createDefaultExecutor(input)) ??
		createDefaultExecutor(input);

	const terminalView = {
		getRuntimeKey: () => null,
		getRuntimeInstanceId: () => null,
		isCurrentInstance: () => false,
		fit: () => {},
		setSystemKeyboardEnabled: () => {},
		setSelectionModeEnabled: () => {},
		getSelection: async () => '',
		exitScrollback: () => {},
		sendScrollbackEnterAck: () => {},
	};
	const terminalTransport = {
		captureLease: () => null,
		isLeaseCurrent: () => false,
		sendBatch: async () => {},
	};
	const scroll = {
		enter: async () => ({ success: true, output: '' }),
		move: async () => ({ success: true, output: '' }),
		exit: async () => ({ success: true, output: '' }),
	};
	const context: ShellScrollbackContext = {
		targetKey,
		targetName: 'main',
		connectionAvailable: true,
		shellAvailable: true,
		tmuxEnabled: true,
		getActivitySnapshot: () => ({
			focused: true,
			appState: 'active',
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getSelectionModeEnabled: () => false,
		terminalTransport,
		terminalView,
		workmuxScroll: scroll,
		trace: () => {},
		feedback: { alert: () => {}, copyMessage: () => {} },
		logger:
			options.logger ??
			({
				warn: (message) => warnings.push(message),
			} satisfies ShellScrollbackContext['logger']),
	};
	const core = createShellScrollbackControllerCore({
		createExecutor,
		lineAccumulator,
		cleanupBarrier:
			options.cleanupBarrier ??
			createWorkmuxScrollbackLiveInputCleanupBarrier(),
		localExitRequestIds,
		remoteCopyModeActive,
		remoteCopyModeGeneration,
	});
	core.setContext(context);

	return {
		core,
		context,
		events,
		executorInputs,
		executors,
		lineAccumulator,
		localExitRequestIds,
		remoteCopyModeActive,
		remoteCopyModeGeneration,
		resetCalls,
		scroll,
		setExecutorFactoryOverride: (override: typeof executorFactoryOverride) => {
			executorFactoryOverride = override;
		},
		warnings,
	};
}
