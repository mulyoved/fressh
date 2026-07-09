import {
	type SavedEntryConnectAttemptPhase,
	type SavedEntryConnectResult,
	type SavedEntryTailscaleRecovery,
} from './auto-connect-saved-entry';
import {
	runSavedEntryConnectionAttempt,
	type SavedEntryConnectionAttemptOutcome,
} from './connection-attempt-lifecycle';
import { type ConnectionDiagnosticEvent } from './connection-diagnostic-types';
import {
	buildSavedEntryIdentity,
	savedEntryEvents,
} from './connection-diagnostics/events';
import {
	type ConnectionRunContext,
	type ConnectionRunOperationResult,
} from './connection-run-context';
import { type SavedConnectionEntry } from './connection-utils';
import { createSavedEntryTailscaleDiagnosticRecovery } from './saved-entry-tailscale-diagnostic-recovery';
// eslint-disable-next-line import/consistent-type-specifier-style -- keep secrets-manager fully type-only so Node integration tests do not load React Native at runtime
import type {
	InputConnectionDetails,
	StoredConnectionDetails,
} from './secrets-manager';

export type PreparedSavedEntryAttempt = {
	latestEntryConnection: ReturnType<typeof buildSavedEntryIdentity>;
	normalizedDetails: InputConnectionDetails;
	details: SavedConnectionEntry['value'];
};

export type ResolvedKeySecurity = {
	type: 'key';
	privateKey: string;
};

export type OpenSavedEntryShell = (args: {
	connectionDetails: InputConnectionDetails;
	resolvedSecurity: ResolvedKeySecurity;
	navigate: (params: { connectionId: string; channelId: number }) => void;
	abortSignal?: AbortSignal;
}) => Promise<SavedEntryConnectResult>;

export type Logger = {
	info: (message: string, data?: unknown) => void;
	warn: (message: string, error: unknown) => void;
};

export function prepareSavedEntryAttempt({
	latestEntry,
	traceEvent,
}: {
	latestEntry: SavedConnectionEntry;
	traceEvent: (event: ConnectionDiagnosticEvent) => void;
}): PreparedSavedEntryAttempt | null {
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
		return null;
	}
	return {
		latestEntryConnection,
		details,
		normalizedDetails: {
			...details,
			useTmux: details.useTmux,
			tmuxSessionName: details.tmuxSessionName,
			autoConnect: details.autoConnect ?? false,
		},
	};
}

export async function resolvePreparedSavedEntrySecurity({
	runContext,
	prepared,
	resolveKeySecurity,
	traceEvent,
}: {
	runContext: ConnectionRunContext;
	prepared: PreparedSavedEntryAttempt;
	resolveKeySecurity: (
		details: StoredConnectionDetails,
	) => Promise<ResolvedKeySecurity | null>;
	traceEvent: (event: ConnectionDiagnosticEvent) => void;
}): Promise<ConnectionRunOperationResult<ResolvedKeySecurity | null>> {
	const resolvedSecurityResult = await runContext.runOperation(
		'operation',
		async () => await resolveKeySecurity(prepared.details),
	);
	if (resolvedSecurityResult.status === 'aborted') {
		return resolvedSecurityResult;
	}
	if (!resolvedSecurityResult.value) {
		traceEvent(
			savedEntryEvents.keyMissing({
				source: 'saved-entry',
				connection: prepared.latestEntryConnection,
			}),
		);
		return resolvedSecurityResult;
	}
	traceEvent(
		savedEntryEvents.keyResolved({
			source: 'saved-entry',
			connection: prepared.latestEntryConnection,
		}),
	);
	return resolvedSecurityResult;
}

export async function runPreparedSavedEntryAttempt({
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
	traceConnectStart,
	traceConnectThrow,
}: {
	platformOS: string;
	runContext: ConnectionRunContext;
	recovery: SavedEntryTailscaleRecovery;
	traceEvent: (event: ConnectionDiagnosticEvent) => void;
	prepared: PreparedSavedEntryAttempt;
	resolvedSecurity: ResolvedKeySecurity;
	openSavedEntryShell: OpenSavedEntryShell;
	navigateToShell: (connectionId: string, channelId: number) => void;
	logger: Logger;
	isAborted: () => boolean;
	traceConnectStart: (
		phase: SavedEntryConnectAttemptPhase,
		prepared: PreparedSavedEntryAttempt,
	) => void;
	traceConnectThrow: (
		phase: SavedEntryConnectAttemptPhase,
		prepared: PreparedSavedEntryAttempt,
		error: unknown,
	) => void;
}): Promise<SavedEntryConnectionAttemptOutcome> {
	let didNavigate = false;
	const connectSavedEntry = (signal?: AbortSignal) =>
		openSavedEntryShell({
			connectionDetails: prepared.normalizedDetails,
			resolvedSecurity,
			navigate: ({ connectionId, channelId }) => {
				if (isAborted()) return;
				didNavigate = true;
				navigateToShell(connectionId, channelId);
			},
			abortSignal: signal,
		});
	const tracedConnectSavedEntry = async (
		phase: SavedEntryConnectAttemptPhase,
		signal?: AbortSignal,
	) => {
		traceConnectStart(phase, prepared);
		try {
			return await connectSavedEntry(signal);
		} catch (error) {
			traceConnectThrow(phase, prepared, error);
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
	if (result.status === 'connected' && !didNavigate && !isAborted()) {
		didNavigate = true;
		navigateToShell(result.connectionId, result.channelId);
	}
	return result;
}
