import {
	type AutoConnectAttemptSourceArgs,
	attemptAutoConnectSource as attemptAutoConnectSourceBase,
} from '../../src/lib/auto-connect-attempt';
import { createConnectionRunContext } from '../../src/lib/connection-run-context';
import {
	pickLatestConnection,
	type SavedConnectionEntry,
} from '../../src/lib/connection-utils';
import type { InputConnectionDetails } from '../../src/lib/secrets-manager';

export type OpenSavedEntryShellArgs = {
	connectionDetails: InputConnectionDetails;
	resolvedSecurity: {
		type: 'key';
		privateKey: string;
	};
	navigate: (params: { connectionId: string; channelId: number }) => void;
};

export const baseDetails: InputConnectionDetails = {
	username: 'muly',
	host: 'host.example',
	port: 22,
	useTmux: true,
	tmuxSessionName: 'main',
	autoConnect: true,
	security: { type: 'key', keyId: 'key-1' },
};

export function createLogger() {
	const calls: unknown[] = [];
	return {
		calls,
		logger: {
			info: (...args: unknown[]) => {
				calls.push(['info', ...args]);
			},
			warn: (...args: unknown[]) => {
				calls.push(['warn', ...args]);
			},
		},
	};
}

export function createSavedEntry(
	value: SavedConnectionEntry['value'] = baseDetails,
): SavedConnectionEntry {
	return {
		id: 'saved-1',
		metadata: {
			createdAtMs: 1,
			modifiedAtMs: 2,
			priority: 0,
		},
		value,
	};
}

export function createSavedEntryWithId(
	id: string,
	value: SavedConnectionEntry['value'],
): SavedConnectionEntry {
	return {
		...createSavedEntry(value),
		id,
	};
}

export function activeConnectionFixture(overrides: {
	connectionId: string;
	host: string;
	connectedAtMs?: number;
	startShell: AutoConnectAttemptSourceArgs['connections'][string]['startShell'];
}): AutoConnectAttemptSourceArgs['connections'][string] {
	return {
		connectionId: overrides.connectionId,
		connectionDetails: {
			...baseDetails,
			host: overrides.host,
		},
		connectedAtMs: overrides.connectedAtMs ?? 10,
		startShell: overrides.startShell,
	};
}

export function createAutoConnectRunContext(callerSignal?: AbortSignal) {
	return createConnectionRunContext({
		callerSignal,
		timeouts: {
			operationTimeoutMs: 60_000,
			recoveryTimeoutMs: 60_000,
			cleanupTimeoutMs: 5_000,
		},
	});
}

type LegacyAttemptSourceArgs = Omit<
	AutoConnectAttemptSourceArgs,
	'loadLatestSavedConnection' | 'loadSavedConnections' | 'runContext'
> & {
	loadLatestSavedConnection?: AutoConnectAttemptSourceArgs['loadLatestSavedConnection'];
	loadSavedConnections?: AutoConnectAttemptSourceArgs['loadSavedConnections'];
	loadLatestSavedAutoConnectConnection?: () => Promise<
		SavedConnectionEntry | null
	>;
	runContext?: AutoConnectAttemptSourceArgs['runContext'];
	abortSignal?: AbortSignal;
};

async function loadSavedConnectionsForTest({
	loadSavedConnections,
	loadLatestSavedConnection,
	loadLatestSavedAutoConnectConnection,
}: Pick<
	LegacyAttemptSourceArgs,
	| 'loadSavedConnections'
	| 'loadLatestSavedConnection'
	| 'loadLatestSavedAutoConnectConnection'
>): Promise<SavedConnectionEntry[] | null> {
	if (loadSavedConnections) return await loadSavedConnections();
	const entries = [
		(await loadLatestSavedConnection?.()) ?? null,
		(await loadLatestSavedAutoConnectConnection?.()) ?? null,
	].filter((entry): entry is SavedConnectionEntry => entry !== null);
	if (entries.length === 0) return null;
	return Array.from(new Map(entries.map((entry) => [entry.id, entry])).values());
}

export async function attemptAutoConnectSource(args: LegacyAttemptSourceArgs) {
	const runContext =
		args.runContext ?? createAutoConnectRunContext(args.abortSignal);
	try {
		const {
			abortSignal: _abortSignal,
			loadSavedConnections,
			loadLatestSavedConnection,
			loadLatestSavedAutoConnectConnection,
			...sourceArgs
		} = args;
		return await attemptAutoConnectSourceBase({
			...sourceArgs,
			loadLatestSavedConnection:
				loadLatestSavedConnection ??
				(async () =>
					pickLatestConnection(
						await loadSavedConnectionsForTest({
							loadSavedConnections,
							loadLatestSavedConnection,
							loadLatestSavedAutoConnectConnection,
						}),
					)),
			loadSavedConnections: async () =>
				await loadSavedConnectionsForTest({
					loadSavedConnections,
					loadLatestSavedConnection,
					loadLatestSavedAutoConnectConnection,
				}),
			runContext,
		});
	} finally {
		if (!args.runContext) {
			runContext.finish();
		}
	}
}

export function eventKinds(events: unknown[]) {
	return events.map((event) => (event as { kind: string }).kind);
}

export function createTaggedError(message: string, tag: string) {
	const error = new Error(message) as Error & { tag: string };
	error.tag = tag;
	return error;
}

export const unsupportedRecovery = {
	ensureReady: async () => ({
		kind: 'unsupported' as const,
		attempted: false as const,
		available: false as const,
	}),
	recoverAfterFailure: async () => ({
		kind: 'nonNetworkFailure' as const,
		attempted: false as const,
		networkLikeFailure: false as const,
		available: true,
	}),
};

export const readyRecovery = {
	ensureReady: async () => ({
		kind: 'ready' as const,
		attempted: true as const,
		available: true as const,
	}),
	recoverAfterFailure: async () => ({
		kind: 'nonNetworkFailure' as const,
		attempted: false as const,
		networkLikeFailure: false as const,
		available: true,
	}),
};
