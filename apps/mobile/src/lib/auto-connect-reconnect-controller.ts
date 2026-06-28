import { type ConnectionDiagnosticEventInput } from './connection-diagnostics';
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
	event: (event: ConnectionDiagnosticEventInput) => void;
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

	const traceEvent = (event: ConnectionDiagnosticEventInput) => {
		try {
			trace?.event(event);
		} catch (error) {
			logger.warn('Reconnect trace event failed', error);
		}
	};

	const stop = (reason: string) => {
		traceEvent({
			type: 'reconnect.stopped',
			source: 'reconnect-controller',
			message: reason,
			details: { reason },
		});
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
		traceEvent({
			type: 'reconnect.retry.scheduled',
			source: 'reconnect-controller',
			details: { attemptIndex: attempt, delayMs },
		});
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
			traceEvent({
				type: 'reconnect.start.blocked',
				source: 'reconnect-controller',
				message: reason,
				details: {
					reason,
					isAutoConnecting: snapshot.isAutoConnecting,
					isReconnecting: snapshot.isReconnecting,
					resetInFlight: snapshot.resetInFlight,
				},
			});
			return false;
		}

		running = true;
		generation += 1;
		const loopGeneration = generation;
		startedAtMs = now();
		attemptIndex = 0;
		setReconnecting(true);
		logger.info('Reconnect cycle started', { reason });
		traceEvent({
			type: 'reconnect.started',
			source: 'reconnect-controller',
			message: reason,
			details: { reason, delaysMs, windowMs },
		});

		const attemptWithBackoff = async () => {
			if (!isCurrentLoop(loopGeneration)) return;
			const snapshotBeforeAttempt = getSnapshot();
			const elapsedMs = now() - (startedAtMs ?? now());
			if (elapsedMs >= windowMs) {
				logger.warn('Reconnect timeout reached', { elapsedMs });
				traceEvent({
					type: 'reconnect.timeout',
					source: 'reconnect-controller',
					details: { elapsedMs, windowMs },
				});
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

			traceEvent({
				type: 'reconnect.attempt.started',
				source: 'reconnect-controller',
				details: { elapsedMs },
			});
			const success = await attemptAutoConnect();
			if (!isCurrentLoop(loopGeneration)) return;
			traceEvent({
				type: success
					? 'reconnect.attempt.connected'
					: 'reconnect.attempt.failed',
				source: 'reconnect-controller',
				details: { elapsedMs },
			});
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
