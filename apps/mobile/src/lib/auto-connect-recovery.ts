import {
	getTailscaleManualResetAttentionMessage,
	getTailscaleRecoveryAttentionMessage,
	isTailscaleRecoverySupported,
	TAILSCALE_RESTART_FAILED_MESSAGE,
	type TailscaleManualResetResult,
	type TailscaleRecoverAfterFailureResult,
} from './tailscale-recovery-core';

export function getTailscaleRecoveryAttentionDecision(input: {
	platformOS: string;
	result: TailscaleRecoverAfterFailureResult;
	retrySucceeded: boolean;
}) {
	if (
		!isTailscaleRecoverySupported(input.platformOS) ||
		!input.result.networkLikeFailure ||
		input.retrySucceeded
	) {
		return { kind: 'none' as const };
	}

	const message =
		getTailscaleRecoveryAttentionMessage(input.result) ??
		(input.result.attempted ? TAILSCALE_RESTART_FAILED_MESSAGE : null);

	if (message === null) {
		return { kind: 'none' as const };
	}

	return {
		kind: 'attention' as const,
		message,
	};
}

export function getTailscaleManualResetDecision(
	result: TailscaleManualResetResult,
) {
	const message = getTailscaleManualResetAttentionMessage(result);
	if (message !== null) {
		return {
			kind: 'attention' as const,
			message,
		};
	}

	if (result.kind === 'reset') {
		return { kind: 'reconnect' as const };
	}
	return { kind: 'none' as const };
}

export function canStartReplacementReconnect(input: {
	resetInFlight: boolean;
	reconnectLoopRunning: boolean;
	isReconnecting: boolean;
	isAutoConnecting: boolean;
}) {
	return (
		!input.resetInFlight &&
		!input.reconnectLoopRunning &&
		!input.isReconnecting &&
		!input.isAutoConnecting
	);
}

export function canUpdateTailscaleAttention(input: {
	resetInFlight: boolean;
	force?: boolean;
}) {
	return input.force === true || !input.resetInFlight;
}

export function isCurrentReconnectLoop(input: {
	currentGeneration: number;
	loopGeneration: number;
	reconnectLoopRunning: boolean;
}) {
	return (
		input.reconnectLoopRunning &&
		input.currentGeneration === input.loopGeneration
	);
}
