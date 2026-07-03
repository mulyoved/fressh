export type ConnectionRunAbortReason =
	| 'timeout'
	| 'caller-aborted'
	| 'stale-run'
	| 'stopped'
	| 'replaced'
	| 'unmounted';

export type ConnectionRunTimeoutKind = 'operation' | 'recovery' | 'cleanup';

export type ConnectionRunOperationKind = 'operation' | 'recovery' | 'cleanup';

export type ConnectionRunOperationResult<T> =
	| { status: 'ok'; value: T }
	| {
			status: 'aborted';
			reason: ConnectionRunAbortReason;
			timeoutKind: ConnectionRunTimeoutKind | null;
	  };

export type ConnectionRunOperationScope = {
	signal: AbortSignal;
	finish: () => void;
};

type OperationAbortMetadata = {
	reason: ConnectionRunAbortReason;
	timeoutKind: ConnectionRunTimeoutKind | null;
};

type InternalConnectionRunOperationScope = ConnectionRunOperationScope & {
	getAbortMetadata: () => OperationAbortMetadata | null;
};

export class ConnectionRunAbortedError extends Error {
	readonly reason: ConnectionRunAbortReason;
	readonly timeoutKind: ConnectionRunTimeoutKind | null;

	constructor(
		reason: ConnectionRunAbortReason,
		timeoutKind: ConnectionRunTimeoutKind | null,
	) {
		super(reason);
		this.name = 'ConnectionRunAbortedError';
		this.reason = reason;
		this.timeoutKind = timeoutKind;
	}
}

export type ConnectionRunTimeouts = {
	operationTimeoutMs: number;
	recoveryTimeoutMs: number;
	cleanupTimeoutMs: number;
};

export type ConnectionRunContext = {
	readonly signal: AbortSignal;
	readonly abortReason: ConnectionRunAbortReason | null;
	readonly timeoutKind: ConnectionRunTimeoutKind | null;
	abort: (
		reason: ConnectionRunAbortReason,
		timeoutKind?: ConnectionRunTimeoutKind | null,
	) => void;
	createOperationScope: (
		kind: ConnectionRunOperationKind,
	) => ConnectionRunOperationScope;
	runOperation: <T>(
		kind: ConnectionRunOperationKind,
		operation: (signal: AbortSignal) => Promise<T>,
	) => Promise<ConnectionRunOperationResult<T>>;
	throwIfAborted: () => void;
	finish: () => void;
	classifyError: (error: unknown) => 'aborted' | 'failed';
};

type TimerHandle = unknown;
type CleanupAbortListener = (
	reason: ConnectionRunAbortReason,
	timeoutKind: ConnectionRunTimeoutKind | null,
) => void;

type ConnectionRunContextOptions = {
	callerSignal?: AbortSignal | null;
	isCurrent?: () => boolean;
	timeouts?: Partial<ConnectionRunTimeouts>;
	setTimeout?: (callback: () => void, delayMs: number) => TimerHandle;
	clearTimeout?: (timer: TimerHandle) => void;
	createAbortController?: () => AbortController;
};

const defaultTimeouts: ConnectionRunTimeouts = {
	operationTimeoutMs: 30_000,
	recoveryTimeoutMs: 30_000,
	cleanupTimeoutMs: 5_000,
};

