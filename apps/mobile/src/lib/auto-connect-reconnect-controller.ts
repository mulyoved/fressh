import { diagnosticEvents } from './connection-diagnostic-events';
import { type ConnectionDiagnosticEvent } from './connection-diagnostic-types';
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
	attemptAutoConnect: () => Promise<boolean>;
	logger: AutoConnectReconnectLogger;
	trace?: AutoConnectReconnectTrace;
};

export type AutoConnectReconnectController = {
	start: (reason: string) => boolean;
	replace: (reason: string) => boolean;
	stop: (reason: string) => void;
	isRunning: () => boolean;
};

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
			diagnosticEvents.reconnect({
				kind: 'reconnect.stopped',
				source: 'reconnect-controller',
				message: reason,
				reason,
			}),
		);

	const traceScheduledRetry = (attemptIndex: number, delayMs: number) =>
		traceEvent(
			diagnosticEvents.reconnect({
				kind: 'reconnect.retry.scheduled',
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
			diagnosticEvents.reconnect({
				kind: 'reconnect.start.blocked',
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
			diagnosticEvents.reconnect({
				kind: success
					? 'reconnect.attempt.connected'
					: 'reconnect.attempt.failed',
				source: 'reconnect-controller',
				reconnectElapsedMs: elapsedMs,
			}),
		);

	const stop = (reason: string) => {
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

	const start = (reason: string) => {
		const snapshot = getSnapshot();
		if (
			running ||
			snapshot.resetInFlight ||
			snapshot.isReconnecting ||
			snapshot.isAutoConnecting
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
			diagnosticEvents.reconnect({
				kind: 'reconnect.started',
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
					diagnosticEvents.reconnect({
						kind: 'reconnect.timeout',
						source: 'reconnect-controller',
						reconnectElapsedMs: elapsedMs,
						windowMs,
					}),
				);
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
				diagnosticEvents.reconnect({
					kind: 'reconnect.attempt.started',
					source: 'reconnect-controller',
					reconnectElapsedMs: elapsedMs,
				}),
			);
			const success = await attemptAutoConnect();
			if (!isCurrentLoop(loopGeneration)) return;
			traceAttemptResult(success, elapsedMs);
			if (success) {
				logger.info('Reconnected successfully', { elapsedMs });
				stop('reconnected');
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

	const replace = (reason: string) => {
		if (running) {
			stop(`${reason}-restart`);
		}
		return start(reason);
	};

	return {
		start,
		replace,
		stop,
		isRunning: () => running,
	};
}
