import {
	attemptSavedEntryWithTailscaleRecovery,
	type SavedEntryTailscaleRecovery,
} from './auto-connect-saved-entry';
import {
	formatConnectionDiagnosticPrompt,
	serializeConnectionDiagnosticError,
	type ConnectionDiagnosticAppState,
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticRecorder,
	type ConnectionDiagnosticTrace,
	type ConnectionDiagnosticTraceHandle,
} from './connection-diagnostics';
import { type SavedConnectionEntry } from './connection-utils';
// eslint-disable-next-line import/consistent-type-specifier-style -- keep query-fns type-only so Node integration tests do not load React Native at runtime
import type { ConnectAndOpenShellResult } from './query-fns';
// eslint-disable-next-line import/consistent-type-specifier-style -- keep secrets-manager type-only so Node integration tests do not load React Native at runtime
import type { InputConnectionDetails } from './secrets-manager';

type ResolvedKeySecurity = {
	type: 'key';
	privateKey: string;
};

export type ManualConnectionDiagnosticResult = {
	status: 'connected' | 'failed' | 'skipped' | 'busy';
	prompt: string;
	trace: ConnectionDiagnosticTrace | null;
};

export type ManualConnectionDiagnosticArgs = {
	recorder: ConnectionDiagnosticRecorder;
	appState: ConnectionDiagnosticAppState;
	loadLatestSavedConnection: () => Promise<SavedConnectionEntry | null>;
	resolveKeySecurity: (
		details: SavedConnectionEntry['value'],
	) => Promise<ResolvedKeySecurity | null>;
	connectSavedEntry: (args: {
		connectionDetails: InputConnectionDetails;
		resolvedSecurity: ResolvedKeySecurity;
		trace: ConnectionDiagnosticTraceHandle;
	}) => Promise<ConnectAndOpenShellResult>;
	recovery: SavedEntryTailscaleRecovery;
	formatPrompt?: typeof formatConnectionDiagnosticPrompt;
};

let running = false;
let activeTraceHandle: ConnectionDiagnosticTraceHandle | null = null;

function getConnectionIdentity(
	id: string,
	details: InputConnectionDetails,
): ConnectionDiagnosticConnectionIdentity {
	return {
		savedConnectionId: id,
		username: details.username,
		host: details.host,
		port: details.port,
		keyId: details.security.keyId,
		useTmux: details.useTmux,
		tmuxSessionName: details.tmuxSessionName,
	};
}

function promptForTrace(
	trace: ConnectionDiagnosticTrace,
	args: ManualConnectionDiagnosticArgs,
) {
	return (args.formatPrompt ?? formatConnectionDiagnosticPrompt)(trace, {
		appState: args.appState,
	});
}

function finish(
	handle: ConnectionDiagnosticTraceHandle,
	status: 'connected' | 'failed' | 'skipped',
	args: ManualConnectionDiagnosticArgs,
): ManualConnectionDiagnosticResult {
	try {
		handle.finish(status);
	} catch {
		// Diagnostics are best-effort; callers still need a result.
	}
	const trace = handle.trace;
	return {
		status,
		trace,
		prompt: promptForTrace(trace, args),
	};
}

function safeTraceEvent(
	handle: ConnectionDiagnosticTraceHandle,
	event: Parameters<ConnectionDiagnosticTraceHandle['event']>[0],
) {
	try {
		handle.event(event);
	} catch {
		// Diagnostics are best-effort; tracing must not change the diagnostic flow.
	}
}

export async function runManualConnectionDiagnostic(
	args: ManualConnectionDiagnosticArgs,
): Promise<ManualConnectionDiagnosticResult> {
	if (running) {
		const latestTrace =
			activeTraceHandle?.trace ?? args.recorder.getLatestTrace();
		const prompt = [
			'A Fressh connection diagnostic is already running. Try again after it finishes.',
			latestTrace ? promptForTrace(latestTrace, args) : null,
		]
			.filter(Boolean)
			.join('\n\n');
		return { status: 'busy', prompt, trace: latestTrace };
	}

	running = true;
	let handle: ConnectionDiagnosticTraceHandle | null = null;

	try {
		handle = args.recorder.startTrace({
			trigger: 'manual-diagnostic',
			reason: 'command-menu',
		});
		activeTraceHandle = handle;
		const traceHandle = handle;
		const latestEntry = await args.loadLatestSavedConnection();
		if (!latestEntry) {
			safeTraceEvent(traceHandle, {
				type: 'manual-diagnostic.saved-entry.missing',
				source: 'manual-diagnostic',
				message: 'No eligible saved auto-connect connection was found.',
			});
			return finish(traceHandle, 'skipped', args);
		}

		const details = latestEntry.value;
		const normalizedDetails: InputConnectionDetails = {
			...details,
			useTmux: details.useTmux ?? true,
			tmuxSessionName: details.tmuxSessionName?.trim() || 'main',
			autoConnect: details.autoConnect ?? false,
		};
		const connection = getConnectionIdentity(latestEntry.id, normalizedDetails);
		safeTraceEvent(traceHandle, {
			type: 'manual-diagnostic.saved-entry.selected',
			source: 'manual-diagnostic',
			connection,
		});

		const resolvedSecurity = await args.resolveKeySecurity(details);
		if (!resolvedSecurity) {
			safeTraceEvent(traceHandle, {
				type: 'manual-diagnostic.key-missing',
				source: 'manual-diagnostic',
				connection,
			});
			return finish(traceHandle, 'failed', args);
		}

		safeTraceEvent(traceHandle, {
			type: 'manual-diagnostic.key-resolved',
			source: 'manual-diagnostic',
			connection,
		});

		const result = await attemptSavedEntryWithTailscaleRecovery({
			platformOS: args.appState.platformOS,
			recovery: args.recovery,
			connectSavedEntry: () =>
				args.connectSavedEntry({
					connectionDetails: normalizedDetails,
					resolvedSecurity,
					trace: traceHandle,
				}),
			markTailscaleAttention: (message) => {
				safeTraceEvent(traceHandle, {
					type: 'manual-diagnostic.tailscale.attention',
					source: 'tailscale-recovery',
					message,
				});
			},
			clearTailscaleAttention: () => {
				safeTraceEvent(traceHandle, {
					type: 'manual-diagnostic.tailscale.attention-cleared',
					source: 'tailscale-recovery',
				});
			},
			logTmuxAttachFailure: (tmuxResult) => {
				safeTraceEvent(traceHandle, {
					type: 'manual-diagnostic.tmux-attach-failed',
					source: 'manual-diagnostic',
					connection: {
						connectionId: tmuxResult.connectionId,
						tmuxSessionName: tmuxResult.tmuxSessionName,
					},
					details: {
						tmuxAttachFailureReason: tmuxResult.tmuxAttachFailureReason,
					},
				});
			},
			logWarning: (message, error) => {
				safeTraceEvent(traceHandle, {
					type: 'manual-diagnostic.warning',
					source: 'manual-diagnostic',
					message,
					error: serializeConnectionDiagnosticError(error),
				});
			},
			trace: traceHandle,
		});

		return finish(traceHandle, result.connected ? 'connected' : 'failed', args);
	} catch (error) {
		if (!handle) {
			throw error;
		}
		safeTraceEvent(handle, {
			type: 'manual-diagnostic.failed',
			source: 'manual-diagnostic',
			error: serializeConnectionDiagnosticError(error),
		});
		return finish(handle, 'failed', args);
	} finally {
		activeTraceHandle = null;
		running = false;
	}
}
