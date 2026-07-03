export type ConnectionRunAbortReason =
	| 'timeout'
	| 'caller-aborted'
	| 'stale-run'
	| 'stopped'
	| 'replaced'
	| 'unmounted';

export type ConnectionRunTimeoutKind = 'operation' | 'recovery' | 'cleanup';

export type ConnectionRunOperationKind = 'operation' | 'recovery' | 'cleanup';

type NonTimeoutAbortReason = Exclude<ConnectionRunAbortReason, 'timeout'>;
type ManualAbortReason = 'stopped' | 'replaced' | 'unmounted';

export type ConnectionRunOperationResult<T> =
	| { status: 'ok'; value: T }
	| ({
			status: 'aborted';
	  } & OperationAbortMetadata);

type ConnectionRunOperationScope = {
	signal: AbortSignal;
	finish: () => void;
};

type OperationAbortMetadata =
	| {
			reason: 'timeout';
			timeoutKind: ConnectionRunTimeoutKind;
	  }
	| {
			reason: Exclude<ConnectionRunAbortReason, 'timeout'>;
			timeoutKind: null;
	  };

type InternalConnectionRunOperationScope = ConnectionRunOperationScope & {
	getAbortMetadata: () => OperationAbortMetadata | null;
};

export class ConnectionRunAbortedError extends Error {
	readonly reason: ConnectionRunAbortReason;
	readonly timeoutKind: ConnectionRunTimeoutKind | null;

