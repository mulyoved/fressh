import {
	attemptSavedEntryWithTailscaleRecovery,
	type SavedEntryTailscaleRecovery,
} from './auto-connect-saved-entry';
import {
	getStoredConnectionId,
	type SavedConnectionEntry,
} from './connection-utils';
// eslint-disable-next-line import/consistent-type-specifier-style -- keep query-fns fully type-only so Node integration tests do not load React Native at runtime
import type { ConnectAndOpenShellResult } from './query-fns';
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
}) => Promise<ConnectAndOpenShellResult>;

type Logger = {
	info: (message: string, data?: unknown) => void;
	warn: (message: string, error: unknown) => void;
};

type TmuxSettings = {
	useTmux: boolean;
	tmuxSessionName: string;
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
}: AutoConnectAttemptSourceArgs): Promise<boolean> {
	if (latestShell) {
		if (pathname !== '/shell/detail') {
			navigateToShell(latestShell.connectionId, latestShell.channelId);
		}
		return true;
	}

	const activeConnection = pickLatestActiveConnection(connections);
	if (activeConnection) {
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
			navigateToShell(activeConnection.connectionId, shellHandle.channelId);
			return true;
		} catch (error) {
			const tmuxAttachFailureReason = extractTmuxAttachFailureReason(error);
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
	}

	const latestEntry = await loadLatestSavedConnection();
	if (!latestEntry) return false;

	const details = latestEntry.value;
	if (
		typeof details.useTmux !== 'boolean' ||
		typeof details.tmuxSessionName !== 'string'
	) {
		return false;
	}

	const normalizedDetails: InputConnectionDetails = {
		...details,
		useTmux: details.useTmux,
		tmuxSessionName: details.tmuxSessionName,
		autoConnect: details.autoConnect ?? false,
	};
	const resolvedSecurity = await resolveKeySecurity(details);
	if (!resolvedSecurity) return false;

	const connectSavedEntry = () =>
		openSavedEntryShell({
			connectionDetails: normalizedDetails,
			resolvedSecurity,
			navigate: ({ connectionId, channelId }) => {
				navigateToShell(connectionId, channelId);
			},
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
		recovery,
		connectSavedEntry,
		markTailscaleAttention,
		clearTailscaleAttention,
		logTmuxAttachFailure,
		logWarning: (message, error) => {
			logger.warn(message, error);
		},
	});
	return result.connected;
}
