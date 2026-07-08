import { type SavedEntryTailscaleRecovery } from './auto-connect-saved-entry';
import {
	type Logger,
	type OpenSavedEntryShell,
	type PreparedSavedEntryAttempt,
	type ResolvedKeySecurity,
	prepareSavedEntryAttempt,
	resolvePreparedSavedEntrySecurity,
	runPreparedSavedEntryAttempt,
} from './auto-connect-saved-entry-attempt';
import { type SavedEntryConnectionAttemptOutcome } from './connection-attempt-lifecycle';
import { type ConnectionDiagnosticEvent } from './connection-diagnostic-types';
import {
	autoConnectEvents,
	savedEntryEvents,
} from './connection-diagnostics/events';
import {
	type ConnectionRunContext,
	type ConnectionRunOperationResult,
} from './connection-run-context';
import { type AutoConnectReconnectAttemptResult } from './auto-connect-reconnect-controller';
import {
	getStoredConnectionId,
	type SavedConnectionEntry,
} from './connection-utils';
// eslint-disable-next-line import/consistent-type-specifier-style -- keep secrets-manager fully type-only so Node integration tests do not load React Native at runtime
import type { StoredConnectionDetails } from './secrets-manager';
import { isNetworkLikeSshError } from './tailscale-recovery-core';
import type {
	ActiveConnectionSnapshot,
	AutoConnectReconnectContext,
} from './auto-connect-attempt';

type ReconnectFailureStatus = Extract<
	AutoConnectReconnectAttemptResult['status'],
	'needsAttention' | 'failedNetwork' | 'failedAuth' | 'failedTmuxAttach'
>;

type ReconnectSetupFailureResult = {
	status: Extract<
		AutoConnectReconnectAttemptResult['status'],
		'cleanupFailed' | 'failedNetwork' | 'failedAuth' | 'failedTmuxAttach'
	>;
	message: string;
};

function errorTag(error: unknown): string | null {
	if (!error || typeof error !== 'object') return null;
	const tag = (error as { tag?: unknown }).tag;
	return typeof tag === 'string' ? tag : null;
}

export function classifyReconnectFailure(error: unknown): ReconnectFailureStatus {
	const tag = errorTag(error);
	if (tag === 'TmuxAttachFailed') return 'failedTmuxAttach';
	if (tag === 'Auth') return 'failedAuth';
	if (isNetworkLikeSshError(error)) return 'failedNetwork';
	return 'needsAttention';
}

function reconnectFailureMessage(
	error: unknown,
	fallbackMessage: string,
): string {
	return error instanceof Error && error.message.trim().length > 0
		? error.message
		: fallbackMessage;
}

function reconnectCleanupFailureMessage(error: unknown): string {
	const detail = reconnectFailureMessage(error, 'cleanup-failed');
	return detail === 'cleanup-failed'
		? detail
		: `cleanup-failed: ${detail}`;
}

function reconnectSetupFailureClass(
	result: ReconnectSetupFailureResult,
): string {
	return result.status;
}

function emitReconnectSetupFailed({
	traceEvent,
	reconnectContext,
	result,
	entry,
}: {
	traceEvent: (event: ConnectionDiagnosticEvent) => void;
	reconnectContext: AutoConnectReconnectContext;
	result: ReconnectSetupFailureResult;
	entry?: PreparedSavedEntryAttempt;
}) {
	traceEvent(
		autoConnectEvents.savedEntryConnectFailed({
			source: 'saved-entry',
			connection: entry?.latestEntryConnection,
			storedConnectionId:
				entry?.latestEntryConnection.savedConnectionId ??
				reconnectContext.droppedStoredConnectionId,
			trigger: 'reconnect',
			host: entry?.latestEntryConnection.host,
			port: entry?.latestEntryConnection.port,
			tmuxSessionName: entry?.normalizedDetails.tmuxSessionName,
			failureClass: reconnectSetupFailureClass(result),
			message: result.message,
		}),
	);
}

export function classifyReconnectSetupFailure(
	error: unknown,
	stage: 'saved-entry-load' | 'key-resolution',
): ReconnectSetupFailureResult {
	const failureClass = classifyReconnectFailure(error);
	if (failureClass === 'failedNetwork') {
		return {
			status: 'failedNetwork',
			message: reconnectFailureMessage(error, `${stage}-failed`),
		};
	}
	if (failureClass === 'failedTmuxAttach') {
		return {
			status: 'failedTmuxAttach',
			message: reconnectFailureMessage(error, `${stage}-failed`),
		};
	}
	if (failureClass === 'failedAuth' || stage === 'key-resolution') {
		return {
			status: 'failedAuth',
			message: reconnectFailureMessage(error, `${stage}-failed`),
		};
	}
	return {
		status: 'cleanupFailed',
		message: reconnectFailureMessage(error, `${stage}-failed`),
	};
}

