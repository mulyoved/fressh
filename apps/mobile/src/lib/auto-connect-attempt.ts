import { type SavedEntryTailscaleRecovery } from './auto-connect-saved-entry';
import {
	type Logger,
	type OpenSavedEntryShell,
	type ResolvedKeySecurity,
	prepareSavedEntryAttempt,
	resolvePreparedSavedEntrySecurity,
	runPreparedSavedEntryAttempt,
} from './auto-connect-saved-entry-attempt';
import {
	runActiveShellReopenAttempt,
	type ConnectionAttemptTimeouts,
	type SavedEntryConnectionAttemptOutcome,
} from './connection-attempt-lifecycle';
import { attemptReconnectThroughSavedEntry } from './auto-connect-reconnect-saved-entry';
import { type ConnectionDiagnosticEvent } from './connection-diagnostic-types';
import {
	autoConnectEvents,
	buildActiveConnectionIdentity,
	reconnectEvents,
	savedEntryEvents,
	serializeConnectionDiagnosticError,
} from './connection-diagnostics/events';
import {
	createConnectionRunContext,
	type ConnectionRunContext,
} from './connection-run-context';
import { type AutoConnectReconnectAttemptResult } from './auto-connect-reconnect-controller';
import {
	getStoredConnectionId,
	type SavedConnectionEntry,
} from './connection-utils';
// eslint-disable-next-line import/consistent-type-specifier-style -- keep secrets-manager fully type-only so Node integration tests do not load React Native at runtime
import type { StoredConnectionDetails } from './secrets-manager';
import { extractTmuxAttachFailureReason } from './ssh-error-details';
import { AbortSignalTimeout, queryClient } from './utils';

type LatestShellSnapshot = {
	connectionId: string;
	channelId: number;
	createdAtMs: number;
};

export type ActiveConnectionSnapshot = {
	connectionId: string;
	connectedAtMs: number;
	connectionDetails: {
		username: string;
		host: string;
		port: number;
	};
	startShell: (args: {
		term: 'Xterm';
		useTmux: boolean;
		tmuxSessionName: string;
		abortSignal: AbortSignal;
	}) => Promise<{
		channelId: number;
		close?: (opts?: { signal?: AbortSignal }) => Promise<void>;
	}>;
};

type TmuxSettings = {
	useTmux: boolean;
	tmuxSessionName: string;
};

type AutoConnectTrace = {
	event: (event: ConnectionDiagnosticEvent) => void;
};

const DEFAULT_AUTO_CONNECT_TIMEOUTS: ConnectionAttemptTimeouts = {
	operationTimeoutMs: 5_000,
	recoveryTimeoutMs: 60_000,
	cleanupTimeoutMs: 5_000,
};

export type AutoConnectAttemptSourceArgs = {
	platformOS: string;
	pathname: string;
	latestShell: LatestShellSnapshot | null;
	connections: Record<string, ActiveConnectionSnapshot>;
	openSavedEntryShell: OpenSavedEntryShell;
	loadLatestSavedConnection: () => Promise<SavedConnectionEntry | null>;
	loadSavedConnectionByStoredId?: (
		storedConnectionId: string,
	) => Promise<SavedConnectionEntry | null>;
	resolveKeySecurity: (
		details: StoredConnectionDetails,
	) => Promise<ResolvedKeySecurity | null>;
	navigateToShell: (connectionId: string, channelId: number) => void;
	recovery: SavedEntryTailscaleRecovery;
	markTailscaleAttention: (message: string) => void;
	clearTailscaleAttention: () => void;
	logger: Logger;
	loadTmuxSettings?: (
		storedConnectionId: string,
	) => Promise<TmuxSettings | null>;
	reconnectContext?: AutoConnectReconnectContext;
	trace?: AutoConnectTrace;
	runContext: ConnectionRunContext;
	timeouts?: ConnectionAttemptTimeouts;
};

export type AutoConnectReconnectContext = {
	trigger: 'reconnect';
	droppedConnectionId?: string;
	droppedChannelId?: number;
	droppedStoredConnectionId?: string;
	pathname: string;
};

const loadStoredTmuxSettings = async (
	storedConnectionId: string,
): Promise<TmuxSettings | null> => {
	const { secretsManager } = await import('./secrets-manager');
	const entry = await queryClient.fetchQuery(
		secretsManager.connections.query.get(storedConnectionId),
	);
	if (!entry?.value) return null;
	return {
		useTmux: entry.value.useTmux ?? true,
		tmuxSessionName: entry.value.tmuxSessionName?.trim() || 'main',
	};
};

