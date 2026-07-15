export type WisprAutomationFailureReason =
	| 'service-disabled'
	| 'bubble-not-found'
	| 'tap-failed'
	| 'unsupported-platform';

export type WisprAutomationFailure = {
	reason: WisprAutomationFailureReason;
	message: string;
};

function getWisprErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function resolveWisprTapFailure(error: unknown): WisprAutomationFailure {
	const errorMessage = getWisprErrorMessage(error);
	const reason: WisprAutomationFailureReason = errorMessage
		.toLowerCase()
		.includes('not found')
		? 'bubble-not-found'
		: 'tap-failed';
	if (reason === 'bubble-not-found') {
		return { reason, message: 'Wispr bubble not found.' };
	}
	return {
		reason,
		message: errorMessage
			? `Wispr tap failed: ${errorMessage}`
			: 'Wispr tap failed.',
	};
}

export type WisprAutomationState =
	| { phase: 'idle' }
	| { phase: 'openingTextEntry' }
	| { phase: 'waitingForBubble'; textBeforeStart: string }
	| { phase: 'recording'; textBeforeStart: string }
	| {
			phase: 'failed';
			reason: WisprAutomationFailureReason;
			message: string;
	  };

export type WisprAutomationEvent =
	| { type: 'press' }
	| { type: 'textEntryFocused'; textBeforeStart: string }
	| { type: 'wisprTapSucceeded' }
	| { type: 'textChanged'; value: string }
	| {
			type: 'failed';
			reason: WisprAutomationFailureReason;
			message: string;
	  }
	| { type: 'reset' };

export function reduceWisprAutomationState(
	state: WisprAutomationState,
	event: WisprAutomationEvent,
): WisprAutomationState {
	if (event.type === 'reset') return { phase: 'idle' };
	if (event.type === 'failed') {
		return {
			phase: 'failed',
			reason: event.reason,
			message: event.message,
		};
	}

	switch (state.phase) {
		case 'idle':
			if (event.type === 'press') return { phase: 'openingTextEntry' };
			return state;

		case 'failed':
			if (event.type === 'press') return { phase: 'openingTextEntry' };
			return state;

		case 'openingTextEntry':
			if (event.type === 'textEntryFocused') {
				return {
					phase: 'waitingForBubble',
					textBeforeStart: event.textBeforeStart,
				};
			}
			return state;

		case 'waitingForBubble':
			if (event.type === 'wisprTapSucceeded') {
				return {
					phase: 'recording',
					textBeforeStart: state.textBeforeStart,
				};
			}
			return state;

		case 'recording':
			if (
				event.type === 'textChanged' &&
				event.value !== state.textBeforeStart
			) {
				return { phase: 'idle' };
			}
			return state;

		default:
			return state;
	}
}

export function isWisprAutomationBusy(state: WisprAutomationState): boolean {
	return state.phase !== 'idle' && state.phase !== 'failed';
}

export type WisprTextEditorAvailability =
	| { type: 'ready' }
	| {
			type: 'setup-required';
			reason: 'service-disabled';
			message: string;
			openAccessibilitySettings: false;
	  };

export type WisprTextEditorStatus = {
	serviceEnabled: boolean;
	serviceConnected: boolean;
};

export type TextEntryWisprControl =
	| {
			type: 'switch';
			label: 'Wispr';
			enabled: boolean;
	  }
	| {
			type: 'setup-pill';
			label: 'Wispr disabled';
	  };

export type WisprAutoCloseDecision =
	| { type: 'none' }
	| { type: 'close-now' }
	| { type: 'close-after-start'; requestId: number };

export type WisprPendingAutoCloseRequest = {
	requestId: number;
	retryClose: boolean;
};

export type WisprPendingAutoCloseRequestResolution = {
	pendingRequests: WisprPendingAutoCloseRequest[];
	closeNow: boolean;
};

export function resolveWisprTextEditorAvailability(
	status: WisprTextEditorStatus,
): WisprTextEditorAvailability {
	if (status.serviceEnabled && status.serviceConnected) {
		return { type: 'ready' };
	}

	return {
		type: 'setup-required',
		reason: 'service-disabled',
		message: 'Wispr automation is disabled. Text entry is still available.',
		openAccessibilitySettings: false,
	};
}

export function resolveTextEntryWisprControl({
	availability,
	autoStartEnabled,
	automationState,
}: {
	availability: WisprTextEditorAvailability;
	autoStartEnabled: boolean;
	automationState?: WisprAutomationState;
}): TextEntryWisprControl {
	if (automationState?.phase === 'failed') {
		return {
			type: 'setup-pill',
			label: 'Wispr disabled',
		};
	}

	if (availability.type === 'ready') {
		return {
			type: 'switch',
			label: 'Wispr',
			enabled: autoStartEnabled,
		};
	}

	return {
		type: 'setup-pill',
		label: 'Wispr disabled',
	};
}

