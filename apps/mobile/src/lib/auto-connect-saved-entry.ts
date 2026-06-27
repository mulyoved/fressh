import {
	getTailscaleRecoveryAttentionMessage,
	isTailscaleRecoverySupported,
	TAILSCALE_RESTART_FAILED_MESSAGE,
	type TailscaleReadyResult,
	type TailscaleRecoverAfterFailureResult,
} from './tailscale-recovery-core';

type ConnectAndOpenShellResult =
	| {
			status: 'connected';
			sshConnection: unknown;
			shellHandle: unknown;
			connectionId: string;
			channelId: number;
	  }
	| {
			status: 'tmux_attach_failed';
			connectionId: string;
			tmuxAttachFailureReason: string | null;
			tmuxSessionName: string;
			storedConnectionId: string;
	  };

type TmuxAttachFailedResult = Extract<
	ConnectAndOpenShellResult,
	{ status: 'tmux_attach_failed' }
>;

export type SavedEntryTailscaleRecovery = {
	ensureReady: () => Promise<TailscaleReadyResult>;
	recoverAfterFailure: (
		error: unknown,
	) => Promise<TailscaleRecoverAfterFailureResult>;
};

export type AttemptSavedEntryWithTailscaleRecoveryArgs = {
	platformOS: string;
	recovery: SavedEntryTailscaleRecovery;
	connectSavedEntry: () => Promise<ConnectAndOpenShellResult>;
	markTailscaleAttention: (message: string) => void;
	clearTailscaleAttention: () => void;
	logTmuxAttachFailure: (result: TmuxAttachFailedResult) => void;
	logWarning: (message: string, error: unknown) => void;
};

function getTailscaleRecoveryFailureAttentionMessage(input: {
	platformOS: string;
	result: TailscaleRecoverAfterFailureResult;
}) {
	if (
		!isTailscaleRecoverySupported(input.platformOS) ||
		!input.result.networkLikeFailure
	) {
		return null;
	}

	return (
		getTailscaleRecoveryAttentionMessage(input.result) ??
		(input.result.attempted ? TAILSCALE_RESTART_FAILED_MESSAGE : null)
	);
}

export async function attemptSavedEntryWithTailscaleRecovery({
	platformOS,
	recovery,
	connectSavedEntry,
	markTailscaleAttention,
	clearTailscaleAttention,
	logTmuxAttachFailure,
	logWarning,
}: AttemptSavedEntryWithTailscaleRecoveryArgs) {
	const readiness = await recovery.ensureReady();
	const readinessMessage = getTailscaleRecoveryAttentionMessage(readiness);
	if (readinessMessage !== null) {
		markTailscaleAttention(readinessMessage);
		return { connected: false };
	}

	const handleConnectResult = (result: ConnectAndOpenShellResult) => {
		if (result.status === 'tmux_attach_failed') {
			logTmuxAttachFailure(result);
			return { connected: false };
		}
		clearTailscaleAttention();
		return { connected: true };
	};

	try {
		return handleConnectResult(await connectSavedEntry());
	} catch (error) {
		const recoveryResult = await recovery.recoverAfterFailure(error);
		if (!recoveryResult.networkLikeFailure) {
			throw error;
		}

		if (recoveryResult.kind !== 'recovered') {
			const attentionMessage = getTailscaleRecoveryFailureAttentionMessage({
				platformOS,
				result: recoveryResult,
			});
			if (attentionMessage !== null) {
				markTailscaleAttention(attentionMessage);
			}
			return { connected: false };
		}

		try {
			return handleConnectResult(await connectSavedEntry());
		} catch (retryError) {
			const attentionMessage = getTailscaleRecoveryFailureAttentionMessage({
				platformOS,
				result: recoveryResult,
			});
			if (attentionMessage !== null) {
				markTailscaleAttention(attentionMessage);
			}
			logWarning(
				'Auto-connect failed after Tailscale recovery retry',
				retryError,
			);
			return { connected: false };
		}
	}
}
