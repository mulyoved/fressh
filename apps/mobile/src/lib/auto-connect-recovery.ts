import {
	isTailscaleRecoverySupported,
	shouldShowTailscaleAttention,
} from './tailscale-recovery-core';

export const TAILSCALE_RESET_FAILED_MESSAGE =
	'Tailscale reset failed. Open Tailscale, then retry Fressh.';
export const TAILSCALE_RESET_NOT_STARTED_MESSAGE =
	'Tailscale reset did not start. Open Tailscale, then retry Fressh.';

export function shouldMarkTailscaleRecoveryAttention(input: {
	platformOS: string;
	networkLikeFailure: boolean;
	recoveryAttempted: boolean;
	retrySucceeded: boolean;
	available?: boolean;
	failed?: boolean;
	ensureAttemptedBeforeFailure?: boolean;
}) {
	if (
		!isTailscaleRecoverySupported(input.platformOS) ||
		!input.networkLikeFailure
	) {
		return false;
	}

	return (
		shouldShowTailscaleAttention(input) ||
		input.available === false ||
		input.failed === true ||
		input.ensureAttemptedBeforeFailure === true
	);
}

export function getTailscaleManualResetDecision(result: {
	attempted: boolean;
	failed?: boolean;
}) {
	if (result.failed === true) {
		return {
			kind: 'attention' as const,
			message: TAILSCALE_RESET_FAILED_MESSAGE,
		};
	}
	if (!result.attempted) {
		return {
			kind: 'attention' as const,
			message: TAILSCALE_RESET_NOT_STARTED_MESSAGE,
		};
	}
	return { kind: 'reconnect' as const };
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