export async function resolveReconnectSavedEntry({
	reconnectContext,
	connections,
	loadSavedConnectionByStoredId,
	loadLatestSavedReconnectConnection,
}: {
	reconnectContext: AutoConnectReconnectContext;
	connections: Record<string, ActiveConnectionSnapshot>;
	loadSavedConnectionByStoredId?: (
		storedConnectionId: string,
	) => Promise<SavedConnectionEntry | null>;
	loadLatestSavedReconnectConnection: () => Promise<SavedConnectionEntry | null>;
}): Promise<SavedConnectionEntry | null> {
	const droppedConnection =
		reconnectContext.droppedConnectionId !== undefined
			? connections[reconnectContext.droppedConnectionId] ?? null
			: null;
	const storedConnectionId =
		reconnectContext.droppedStoredConnectionId ??
		(droppedConnection
			? getStoredConnectionId(droppedConnection.connectionDetails)
			: null);
	if (storedConnectionId && loadSavedConnectionByStoredId) {
		const entry = await loadSavedConnectionByStoredId(storedConnectionId);
		if (entry) return entry;
	}
	return await loadLatestSavedReconnectConnection();
}

export function mapReconnectSavedEntryAttemptOutcome({
	result,
	prepared,
	latestEntryId,
	traceEvent,
	markTailscaleAttention,
	clearTailscaleAttention,
	logger,
}: {
	result: SavedEntryConnectionAttemptOutcome;
	prepared: PreparedSavedEntryAttempt;
	latestEntryId: string;
	traceEvent: (event: ConnectionDiagnosticEvent) => void;
	markTailscaleAttention: (message: string) => void;
	clearTailscaleAttention: () => void;
	logger: Logger;
}): AutoConnectReconnectAttemptResult {
	switch (result.status) {
		case 'connected':
			traceEvent(
				autoConnectEvents.savedEntryConnectConnected({
					source: 'saved-entry',
					connection: {
						...prepared.latestEntryConnection,
						connectionId: result.connectionId,
					},
					connectionId: result.connectionId,
					channelId: result.channelId,
					trigger: 'reconnect',
					storedConnectionId: latestEntryId,
					tmuxSessionName: prepared.normalizedDetails.tmuxSessionName,
				}),
			);
			clearTailscaleAttention();
			return { status: 'connected' };
		case 'tmuxAttachFailed':
			traceEvent(
				autoConnectEvents.savedEntryConnectTmuxAttachFailed({
					source: 'saved-entry',
					connection: {
						...prepared.latestEntryConnection,
						connectionId: result.connectionId,
						tmuxSessionName: result.tmuxSessionName,
					},
					connectionId: result.connectionId,
					tmuxAttachFailureReason: result.tmuxAttachFailureReason,
					tmuxSessionName: result.tmuxSessionName,
					storedConnectionId: result.storedConnectionId,
					trigger: 'reconnect',
					failureClass: 'failedTmuxAttach',
				}),
			);
			traceEvent(
				autoConnectEvents.savedEntryConnectFailed({
					source: 'saved-entry',
					connection: prepared.latestEntryConnection,
					connectionId: result.connectionId,
					storedConnectionId: result.storedConnectionId,
					trigger: 'reconnect',
					tmuxSessionName: result.tmuxSessionName,
					failureClass: 'failedTmuxAttach',
				}),
			);
			return { status: 'failedTmuxAttach' };
		case 'blocked':
			if (result.attentionMessage !== null) {
				markTailscaleAttention(result.attentionMessage);
			}
			traceEvent(
				autoConnectEvents.savedEntryConnectFailed({
					source: 'saved-entry',
					connection: prepared.latestEntryConnection,
					trigger: 'reconnect',
					tmuxSessionName: prepared.normalizedDetails.tmuxSessionName,
					failureClass: 'needsAttention',
				}),
			);
			return {
				status: 'needsAttention',
				message: result.attentionMessage ?? 'tailscale-attention-required',
			};
		case 'failed': {
			if (result.attentionMessage !== null) {
				markTailscaleAttention(result.attentionMessage);
			}
			if (result.recoverable) {
				logger.warn(
					'Auto-connect failed after Tailscale recovery retry',
					result.error,
				);
			}
			const failureClass = classifyReconnectFailure(result.error);
			traceEvent(
				autoConnectEvents.savedEntryConnectFailed({
					source: 'saved-entry',
					connection: prepared.latestEntryConnection,
					trigger: 'reconnect',
					tmuxSessionName: prepared.normalizedDetails.tmuxSessionName,
					failureClass,
				}),
			);
			return {
				status: failureClass,
				message:
					result.attentionMessage ??
					(result.error instanceof Error ? result.error.message : undefined),
			};
		}
		case 'aborted':
		case 'timedOut':
			return { status: 'retry' };
		case 'cleanupFailed': {
			logger.warn('Auto-connect cleanup failed', result.error);
			traceEvent(
				autoConnectEvents.savedEntryConnectFailed({
					source: 'saved-entry',
					connection: prepared.latestEntryConnection,
					connectionId: result.priorOutcome.connectionId,
					storedConnectionId: latestEntryId,
					trigger: 'reconnect',
					tmuxSessionName: prepared.normalizedDetails.tmuxSessionName,
					failureClass: 'cleanupFailed',
					message: reconnectCleanupFailureMessage(result.error),
				}),
			);
			return { status: 'cleanupFailed' };
		}
	}
}

