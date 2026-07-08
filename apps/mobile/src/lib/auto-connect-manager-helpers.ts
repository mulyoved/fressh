import {
	attemptAutoConnectSource,
	type AutoConnectAttemptSourceArgs,
	type AutoConnectReconnectContext,
} from './auto-connect-attempt';
import { type AutoConnectReconnectAttemptResult } from './auto-connect-reconnect-controller';
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

export function preserveShellReferencedConnections<
	T extends ShellSnapshot,
	C extends ConnectionSnapshot,
>({
	shells,
	connections,
	previousConnections,
}: {
	shells: T[];
	connections: Record<string, C>;
	previousConnections: Record<string, C>;
}) {
	const nextConnections = { ...connections };
	for (const shell of shells) {
		if (nextConnections[shell.connectionId] !== undefined) continue;
		const previousConnection = previousConnections[shell.connectionId];
		if (previousConnection !== undefined) {
			nextConnections[shell.connectionId] = previousConnection;
		}
	}
	return nextConnections;
}

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

function reconnectAttemptIsTerminal(
	result: AutoConnectReconnectAttemptResult | boolean,
) {
	if (typeof result === 'boolean') return result;
	return result.status !== 'retry';
}

export function createReconnectContextCycleState() {
	let pendingReconnectContext: AutoConnectReconnectContext | null = null;
	let activeReconnectContext: AutoConnectReconnectContext | null = null;

	return {
		replacePendingReconnectContext(next: AutoConnectReconnectContext) {
			pendingReconnectContext = next;
			activeReconnectContext = null;
		},
		getReconnectContextForReconnectAttempt() {
			if (pendingReconnectContext !== null) {
				activeReconnectContext = pendingReconnectContext;
			}
			return activeReconnectContext ?? undefined;
		},
		settleReconnectAttempt(
			result: AutoConnectReconnectAttemptResult | boolean,
		) {
			if (!reconnectAttemptIsTerminal(result)) return;
			pendingReconnectContext = null;
			activeReconnectContext = null;
		},
		clearReconnectContext() {
			pendingReconnectContext = null;
			activeReconnectContext = null;
		},
	};
}

type ReconnectContextCycleState = ReturnType<
	typeof createReconnectContextCycleState
>;

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
}): AutoConnectReconnectContext | undefined {
	const droppedShell = pickLatestShellSnapshot(shells);
	if (!droppedShell) return undefined;
	const droppedConnection = connections[droppedShell.connectionId];
	return {
		trigger: 'reconnect',
		pathname,
		droppedConnectionId: droppedShell.connectionId,
		droppedChannelId: droppedShell.channelId,
		droppedStoredConnectionId: droppedConnection
			? getStoredConnectionId(droppedConnection.connectionDetails)
			: undefined,
	};
}

export function installPendingReconnectContext({
	reconnectContextState,
	pathname,
	shells,
	connections,
}: {
	reconnectContextState: ReconnectContextCycleState;
	pathname: string;
	shells: ShellSnapshot[];
	connections: Record<string, ConnectionSnapshot | undefined>;
}) {
	const reconnectContext = buildPendingReconnectContext({
		pathname,
		shells,
		connections,
	});
	if (reconnectContext) {
		reconnectContextState.replacePendingReconnectContext(reconnectContext);
		return;
	}
	reconnectContextState.clearReconnectContext();
}
