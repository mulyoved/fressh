import { type WisprTimerPort } from '../wispr-automation';

export class WisprDelayCancelledError extends Error {
	constructor() {
		super('Wispr delay cancelled');
		this.name = 'WisprDelayCancelledError';
	}
}

type TimerOperation = {
	active: boolean;
	handle?: unknown;
	onCancel?: () => void;
};

export type WisprTimerOwner = WisprTimerPort & {
	sleep(delayMs: number): Promise<void>;
	cancelAll(): void;
};

export function createWisprTimerOwner(deps: WisprTimerPort): WisprTimerOwner {
	const operations = new Set<TimerOperation>();

	const cancelUnderlying = (operation: TimerOperation) => {
		if (operation.handle === undefined) return;
		try {
			deps.clearTimeout(operation.handle);
		} catch {
			// Logical cancellation remains authoritative when native cleanup throws.
		}
	};
	const cancel = (operation: TimerOperation) => {
		if (!operations.delete(operation)) return;
		operation.active = false;
		cancelUnderlying(operation);
		operation.onCancel?.();
	};
	const schedule = (
		task: () => void,
		delayMs: number,
		onCancel?: () => void,
	): TimerOperation => {
		const operation: TimerOperation = {
			active: true,
			onCancel,
		};
		operations.add(operation);
		try {
			operation.handle = deps.setTimeout(() => {
				if (!operations.delete(operation)) return;
				operation.active = false;
				task();
			}, delayMs);
		} catch (error) {
			operations.delete(operation);
			operation.active = false;
			throw error;
		}
		return operation;
	};

	return {
		setTimeout: (task, delayMs) => schedule(task, delayMs),
		clearTimeout: (timer) => cancel(timer as TimerOperation),
		sleep: (delayMs) =>
			new Promise<void>((resolve, reject) => {
				schedule(resolve, delayMs, () => {
					reject(new WisprDelayCancelledError());
				});
			}),
		cancelAll: () => {
			for (const operation of [...operations]) cancel(operation);
		},
	};
}
