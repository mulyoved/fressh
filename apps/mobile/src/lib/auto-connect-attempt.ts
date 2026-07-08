import {
	type SavedEntryConnectAttemptPhase,
	type SavedEntryConnectResult,
	type SavedEntryTailscaleRecovery,
} from './auto-connect-saved-entry';
import {
	runActiveShellReopenAttempt,
	runSavedEntryConnectionAttempt,
	type ConnectionAttemptTimeouts,
} from './connection-attempt-lifecycle';
import { type ConnectionDiagnosticEvent } from './connection-diagnostic-types';
import {
	autoConnectEvents,
	buildActiveConnectionIdentity,
	buildSavedEntryIdentity,
	reconnectEvents,
	savedEntryEvents,
	serializeConnectionDiagnosticError,
} from './connection-diagnostics/events';
import {
	createConnectionRunContext,
	type ConnectionRunContext,
	type ConnectionRunOperationResult,
} from './connection-run-context';
import { type AutoConnectReconnectAttemptResult } from './auto-connect-reconnect-controller';
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
import { isNetworkLikeSshError } from './tailscale-recovery-core';
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
	}) => Promise<{
		channelId: number;
		close?: (opts?: { signal?: AbortSignal }) => Promise<void>;
	}>;
};

type ResolvedKeySecurity = {
	type: 'key';
	privateKey: string;
};

