export const DEFAULT_TAILSCALE_RECOVERY_COOLDOWN_MS = 20_000;
export const DEFAULT_TAILSCALE_SETTLE_DELAY_MS = 3_000;
export const DEFAULT_TAILSCALE_RESET_DELAY_MS = 1_500;

export function isTailscaleRecoverySupported(platformOS: string) {
	return platformOS === 'android';
}

function errorText(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

export function isNetworkLikeSshError(error: unknown) {
	if (
		error &&
		typeof error === 'object' &&
		(error as { tag?: unknown }).tag === 'TmuxAttachFailed'
	) {
		return false;
	}

	const text = errorText(error).toLowerCase();
	if (
		text.includes('permission denied') ||
		text.includes('authentication failed') ||
		text.includes('host key') ||
		text.includes('key missing')
	) {
		return false;
	}

	return [
		'network is unreachable',
		'no route to host',
		'connection timed out',
		'operation timed out',
		'unable to resolve host',
		'connection reset',
		'broken pipe',
		'software caused connection abort',
	].some((needle) => text.includes(needle));
}

export function createTailscaleRecoveryCooldown(opts?: {
	cooldownMs?: number;
}) {
	const cooldownMs = opts?.cooldownMs ?? DEFAULT_TAILSCALE_RECOVERY_COOLDOWN_MS;
	let lastAttemptAtMs: number | null = null;

	return {
		canAttempt(nowMs: number) {
			return lastAttemptAtMs === null || nowMs - lastAttemptAtMs >= cooldownMs;
		},
		recordAttempt(nowMs: number) {
			lastAttemptAtMs = nowMs;
		},
		reset() {
			lastAttemptAtMs = null;
		},
	};
}

export function shouldShowTailscaleAttention(input: {
	platformOS: string;
	networkLikeFailure: boolean;
	recoveryAttempted: boolean;
	retrySucceeded: boolean;
}) {
	return (
		isTailscaleRecoverySupported(input.platformOS) &&
		input.networkLikeFailure &&
		input.recoveryAttempted &&
		!input.retrySucceeded
	);
}
