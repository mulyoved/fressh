import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient();

export type StrictOmit<T, K extends keyof T> = Omit<T, K>;

export const AbortSignalTimeout = (timeout: number) => {
	// AbortSignal.timeout is not available as of expo 54
	// TypeError: AbortSignal.timeout is not a function (it is undefined)
	const controller = new AbortController();
	setTimeout(() => {
		controller.abort();
	}, timeout);
	return controller.signal;
};

export const AbortSignalAny = (
	signals: readonly (AbortSignal | undefined)[],
) => {
	const activeSignals = signals.filter((signal) => signal !== undefined);
	const controller = new AbortController();
	const abort = () => {
		controller.abort();
		for (const signal of activeSignals) {
			signal.removeEventListener('abort', abort);
		}
	};

	if (activeSignals.some((signal) => signal.aborted)) {
		abort();
		return controller.signal;
	}

	for (const signal of activeSignals) {
		signal.addEventListener('abort', abort, { once: true });
	}

	return controller.signal;
};
