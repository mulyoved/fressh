import { type TerminalFitSize } from '../terminal-fit-runner';
import {
	createControllerPublisher,
	type ControllerCore,
	type ControllerInvalidationReason,
} from './controller-core';

export type TerminalSizeState = {
	lastSize: TerminalFitSize | null;
};

export type TerminalSizeController = ControllerCore<TerminalSizeState> & {
	handleResize(cols: number, rows: number): void;
	waitForSizeAfterFit(): Promise<TerminalFitSize | null>;
};

export type CreateTerminalSizeControllerInput = {
	setTimeout(task: () => void, delayMs: number): unknown;
	clearTimeout(timer: unknown): void;
	resizePty(cols: number, rows: number): Promise<void>;
	warn(message: string, error: unknown): void;
};

type FitWaiter = {
	timer: unknown;
	resolve(size: TerminalFitSize | null): void;
};

const RESIZE_DEBOUNCE_MS = 100;
const FIT_SIZE_FALLBACK_MS = 250;

export function createTerminalSizeController({
	setTimeout,
	clearTimeout,
	resizePty,
	warn,
}: CreateTerminalSizeControllerInput): TerminalSizeController {
	const publisher = createControllerPublisher<TerminalSizeState>({
		lastSize: null,
	});
	const waiters = new Set<FitWaiter>();
	let resizeTimer: unknown | null = null;
	let lastRequestedPtySize: TerminalFitSize | null = null;
	let operationRevision = 0;
	let disposed = false;

	const clearResizeTimer = (): void => {
		if (resizeTimer === null) return;
		clearTimeout(resizeTimer);
		resizeTimer = null;
	};

	const settleWaiters = (size: TerminalFitSize | null): void => {
		for (const waiter of [...waiters]) {
			waiters.delete(waiter);
			waiter.resolve(size);
			clearTimeout(waiter.timer);
		}
	};

	const reportResizeFailure = (error: unknown): void => {
		try {
			warn('resizePty failed', error);
		} catch {
			// Logging must not escape a timer callback or block later resizes.
		}
	};

	const runResize = (size: TerminalFitSize): void => {
		try {
			void resizePty(size.cols, size.rows).catch(reportResizeFailure);
		} catch (error) {
			reportResizeFailure(error);
		}
	};

	const handleResize = (cols: number, rows: number): void => {
		if (disposed) return;
		const revision = ++operationRevision;
		const size = { cols, rows };
		publisher.publish({ lastSize: size });
		if (disposed || revision !== operationRevision) return;
		settleWaiters(size);

		if (
			lastRequestedPtySize?.cols === size.cols &&
			lastRequestedPtySize.rows === size.rows
		) {
			return;
		}

		clearResizeTimer();
		lastRequestedPtySize = size;
		resizeTimer = setTimeout(() => {
			resizeTimer = null;
			if (disposed) return;
			runResize(size);
		}, RESIZE_DEBOUNCE_MS);
	};

	const waitForSizeAfterFit = (): Promise<TerminalFitSize | null> => {
		if (disposed) return Promise.resolve(publisher.getSnapshot().lastSize);
		return new Promise((resolve) => {
			const waiter: FitWaiter = {
				timer: null,
				resolve,
			};
			waiter.timer = setTimeout(() => {
				if (!waiters.delete(waiter)) return;
				resolve(publisher.getSnapshot().lastSize);
			}, FIT_SIZE_FALLBACK_MS);
			waiters.add(waiter);
		});
	};

	const invalidate = (_reason: ControllerInvalidationReason): void => {
		if (disposed) return;
		operationRevision += 1;
		clearResizeTimer();
		lastRequestedPtySize = null;
		settleWaiters(publisher.getSnapshot().lastSize);
		publisher.publish({ lastSize: null });
	};

	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		operationRevision += 1;
		clearResizeTimer();
		settleWaiters(publisher.getSnapshot().lastSize);
		publisher.disposePublisher();
	};

	return {
		getSnapshot: publisher.getSnapshot,
		subscribe: publisher.subscribe,
		invalidate,
		dispose,
		handleResize,
		waitForSizeAfterFit,
	};
}
