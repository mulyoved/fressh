import {
	isTailscaleRecoverySupported,
	shouldShowTailscaleAttention,
} from './tailscale-recovery-core';

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