export function createConnectionRunContext(
	options: ConnectionRunContextOptions = {},
): ConnectionRunContext {
	const createAbortController =
		options.createAbortController ?? (() => new AbortController());
	const runController = createAbortController();
	const activeTimers = new Set<TimerHandle>();
	const activeScopeFinalizers = new Set<() => void>();
	const activeCleanupAbortListeners = new Set<CleanupAbortListener>();
	const timeouts = { ...defaultTimeouts, ...options.timeouts };
	const setTimer =
		options.setTimeout ??
		((callback: () => void, delayMs: number) =>
			globalThis.setTimeout(callback, delayMs));
	const clearTimer =
		options.clearTimeout ??
		((timer: TimerHandle) => {
			globalThis.clearTimeout(
				timer as ReturnType<typeof globalThis.setTimeout>,
			);
		});
	const isCurrent = options.isCurrent ?? (() => true);
	let abortReason: ConnectionRunAbortReason | null = null;
	let timeoutKind: ConnectionRunTimeoutKind | null = null;
	let cleanupStopAfterTimeout: OperationAbortMetadata | null = null;
	let finished = false;
	let abortFromCaller: (() => void) | null = null;

	function getTimeoutMs(kind: ConnectionRunOperationKind) {
		switch (kind) {
			case 'cleanup':
				return timeouts.cleanupTimeoutMs;
			case 'recovery':
				return timeouts.recoveryTimeoutMs;
			case 'operation':
				return timeouts.operationTimeoutMs;
		}
	}

	function clearTrackedTimer(timer: TimerHandle) {
		if (!activeTimers.delete(timer)) {
			return;
		}
		clearTimer(timer);
	}

	function startTimer(
		kind: ConnectionRunOperationKind,
		onTimeout: () => void,
	): TimerHandle {
		const timer = setTimer(() => {
			if (finished) {
				return;
			}
			activeTimers.delete(timer);
			onTimeout();
		}, getTimeoutMs(kind));
		activeTimers.add(timer);
		return timer;
	}

	function abortRun(
		reason: ConnectionRunAbortReason,
		nextTimeoutKind: ConnectionRunTimeoutKind | null,
	) {
		if (finished) {
			return;
		}
		if (reason !== 'timeout') {
			if (runController.signal.aborted && abortReason === 'timeout') {
				cleanupStopAfterTimeout = {
					reason,
					timeoutKind: nextTimeoutKind,
				};
			}
			for (const listener of [...activeCleanupAbortListeners]) {
				listener(reason, nextTimeoutKind);
			}
		}
		if (runController.signal.aborted) {
			return;
		}
		abortReason = reason;
		timeoutKind = nextTimeoutKind;
		runController.abort(new ConnectionRunAbortedError(reason, nextTimeoutKind));
	}

	function detachCallerSignal() {
		if (options.callerSignal && abortFromCaller !== null) {
			options.callerSignal.removeEventListener('abort', abortFromCaller);
			abortFromCaller = null;
		}
	}

	function createOperationScope(
		kind: ConnectionRunOperationKind,
	): InternalConnectionRunOperationScope {
		const controller = createAbortController();
		let timer: TimerHandle | null = null;
		let finishedScope = false;
		let abortFromRun: (() => void) | null = null;
		let abortFromLaterStop: CleanupAbortListener | null = null;
		let abortMetadata: OperationAbortMetadata | null = null;

		function finishScope() {
			if (finishedScope) {
				return;
			}
			finishedScope = true;
			activeScopeFinalizers.delete(finishScope);
			if (timer !== null) {
				clearTrackedTimer(timer);
				timer = null;
			}
			controller.signal.removeEventListener('abort', finishScope);
			if (abortFromRun !== null) {
				runController.signal.removeEventListener('abort', abortFromRun);
				abortFromRun = null;
			}
			if (abortFromLaterStop !== null) {
				activeCleanupAbortListeners.delete(abortFromLaterStop);
				abortFromLaterStop = null;
			}
		}

		function abortChild(
			reason: ConnectionRunAbortReason,
			nextTimeoutKind: ConnectionRunTimeoutKind | null,
		) {
			if (controller.signal.aborted) {
				return;
			}
			abortMetadata = { reason, timeoutKind: nextTimeoutKind };
			controller.abort(new ConnectionRunAbortedError(reason, nextTimeoutKind));
		}

		controller.signal.addEventListener('abort', finishScope, {
			once: true,
		});
		activeScopeFinalizers.add(finishScope);

		if (kind !== 'cleanup' && !runController.signal.aborted && !isCurrent()) {
			abortChild('stale-run', null);
			return {
				signal: controller.signal,
				finish: finishScope,
				getAbortMetadata: () => abortMetadata,
			};
		}

		timer = startTimer(kind, () => {
			if (finishedScope) {
				return;
			}
			if (kind === 'cleanup') {
				abortChild('timeout', 'cleanup');
				return;
			}
			abortRun('timeout', kind);
		});

		abortFromRun = () => {
			if (kind === 'cleanup' && abortReason === 'timeout') {
				return;
			}
			abortChild(abortReason ?? 'stopped', timeoutKind);
		};
		if (kind === 'cleanup') {
			abortFromLaterStop = (reason, nextTimeoutKind) => {
				abortChild(reason, nextTimeoutKind);
			};
			activeCleanupAbortListeners.add(abortFromLaterStop);
		}
		if (runController.signal.aborted) {
			if (kind === 'cleanup' && cleanupStopAfterTimeout !== null) {
				abortChild(
					cleanupStopAfterTimeout.reason,
					cleanupStopAfterTimeout.timeoutKind,
				);
			} else {
				abortFromRun();
			}
		} else {
			runController.signal.addEventListener('abort', abortFromRun, {
				once: true,
			});
		}

		return {
			signal: controller.signal,
			finish: finishScope,
			getAbortMetadata: () => abortMetadata,
		};
	}

	function throwIfAborted() {
		if (runController.signal.aborted) {
			throw new ConnectionRunAbortedError(
				abortReason ?? 'stopped',
				timeoutKind,
			);
		}
		if (!isCurrent()) {
			throw new ConnectionRunAbortedError('stale-run', null);
		}
	}

	function getAbortErrorResult(
		error: ConnectionRunAbortedError,
	): ConnectionRunOperationResult<never> {
		return {
			status: 'aborted',
			reason: error.reason,
			timeoutKind: error.timeoutKind,
		};
	}

	function isSignalAbortMessage(message: string) {
		return /\bsignal\b/i.test(message) && /\babort(?:ed)?\b/i.test(message);
	}

	function classifyError(error: unknown): 'aborted' | 'failed' {
		if (error instanceof ConnectionRunAbortedError) {
			return 'aborted';
		}
		if (!(error instanceof Error)) {
			return 'failed';
		}
		if (error.name === 'AbortError') {
			return 'aborted';
		}
		return isSignalAbortMessage(error.message) ? 'aborted' : 'failed';
	}

	function getScopeAbortResult(
		scope: InternalConnectionRunOperationScope,
	): ConnectionRunOperationResult<never> {
		const metadata = scope.getAbortMetadata();
		if (metadata !== null) {
			return {
				status: 'aborted',
				reason: metadata.reason,
				timeoutKind: metadata.timeoutKind,
			};
		}
		const reason = scope.signal.reason;
		if (reason instanceof ConnectionRunAbortedError) {
			return {
				status: 'aborted',
				reason: reason.reason,
				timeoutKind: reason.timeoutKind,
			};
		}
		return {
			status: 'aborted',
			reason: abortReason ?? 'stopped',
			timeoutKind,
		};
	}

	function isAbortedResult<T>(
		result: ConnectionRunOperationResult<T>,
	): result is Extract<ConnectionRunOperationResult<T>, { status: 'aborted' }> {
		return result.status === 'aborted';
	}

	async function runOperation<T>(
		kind: ConnectionRunOperationKind,
		operation: (signal: AbortSignal) => Promise<T>,
	): Promise<ConnectionRunOperationResult<T>> {
		if (kind !== 'cleanup' && !runController.signal.aborted && !isCurrent()) {
			return {
				status: 'aborted',
				reason: 'stale-run',
				timeoutKind: null,
			};
		}
		const scope = createOperationScope(kind);
		const signal = scope.signal;
		if (signal.aborted) {
			return getScopeAbortResult(scope);
		}

		let abortResultListener: (() => void) | null = null;
		const detachAbortResultListener = () => {
			if (abortResultListener === null) {
				return;
			}
			signal.removeEventListener('abort', abortResultListener);
			abortResultListener = null;
			activeScopeFinalizers.delete(detachAbortResultListener);
		};
		const abortResult = new Promise<ConnectionRunOperationResult<never>>(
			(resolve) => {
				abortResultListener = () => {
					resolve(getScopeAbortResult(scope));
				};
				signal.addEventListener('abort', abortResultListener, {
					once: true,
				});
				activeScopeFinalizers.add(detachAbortResultListener);
			},
		);

		try {
			const result = await Promise.race([
				operation(signal).then<ConnectionRunOperationResult<T>>((value) => ({
					status: 'ok',
					value,
				})),
				abortResult,
			]);
			if (isAbortedResult(result)) {
				return result;
			}
			if (signal.aborted) {
				return getScopeAbortResult(scope);
			}
			if (
				runController.signal.aborted &&
				!(kind === 'cleanup' && abortReason === 'timeout')
			) {
				return {
					status: 'aborted',
					reason: abortReason ?? 'stopped',
					timeoutKind,
				};
			}
			if (kind !== 'cleanup' && !isCurrent()) {
				return {
					status: 'aborted',
					reason: 'stale-run',
					timeoutKind: null,
				};
			}
			return result;
		} catch (error) {
			if (error instanceof ConnectionRunAbortedError) {
				return getAbortErrorResult(error);
			}
			if (signal.aborted) {
				return getScopeAbortResult(scope);
			}
			if (
				runController.signal.aborted &&
				!(kind === 'cleanup' && abortReason === 'timeout')
			) {
				return {
					status: 'aborted',
					reason: abortReason ?? 'stopped',
					timeoutKind,
				};
			}
			if (kind !== 'cleanup' && !isCurrent()) {
				return {
					status: 'aborted',
					reason: 'stale-run',
					timeoutKind: null,
				};
			}
			throw error;
		} finally {
			detachAbortResultListener();
			scope.finish();
		}
	}

	function finish() {
		finished = true;
		detachCallerSignal();
		for (const finalizeScope of [...activeScopeFinalizers]) {
			finalizeScope();
		}
		activeScopeFinalizers.clear();
		for (const timer of [...activeTimers]) {
			clearTrackedTimer(timer);
		}
		activeCleanupAbortListeners.clear();
	}

	if (options.callerSignal) {
		abortFromCaller = () => {
			abortFromCaller = null;
			abortRun('caller-aborted', null);
		};
		if (options.callerSignal.aborted) {
			abortFromCaller();
		} else {
			options.callerSignal.addEventListener('abort', abortFromCaller, {
				once: true,
			});
		}
	}

	return {
		signal: runController.signal,
		get abortReason() {
			return abortReason;
		},
		get timeoutKind() {
			return timeoutKind;
		},
		abort: (reason, nextTimeoutKind = null) => {
			abortRun(reason, nextTimeoutKind);
		},
		createOperationScope,
		runOperation,
		throwIfAborted,
		finish,
		classifyError,
	};
}