export function resolveWisprAutoCloseOnTextEntryClose({
	autoStartedRequestId,
	automationState,
	controlTapStartedRequestId,
	timedOutStartRequestId,
}: {
	autoStartedRequestId: number | null;
	automationState: WisprAutomationState;
	controlTapStartedRequestId?: number | null;
	timedOutStartRequestId?: number | null;
}): WisprAutoCloseDecision {
	const noClose = { type: 'none' } as const;
	if (autoStartedRequestId == null) return noClose;

	if (
		automationState.phase === 'waitingForBubble' &&
		controlTapStartedRequestId === autoStartedRequestId
	) {
		return {
			type: 'close-after-start',
			requestId: autoStartedRequestId,
		};
	}

	if (
		automationState.phase === 'failed' &&
		timedOutStartRequestId === autoStartedRequestId
	) {
		return {
			type: 'close-after-start',
			requestId: autoStartedRequestId,
		};
	}

	if (
		automationState.phase === 'idle' ||
		automationState.phase === 'recording'
	) {
		return {
			type: 'close-now',
		};
	}

	return noClose;
}

export function resolveWisprPendingAutoCloseRequests({
	pendingRequests,
	decision,
	retryClose,
}: {
	pendingRequests: readonly WisprPendingAutoCloseRequest[];
	decision: WisprAutoCloseDecision;
	retryClose: boolean;
}): WisprPendingAutoCloseRequestResolution {
	const closeAfterStartRequestId =
		decision.type === 'close-after-start' ? decision.requestId : null;
	const nextRequests = pendingRequests.filter(
		(request) => request.requestId !== closeAfterStartRequestId,
	);

	if (closeAfterStartRequestId != null) {
		nextRequests.push({
			requestId: closeAfterStartRequestId,
			retryClose,
		});
	}

	return {
		pendingRequests: nextRequests,
		closeNow: decision.type === 'close-now',
	};
}

export function canStartWisprTextEntryAutomation({
	closeInFlight,
	pendingRequests,
}: {
	closeInFlight: boolean;
	pendingRequests: readonly WisprPendingAutoCloseRequest[];
}): boolean {
	return !closeInFlight && pendingRequests.length === 0;
}

export class WisprTapTimeoutError extends Error {
	constructor(readonly nativeWorkIssued = true) {
		super('Wispr tap timed out');
		this.name = 'WisprTapTimeoutError';
	}
}

export type WisprTimerPort = {
	setTimeout(task: () => void, delayMs: number): unknown;
	clearTimeout(timer: unknown): void;
};

const defaultWisprTimerPort: WisprTimerPort = {
	setTimeout: (task, delayMs) => setTimeout(task, delayMs),
	clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	timerPort: WisprTimerPort = defaultWisprTimerPort,
): Promise<T> {
	let timeout: unknown;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeout = timerPort.setTimeout(() => {
			reject(new WisprTapTimeoutError());
		}, timeoutMs);
	});

	return Promise.race([promise, timeoutPromise]).finally(() => {
		if (timeout !== undefined) timerPort.clearTimeout(timeout);
	});
}

export function tapWisprControlWithTimeout({
	tapWisprControl,
	timeoutMs,
	onLateSuccess,
	onLateFailure,
	onInvocation,
	setTimeout: scheduleTimeout = defaultWisprTimerPort.setTimeout,
	clearTimeout: cancelTimeout = defaultWisprTimerPort.clearTimeout,
}: {
	tapWisprControl: () => Promise<unknown>;
	timeoutMs: number;
	onLateSuccess?: () => void;
	onLateFailure?: () => void;
	onInvocation?: () => void;
	setTimeout?: WisprTimerPort['setTimeout'];
	clearTimeout?: WisprTimerPort['clearTimeout'];
}): Promise<unknown> {
	let timedOut = false;
	let nativeWorkIssued = false;
	let timeout: unknown;
	let rejectTimeout!: (error: WisprTapTimeoutError) => void;
	const timeoutPromise = new Promise<never>((_, reject) => {
		rejectTimeout = reject;
	});
	try {
		timeout = scheduleTimeout(() => {
			timedOut = true;
			rejectTimeout(new WisprTapTimeoutError(nativeWorkIssued));
		}, timeoutMs);
	} catch (error) {
		return Promise.reject(error);
	}
	if (timedOut) return timeoutPromise;
	let tapPromise: Promise<unknown>;
	try {
		tapPromise = tapWisprControl();
	} catch (error) {
		cancelTimeout(timeout);
		return Promise.reject(error);
	}
	nativeWorkIssued = true;
	onInvocation?.();
	tapPromise.then(
		() => {
			if (timedOut) onLateSuccess?.();
		},
		() => {
			if (timedOut) onLateFailure?.();
		},
	);
	return Promise.race([tapPromise, timeoutPromise]).finally(() => {
		if (timeout !== undefined) cancelTimeout(timeout);
	});
}
