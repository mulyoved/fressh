import {
	attemptAutoConnectSource,
	type AutoConnectAttemptSourceArgs,
	type AutoConnectReconnectContext,
} from './auto-connect-attempt';
import {
	getStoredConnectionId,
	pickLatestConnection,
	type SavedConnectionEntry,
} from './connection-utils';

type ShellSnapshot = {
	connectionId: string;
	channelId: number;
	createdAtMs: number;
};

type ConnectionSnapshot = {
	connectionDetails: {
		username: string;
		host: string;
		port: number;
	};
};

export function pickLatestShellSnapshot<T extends ShellSnapshot>(
	shells: T[],
): T | null {
	if (shells.length === 0) return null;
	return shells.reduce((latest, shell) =>
		shell.createdAtMs > latest.createdAtMs ? shell : latest,
	);
}

export function pickLatestSavedAutoConnectConnection(
	entries?: SavedConnectionEntry[] | null,
): SavedConnectionEntry | null {
	return pickLatestConnection(
		entries?.filter((entry) => entry.value.autoConnect),
	);
}

export function pickLatestSavedReconnectConnection(
	entries?: SavedConnectionEntry[] | null,
): SavedConnectionEntry | null {
	return pickLatestConnection(entries);
}

export async function attemptAutoConnectFromManager({
	attemptAutoConnectSourceImpl = attemptAutoConnectSource,
	loadSavedConnections,
	loadSavedConnectionByStoredId,
	...args
}: Omit<
	AutoConnectAttemptSourceArgs,
	| 'loadLatestSavedConnection'
	| 'loadLatestSavedReconnectConnection'
	| 'loadSavedConnectionByStoredId'
> & {
	loadSavedConnections: () => Promise<SavedConnectionEntry[] | null>;
	loadSavedConnectionByStoredId: NonNullable<
		AutoConnectAttemptSourceArgs['loadSavedConnectionByStoredId']
	>;
	attemptAutoConnectSourceImpl?: typeof attemptAutoConnectSource;
}) {
	return await attemptAutoConnectSourceImpl({
		...args,
		loadLatestSavedConnection: async () =>
			pickLatestSavedAutoConnectConnection(await loadSavedConnections()),
		loadLatestSavedReconnectConnection: async () =>
			pickLatestSavedReconnectConnection(await loadSavedConnections()),
		loadSavedConnectionByStoredId,
	});
}

export function buildPendingReconnectContext({
	pathname,
	shells,
	connections,
}: {
	pathname: string;
	shells: ShellSnapshot[];
	connections: Record<string, ConnectionSnapshot | undefined>;
}): AutoConnectReconnectContext {
	const droppedShell = pickLatestShellSnapshot(shells);
	const droppedConnection = droppedShell
		? connections[droppedShell.connectionId]
		: undefined;
	return {
		trigger: 'reconnect',
		pathname,
		droppedConnectionId: droppedShell?.connectionId,
		droppedChannelId: droppedShell?.channelId,
		droppedStoredConnectionId: droppedConnection
			? getStoredConnectionId(droppedConnection.connectionDetails)
			: undefined,
	};
}
