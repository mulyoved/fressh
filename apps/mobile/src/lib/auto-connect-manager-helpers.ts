import { type AutoConnectReconnectContext } from './auto-connect-attempt';
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
