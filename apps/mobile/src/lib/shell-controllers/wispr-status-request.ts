import { withTimeout, type WisprTimerPort } from '../wispr-automation';

const STATUS_TIMEOUT_MS = 750;

export function requestWisprStatus<T>(
	getStatus: () => Promise<T>,
	timers: WisprTimerPort,
): Promise<T> {
	return withTimeout(getStatus(), STATUS_TIMEOUT_MS, {
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
