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
	return (
		shouldShowTailscaleAttention(input) ||
		!input.available ||
		input.failed === true ||
		(input.ensureAttemptedBeforeFailure && input.networkLikeFailure)
	);
}