async function runSavedEntryReconnectAttempt({
	platformOS,
	runContext,
	recovery,
	traceEvent,
	latestEntry,
	reconnectContext,
	resolveKeySecurity,
	openSavedEntryShell,
	navigateToShell,
	markTailscaleAttention,
	clearTailscaleAttention,
	logger,
}: {
	platformOS: string;
	runContext: ConnectionRunContext;
	recovery: SavedEntryTailscaleRecovery;
	traceEvent: (event: ConnectionDiagnosticEvent) => void;
	latestEntry: SavedConnectionEntry;
	reconnectContext: AutoConnectReconnectContext;
	resolveKeySecurity: (
		details: StoredConnectionDetails,
	) => Promise<ResolvedKeySecurity | null>;
	openSavedEntryShell: OpenSavedEntryShell;
	navigateToShell: (connectionId: string, channelId: number) => void;
	markTailscaleAttention: (message: string) => void;
	clearTailscaleAttention: () => void;
	logger: Logger;
}): Promise<AutoConnectReconnectAttemptResult | boolean> {
	const prepared = prepareSavedEntryAttempt({
		latestEntry,
		traceEvent,
	});
	if (!prepared) {
		return {
			status: 'failedTmuxAttach',
			message: 'invalid-tmux-settings',
		};
	}

	let resolvedSecurityResult: ConnectionRunOperationResult<
		ResolvedKeySecurity | null
	>;
	try {
		resolvedSecurityResult = await resolvePreparedSavedEntrySecurity({
			runContext,
			prepared,
			resolveKeySecurity,
			traceEvent,
		});
	} catch (error) {
		if (
			runContext.classifyError(error) === 'aborted' ||
			runContext.signal.aborted
		) {
			return { status: 'retry' };
		}
		logger.warn('Reconnect key resolution failed', error);
		const result = classifyReconnectSetupFailure(error, 'key-resolution');
		emitReconnectSetupFailed({
			traceEvent,
			reconnectContext,
			result,
			entry: prepared,
		});
		return result;
	}
	if (resolvedSecurityResult.status === 'aborted') {
		return { status: 'retry' };
	}
	const resolvedSecurity = resolvedSecurityResult.value;
	if (runContext.signal.aborted) return { status: 'retry' };
	if (!resolvedSecurity) {
		return { status: 'failedAuth', message: 'key-missing' };
	}

	const result = await runPreparedSavedEntryAttempt({
		platformOS,
		runContext,
		recovery,
		traceEvent,
		prepared,
		resolvedSecurity,
		openSavedEntryShell,
		navigateToShell,
		logger,
		isAborted: () => runContext.signal.aborted,
		traceConnectStart: (phase, currentPrepared) => {
			const isRetry = phase === 'retry';
			traceEvent(
				isRetry
					? autoConnectEvents.savedEntryRetryStarted({
							source: 'saved-entry',
							connection: currentPrepared.latestEntryConnection,
							trigger: 'reconnect',
							tmuxSessionName: currentPrepared.normalizedDetails.tmuxSessionName,
						})
					: autoConnectEvents.savedEntryConnectStarted({
							source: 'saved-entry',
							trigger: 'reconnect',
							connection: currentPrepared.latestEntryConnection,
							tmuxSessionName: currentPrepared.normalizedDetails.tmuxSessionName,
						}),
			);
		},
		traceConnectThrow: (phase, currentPrepared, error) => {
			const isRetry = phase === 'retry';
			traceEvent(
				isRetry
					? autoConnectEvents.savedEntryRetryThrew({
							source: 'saved-entry',
							connection: currentPrepared.latestEntryConnection,
							error,
							trigger: 'reconnect',
							tmuxSessionName: currentPrepared.normalizedDetails.tmuxSessionName,
							failureClass: classifyReconnectFailure(error),
						})
					: autoConnectEvents.savedEntryConnectThrew({
							source: 'saved-entry',
							connection: currentPrepared.latestEntryConnection,
							error,
							trigger: 'reconnect',
							tmuxSessionName: currentPrepared.normalizedDetails.tmuxSessionName,
							failureClass: classifyReconnectFailure(error),
						}),
			);
		},
	});
	if (runContext.signal.aborted) return { status: 'retry' };

	return mapReconnectSavedEntryAttemptOutcome({
		result,
		prepared,
		latestEntryId: latestEntry.id,
		traceEvent,
		markTailscaleAttention,
		clearTailscaleAttention,
		logger,
	});
}

