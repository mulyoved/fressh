import {
	attemptSavedEntryWithTailscaleRecovery,
	type SavedEntryTailscaleRecovery,
} from './auto-connect-saved-entry';
import { formatConnectionDiagnosticPrompt } from './connection-diagnostic-prompt';
import { serializeConnectionDiagnosticError } from './connection-diagnostic-redaction';
import {
	type ConnectionDiagnosticAppState,
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticRecorder,
	type ConnectionDiagnosticTrace,
	type ConnectionDiagnosticTraceHandle,
} from './connection-diagnostic-types';
import { type SavedConnectionEntry } from './connection-utils';
import {
	isDiagnosticShellCleanupError,
	type DiagnosticShellProbeResult,
} from './diagnostic-shell-probe';
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
	}) => Promise<DiagnosticShellProbeResult>;
	recovery: SavedEntryTailscaleRecovery;
	formatPrompt?: typeof formatConnectionDiagnosticPrompt;
	timeoutMs?: number;
};

const DEFAULT_MANUAL_DIAGNOSTIC_TIMEOUT_MS = 60_000;

let running = false;
let activeTraceHandle: ConnectionDiagnosticTraceHandle | null = null;
let activeRunToken: symbol | null = null;

class ManualDiagnosticTimeoutError extends Error {
	constructor(readonly timeoutMs: number) {
		super(`Connection diagnostic timed out after ${timeoutMs}ms`);
		this.name = 'ManualDiagnosticTimeoutError';
	}
}

async function withManualDiagnosticTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timeoutId = setTimeout(() => {
					timeoutId = null;
					reject(new ManualDiagnosticTimeoutError(timeoutMs));
				}, timeoutMs);
				const maybeNodeTimer = timeoutId as ReturnType<typeof setTimeout> & {
					unref?: () => void;
				};
				maybeNodeTimer.unref?.();
			}),
		]);
	} finally {
		if (timeoutId !== null) clearTimeout(timeoutId);
	}
}

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
	const runToken = Symbol('manual-connection-diagnostic');
	activeRunToken = runToken;
	let handle: ConnectionDiagnosticTraceHandle | null = null;
	const ensureCurrentRun = () => {
		if (activeRunToken !== runToken) {
			throw new Error('Connection diagnostic run is no longer active');
		}
	};

	try {
		return await withManualDiagnosticTimeout(
			(async () => {
				handle = args.recorder.startTrace({
					trigger: 'manual-diagnostic',
					reason: 'command-menu',
				});
				activeTraceHandle = handle;
				const traceHandle = handle;
				const latestEntry = await args.loadLatestSavedConnection();
				ensureCurrentRun();
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
				const connection = getConnectionIdentity(
					latestEntry.id,
					normalizedDetails,
				);
				safeTraceEvent(traceHandle, {
					type: 'manual-diagnostic.saved-entry.selected',
					source: 'manual-diagnostic',
					connection,
				});

				const resolvedSecurity = await args.resolveKeySecurity(details);
				ensureCurrentRun();
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
						Promise.resolve()
							.then(ensureCurrentRun)
							.then(() =>
								args.connectSavedEntry({
									connectionDetails: normalizedDetails,
									resolvedSecurity,
									trace: traceHandle,
								}),
							),
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
					shouldRecoverAfterFailure: (error) =>
						!isDiagnosticShellCleanupError(error),
					trace: traceHandle,
				});

				return finish(
					traceHandle,
					result.connected ? 'connected' : 'failed',
					args,
				);
			})(),
			args.timeoutMs ?? DEFAULT_MANUAL_DIAGNOSTIC_TIMEOUT_MS,
		);
	} catch (error) {
		if (!handle) {
			throw error;
		}
		const isTimeout = error instanceof ManualDiagnosticTimeoutError;
		if (isTimeout) {
			safeTraceEvent(handle, {
				type: 'manual-diagnostic.timeout',
				source: 'manual-diagnostic',
				message: error.message,
				details: { timeoutMs: error.timeoutMs },
			});
			return finish(handle, 'failed', args);
		}
		safeTraceEvent(handle, {
			type: 'manual-diagnostic.failed',
			source: 'manual-diagnostic',
			error: serializeConnectionDiagnosticError(error),
		});
		return finish(handle, 'failed', args);
	} finally {
		if (activeRunToken === runToken) {
			activeTraceHandle = null;
			activeRunToken = null;
			running = false;
		}
	}
}
