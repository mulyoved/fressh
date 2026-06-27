import {
	getTailscaleRecoveryAttentionMessage,
	isTailscaleRecoverySupported,
	TAILSCALE_RESTART_FAILED_MESSAGE,
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