const pickLatestActiveConnection = (
	connections: Record<string, ActiveConnectionSnapshot>,
) => {
	const activeConnections = Object.values(connections);
	if (activeConnections.length === 0) return null;
	return activeConnections.reduce((latest, current) =>
		current.connectedAtMs > latest.connectedAtMs ? current : latest,
	);
};

async function loadStoredConnectionByStoredId(
	storedConnectionId: string,
): Promise<SavedConnectionEntry | null> {
	const { secretsManager } = await import('./secrets-manager');
	return await queryClient.fetchQuery(
		secretsManager.connections.query.get(storedConnectionId),
	);
}

function emitTrace(
	trace: AutoConnectTrace | undefined,
	logger: Logger,
	event: ConnectionDiagnosticEvent,
) {
	try {
		trace?.event(event);
	} catch (error) {
		logger.warn('Auto-connect trace event failed', error);
	}
}

function traceLatestShell(
	trace: AutoConnectTrace | undefined,
	logger: Logger,
	latestShell: LatestShellSnapshot,
	pathname: string,
) {
	emitTrace(
		trace,
		logger,
		autoConnectEvents.latestShellSelected({
			source: 'latest-shell',
			connection: { connectionId: latestShell.connectionId },
			channelId: latestShell.channelId,
			pathname,
		}),
	);
}

export async function attemptAutoConnectSource({
	platformOS,
	pathname,
	latestShell,
	connections,
	openSavedEntryShell,
	loadLatestSavedConnection,
	loadSavedConnectionByStoredId = loadStoredConnectionByStoredId,
	resolveKeySecurity,
	navigateToShell,
	recovery,
	markTailscaleAttention,
	clearTailscaleAttention,
	logger,
	loadTmuxSettings = loadStoredTmuxSettings,
	reconnectContext,
	trace,
	runContext,
	timeouts = DEFAULT_AUTO_CONNECT_TIMEOUTS,
}: AutoConnectAttemptSourceArgs): Promise<
	AutoConnectReconnectAttemptResult | boolean
