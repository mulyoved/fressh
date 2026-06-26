import { shouldShowTailscaleAttention } from './tailscale-recovery-core';

export function shouldMarkTailscaleRecoveryAttention(input: {
	platformOS: string;
	networkLikeFailure: boolean;
	recoveryAttempted: boolean;
	retrySucceeded: boolean;
	available: boolean;
	failed?: boolean;
	ensureAttemptedBeforeFailure: boolean;
}) {
	if (input.platformOS !== 'android' || !input.networkLikeFailure) {
		return false;
	}

	return (
		shouldShowTailscaleAttention(input) ||
		!input.available ||
		input.failed === true ||
		(input.ensureAttemptedBeforeFailure && input.networkLikeFailure)
	);
}