	constructor(reason: 'timeout', timeoutKind: ConnectionRunTimeoutKind);
	constructor(reason: NonTimeoutAbortReason, timeoutKind?: null);
	constructor(
		reason: ConnectionRunAbortReason,
		timeoutKind: ConnectionRunTimeoutKind | null = null,
	) {
		if (reason === 'timeout' && timeoutKind === null) {
			throw new Error('Timeout aborts require a timeout kind.');
		}
		if (reason !== 'timeout' && timeoutKind !== null) {
			throw new Error('Only timeout aborts can include a timeout kind.');
		}
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
	abort: (reason: ManualAbortReason) => void;
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
	reason: NonTimeoutAbortReason,
	timeoutKind: null,
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
	const activeTimers = new Map<TimerHandle, ConnectionRunOperationKind>();
	const activeScopeFinalizers = new Set<() => void>();
	const activeCleanupRunAbortFinalizers = new Set<() => void>();
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

	function createAbortMetadata(
		reason: 'timeout',
		nextTimeoutKind: ConnectionRunTimeoutKind,
	): OperationAbortMetadata;
	function createAbortMetadata(
		reason: NonTimeoutAbortReason,
		nextTimeoutKind?: null,
	): OperationAbortMetadata;
	function createAbortMetadata(
		reason: ConnectionRunAbortReason,
		nextTimeoutKind: ConnectionRunTimeoutKind | null = null,
	): OperationAbortMetadata {
		if (reason === 'timeout') {
			if (nextTimeoutKind === null) {
				throw new Error('Timeout aborts require a timeout kind.');
			}
			return { reason, timeoutKind: nextTimeoutKind };
		}
		return { reason, timeoutKind: null };
	}

	function getRunAbortMetadata(): OperationAbortMetadata {
		if (abortReason === 'timeout' && timeoutKind !== null) {
			return { reason: 'timeout', timeoutKind };
		}
		if (abortReason !== null && abortReason !== 'timeout') {
			return { reason: abortReason, timeoutKind: null };
		}
		return { reason: 'stopped', timeoutKind: null };
	}

	function createAbortError(metadata: OperationAbortMetadata) {
		return metadata.reason === 'timeout'
			? new ConnectionRunAbortedError(metadata.reason, metadata.timeoutKind)
			: new ConnectionRunAbortedError(metadata.reason);
	}

	function createAbortResult(
		metadata: OperationAbortMetadata,
	): ConnectionRunOperationResult<never> {
		return {
			status: 'aborted',
			...metadata,
		};
	}

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
			if (finished && kind !== 'cleanup') {
				return;
			}
			activeTimers.delete(timer);
			onTimeout();
		}, getTimeoutMs(kind));
		activeTimers.set(timer, kind);
		return timer;
	}

	function abortRun(
		reason: 'timeout',
		nextTimeoutKind: ConnectionRunTimeoutKind,
	): void;
	function abortRun(
		reason: NonTimeoutAbortReason,
		nextTimeoutKind?: null,
	): void;
	function abortRun(
		reason: ConnectionRunAbortReason,
		nextTimeoutKind: ConnectionRunTimeoutKind | null = null,
	) {
		if (finished) {
			return;
		}
		if (reason !== 'timeout') {
			if (runController.signal.aborted && abortReason === 'timeout') {
				cleanupStopAfterTimeout = createAbortMetadata(reason);
			}
			for (const listener of [...activeCleanupAbortListeners]) {
				listener(reason, null);
			}
		}
		if (runController.signal.aborted) {
			return;
		}
		abortReason = reason;
		timeoutKind = nextTimeoutKind;
		const metadata =
			reason === 'timeout'
				? createAbortMetadata(
						'timeout',
						nextTimeoutKind as ConnectionRunTimeoutKind,
					)
				: createAbortMetadata(reason);
		runController.abort(createAbortError(metadata));
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

		function detachRunAbortListener() {
			if (abortFromRun !== null) {
				runController.signal.removeEventListener('abort', abortFromRun);
				abortFromRun = null;
			}
			activeCleanupRunAbortFinalizers.delete(detachRunAbortListener);
		}

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
			detachRunAbortListener();
			if (abortFromLaterStop !== null) {
				activeCleanupAbortListeners.delete(abortFromLaterStop);
				abortFromLaterStop = null;
			}
		}

		function abortChild(
			reason: 'timeout',
			nextTimeoutKind: ConnectionRunTimeoutKind,
		): void;
		function abortChild(
			reason: NonTimeoutAbortReason,
			nextTimeoutKind?: null,
		): void;
		function abortChild(
			reason: ConnectionRunAbortReason,
			nextTimeoutKind: ConnectionRunTimeoutKind | null = null,
		) {
			if (controller.signal.aborted) {
				return;
			}
			abortMetadata =
				reason === 'timeout'
					? createAbortMetadata(
							'timeout',
							nextTimeoutKind as ConnectionRunTimeoutKind,
						)
					: createAbortMetadata(reason);
			controller.abort(createAbortError(abortMetadata));
		}

		function abortChildWithMetadata(metadata: OperationAbortMetadata) {
			if (metadata.reason === 'timeout') {
				abortChild('timeout', metadata.timeoutKind);
				return;
			}
			abortChild(metadata.reason);
		}

		controller.signal.addEventListener('abort', finishScope, {
			once: true,
		});
		if (kind !== 'cleanup') {
			activeScopeFinalizers.add(finishScope);
		}

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
			if (abortReason === 'timeout' && timeoutKind !== null) {
				abortChild('timeout', timeoutKind);
			} else {
				abortChild(
					abortReason !== null && abortReason !== 'timeout'
						? abortReason
						: 'stopped',
				);
			}
		};
		if (kind === 'cleanup') {
			abortFromLaterStop = (reason, nextTimeoutKind) => {
				abortChild(reason, nextTimeoutKind);
			};
			activeCleanupAbortListeners.add(abortFromLaterStop);
		}
		if (runController.signal.aborted) {
			if (kind === 'cleanup') {
				if (cleanupStopAfterTimeout !== null) {
					abortChildWithMetadata(cleanupStopAfterTimeout);
				}
			} else {
				abortFromRun();
			}
		} else {
			runController.signal.addEventListener('abort', abortFromRun, {
				once: true,
			});
			if (kind === 'cleanup') {
				activeCleanupRunAbortFinalizers.add(detachRunAbortListener);
			}
		}

		return {
			signal: controller.signal,
			finish: finishScope,
			getAbortMetadata: () => abortMetadata,
		};
	}

	function throwIfAborted() {
		if (runController.signal.aborted) {
			throw createAbortError(getRunAbortMetadata());
		}
		if (!isCurrent()) {
			throw new ConnectionRunAbortedError('stale-run');
		}
	}

	function getAbortErrorResult(
		error: ConnectionRunAbortedError,
	): ConnectionRunOperationResult<never> {
		return createAbortResult(
			error.reason === 'timeout' && error.timeoutKind !== null
				? { reason: 'timeout', timeoutKind: error.timeoutKind }
				: {
						reason: error.reason === 'timeout' ? 'stopped' : error.reason,
						timeoutKind: null,
					},
		);
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
			return createAbortResult(metadata);
		}
		const reason = scope.signal.reason;
		if (reason instanceof ConnectionRunAbortedError) {
			return getAbortErrorResult(reason);
		}
		return createAbortResult(getRunAbortMetadata());
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
				if (kind !== 'cleanup') {
					activeScopeFinalizers.add(detachAbortResultListener);
				}
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
			if (runController.signal.aborted && kind !== 'cleanup') {
				return createAbortResult(getRunAbortMetadata());
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
			if (runController.signal.aborted && kind !== 'cleanup') {
				return createAbortResult(getRunAbortMetadata());
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
		for (const [timer, kind] of [...activeTimers]) {
			if (kind !== 'cleanup') {
				clearTrackedTimer(timer);
			}
		}
		for (const finalizeRunAbort of [...activeCleanupRunAbortFinalizers]) {
			finalizeRunAbort();
		}
		activeCleanupRunAbortFinalizers.clear();
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
		abort: (reason) => {
			abortRun(reason, null);
		},
		runOperation,
		throwIfAborted,
		finish,
		classifyError,
	};
}
