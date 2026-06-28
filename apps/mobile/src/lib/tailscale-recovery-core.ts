export const DEFAULT_TAILSCALE_RECOVERY_COOLDOWN_MS = 20_000;
export const DEFAULT_TAILSCALE_SETTLE_DELAY_MS = 3_000;
export const DEFAULT_TAILSCALE_RESET_DELAY_MS = 1_500;
export const TAILSCALE_UNAVAILABLE_MESSAGE =
	'Tailscale is required for this SSH connection. Open Tailscale, then retry Fressh.';
export const TAILSCALE_REACHABILITY_MESSAGE =
	'Fressh could not reach the SSH host through Tailscale.';
export const TAILSCALE_RESTART_FAILED_MESSAGE =
	'Fressh could not reach the SSH host after restarting Tailscale.';
export const TAILSCALE_RESET_FAILED_MESSAGE =
	'Tailscale reset failed. Open Tailscale, then retry Fressh.';
export const TAILSCALE_RESET_NOT_STARTED_MESSAGE =
	'Tailscale reset did not start. Open Tailscale, then retry Fressh.';

export type TailscaleReadyResult =
	| { kind: 'unsupported'; attempted: false; available: false }
	| { kind: 'unavailable'; attempted: false; available: false }
	| { kind: 'ready'; attempted: true; available: true }
	| { kind: 'cooldown'; attempted: false; available: true }
	| { kind: 'notStarted'; attempted: false; available: true }
	| { kind: 'failed'; attempted: boolean; available: true };

export type TailscaleRecoverAfterFailureResult =
	| {
			kind: 'nonNetworkFailure';
			attempted: false;
			networkLikeFailure: false;
			available: boolean;
	  }
	| {
			kind: 'unsupported';
			attempted: false;
			networkLikeFailure: true;
			available: false;
	  }
	| {
			kind: 'unavailable';
			attempted: false;
			networkLikeFailure: true;
			available: false;
	  }
	| {
			kind: 'cooldown';
			attempted: false;
			networkLikeFailure: true;
			available: true;
	  }
	| {
			kind: 'notStarted';
			attempted: false;
			networkLikeFailure: true;
			available: true;
	  }
	| {
			kind: 'preflightReady';
			attempted: false;
			networkLikeFailure: true;
			available: true;
	  }
	| {
			kind: 'recovered';
			attempted: true;
			networkLikeFailure: true;
			available: true;
	  }
	| {
			kind: 'failed';
			attempted: boolean;
			networkLikeFailure: true;
			available: true;
	  };

export type TailscaleManualResetResult =
	| { kind: 'unsupported'; attempted: false }
	| { kind: 'notStarted'; attempted: false }
	| { kind: 'reset'; attempted: true }
	| { kind: 'failed'; attempted: boolean };

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
		return JSON.stringify(error) ?? String(error);
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
		'failed to lookup address information',
		'no address associated with hostname',
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
			return (
				lastAttemptAtMs === null ||
				nowMs < lastAttemptAtMs ||
				nowMs - lastAttemptAtMs >= cooldownMs
			);
		},
		recordAttempt(nowMs: number) {
			lastAttemptAtMs = nowMs;
		},
		reset() {
			lastAttemptAtMs = null;
		},
	};
}

export function getTailscaleRecoveryAttentionMessage(
	result: TailscaleReadyResult | TailscaleRecoverAfterFailureResult,
) {
	switch (result.kind) {
		case 'unavailable':
			return TAILSCALE_UNAVAILABLE_MESSAGE;
		case 'cooldown':
		case 'notStarted':
			return TAILSCALE_REACHABILITY_MESSAGE;
		case 'failed':
			return TAILSCALE_RESTART_FAILED_MESSAGE;
		case 'unsupported':
		case 'ready':
		case 'preflightReady':
		case 'recovered':
		case 'nonNetworkFailure':
			return null;
	}
}

export function getTailscaleManualResetAttentionMessage(
	result: TailscaleManualResetResult,
) {
	switch (result.kind) {
		case 'failed':
			return TAILSCALE_RESET_FAILED_MESSAGE;
		case 'notStarted':
			return TAILSCALE_RESET_NOT_STARTED_MESSAGE;
		case 'unsupported':
		case 'reset':
			return null;
	}
}
