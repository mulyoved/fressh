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
};

const defaultTimeouts: ConnectionRunTimeouts = {
	operationTimeoutMs: 30_000,
	recoveryTimeoutMs: 30_000,
	cleanupTimeoutMs: 5_000,
};

export function createConnectionRunContext(
	options: ConnectionRunContextOptions = {},
): ConnectionRunContext {
	const runController = new AbortController();
	const activeTimers = new Set<TimerHandle>();
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
		if (reason !== 'timeout') {
			for (const listener of [...activeCleanupAbortListeners]) {
				listener(reason, nextTimeoutKind);
			}
		}
		if (finished || runController.signal.aborted) {
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
	): ConnectionRunOperationScope {
		const controller = new AbortController();
		let timer: TimerHandle | null = null;
		let finishedScope = false;
		let abortFromRun: (() => void) | null = null;
		let abortFromLaterStop: CleanupAbortListener | null = null;

		function finishScope() {
			if (finishedScope) {
				return;
			}
			finishedScope = true;
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
			controller.abort(new ConnectionRunAbortedError(reason, nextTimeoutKind));
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

		controller.signal.addEventListener('abort', finishScope, {
			once: true,
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
			abortFromRun();
		} else {
			runController.signal.addEventListener('abort', abortFromRun, {
				once: true,
			});
		}

		return {
			signal: controller.signal,
			finish: finishScope,
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

	function getSignalAbortResult(
		signal: AbortSignal,
	): ConnectionRunOperationResult<never> {
		const reason = signal.reason;
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
			return getSignalAbortResult(signal);
		}

		const abortResult = new Promise<ConnectionRunOperationResult<never>>(
			(resolve) => {
				signal.addEventListener(
					'abort',
					() => {
						resolve(getSignalAbortResult(signal));
					},
					{ once: true },
				);
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
			if (classifyError(error) === 'aborted') {
				if (signal.aborted) {
					return getSignalAbortResult(signal);
				}
				if (runController.signal.aborted) {
					return {
						status: 'aborted',
						reason: abortReason ?? 'stopped',
						timeoutKind,
					};
				}
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
			scope.finish();
		}
	}

	function finish() {
		finished = true;
		detachCallerSignal();
		for (const timer of [...activeTimers]) {
			clearTrackedTimer(timer);
		}
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
