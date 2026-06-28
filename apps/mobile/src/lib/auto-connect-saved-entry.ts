import { type ConnectAndOpenShellResult } from './connect-and-open-shell';
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

type SavedEntryTrace = {
	event: (event: ConnectionDiagnosticEventInput) => void;
};

export type AttemptSavedEntryWithTailscaleRecoveryArgs = {
	platformOS: string;
	recovery: SavedEntryTailscaleRecovery;
	connectSavedEntry: () => Promise<ConnectAndOpenShellResult>;
	markTailscaleAttention: (message: string) => void;
	clearTailscaleAttention: () => void;
	logTmuxAttachFailure: (result: TmuxAttachFailedResult) => void;
	logWarning: (message: string, error: unknown) => void;
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

function snapshotConnectResult(result: ConnectAndOpenShellResult) {
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

export async function attemptSavedEntryWithTailscaleRecovery({
	platformOS,
	recovery,
	connectSavedEntry,
	markTailscaleAttention,
	clearTailscaleAttention,
	logTmuxAttachFailure,
	logWarning,
	trace,
}: AttemptSavedEntryWithTailscaleRecoveryArgs) {
	const traceEvent = (event: ConnectionDiagnosticEventInput) => {
		try {
			trace?.event(event);
		} catch (error) {
			logWarning('Saved-entry trace event failed', error);
		}
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

	const handleConnectResult = (result: ConnectAndOpenShellResult) => {
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
		const recoveryResult = await recovery.recoverAfterFailure(error);
		traceEvent({
			type: 'tailscale.recovery.result',
			source: 'tailscale-recovery',
			details: {
				recoveryResult:
					snapshotTailscaleRecoverAfterFailureResult(recoveryResult),
			},
		});
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
