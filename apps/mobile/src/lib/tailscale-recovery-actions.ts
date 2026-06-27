import {
	getTailscaleManualResetAttentionMessage,
	TAILSCALE_RESET_FAILED_MESSAGE,
	type TailscaleManualResetResult,
} from './tailscale-recovery-core';

const TAILSCALE_RETRY_ACTION_REASON = 'tailscale-retry-action';
const TAILSCALE_RESET_ACTION_REASON = 'tailscale-reset-action';
const TAILSCALE_RESET_RECOVERING_MESSAGE = 'Resetting Tailscale...';
const TAILSCALE_RESET_IDLE_TIMEOUT_MESSAGE =
	'Fressh is still reconnecting. Try resetting Tailscale again.';
const TAILSCALE_RESET_RECONNECT_NOT_STARTED_MESSAGE =
	'Tailscale reset finished. Retry Fressh to reconnect.';

type TailscaleRecoveryActionsDeps = {
	recovery: {
		openApp: () => Promise<unknown>;
		reset: () => Promise<TailscaleManualResetResult>;
	};
	waitForAutoConnectIdle: () => Promise<boolean>;
	reconnect: {
		stop: (reason: string) => void;
		replace: (reason: string) => boolean;
	};
	attention: {
		clear: () => void;
		mark: (message: string) => void;
		recovering: (message: string) => void;
	};
	logger: {
		warn: (message: string, error: unknown) => void;
	};
};

export type TailscaleRecoveryActions = {
	open: () => Promise<void>;
	retry: () => void;
	reset: () => Promise<void>;
	isResetInFlight: () => boolean;
};

export function createTailscaleRecoveryActions({
	recovery,
	waitForAutoConnectIdle,
	reconnect,
	attention,
	logger,
}: TailscaleRecoveryActionsDeps): TailscaleRecoveryActions {
	let resetInFlight = false;

	const retry = () => {
		const started = reconnect.replace(TAILSCALE_RETRY_ACTION_REASON);
		if (started) {
			attention.clear();
		}
	};

	const open = async () => {
		try {
			await recovery.openApp();
		} catch (error: unknown) {
			logger.warn('Manual Tailscale open failed', error);
		}
	};

	const reset = async () => {
		if (resetInFlight) return;
		resetInFlight = true;
		reconnect.stop(TAILSCALE_RESET_ACTION_REASON);
		attention.recovering(TAILSCALE_RESET_RECOVERING_MESSAGE);

		try {
			const idle = await waitForAutoConnectIdle();
			if (!idle) {
				attention.mark(TAILSCALE_RESET_IDLE_TIMEOUT_MESSAGE);
				return;
			}

			const result = await recovery.reset();
			const attentionMessage = getTailscaleManualResetAttentionMessage(result);
			if (attentionMessage !== null) {
				attention.mark(attentionMessage);
				return;
			}
			if (result.kind !== 'reset') {
				return;
			}

			resetInFlight = false;
			const started = reconnect.replace(TAILSCALE_RESET_ACTION_REASON);
			if (started) {
				attention.clear();
				return;
			}
			attention.mark(TAILSCALE_RESET_RECONNECT_NOT_STARTED_MESSAGE);
		} catch (error: unknown) {
			logger.warn('Manual Tailscale reset failed', error);
			attention.mark(TAILSCALE_RESET_FAILED_MESSAGE);
		} finally {
			resetInFlight = false;
		}
	};

	return {
		open,
		retry,
		reset,
		isResetInFlight: () => resetInFlight,
	};
}
