import { diagnosticEvents } from './connection-diagnostic-events';
import { type ConnectionDiagnosticEvent } from './connection-diagnostic-types';
import { serializeConnectionDiagnosticError } from './connection-diagnostics/events';
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

export type SavedEntryTailscaleRecovery = {
	ensureReady: () => Promise<TailscaleReadyResult>;
	recoverAfterFailure: (
		error: unknown,
	) => Promise<TailscaleRecoverAfterFailureResult>;
};

type SavedEntryTrace = {
	event: (event: ConnectionDiagnosticEvent) => void;
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
	connectSavedEntry: () => Promise<SavedEntryConnectResult>;
	shouldRecoverAfterFailure?: (error: unknown) => boolean;
	onEvent?: (event: ConnectionDiagnosticEvent) => void;
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

function emitTrace(
	trace: SavedEntryTrace | undefined,
	event: ConnectionDiagnosticEvent,
) {
	try {
		trace?.event(event);
	} catch {
		// Diagnostic sinks must not affect the recovery policy outcome.
	}
}

export async function attemptSavedEntryWithTailscaleRecovery({
	platformOS,
	recovery,
	connectSavedEntry,
	shouldRecoverAfterFailure = () => true,
	onEvent,
}: AttemptSavedEntryWithTailscaleRecoveryArgs): Promise<SavedEntryRecoveryOutcome> {
	const trace: SavedEntryTrace | undefined = onEvent
		? { event: onEvent }
		: undefined;
	const traceEvent = (event: ConnectionDiagnosticEvent) => {
		emitTrace(trace, event);
	};
	const handleConnectResult = (
		result: SavedEntryConnectResult,
	): SavedEntryRecoveryOutcome => {
		if (result.status === 'tmux_attach_failed') {
			traceEvent(
				diagnosticEvents.autoConnectSavedEntryConnectTmuxAttachFailed({
					source: 'saved-entry',
					connection: {
						connectionId: result.connectionId,
						tmuxSessionName: result.tmuxSessionName,
					},
					connectionId: result.connectionId,
					tmuxAttachFailureReason: result.tmuxAttachFailureReason,
					tmuxSessionName: result.tmuxSessionName,
					storedConnectionId: result.storedConnectionId,
				}),
			);
			return { status: 'tmuxAttachFailed', result };
		}

		traceEvent(
			diagnosticEvents.autoConnectSavedEntryConnectConnected({
				source: 'saved-entry',
				connection: { connectionId: result.connectionId },
				connectionId: result.connectionId,
				channelId: result.channelId,
			}),
		);
		return { status: 'connected', result };
	};

	const readiness = await recovery.ensureReady();
	traceEvent(
		diagnosticEvents.tailscaleEnsureReadyResult({
			source: 'tailscale-recovery',
			platformOS,
			readiness,
		}),
	);
	const readinessMessage = getTailscaleRecoveryAttentionMessage(readiness);
	if (readinessMessage !== null && shouldBlockBeforeSshProbe(readiness)) {
		return {
			status: 'blocked',
			readiness,
			attentionMessage: readinessMessage,
		};
	}

	try {
		traceEvent(
			diagnosticEvents.autoConnectSavedEntryConnectStarted({
				source: 'saved-entry',
			}),
		);
		return handleConnectResult(await connectSavedEntry());
	} catch (error) {
		traceEvent(
			diagnosticEvents.autoConnectSavedEntryConnectThrew({
				source: 'saved-entry',
				error: serializeConnectionDiagnosticError(error),
			}),
		);
		if (!shouldRecoverAfterFailure(error)) {
			return { status: 'threw', error };
		}
		const recoveryResult = await recovery.recoverAfterFailure(error);
		traceEvent(
			diagnosticEvents.tailscaleRecoveryResult({
				source: 'tailscale-recovery',
				recoveryResult,
			}),
		);
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
			traceEvent(
				diagnosticEvents.autoConnectSavedEntryRetryStarted({
					source: 'saved-entry',
				}),
			);
			return handleConnectResult(await connectSavedEntry());
		} catch (retryError) {
			traceEvent(
				diagnosticEvents.autoConnectSavedEntryRetryThrew({
					source: 'saved-entry',
					error: serializeConnectionDiagnosticError(retryError),
				}),
			);
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
