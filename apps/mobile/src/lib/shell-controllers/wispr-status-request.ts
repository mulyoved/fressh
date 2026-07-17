import { withTimeout, type WisprTimerPort } from '../wispr-automation';

const STATUS_TIMEOUT_MS = 750;

export function withWisprTransactionDeadline<T>(
	operation: Promise<T>,
	timeoutMs: number,
	timers: WisprTimerPort,
): Promise<T> {
	return withTimeout(operation, timeoutMs, {
		setTimeout: (task, delayMs) => timers.setTimeout(task, delayMs),
		clearTimeout: (timer) => {
			try {
				timers.clearTimeout(timer);
			} catch {
				// Exact request identity still retires a stale deadline callback.
			}
		},
	});
}

export function requestWisprStatus<T>(
	getStatus: () => Promise<T>,
	timers: WisprTimerPort,
): Promise<T> {
	return withWisprTransactionDeadline(getStatus(), STATUS_TIMEOUT_MS, timers);
}
