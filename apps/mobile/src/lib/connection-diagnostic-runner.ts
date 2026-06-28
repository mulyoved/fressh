import { attemptSavedEntryWithTailscaleRecovery } from './auto-connect-saved-entry';
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
	recovery: Parameters<
		typeof attemptSavedEntryWithTailscaleRecovery
	>[0]['recovery'];
	formatPrompt?: typeof formatConnectionDiagnosticPrompt;
};

let running = false;

function getConnectionIdentity(
	id: string,
	details: SavedConnectionEntry['value'],
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
	handle.finish(status);
	const trace = handle.trace;
	return {
		status,
		trace,
		prompt: promptForTrace(trace, args),
	};
}

export async function runManualConnectionDiagnostic(
	args: ManualConnectionDiagnosticArgs,
): Promise<ManualConnectionDiagnosticResult> {
	if (running) {
		const latestTrace = args.recorder.getLatestTrace();
		const prompt = [
			'A Fressh connection diagnostic is already running. Try again after it finishes.',
			latestTrace ? promptForTrace(latestTrace, args) : null,
		]
			.filter(Boolean)
			.join('\n\n');
		return { status: 'busy', prompt, trace: latestTrace };
	}

	running = true;
	const handle = args.recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'command-menu',
	});

	try {
		const latestEntry = await args.loadLatestSavedConnection();
		if (!latestEntry) {
			handle.event({
				type: 'manual-diagnostic.saved-entry.missing',
				source: 'manual-diagnostic',
				message: 'No eligible saved auto-connect connection was found.',
			});
			return finish(handle, 'skipped', args);
		}

		const details = latestEntry.value;
		const connection = getConnectionIdentity(latestEntry.id, details);
		handle.event({
			type: 'manual-diagnostic.saved-entry.selected',
			source: 'manual-diagnostic',
			connection,
		});

		const resolvedSecurity = await args.resolveKeySecurity(details);
		if (!resolvedSecurity) {
			handle.event({
				type: 'manual-diagnostic.key-missing',
				source: 'manual-diagnostic',
				connection,
			});
			return finish(handle, 'failed', args);
		}

		handle.event({
			type: 'manual-diagnostic.key-resolved',
			source: 'manual-diagnostic',
			connection,
		});

		const normalizedDetails: InputConnectionDetails = {
			...details,
			useTmux: details.useTmux ?? true,
			tmuxSessionName: details.tmuxSessionName?.trim() || 'main',
			autoConnect: details.autoConnect ?? false,
		};

		const result = await attemptSavedEntryWithTailscaleRecovery({
			platformOS: args.appState.platformOS,
			recovery: args.recovery,
			connectSavedEntry: () =>
				args.connectSavedEntry({
					connectionDetails: normalizedDetails,
					resolvedSecurity,
					trace: handle,
				}),
			markTailscaleAttention: (message) => {
				handle.event({
					type: 'manual-diagnostic.tailscale.attention',
					source: 'tailscale-recovery',
					message,
				});
			},
			clearTailscaleAttention: () => {
				handle.event({
					type: 'manual-diagnostic.tailscale.attention-cleared',
					source: 'tailscale-recovery',
				});
			},
			logTmuxAttachFailure: (tmuxResult) => {
				handle.event({
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
				handle.event({
					type: 'manual-diagnostic.warning',
					source: 'manual-diagnostic',
					message,
					error: serializeConnectionDiagnosticError(error),
				});
			},
			trace: handle,
		});

		return finish(handle, result.connected ? 'connected' : 'failed', args);
	} catch (error) {
		handle.event({
			type: 'manual-diagnostic.failed',
			source: 'manual-diagnostic',
			error: serializeConnectionDiagnosticError(error),
		});
		return finish(handle, 'failed', args);
	} finally {
		running = false;
	}
}
