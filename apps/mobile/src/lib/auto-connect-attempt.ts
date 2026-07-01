import {
	attemptSavedEntryWithTailscaleRecovery,
	type SavedEntryConnectAttemptPhase,
	type SavedEntryConnectResult,
	type SavedEntryTailscaleRecovery,
} from './auto-connect-saved-entry';
import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticEvent,
} from './connection-diagnostic-types';
import {
	autoConnectEvents,
	savedEntryEvents,
	serializeConnectionDiagnosticError,
} from './connection-diagnostics/events';
import {
	getStoredConnectionId,
	type SavedConnectionEntry,
} from './connection-utils';
import { createSavedEntryTailscaleDiagnosticRecovery } from './saved-entry-tailscale-diagnostic-recovery';
// eslint-disable-next-line import/consistent-type-specifier-style -- keep secrets-manager fully type-only so Node integration tests do not load React Native at runtime
import type {
	InputConnectionDetails,
	StoredConnectionDetails,
} from './secrets-manager';
import { extractTmuxAttachFailureReason } from './ssh-error-details';
import { AbortSignalTimeout, queryClient } from './utils';

type LatestShellSnapshot = {
	connectionId: string;
	channelId: number;
	createdAtMs: number;
};

type ActiveConnectionSnapshot = {
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
	}) => Promise<{ channelId: number }>;
};

type ResolvedKeySecurity = {
	type: 'key';
	privateKey: string;
};

type OpenSavedEntryShell = (args: {
	connectionDetails: InputConnectionDetails;
	resolvedSecurity: ResolvedKeySecurity;
	navigate: (params: { connectionId: string; channelId: number }) => void;
}) => Promise<SavedEntryConnectResult>;

type Logger = {
	info: (message: string, data?: unknown) => void;
	warn: (message: string, error: unknown) => void;
};

type TmuxSettings = {
	useTmux: boolean;
	tmuxSessionName: string;
};

type AutoConnectTrace = {
	event: (event: ConnectionDiagnosticEvent) => void;
};

