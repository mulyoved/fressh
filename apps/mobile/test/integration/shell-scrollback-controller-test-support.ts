import { type ShellActivitySnapshot } from '../../src/lib/shell-controllers/activity-core';
import {
	createShellScrollbackControllerCore,
	type ShellScrollbackContext,
} from '../../src/lib/shell-controllers/scrollback-core';
import { createScrollbackRemoteCopyModeOwner } from '../../src/lib/shell-controllers/scrollback-remote-copy-mode-owner';
import {
	type RetiringWorkmuxCleanupPort,
	type ShellWorkmuxPort,
} from '../../src/lib/shell-controllers/session-contracts';
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
	const aggregateBarrier = createWorkmuxScrollbackLiveInputCleanupBarrier();
	const trackedInputs: Promise<boolean>[] = [];
	return {
		barrier: {
			current: aggregateBarrier.current,
			track: (cleanup?: Promise<boolean> | null) => {
				if (cleanup) trackedInputs.push(cleanup);
				return aggregateBarrier.track(cleanup);
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
	const remoteCopyMode = createScrollbackRemoteCopyModeOwner({
		warn: () => {},
	});
	const remoteCopyModeActive = {
		get current() {
			return remoteCopyMode.isOwned();
		},
		set current(owned: boolean) {
			if (owned !== remoteCopyMode.isOwned()) {
				if (owned) remoteCopyMode.acquire();
				else remoteCopyMode.release();
			}
		},
	};
	const remoteCopyModeGeneration = {
		get current() {
			return remoteCopyMode.generation();
		},
		set current(generation: number) {
			while (remoteCopyMode.generation() < generation) {
				remoteCopyMode.transition();
			}
		},
	};
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const localExitRequestIds = new Set<number>();
	const resetCalls: unknown[] = [];
	const warnings: string[] = [];
	const enterAcks: { requestId: number; instanceId: string }[] = [];
	const localExitMessages: { requestId: number; instanceId?: string }[] = [];
	const alerts: { title: string; message: string }[] = [];
	const copiedMessages: string[] = [];
	const traces: Record<string, unknown>[] = [];
	let activitySnapshot = {
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 0,
	} as const;
	const activityListeners = new Set<() => void>();
	const activity = {
		getSnapshot: () => activitySnapshot,
		subscribe: (listener: () => void) => {
			activityListeners.add(listener);
			return () => activityListeners.delete(listener);
		},
	};
	let selectionModeEnabled = false;
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
		getSelectionModeEnabled: () => selectionModeEnabled,
		isCurrentInstance: () => true,
		fit: () => {},
		setSystemKeyboardEnabled: () => {},
		setSelectionModeEnabled: () => {},
		getSelection: async () => '',
		exitScrollback: (message: { requestId: number; instanceId?: string }) => {
			localExitMessages.push(message);
		},
		sendScrollbackEnterAck: (requestId: number, instanceId: string) => {
			enterAcks.push({ requestId, instanceId });
		},
	};
	const terminalTransport = {
		captureLease: () => null,
		isLeaseCurrent: () => false,
		sendBatch: async () => {},
	};
	const scroll = {
		enter: async () => ({ status: 'completed' as const, output: '' }),
		move: async () => ({ status: 'completed' as const, output: '' }),
		exit: async () => ({ status: 'completed' as const, output: '' }),
	};
	const workmuxBeforeDispose = new Map<
		string,
		(port: RetiringWorkmuxCleanupPort) => Promise<void>
	>();
	let workmuxUnregisterCount = 0;
	const workmux = {
		key: targetKey,
		scroll,
		registerBeforeDispose: (owner, cleanup) => {
			workmuxBeforeDispose.set(owner, cleanup);
			return () => {
				if (workmuxBeforeDispose.get(owner) !== cleanup) return;
				workmuxBeforeDispose.delete(owner);
				workmuxUnregisterCount += 1;
			};
		},
	} satisfies Pick<
		ShellWorkmuxPort,
		'key' | 'scroll' | 'registerBeforeDispose'
	>;
	const context = {
		targetKey,
		targetName: 'main',
		connectionAvailable: true,
		shellAvailable: true,
		tmuxEnabled: true,
		activity,
		terminalTransport,
		terminalView,
		workmux,
		trace: (event) => traces.push(event),
		feedback: {
			alert: (title, message) => alerts.push({ title, message }),
			copyMessage: (message) => copiedMessages.push(message),
		},
		logger:
			options.logger ??
			({
				warn: (message) => warnings.push(message),
			} satisfies ShellScrollbackContext['logger']),
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	} as ShellScrollbackContext & { workmux: typeof workmux };
	const core = createShellScrollbackControllerCore({
		createExecutor,
		lineAccumulator,
		cleanupBarrier:
			options.cleanupBarrier ??
			createWorkmuxScrollbackLiveInputCleanupBarrier(),
		localExitRequestIds,
		remoteCopyMode,
	});
	core.setContext(context);

	return {
		core,
		alerts,
		copiedMessages,
		context,
		enterAcks,
		events,
		executorInputs,
		executors,
		lineAccumulator,
		localExitMessages,
		localExitRequestIds,
		remoteCopyModeActive,
		remoteCopyModeGeneration,
		remoteCopyMode,
		resetCalls,
		scroll,
		setExecutorFactoryOverride: (override: typeof executorFactoryOverride) => {
			executorFactoryOverride = override;
		},
		setActivitySnapshot: (next: Partial<ShellActivitySnapshot>) => {
			activitySnapshot = {
				...activitySnapshot,
				...next,
			} as typeof activitySnapshot;
			for (const listener of [...activityListeners]) listener();
		},
		setSelectionModeEnabled: (enabled: boolean) => {
			selectionModeEnabled = enabled;
		},
		traces,
		warnings,
		workmux,
		workmuxBeforeDispose,
		workmuxUnregisterCount: () => workmuxUnregisterCount,
	};
}
