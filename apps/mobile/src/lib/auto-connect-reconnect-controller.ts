import { type ConnectionDiagnosticEvent } from './connection-diagnostic-types';
import { reconnectEvents } from './connection-diagnostics/events';
import {
	createConnectionRunContext,
	type ConnectionRunContext,
} from './connection-run-context';
import {
	canAttemptBackgroundReconnect,
	shouldWaitForForegroundServiceCoverage,
} from './foreground-service-runtime';

export type AutoConnectReconnectSnapshot = {
	isAutoConnecting: boolean;
	isReconnecting: boolean;
	resetInFlight: boolean;
	platformOS: string;
	appActive: boolean;
	backgroundWorkAllowed: boolean;
	foregroundServiceRequired: boolean;
};

export type AutoConnectReconnectAttemptResult =
	| { status: 'connected'; message?: string }
	| { status: 'retry'; message?: string }
	| {
			status:
				| 'timeout'
				| 'needsAttention'
				| 'failedNetwork'
				| 'failedAuth'
				| 'failedTmuxAttach'
				| 'cleanupFailed';
			message?: string;
	  };

type AutoConnectReconnectLogger = {
	info: (message: string, context?: unknown) => void;
	warn: (message: string, context?: unknown) => void;
};

type AutoConnectReconnectTrace = {
	event: (event: ConnectionDiagnosticEvent) => void;
};

export type AutoConnectReconnectControllerOptions = {
	delaysMs: readonly number[];
	windowMs: number;
	now: () => number;
	setTimeout: (callback: () => void, delayMs: number) => unknown;
	clearTimeout: (timer: unknown) => void;
	getSnapshot: () => AutoConnectReconnectSnapshot;
	setReconnecting: (next: boolean) => void;
	attemptAutoConnect: (
		signal: AbortSignal,
	) => Promise<AutoConnectReconnectAttemptResult | boolean>;
	logger: AutoConnectReconnectLogger;
	trace?: AutoConnectReconnectTrace;
};

export type AutoConnectReconnectController = {
	start: (reason: string) => boolean;
	replace: (reason: string) => boolean;
	stop: (reason: string) => void;
	isRunning: () => boolean;
};

function normalizeReconnectAttemptResult(
	result: AutoConnectReconnectAttemptResult | boolean,
): AutoConnectReconnectAttemptResult {
	if (typeof result === 'boolean') {
		return result ? { status: 'connected' } : { status: 'retry' };
	}
	return result;
}

function destinationForReconnectOutcome(
	status: AutoConnectReconnectAttemptResult['status'],
): 'terminal' | 'hostPage' {
	return status === 'connected' ? 'terminal' : 'hostPage';
}

function timeoutReconnectAttemptResult(): AutoConnectReconnectAttemptResult {
	return {
		status: 'timeout',
		message: 'retry-timeout',
	};
}