> {
	const isAborted = () => runContext.signal.aborted === true;
	const traceEvent = (event: ConnectionDiagnosticEvent) => {
		emitTrace(trace, logger, event);
	};
	const attemptReconnectSavedEntry = async (
		currentReconnectContext: AutoConnectReconnectContext,
	) =>
		await attemptReconnectThroughSavedEntry({
			platformOS,
			runContext,
			reconnectContext: currentReconnectContext,
			connections,
			loadSavedConnectionByStoredId,
			recovery,
			traceEvent,
			resolveKeySecurity,
			openSavedEntryShell,
			navigateToShell,
			markTailscaleAttention,
			clearTailscaleAttention,
			logger,
		});

	if (isAborted()) return false;

	if (latestShell) {
		traceLatestShell(trace, logger, latestShell, pathname);
		if (isAborted()) return false;
		if (pathname !== '/shell/detail') {
			navigateToShell(latestShell.connectionId, latestShell.channelId);
		}
		if (isAborted()) return false;
		clearTailscaleAttention();
		return true;
	}

	traceEvent(
		autoConnectEvents.latestShellMissing({
			source: 'latest-shell',
			pathname,
		}),
	);
	const activeConnection = pickLatestActiveConnection(connections);
	if (activeConnection) {
		const reconnectingExistingSession = reconnectContext?.trigger === 'reconnect';
		if (reconnectingExistingSession) {
			traceEvent(
				reconnectEvents.transportInvalidated({
					source: 'reconnect',
					connectionId: reconnectContext.droppedConnectionId,
					channelId: reconnectContext.droppedChannelId,
					hadShell: reconnectContext.droppedChannelId !== undefined,
					bridgeDisposed: false,
					bridgeRequestInFlight: false,
					message: 'stale transport marked for replacement',
				}),
			);
			return await attemptReconnectSavedEntry(reconnectContext);
		}
		const activeConnectionIdentity = buildActiveConnectionIdentity({
			connectionId: activeConnection.connectionId,
			connectionDetails: {
				username: activeConnection.connectionDetails.username,
				host: activeConnection.connectionDetails.host,
				port: activeConnection.connectionDetails.port,
			},
		});
		traceEvent(
			autoConnectEvents.activeConnectionSelected({
				source: 'active-connection',
				connection: activeConnectionIdentity,
			}),
		);
		const storedConnectionId = getStoredConnectionId(
			activeConnection.connectionDetails,
		);
		let useTmux = true;
		let tmuxSessionName = 'main';
		try {
			const tmuxSettingsResult = await runContext.runOperation(
				'operation',
				async () => await loadTmuxSettings(storedConnectionId),
			);
			if (tmuxSettingsResult.status === 'aborted') return false;
			const tmuxSettings = tmuxSettingsResult.value;
			if (tmuxSettings) {
				useTmux = tmuxSettings.useTmux;
				tmuxSessionName = tmuxSettings.tmuxSessionName;
			}
		} catch (error) {
			logger.warn('Failed to load tmux settings for active connection', error);
		}

		traceEvent(
			autoConnectEvents.activeConnectionShellStarted({
				source: 'active-connection',
				connection: {
					...activeConnectionIdentity,
					useTmux,
					tmuxSessionName,
				},
			}),
		);
		let closeReopenedShell:
			| ((opts?: { signal?: AbortSignal }) => Promise<void>)
			| undefined;
		const activeRunContext = createConnectionRunContext({
			callerSignal: runContext.signal,
			isCurrent: () => !runContext.signal.aborted,
			timeouts,
		});
		const result = await (async () => {
			try {
				return await runActiveShellReopenAttempt({
					runContext: activeRunContext,
					startShell: async ({ signal }) => {
						const shellHandle = await activeConnection.startShell({
							term: 'Xterm',
							useTmux,
							tmuxSessionName,
							abortSignal: signal,
						});
						closeReopenedShell = shellHandle.close;
						return {
							connectionId: activeConnection.connectionId,
							channelId: shellHandle.channelId,
							close: shellHandle.close,
						};
					},
					cleanupConnected: async ({ close }, signal) => {
						await close?.({ signal });
					},
					onLateCleanupFailure: (error) => {
						logger.warn('Failed to close late active shell', error);
					},
				});
			} finally {
				activeRunContext.finish();
			}
		})();
		if (result.status === 'connected') {
			if (isAborted()) {
				try {
					await closeReopenedShell?.({
						signal: AbortSignalTimeout(timeouts.cleanupTimeoutMs),
					});
				} catch (error) {
					logger.warn('Failed to close aborted active shell', error);
				}
				return false;
			}
			logger.info('Reconnected by reopening shell on active connection', {
				connectionId: activeConnection.connectionId,
				channelId: result.channelId,
			});
			traceEvent(
				autoConnectEvents.activeConnectionShellConnected({
					source: 'active-connection',
					connection: activeConnectionIdentity,
					channelId: result.channelId,
					pathname,
				}),
			);
			navigateToShell(activeConnection.connectionId, result.channelId);
			if (isAborted()) return false;
			clearTailscaleAttention();
			return true;
		}
		if (result.status === 'aborted') {
			return false;
		}
		if (result.status === 'timedOut') {
			const error = new Error('Active shell reopen timed out');
			traceEvent(
				autoConnectEvents.activeConnectionShellFailed({
					source: 'active-connection',
					connection: activeConnectionIdentity,
					error: serializeConnectionDiagnosticError(error),
					tmuxSessionName,
				}),
			);
			logger.warn('Failed to reopen shell on active connection', error);
			if (isAborted()) return false;
		} else {
			const error = result.error;
			const tmuxAttachFailureReason = extractTmuxAttachFailureReason(error);
			traceEvent(
				tmuxAttachFailureReason !== null
					? autoConnectEvents.activeConnectionTmuxAttachFailed({
							source: 'active-connection',
							connection: activeConnectionIdentity,
							error: serializeConnectionDiagnosticError(error),
							tmuxAttachFailureReason,
							tmuxSessionName,
						})
					: autoConnectEvents.activeConnectionShellFailed({
							source: 'active-connection',
							connection: activeConnectionIdentity,
							error: serializeConnectionDiagnosticError(error),
							tmuxSessionName,
						}),
			);
			if (tmuxAttachFailureReason !== null) {
				logger.info(
					'Tmux attach failed while reopening shell on active connection',
					{
						connectionId: activeConnection.connectionId,
						tmuxAttachFailureReason,
						tmuxSessionName,
					},
				);
			} else {
				logger.warn('Failed to reopen shell on active connection', error);
			}
			if (isAborted()) return false;
		}
	} else {
		traceEvent(
			autoConnectEvents.activeConnectionMissing({
				source: 'active-connection',
			}),
		);
	}

	if (reconnectContext?.trigger === 'reconnect') {
		return await attemptReconnectSavedEntry(reconnectContext);
	}

	const latestEntryResult = await runContext.runOperation(
		'operation',
		async () => await loadLatestSavedConnection(),
	);
	if (latestEntryResult.status === 'aborted') return false;
	const latestEntry = latestEntryResult.value;
	if (isAborted()) return false;
	if (!latestEntry) {
		traceEvent(
			savedEntryEvents.missing({
				source: 'saved-entry',
			}),
		);
		return false;
	}

	const prepared = prepareSavedEntryAttempt({
		latestEntry,
		traceEvent,
	});
	if (!prepared) {
		return false;
	}

	const resolvedSecurityResult = await resolvePreparedSavedEntrySecurity({
		runContext,
		prepared,
		resolveKeySecurity,
		traceEvent,
	});
	if (resolvedSecurityResult.status === 'aborted') return false;
	const resolvedSecurity = resolvedSecurityResult.value;
	if (isAborted()) return false;
	if (!resolvedSecurity) return false;
	const logTmuxAttachFailure = (
		result: Extract<SavedEntryConnectionAttemptOutcome, { status: 'tmuxAttachFailed' }>,
	) => {
		logger.info('Auto-connect tmux attach failed, will retry', {
			connectionId: result.connectionId,
			tmuxAttachFailureReason: result.tmuxAttachFailureReason,
			tmuxSessionName: result.tmuxSessionName,
		});
	};

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
		isAborted,
		traceConnectStart: (phase) => {
			traceEvent(
				phase === 'retry'
					? autoConnectEvents.savedEntryRetryStarted({
							source: 'saved-entry',
						})
					: autoConnectEvents.savedEntryConnectStarted({
							source: 'saved-entry',
						}),
			);
		},
		traceConnectThrow: (phase, _prepared, error) => {
			traceEvent(
				phase === 'retry'
					? autoConnectEvents.savedEntryRetryThrew({
							source: 'saved-entry',
							error,
						})
					: autoConnectEvents.savedEntryConnectThrew({
							source: 'saved-entry',
							error,
						}),
			);
		},
	});
	if (isAborted()) return false;

	switch (result.status) {
		case 'connected':
			traceEvent(
				autoConnectEvents.savedEntryConnectConnected({
					source: 'saved-entry',
					connection: { connectionId: result.connectionId },
					connectionId: result.connectionId,
					channelId: result.channelId,
				}),
			);
			clearTailscaleAttention();
			return true;
		case 'tmuxAttachFailed':
			traceEvent(
				autoConnectEvents.savedEntryConnectTmuxAttachFailed({
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
				logTmuxAttachFailure({
					status: 'tmuxAttachFailed',
					connectionId: result.connectionId,
					tmuxAttachFailureReason: result.tmuxAttachFailureReason,
					tmuxSessionName: result.tmuxSessionName,
					storedConnectionId: result.storedConnectionId,
			});
			traceEvent(
				autoConnectEvents.savedEntryConnectFailed({
					source: 'saved-entry',
					connection: prepared.latestEntryConnection,
					connectionId: result.connectionId,
					storedConnectionId: result.storedConnectionId,
				}),
			);
			return false;
		case 'blocked':
			if (result.attentionMessage !== null) {
				markTailscaleAttention(result.attentionMessage);
			}
			traceEvent(
				autoConnectEvents.savedEntryConnectFailed({
					source: 'saved-entry',
					connection: prepared.latestEntryConnection,
				}),
			);
			return false;
		case 'failed':
			if (result.attentionMessage !== null) {
				markTailscaleAttention(result.attentionMessage);
			}
			if (result.recoverable) {
				logger.warn(
					'Auto-connect failed after Tailscale recovery retry',
					result.error,
				);
			}
			traceEvent(
				autoConnectEvents.savedEntryConnectFailed({
					source: 'saved-entry',
					connection: prepared.latestEntryConnection,
				}),
			);
			return false;
		case 'aborted':
		case 'timedOut':
			return false;
		case 'cleanupFailed':
			logger.warn('Auto-connect cleanup failed', result.error);
			return false;
	}
}