export type AutoConnectAttemptSourceArgs = {
	platformOS: string;
	pathname: string;
	latestShell: LatestShellSnapshot | null;
	connections: Record<string, ActiveConnectionSnapshot>;
	openSavedEntryShell: OpenSavedEntryShell;
	loadLatestSavedConnection: () => Promise<SavedConnectionEntry | null>;
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
	trace?: AutoConnectTrace;
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

const getSavedEntryConnectionIdentity = (
	id: string,
	details: StoredConnectionDetails,
): ConnectionDiagnosticConnectionIdentity => {
	const identity: ConnectionDiagnosticConnectionIdentity = {
		savedConnectionId: id,
		username: details.username,
		host: details.host,
		port: details.port,
		keyId: details.security.keyId,
	};
	if (details.useTmux !== undefined) identity.useTmux = details.useTmux;
	if (details.tmuxSessionName !== undefined) {
		identity.tmuxSessionName = details.tmuxSessionName;
	}
	return identity;
};

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
	resolveKeySecurity,
	navigateToShell,
	recovery,
	markTailscaleAttention,
	clearTailscaleAttention,
	logger,
	loadTmuxSettings = loadStoredTmuxSettings,
	trace,
}: AutoConnectAttemptSourceArgs): Promise<boolean> {
	const traceEvent = (event: ConnectionDiagnosticEvent) => {
		emitTrace(trace, logger, event);
	};

	if (latestShell) {
		traceLatestShell(trace, logger, latestShell, pathname);
		if (pathname !== '/shell/detail') {
			navigateToShell(latestShell.connectionId, latestShell.channelId);
		}
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
		const activeConnectionIdentity = {
			connectionId: activeConnection.connectionId,
			username: activeConnection.connectionDetails.username,
			host: activeConnection.connectionDetails.host,
			port: activeConnection.connectionDetails.port,
		};
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
			const tmuxSettings = await loadTmuxSettings(storedConnectionId);
			if (tmuxSettings) {
				useTmux = tmuxSettings.useTmux;
				tmuxSessionName = tmuxSettings.tmuxSessionName;
			}
		} catch (error) {
			logger.warn('Failed to load tmux settings for active connection', error);
		}

		try {
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
			const shellHandle = await activeConnection.startShell({
				term: 'Xterm',
				useTmux,
				tmuxSessionName,
				abortSignal: AbortSignalTimeout(5_000),
			});
			logger.info('Reconnected by reopening shell on active connection', {
				connectionId: activeConnection.connectionId,
				channelId: shellHandle.channelId,
			});
			traceEvent(
				autoConnectEvents.activeConnectionShellConnected({
					source: 'active-connection',
					connection: activeConnectionIdentity,
					channelId: shellHandle.channelId,
					pathname,
				}),
			);
			navigateToShell(activeConnection.connectionId, shellHandle.channelId);
			clearTailscaleAttention();
			return true;
		} catch (error) {
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
		}
	} else {
		traceEvent(
			autoConnectEvents.activeConnectionMissing({
				source: 'active-connection',
			}),
		);
	}

	const latestEntry = await loadLatestSavedConnection();
	if (!latestEntry) {
		traceEvent(
			savedEntryEvents.missing({
				source: 'saved-entry',
			}),
		);
		return false;
	}

	const details = latestEntry.value;
	const latestEntryConnection = getSavedEntryConnectionIdentity(
		latestEntry.id,
		latestEntry.value,
	);
	traceEvent(
		savedEntryEvents.selected({
			source: 'saved-entry',
			connection: latestEntryConnection,
		}),
	);
	if (
		typeof details.useTmux !== 'boolean' ||
		typeof details.tmuxSessionName !== 'string'
	) {
		traceEvent(
			savedEntryEvents.invalidTmuxSettings({
				source: 'saved-entry',
				connection: latestEntryConnection,
				useTmuxType: typeof details.useTmux,
				tmuxSessionNameType: typeof details.tmuxSessionName,
			}),
		);
		return false;
	}

	const normalizedDetails: InputConnectionDetails = {
		...details,
		useTmux: details.useTmux,
		tmuxSessionName: details.tmuxSessionName,
		autoConnect: details.autoConnect ?? false,
	};
	const resolvedSecurity = await resolveKeySecurity(details);
	if (!resolvedSecurity) {
		traceEvent(
			savedEntryEvents.keyMissing({
				source: 'saved-entry',
				connection: latestEntryConnection,
			}),
		);
		return false;
	}
	traceEvent(
		savedEntryEvents.keyResolved({
			source: 'saved-entry',
			connection: latestEntryConnection,
		}),
	);

	const connectSavedEntry = () =>
		openSavedEntryShell({
			connectionDetails: normalizedDetails,
			resolvedSecurity,
			navigate: ({ connectionId, channelId }) => {
				navigateToShell(connectionId, channelId);
			},
		});
	const tracedConnectSavedEntry = async (
		phase: SavedEntryConnectAttemptPhase,
	) => {
		const isRetry = phase === 'retry';
		traceEvent(
			isRetry
				? autoConnectEvents.savedEntryRetryStarted({
						source: 'saved-entry',
					})
				: autoConnectEvents.savedEntryConnectStarted({
						source: 'saved-entry',
					}),
		);
		try {
			return await connectSavedEntry();
		} catch (error) {
			traceEvent(
				isRetry
					? autoConnectEvents.savedEntryRetryThrew({
							source: 'saved-entry',
							error,
						})
					: autoConnectEvents.savedEntryConnectThrew({
							source: 'saved-entry',
							error,
						}),
			);
			throw error;
		}
	};
	const tracedRecovery = createSavedEntryTailscaleDiagnosticRecovery({
		platformOS,
		recovery,
		emit: traceEvent,
	});
	const logTmuxAttachFailure = (
		result: Extract<
			Awaited<ReturnType<typeof connectSavedEntry>>,
			{ status: 'tmux_attach_failed' }
		>,
	) => {
		logger.info('Auto-connect tmux attach failed, will retry', {
			connectionId: result.connectionId,
			tmuxAttachFailureReason: result.tmuxAttachFailureReason,
			tmuxSessionName: result.tmuxSessionName,
		});
	};

	const result = await attemptSavedEntryWithTailscaleRecovery({
		platformOS,
		recovery: tracedRecovery,
		connectSavedEntry: tracedConnectSavedEntry,
		shouldRecoverAfterFailure: () => true,
	});

	switch (result.status) {
		case 'connected':
			traceEvent(
				autoConnectEvents.savedEntryConnectConnected({
					source: 'saved-entry',
					connection: { connectionId: result.result.connectionId },
					connectionId: result.result.connectionId,
					channelId: result.result.channelId,
				}),
			);
			clearTailscaleAttention();
			return true;
		case 'tmuxAttachFailed':
			traceEvent(
				autoConnectEvents.savedEntryConnectTmuxAttachFailed({
					source: 'saved-entry',
					connection: {
						connectionId: result.result.connectionId,
						tmuxSessionName: result.result.tmuxSessionName,
					},
					connectionId: result.result.connectionId,
					tmuxAttachFailureReason: result.result.tmuxAttachFailureReason,
					tmuxSessionName: result.result.tmuxSessionName,
					storedConnectionId: result.result.storedConnectionId,
				}),
			);
			logTmuxAttachFailure(result.result);
			traceEvent(
				autoConnectEvents.savedEntryConnectFailed({
					source: 'saved-entry',
					connection: latestEntryConnection,
					connectionId: result.result.connectionId,
					storedConnectionId: result.result.storedConnectionId,
				}),
			);
			return false;
		case 'blocked':
		case 'recoveryNotAttempted':
		case 'retryFailed':
			if (result.attentionMessage !== null) {
				markTailscaleAttention(result.attentionMessage);
			}
			if (result.status === 'retryFailed') {
				logger.warn(
					'Auto-connect failed after Tailscale recovery retry',
					result.error,
				);
			}
			traceEvent(
				autoConnectEvents.savedEntryConnectFailed({
					source: 'saved-entry',
					connection: latestEntryConnection,
				}),
			);
			return false;
		case 'threw':
			throw result.error;
	}
}
