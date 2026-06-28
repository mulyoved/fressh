import {
	serializeConnectionDiagnosticError,
	type ConnectionDiagnosticEventInput,
} from './connection-diagnostics';
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

type TmuxAttachFailedResult = Extract<
	SavedEntryConnectResult,
	{ status: 'tmux_attach_failed' }
>;

export type SavedEntryTailscaleRecovery = {
	ensureReady: () => Promise<TailscaleReadyResult>;
	recoverAfterFailure: (
		error: unknown,
	) => Promise<TailscaleRecoverAfterFailureResult>;
};

type SavedEntryTrace = {
	event: (event: ConnectionDiagnosticEventInput) => void;
};

export type AttemptSavedEntryWithTailscaleRecoveryArgs = {
	platformOS: string;
	recovery: SavedEntryTailscaleRecovery;
	connectSavedEntry: () => Promise<SavedEntryConnectResult>;
	markTailscaleAttention: (message: string) => void;
	clearTailscaleAttention: () => void;
	logTmuxAttachFailure: (result: TmuxAttachFailedResult) => void;
	logWarning: (message: string, error: unknown) => void;
	shouldRecoverAfterFailure?: (error: unknown) => boolean;
	trace?: SavedEntryTrace;
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

function snapshotTailscaleReadyResult(readiness: TailscaleReadyResult) {
	return { ...readiness };
}

function snapshotTailscaleRecoverAfterFailureResult(
	recoveryResult: TailscaleRecoverAfterFailureResult,
) {
	return { ...recoveryResult };
}

function snapshotConnectResult(result: SavedEntryConnectResult) {
	if (result.status === 'tmux_attach_failed') {
		return {
			status: result.status,
			connectionId: result.connectionId,
			tmuxAttachFailureReason: result.tmuxAttachFailureReason,
			tmuxSessionName: result.tmuxSessionName,
			storedConnectionId: result.storedConnectionId,
		};
	}

	return {
		status: result.status,
		connectionId: result.connectionId,
		channelId: result.channelId,
	};
}

function emitTrace(
	trace: SavedEntryTrace | undefined,
	logWarning: (message: string, error: unknown) => void,
	event: ConnectionDiagnosticEventInput,
) {
	try {
		trace?.event(event);
	} catch (error) {
		logWarning('Saved-entry trace event failed', error);
	}
}

function traceRecoveryResult(
	trace: SavedEntryTrace | undefined,
	logWarning: (message: string, error: unknown) => void,
	recoveryResult: TailscaleRecoverAfterFailureResult,
) {
	emitTrace(trace, logWarning, {
		type: 'tailscale.recovery.result',
		source: 'tailscale-recovery',
		details: {
			recoveryResult:
				snapshotTailscaleRecoverAfterFailureResult(recoveryResult),
		},
	});
}

export async function attemptSavedEntryWithTailscaleRecovery({
	platformOS,
	recovery,
	connectSavedEntry,
	markTailscaleAttention,
	clearTailscaleAttention,
	logTmuxAttachFailure,
	logWarning,
	shouldRecoverAfterFailure = () => true,
	trace,
}: AttemptSavedEntryWithTailscaleRecoveryArgs) {
	const traceEvent = (event: ConnectionDiagnosticEventInput) => {
		emitTrace(trace, logWarning, event);
	};

	const readiness = await recovery.ensureReady();
	traceEvent({
		type: 'tailscale.ensure-ready.result',
		source: 'tailscale-recovery',
		details: {
			platformOS,
			readiness: snapshotTailscaleReadyResult(readiness),
		},
	});
	const readinessMessage = getTailscaleRecoveryAttentionMessage(readiness);
	if (readinessMessage !== null && shouldBlockBeforeSshProbe(readiness)) {
		markTailscaleAttention(readinessMessage);
		return { connected: false };
	}

	const handleConnectResult = (result: SavedEntryConnectResult) => {
		traceEvent({
			type:
				result.status === 'tmux_attach_failed'
					? 'auto-connect.saved-entry.connect.tmux-attach-failed'
					: 'auto-connect.saved-entry.connect.connected',
			source: 'saved-entry',
			connection:
				result.status === 'tmux_attach_failed'
					? {
							connectionId: result.connectionId,
							tmuxSessionName: result.tmuxSessionName,
						}
					: { connectionId: result.connectionId },
			details: snapshotConnectResult(result),
		});
		if (result.status === 'tmux_attach_failed') {
			logTmuxAttachFailure(result);
			return { connected: false };
		}
		clearTailscaleAttention();
		return { connected: true };
	};

	try {
		traceEvent({
			type: 'auto-connect.saved-entry.connect.started',
			source: 'saved-entry',
		});
		return handleConnectResult(await connectSavedEntry());
	} catch (error) {
		traceEvent({
			type: 'auto-connect.saved-entry.connect.threw',
			source: 'saved-entry',
			error: serializeConnectionDiagnosticError(error),
		});
		if (!shouldRecoverAfterFailure(error)) {
			throw error;
		}
		const recoveryResult = await recovery.recoverAfterFailure(error);
		traceRecoveryResult(trace, logWarning, recoveryResult);
		if (!recoveryResult.networkLikeFailure) {
			throw error;
		}

		if (!shouldRetryAfterTailscaleRecovery(recoveryResult)) {
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
			traceEvent({
				type: 'auto-connect.saved-entry.retry.started',
				source: 'saved-entry',
			});
			return handleConnectResult(await connectSavedEntry());
		} catch (retryError) {
			traceEvent({
				type: 'auto-connect.saved-entry.retry.threw',
				source: 'saved-entry',
				error: serializeConnectionDiagnosticError(retryError),
			});
			if (!shouldRecoverAfterFailure(retryError)) {
				throw retryError;
			}
			if (!isNetworkLikeSshError(retryError)) {
				throw retryError;
			}

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