export function createAutoConnectReconnectController({
	delaysMs,
	windowMs,
	now,
	setTimeout,
	clearTimeout,
	getSnapshot,
	setReconnecting,
	attemptAutoConnect,
	logger,
	trace,
}: AutoConnectReconnectControllerOptions): AutoConnectReconnectController {
	let timer: unknown = null;
	let startedAtMs: number | null = null;
	let attemptIndex = 0;
	let running = false;
	let generation = 0;
	let activeRunContext: ConnectionRunContext | null = null;

	const clearTimer = () => {
		if (timer === null) return;
		clearTimeout(timer);
		timer = null;
	};

	const isCurrentLoop = (loopGeneration: number) =>
		running && generation === loopGeneration;

	const traceEvent = (event: ConnectionDiagnosticEvent) => {
		try {
			trace?.event(event);
		} catch (error) {
			logger.warn('Reconnect trace event failed', error);
		}
	};

	const traceStop = (reason: string) =>
		traceEvent(
			reconnectEvents.stopped({
				source: 'reconnect-controller',
				message: reason,
				reason,
			}),
		);

	const traceScheduledRetry = (attemptIndex: number, delayMs: number) =>
		traceEvent(
			reconnectEvents.retryScheduled({
				source: 'reconnect-controller',
				attemptIndex,
				delayMs,
			}),
		);

	const traceBlockedStart = (
		reason: string,
		snapshot: AutoConnectReconnectSnapshot,
	) =>
		traceEvent(
			reconnectEvents.startBlocked({
				source: 'reconnect-controller',
				message: reason,
				reason,
				isAutoConnecting: snapshot.isAutoConnecting,
				isReconnecting: snapshot.isReconnecting,
				resetInFlight: snapshot.resetInFlight,
			}),
		);

	const traceAttemptResult = (success: boolean, elapsedMs: number) =>
		traceEvent(
			success
				? reconnectEvents.attemptConnected({
						source: 'reconnect-controller',
						reconnectElapsedMs: elapsedMs,
					})
				: reconnectEvents.attemptFailed({
						source: 'reconnect-controller',
						reconnectElapsedMs: elapsedMs,
					}),
		);

	const traceCompletedOutcome = (result: AutoConnectReconnectAttemptResult) => {
		if (result.status === 'retry') return;
		traceEvent(
			reconnectEvents.completed({
				source: 'reconnect-controller',
				message: result.message ?? result.status,
				outcome: result.status,
				destination: destinationForReconnectOutcome(result.status),
			}),
		);
	};

	const runAttemptWithDeadline = async (
		timeoutMs: number,
		loopGeneration: number,
	) => {
		const runContext = createConnectionRunContext({
			isCurrent: () => isCurrentLoop(loopGeneration),
			timeouts: {
				operationTimeoutMs: timeoutMs,
				recoveryTimeoutMs: timeoutMs,
				cleanupTimeoutMs: 5_000,
			},
			setTimeout,
			clearTimeout,
		});
		activeRunContext = runContext;
		try {
			const result = await runContext.runOperation(
				'operation',
				async (signal) => await attemptAutoConnect(signal),
			);
			if (result.status === 'aborted') {
				if (result.reason === 'timeout') {
					return { status: 'timedOut' as const };
				}
				return { status: 'aborted' as const };
			}
			if (!isCurrentLoop(loopGeneration)) {
				return { status: 'aborted' as const };
			}
			return {
				status: 'completed' as const,
				result: normalizeReconnectAttemptResult(result.value),
			};
		} finally {
			runContext.finish();
			if (activeRunContext === runContext) {
				activeRunContext = null;
			}
		}
	};

	const stop = (reason: string) => {
		activeRunContext?.abort(
			reason.includes('restart') ? 'replaced' : 'stopped',
		);
		activeRunContext = null;
		traceStop(reason);
		clearTimer();
		generation += 1;
		running = false;
		startedAtMs = null;
		attemptIndex = 0;
		setReconnecting(false);
		logger.info('Reconnect cycle stopped', { reason });
	};

	const scheduleNextAttempt = (
		loopGeneration: number,
		attemptWithBackoff: () => Promise<void>,
	) => {
		if (!isCurrentLoop(loopGeneration)) return;
		const attempt = attemptIndex;
		attemptIndex += 1;
		const delayMs = delaysMs[Math.min(attempt, delaysMs.length - 1)] ?? 10_000;
		traceScheduledRetry(attempt, delayMs);
		timer = setTimeout(() => {
			timer = null;
			void attemptWithBackoff();
		}, delayMs);
	};

	const startWithOptions = (
		reason: string,
		options?: { allowAutoConnectInFlight: boolean },
	) => {
		const snapshot = getSnapshot();
		if (
			running ||
			snapshot.resetInFlight ||
			snapshot.isReconnecting ||
			(snapshot.isAutoConnecting && !options?.allowAutoConnectInFlight)
		) {
			traceBlockedStart(reason, snapshot);
			return false;
		}

		running = true;
		generation += 1;
		const loopGeneration = generation;
		startedAtMs = now();
		attemptIndex = 0;
		setReconnecting(true);
		logger.info('Reconnect cycle started', { reason });
		traceEvent(
			reconnectEvents.started({
				source: 'reconnect-controller',
				message: reason,
				reason,
				windowMs,
			}),
		);

		const attemptWithBackoff = async () => {
			if (!isCurrentLoop(loopGeneration)) return;
			const snapshotBeforeAttempt = getSnapshot();
			const elapsedMs = now() - (startedAtMs ?? now());
			if (elapsedMs >= windowMs) {
				logger.warn('Reconnect timeout reached', { elapsedMs });
				traceEvent(
					reconnectEvents.timeout({
						source: 'reconnect-controller',
						reconnectElapsedMs: elapsedMs,
						windowMs,
					}),
				);
				traceCompletedOutcome(timeoutReconnectAttemptResult());
				stop('retry-timeout');
				return;
			}
			if (snapshotBeforeAttempt.resetInFlight) {
				stop('tailscale-reset-in-progress');
				return;
			}
			if (!isCurrentLoop(loopGeneration)) return;
			if (
				shouldWaitForForegroundServiceCoverage({
					platformOS: snapshotBeforeAttempt.platformOS,
					appActive: snapshotBeforeAttempt.appActive,
					backgroundWorkAllowed: snapshotBeforeAttempt.backgroundWorkAllowed,
					foregroundServiceRequired:
						snapshotBeforeAttempt.foregroundServiceRequired,
				})
			) {
				scheduleNextAttempt(loopGeneration, attemptWithBackoff);
				return;
			}
			if (!isCurrentLoop(loopGeneration)) return;
			if (
				!canAttemptBackgroundReconnect({
					platformOS: snapshotBeforeAttempt.platformOS,
					appActive: snapshotBeforeAttempt.appActive,
					backgroundWorkAllowed: snapshotBeforeAttempt.backgroundWorkAllowed,
				})
			) {
				stop('app-not-active');
				return;
			}

			traceEvent(
				reconnectEvents.attemptStarted({
					source: 'reconnect-controller',
					reconnectElapsedMs: elapsedMs,
				}),
			);
			let attemptResultValue: AutoConnectReconnectAttemptResult = {
				status: 'retry',
			};
			try {
				const attemptResult = await runAttemptWithDeadline(
					windowMs - elapsedMs,
					loopGeneration,
				);
				if (attemptResult.status === 'timedOut') {
					logger.warn('Reconnect attempt timed out', {
						timeoutMs: windowMs - elapsedMs,
					});
					traceEvent(
						reconnectEvents.timeout({
							source: 'reconnect-controller',
							reconnectElapsedMs: windowMs,
							windowMs,
						}),
					);
					traceCompletedOutcome(timeoutReconnectAttemptResult());
					stop('retry-timeout');
					return;
				}
				if (attemptResult.status === 'aborted') {
					return;
				}
				attemptResultValue = attemptResult.result;
			} catch (error) {
				if (!isCurrentLoop(loopGeneration)) return;
				logger.warn('Reconnect attempt threw', error);
				traceAttemptResult(false, elapsedMs);
				if (getSnapshot().resetInFlight) {
					stop('tailscale-reset-in-progress');
					return;
				}
				if (!isCurrentLoop(loopGeneration)) return;
				scheduleNextAttempt(loopGeneration, attemptWithBackoff);
				return;
			}
			if (!isCurrentLoop(loopGeneration)) return;
			const success = attemptResultValue.status === 'connected';
			traceAttemptResult(success, elapsedMs);
			traceCompletedOutcome(attemptResultValue);
			if (success) {
				logger.info('Reconnected successfully', { elapsedMs });
				stop('reconnected');
				return;
			}
			if (attemptResultValue.status !== 'retry') {
				stop(attemptResultValue.status);
				return;
			}
			if (getSnapshot().resetInFlight) {
				stop('tailscale-reset-in-progress');
				return;
			}
			if (!isCurrentLoop(loopGeneration)) return;
			scheduleNextAttempt(loopGeneration, attemptWithBackoff);
		};

		void attemptWithBackoff();
		return true;
	};

	const start = (reason: string) => startWithOptions(reason);

	const replace = (reason: string) => {
		const wasRunning = running;
		if (running) {
			stop(`${reason}-restart`);
		}
		return startWithOptions(reason, {
			allowAutoConnectInFlight: wasRunning,
		});
	};

	return {
		start,
		replace,
		stop,
		isRunning: () => running,
	};
}
