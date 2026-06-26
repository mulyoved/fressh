export const DEFAULT_TAILSCALE_RECOVERY_COOLDOWN_MS = 20_000;
export const DEFAULT_TAILSCALE_SETTLE_DELAY_MS = 3_000;
export const DEFAULT_TAILSCALE_RESET_DELAY_MS = 1_500;

export function isTailscaleRecoverySupported(platformOS: string) {
	return platformOS === 'android';
}

const NETWORK_ERROR_TAGS = new Set(['Russh', 'RusshKeys']);
const NON_NETWORK_ERROR_TAGS = new Set(['Auth', 'TmuxAttachFailed']);

function errorTag(error: unknown): string | null {
	if (!error || typeof error !== 'object') return null;
	const tag = (error as { tag?: unknown }).tag;
	return typeof tag === 'string' ? tag : null;
}

function structuredErrorText(error: unknown): string | null {
	const tag = errorTag(error);
	if (!tag || !NETWORK_ERROR_TAGS.has(tag)) return null;

	const inner = (error as { inner?: unknown }).inner;
	if (!Array.isArray(inner)) return null;

	const text = inner.filter((value) => typeof value === 'string').join(' ');
	return text === '' ? null : text;
}

function errorText(error: unknown): string {
	const structuredText = structuredErrorText(error);
	if (structuredText !== null) return structuredText;
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

export function isNetworkLikeSshError(error: unknown) {
	const tag = errorTag(error);
	if (tag !== null && NON_NETWORK_ERROR_TAGS.has(tag)) {
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
