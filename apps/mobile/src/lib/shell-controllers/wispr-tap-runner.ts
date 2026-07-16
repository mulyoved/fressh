import {
	resolveWisprTapFailure,
	tapWisprControlWithTimeout,
	WisprTapTimeoutError,
	type WisprAutomationFailureReason,
	type WisprTimerPort,
} from '../wispr-automation';

const RETRY_WINDOW_MS = 2_500;
const RETRY_INTERVAL_MS = 200;
const TAP_TIMEOUT_MS = 750;

export type WisprTapResult =
	| { status: 'completed' }
	| { status: 'superseded' }
	| {
			status: 'failed';
			reason: WisprAutomationFailureReason;
			message: string;
			timedOut: boolean;
			uncertain: boolean;
	  };

export type WisprTapAttemptSettlement =
	| { status: 'completed' }
	| { status: 'failed' };

export type WisprTapRunner = {
	run(input: {
		retry: boolean;
		isCurrent(): boolean;
		acceptLateResult(): boolean;
		attempt?: {
			start(): void;
			settle(result: WisprTapAttemptSettlement): void;
		};
		onLateSuccess?(): void;
		onLateFailure?(): void;
	}): Promise<WisprTapResult>;
};

export type CreateWisprTapRunnerInput = WisprTimerPort & {
	tapControl(): Promise<unknown>;
	now(): number;
	sleep(delayMs: number): Promise<void>;
};

export function createWisprTapRunner(
	deps: CreateWisprTapRunnerInput,
): WisprTapRunner {
	return {
		run: async ({
			retry,
			isCurrent,
			acceptLateResult,
			attempt,
			onLateSuccess,
			onLateFailure,
		}) => {
			let lastError: unknown = new Error('Wispr bubble not found');
			const deadline = deps.now() + (retry ? RETRY_WINDOW_MS : TAP_TIMEOUT_MS);

			for (;;) {
				if (!isCurrent()) return { status: 'superseded' };
				try {
					const remainingMs = Math.max(1, deadline - deps.now());
					await tapWisprControlWithTimeout({
						tapWisprControl: deps.tapControl,
						timeoutMs: Math.min(TAP_TIMEOUT_MS, remainingMs),
						setTimeout: deps.setTimeout,
						clearTimeout: deps.clearTimeout,
						onInvocation: attempt?.start,
						onLateSuccess: () => {
							if (acceptLateResult()) onLateSuccess?.();
						},
						onLateFailure: () => {
							if (acceptLateResult()) onLateFailure?.();
						},
					});
					if (acceptLateResult()) attempt?.settle({ status: 'completed' });
					if (!isCurrent()) return { status: 'superseded' };
					return { status: 'completed' };
				} catch (error) {
					lastError = error;
					const uncertain =
						error instanceof WisprTapTimeoutError && error.nativeWorkIssued;
					if (acceptLateResult() && !uncertain) {
						attempt?.settle({ status: 'failed' });
					}
					if (!isCurrent()) return { status: 'superseded' };
					if (error instanceof WisprTapTimeoutError) break;
				}

				if (!retry || deps.now() >= deadline) break;
				const delayMs = Math.min(RETRY_INTERVAL_MS, deadline - deps.now());
				if (!isCurrent()) return { status: 'superseded' };
				try {
					await deps.sleep(delayMs);
				} catch (error) {
					lastError = error;
					if (!isCurrent()) return { status: 'superseded' };
					break;
				}
				if (!isCurrent()) return { status: 'superseded' };
			}

			const failure = resolveWisprTapFailure(lastError);
			const uncertain =
				lastError instanceof WisprTapTimeoutError && lastError.nativeWorkIssued;
			return {
				status: 'failed',
				...failure,
				timedOut: lastError instanceof WisprTapTimeoutError,
				uncertain,
			};
		},
	};
}