export async function attemptReconnectThroughSavedEntry({
	platformOS,
	runContext,
	reconnectContext,
	connections,
	loadSavedConnectionByStoredId,
	loadLatestSavedReconnectConnection,
	recovery,
	traceEvent,
	resolveKeySecurity,
	openSavedEntryShell,
	navigateToShell,
	markTailscaleAttention,
	clearTailscaleAttention,
	logger,
}: {
	platformOS: string;
	runContext: ConnectionRunContext;
	reconnectContext: AutoConnectReconnectContext;
	connections: Record<string, ActiveConnectionSnapshot>;
	loadSavedConnectionByStoredId?: (
		storedConnectionId: string,
	) => Promise<SavedConnectionEntry | null>;
	loadLatestSavedReconnectConnection: () => Promise<SavedConnectionEntry | null>;
	recovery: SavedEntryTailscaleRecovery;
	traceEvent: (event: ConnectionDiagnosticEvent) => void;
	resolveKeySecurity: (
		details: StoredConnectionDetails,
	) => Promise<ResolvedKeySecurity | null>;
	openSavedEntryShell: OpenSavedEntryShell;
	navigateToShell: (connectionId: string, channelId: number) => void;
	markTailscaleAttention: (message: string) => void;
	clearTailscaleAttention: () => void;
	logger: Logger;
}): Promise<AutoConnectReconnectAttemptResult | boolean> {
	let reconnectEntryResult: ConnectionRunOperationResult<
		SavedConnectionEntry | null
	>;
	try {
		reconnectEntryResult = await runContext.runOperation(
			'operation',
			async () =>
				await resolveReconnectSavedEntry({
					reconnectContext,
					connections,
					loadSavedConnectionByStoredId,
					loadLatestSavedReconnectConnection,
				}),
		);
	} catch (error) {
		if (
			runContext.classifyError(error) === 'aborted' ||
			runContext.signal.aborted
		) {
			return { status: 'retry' };
		}
		logger.warn('Reconnect saved-entry lookup failed', error);
		const result = classifyReconnectSetupFailure(error, 'saved-entry-load');
		emitReconnectSetupFailed({
			traceEvent,
			reconnectContext,
			result,
		});
		return result;
	}
	if (reconnectEntryResult.status === 'aborted') return { status: 'retry' };
	const reconnectEntry = reconnectEntryResult.value;
	if (!reconnectEntry) {
		traceEvent(
			savedEntryEvents.missing({
				source: 'saved-entry',
			}),
		);
		return { status: 'retry' };
	}
	return await runSavedEntryReconnectAttempt({
		platformOS,
		runContext,
		recovery,
		traceEvent,
		latestEntry: reconnectEntry,
		reconnectContext,
		resolveKeySecurity,
		openSavedEntryShell,
		navigateToShell,
		markTailscaleAttention,
		clearTailscaleAttention,
		logger,
	});
}