type OpenSavedEntryShell = (args: {
	connectionDetails: InputConnectionDetails;
	resolvedSecurity: ResolvedKeySecurity;
	navigate: (params: { connectionId: string; channelId: number }) => void;
	abortSignal?: AbortSignal;
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
	loadLatestSavedReconnectConnection?: () => Promise<SavedConnectionEntry | null>;
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

function errorTag(error: unknown): string | null {
	if (!error || typeof error !== 'object') return null;
	const tag = (error as { tag?: unknown }).tag;
	return typeof tag === 'string' ? tag : null;
}

function classifyReconnectFailure(error: unknown): Extract<
	AutoConnectReconnectAttemptResult,
	{
		status:
			| 'failedNetwork'
			| 'failedAuth'
			| 'failedTmuxAttach'
			| 'needsAttention';
	}
>['status'] {
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

function classifyReconnectSetupFailure(
	error: unknown,
	stage: 'saved-entry-load' | 'key-resolution',
): Extract<
	AutoConnectReconnectAttemptResult,
	{
		status:
			| 'cleanupFailed'
			| 'failedNetwork'
			| 'failedAuth'
			| 'failedTmuxAttach';
	}
> {
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

async function resolveReconnectSavedEntry({
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

async function runSavedEntryReconnectAttempt({
	platformOS,
	runContext,
	recovery,
	traceEvent,
	latestEntry,
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
	resolveKeySecurity: (
		details: StoredConnectionDetails,
	) => Promise<ResolvedKeySecurity | null>;
	openSavedEntryShell: OpenSavedEntryShell;
	navigateToShell: (connectionId: string, channelId: number) => void;
	markTailscaleAttention: (message: string) => void;
	clearTailscaleAttention: () => void;
	logger: Logger;
}): Promise<AutoConnectReconnectAttemptResult | boolean> {
	const details = latestEntry.value;
	const latestEntryConnection = buildSavedEntryIdentity(
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
		return {
			status: 'failedTmuxAttach',
			message: 'invalid-tmux-settings',
		};
	}

	const normalizedDetails: InputConnectionDetails = {
		...details,
		useTmux: details.useTmux,
		tmuxSessionName: details.tmuxSessionName,
		autoConnect: details.autoConnect ?? false,
	};
	let resolvedSecurityResult: ConnectionRunOperationResult<
		ResolvedKeySecurity | null
	>;
	try {
		resolvedSecurityResult = await runContext.runOperation(
			'operation',
			async () => await resolveKeySecurity(details),
		);
	} catch (error) {
		if (
			runContext.classifyError(error) === 'aborted' ||
			runContext.signal.aborted
		) {
			return { status: 'retry' };
		}
		logger.warn('Reconnect key resolution failed', error);
		return classifyReconnectSetupFailure(error, 'key-resolution');
	}
	if (resolvedSecurityResult.status === 'aborted') {
		return { status: 'retry' };
	}
	const resolvedSecurity = resolvedSecurityResult.value;
	if (runContext.signal.aborted) return { status: 'retry' };
	if (!resolvedSecurity) {
		traceEvent(
			savedEntryEvents.keyMissing({
				source: 'saved-entry',
				connection: latestEntryConnection,
			}),
		);
		return { status: 'failedAuth', message: 'key-missing' };
	}
	traceEvent(
		savedEntryEvents.keyResolved({
			source: 'saved-entry',
			connection: latestEntryConnection,
		}),
	);

	const connectSavedEntry = (signal?: AbortSignal) =>
		openSavedEntryShell({
			connectionDetails: normalizedDetails,
			resolvedSecurity,
			navigate: ({ connectionId, channelId }) => {
				if (runContext.signal.aborted) return;
				navigateToShell(connectionId, channelId);
			},
			abortSignal: signal,
		});
	const tracedConnectSavedEntry = async (
		phase: SavedEntryConnectAttemptPhase,
		signal?: AbortSignal,
	) => {
		const isRetry = phase === 'retry';
		traceEvent(
			isRetry
				? autoConnectEvents.savedEntryRetryStarted({
						source: 'saved-entry',
						connection: latestEntryConnection,
						trigger: 'reconnect',
						tmuxSessionName: normalizedDetails.tmuxSessionName,
					})
				: autoConnectEvents.savedEntryConnectStarted({
						source: 'saved-entry',
						trigger: 'reconnect',
						connection: latestEntryConnection,
						tmuxSessionName: normalizedDetails.tmuxSessionName,
					}),
		);
		try {
			return await connectSavedEntry(signal);
		} catch (error) {
			traceEvent(
				isRetry
					? autoConnectEvents.savedEntryRetryThrew({
							source: 'saved-entry',
							connection: latestEntryConnection,
							error,
							trigger: 'reconnect',
							tmuxSessionName: normalizedDetails.tmuxSessionName,
							failureClass: classifyReconnectFailure(error),
						})
					: autoConnectEvents.savedEntryConnectThrew({
							source: 'saved-entry',
							connection: latestEntryConnection,
							error,
							trigger: 'reconnect',
							tmuxSessionName: normalizedDetails.tmuxSessionName,
							failureClass: classifyReconnectFailure(error),
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

	const result = await runSavedEntryConnectionAttempt({
		platformOS,
		runContext,
		recovery: tracedRecovery,
		connectSavedEntry: async ({ phase, signal }) =>
			await tracedConnectSavedEntry(phase, signal),
		cleanupConnected: async (connected, signal) => {
			await connected.cleanup?.({ signal });
		},
		onLateCleanupFailure: (error) => {
			logger.warn('Auto-connect cleanup failed', error);
		},
	});
	if (runContext.signal.aborted) return { status: 'retry' };

	switch (result.status) {
		case 'connected':
			traceEvent(
				autoConnectEvents.savedEntryConnectConnected({
					source: 'saved-entry',
					connection: {
						...latestEntryConnection,
						connectionId: result.connectionId,
					},
					connectionId: result.connectionId,
					channelId: result.channelId,
					trigger: 'reconnect',
					storedConnectionId: latestEntry.id,
					tmuxSessionName: normalizedDetails.tmuxSessionName,
				}),
			);
			navigateToShell(result.connectionId, result.channelId);
			clearTailscaleAttention();
			return { status: 'connected' };
		case 'tmuxAttachFailed':
			traceEvent(
				autoConnectEvents.savedEntryConnectTmuxAttachFailed({
					source: 'saved-entry',
					connection: {
						...latestEntryConnection,
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
					connection: latestEntryConnection,
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
					connection: latestEntryConnection,
					trigger: 'reconnect',
					tmuxSessionName: normalizedDetails.tmuxSessionName,
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
					connection: latestEntryConnection,
					trigger: 'reconnect',
					tmuxSessionName: normalizedDetails.tmuxSessionName,
					failureClass,
				}),
			);
			return {
				status: failureClass,
				message:
					result.attentionMessage ??
					(result.error instanceof Error
						? result.error.message
						: undefined),
			};
		}
		case 'aborted':
		case 'timedOut':
			return { status: 'retry' };
		case 'cleanupFailed':
			logger.warn('Auto-connect cleanup failed', result.error);
			return { status: 'cleanupFailed' };
	}
}

export async function attemptAutoConnectSource({
	platformOS,
	pathname,
	latestShell,
	connections,
	openSavedEntryShell,
	loadLatestSavedConnection,
	loadLatestSavedReconnectConnection = loadLatestSavedConnection,
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
				return classifyReconnectSetupFailure(error, 'saved-entry-load');
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
				resolveKeySecurity,
				openSavedEntryShell,
				navigateToShell,
				markTailscaleAttention,
				clearTailscaleAttention,
				logger,
			});
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
			return classifyReconnectSetupFailure(error, 'saved-entry-load');
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
			resolveKeySecurity,
			openSavedEntryShell,
			navigateToShell,
			markTailscaleAttention,
			clearTailscaleAttention,
			logger,
		});
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

	const details = latestEntry.value;
	const latestEntryConnection = buildSavedEntryIdentity(
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
	const resolvedSecurityResult = await runContext.runOperation(
		'operation',
		async () => await resolveKeySecurity(details),
	);
	if (resolvedSecurityResult.status === 'aborted') return false;
	const resolvedSecurity = resolvedSecurityResult.value;
	if (isAborted()) return false;
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

	const connectSavedEntry = (signal?: AbortSignal) =>
		openSavedEntryShell({
			connectionDetails: normalizedDetails,
			resolvedSecurity,
			navigate: ({ connectionId, channelId }) => {
				if (isAborted()) return;
				navigateToShell(connectionId, channelId);
			},
			abortSignal: signal,
		});
	const tracedConnectSavedEntry = async (
		phase: SavedEntryConnectAttemptPhase,
		signal?: AbortSignal,
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
			return await connectSavedEntry(signal);
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

	const result = await runSavedEntryConnectionAttempt({
		platformOS,
		runContext,
		recovery: tracedRecovery,
		connectSavedEntry: async ({ phase, signal }) =>
			await tracedConnectSavedEntry(phase, signal),
		cleanupConnected: async (connected, signal) => {
			await connected.cleanup?.({ signal });
		},
		onLateCleanupFailure: (error) => {
			logger.warn('Auto-connect cleanup failed', error);
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
				status: 'tmux_attach_failed',
				connectionId: result.connectionId,
				tmuxAttachFailureReason: result.tmuxAttachFailureReason,
				tmuxSessionName: result.tmuxSessionName,
				storedConnectionId: result.storedConnectionId,
			});
			traceEvent(
				autoConnectEvents.savedEntryConnectFailed({
					source: 'saved-entry',
					connection: latestEntryConnection,
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
					connection: latestEntryConnection,
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
					connection: latestEntryConnection,
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
