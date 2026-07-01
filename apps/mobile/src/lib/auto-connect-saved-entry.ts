import {
	getTailscaleRecoveryAttentionMessage,
	isNetworkLikeSshError,
	isTailscaleRecoverySupported,
	TAILSCALE_RESTART_FAILED_MESSAGE,
	type TailscaleReadyResult,
	type TailscaleRecoverAfterFailureResult,
} from './tailscale-recovery-core';

export type SavedEntryConnectResult =
	| {
			status: 'connected';
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

export type TmuxAttachFailedResult = Extract<
	SavedEntryConnectResult,
	{ status: 'tmux_attach_failed' }
>;

export type SavedEntryConnectAttemptPhase = 'initial' | 'retry';

export type SavedEntryTailscaleRecovery = {
	ensureReady: () => Promise<TailscaleReadyResult>;
	recoverAfterFailure: (
		error: unknown,
	) => Promise<TailscaleRecoverAfterFailureResult>;
};

export type SavedEntryRecoveryOutcome =
	| {
			status: 'blocked';
			readiness: TailscaleReadyResult;
			attentionMessage: string | null;
	  }
	| {
			status: 'connected';
			result: Extract<SavedEntryConnectResult, { status: 'connected' }>;
	  }
	| { status: 'tmuxAttachFailed'; result: TmuxAttachFailedResult }
	| {
			status: 'recoveryNotAttempted';
			error: unknown;
			recoveryResult: TailscaleRecoverAfterFailureResult;
			attentionMessage: string | null;
	  }
	| {
			status: 'retryFailed';
			error: unknown;
			recoveryResult: TailscaleRecoverAfterFailureResult;
			attentionMessage: string | null;
	  }
	| { status: 'threw'; error: unknown };

export type AttemptSavedEntryWithTailscaleRecoveryArgs = {
	platformOS: string;
	recovery: SavedEntryTailscaleRecovery;
	connectSavedEntry: (
		phase: SavedEntryConnectAttemptPhase,
	) => Promise<SavedEntryConnectResult>;
	shouldRecoverAfterFailure?: (error: unknown) => boolean;
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
		(input.result.attempted || input.result.kind === 'preflightReady'
			? TAILSCALE_RESTART_FAILED_MESSAGE
			: null)
	);
}

function shouldRetryAfterTailscaleRecovery(
	result: TailscaleRecoverAfterFailureResult,
) {
	return result.kind === 'recovered' || result.kind === 'preflightReady';
}

function shouldBlockBeforeSshProbe(readiness: TailscaleReadyResult) {
	return readiness.kind !== 'cooldown' && readiness.kind !== 'notStarted';
}

export async function attemptSavedEntryWithTailscaleRecovery({
	platformOS,
	recovery,
	connectSavedEntry,
	shouldRecoverAfterFailure = () => true,
}: AttemptSavedEntryWithTailscaleRecoveryArgs): Promise<SavedEntryRecoveryOutcome> {
	const handleConnectResult = (
		result: SavedEntryConnectResult,
	): SavedEntryRecoveryOutcome => {
		if (result.status === 'tmux_attach_failed') {
			return { status: 'tmuxAttachFailed', result };
		}

		return { status: 'connected', result };
	};

	const readiness = await recovery.ensureReady();
	const readinessMessage = getTailscaleRecoveryAttentionMessage(readiness);
	if (readinessMessage !== null && shouldBlockBeforeSshProbe(readiness)) {
		return {
			status: 'blocked',
			readiness,
			attentionMessage: readinessMessage,
		};
	}

	try {
		return handleConnectResult(await connectSavedEntry('initial'));
	} catch (error) {
		if (!shouldRecoverAfterFailure(error)) {
			return { status: 'threw', error };
		}
		const recoveryResult = await recovery.recoverAfterFailure(error);
		if (!recoveryResult.networkLikeFailure) {
			return {
				status: 'recoveryNotAttempted',
				error,
				recoveryResult,
				attentionMessage: null,
			};
		}

		if (!shouldRetryAfterTailscaleRecovery(recoveryResult)) {
			const attentionMessage = getTailscaleRecoveryFailureAttentionMessage({
				platformOS,
				result: recoveryResult,
			});
			return {
				status: 'recoveryNotAttempted',
				error,
				recoveryResult,
				attentionMessage,
			};
		}

		try {
			return handleConnectResult(await connectSavedEntry('retry'));
		} catch (retryError) {
			if (!shouldRecoverAfterFailure(retryError)) {
				return { status: 'threw', error: retryError };
			}
			if (!isNetworkLikeSshError(retryError)) {
				return { status: 'threw', error: retryError };
			}

			const attentionMessage = getTailscaleRecoveryFailureAttentionMessage({
				platformOS,
				result: recoveryResult,
			});
			return {
				status: 'retryFailed',
				error: retryError,
				recoveryResult,
				attentionMessage,
			};
		}
	}
}
