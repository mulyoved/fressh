import {
	attemptSavedEntryWithTailscaleRecovery,
	type SavedEntryConnectAttemptPhase,
	type SavedEntryConnectResult,
	type SavedEntryTailscaleRecovery,
} from './auto-connect-saved-entry';
import { formatConnectionDiagnosticPrompt } from './connection-diagnostic-prompt';
import {
	type ConnectionDiagnosticAppState,
	type ConnectionDiagnosticRecorder,
	type ConnectionDiagnosticTrace,
	type ConnectionDiagnosticTraceHandle,
} from './connection-diagnostic-types';
import {
	buildSavedEntryIdentity,
	manualDiagnosticEvents,
	savedEntryEvents,
} from './connection-diagnostics/events';
import {
	createConnectionRunContext,
	type ConnectionRunContext,
} from './connection-run-context';
import { type SavedConnectionEntry } from './connection-utils';
import { isDiagnosticShellCleanupError } from './diagnostic-shell-probe';
import { createSavedEntryTailscaleDiagnosticRecovery } from './saved-entry-tailscale-diagnostic-recovery';
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
		signal: AbortSignal;
	}) => Promise<SavedEntryConnectResult>;
	recovery: SavedEntryTailscaleRecovery;
	formatPrompt?: typeof formatConnectionDiagnosticPrompt;
	timeoutMs?: number;
};

const DEFAULT_MANUAL_DIAGNOSTIC_TIMEOUT_MS = 60_000;

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

type ManualConnectionDiagnosticRunnerState = {
	running: boolean;
	activeTraceHandle: ConnectionDiagnosticTraceHandle | null;
	activeRunToken: symbol | null;
};

type ManualConnectionDiagnosticAttemptContext = {
	setHandle: (next: ConnectionDiagnosticTraceHandle) => void;
	ensureCurrentRun: () => void;
	runContext: ConnectionRunContext;
	signal: AbortSignal;
};

async function runManualConnectionDiagnosticAttempt(
	args: ManualConnectionDiagnosticArgs,
	state: ManualConnectionDiagnosticRunnerState,
	{
		setHandle,
		ensureCurrentRun,
		runContext,
		signal,
	}: ManualConnectionDiagnosticAttemptContext,
): Promise<ManualConnectionDiagnosticResult> {
	const traceHandle = args.recorder.startTrace({
		trigger: 'manual-diagnostic',
		reason: 'command-menu',
	});
	setHandle(traceHandle);
	state.activeTraceHandle = traceHandle;
	const latestEntry = await args.loadLatestSavedConnection();
	ensureCurrentRun();
	if (!latestEntry) {
		safeTraceEvent(
			traceHandle,
			manualDiagnosticEvents.savedEntryMissing({
				source: 'manual-diagnostic',
				message: 'No eligible saved auto-connect connection was found.',
			}),
		);
		return finish(traceHandle, 'skipped', args);
	}

	const details = latestEntry.value;
	const normalizedDetails: InputConnectionDetails = {
		...details,
		useTmux: details.useTmux ?? true,
		tmuxSessionName: details.tmuxSessionName?.trim() || 'main',
		autoConnect: details.autoConnect ?? false,
	};
	const connection = buildSavedEntryIdentity(latestEntry.id, normalizedDetails);
	safeTraceEvent(
		traceHandle,
		savedEntryEvents.selected({
			source: 'manual-diagnostic',
			connection,
		}),
	);

	const resolvedSecurity = await args.resolveKeySecurity(details);
	ensureCurrentRun();
	if (!resolvedSecurity) {
		safeTraceEvent(
			traceHandle,
			savedEntryEvents.keyMissing({
				source: 'manual-diagnostic',
				connection,
			}),
		);
		return finish(traceHandle, 'failed', args);
	}

	safeTraceEvent(
		traceHandle,
		savedEntryEvents.keyResolved({
			source: 'manual-diagnostic',
			connection,
		}),
	);

	const tracedRecovery = createSavedEntryTailscaleDiagnosticRecovery({
		platformOS: args.appState.platformOS,
		recovery: args.recovery,
		emit: (event) => safeTraceEvent(traceHandle, event),
	});
	const tracedConnectSavedEntry = async (
		phase: SavedEntryConnectAttemptPhase,
	) => {
		try {
			runContext.throwIfAborted();
			return await Promise.resolve()
				.then(ensureCurrentRun)
				.then(() =>
					args.connectSavedEntry({
						connectionDetails: normalizedDetails,
						resolvedSecurity,
						trace: traceHandle,
						signal,
					}),
				);
		} catch (error) {
			safeTraceEvent(
				traceHandle,
				manualDiagnosticEvents.warning({
					source: 'manual-diagnostic',
					message:
						phase === 'retry'
							? 'Saved-entry retry threw.'
							: 'Saved-entry connection threw.',
					error,
				}),
			);
			throw error;
		}
	};

	const result = await attemptSavedEntryWithTailscaleRecovery({
		platformOS: args.appState.platformOS,
		recovery: tracedRecovery,
		connectSavedEntry: tracedConnectSavedEntry,
		shouldRecoverAfterFailure: (error) =>
			runContext.abortReason === null && !isDiagnosticShellCleanupError(error),
	});
	runContext.throwIfAborted();
	ensureCurrentRun();

	switch (result.status) {
		case 'connected':
			return finish(traceHandle, 'connected', args);
		case 'tmuxAttachFailed':
			safeTraceEvent(
				traceHandle,
				manualDiagnosticEvents.tmuxAttachFailed({
					source: 'manual-diagnostic',
					connection,
					tmuxAttachFailureReason: result.result.tmuxAttachFailureReason,
				}),
			);
			return finish(traceHandle, 'failed', args);
		case 'aborted':
			throw result.result.reason instanceof Error
				? result.result.reason
				: new Error('Saved-entry connection aborted');
		case 'blocked':
		case 'recoveryNotAttempted':
		case 'retryFailed':
			if (result.attentionMessage !== null) {
				safeTraceEvent(
					traceHandle,
					manualDiagnosticEvents.tailscaleAttention({
						source: 'tailscale-recovery',
						message: result.attentionMessage,
					}),
				);
			}
			return finish(traceHandle, 'failed', args);
		case 'threw':
			throw result.error;
	}
}

async function runManualConnectionDiagnosticWithState(
	args: ManualConnectionDiagnosticArgs,
	state: ManualConnectionDiagnosticRunnerState,
): Promise<ManualConnectionDiagnosticResult> {
	if (state.running) {
		const latestTrace =
			state.activeTraceHandle?.trace ?? args.recorder.getLatestTrace();
		const prompt = [
			'A Fressh connection diagnostic is already running. Try again after it finishes.',
			latestTrace ? promptForTrace(latestTrace, args) : null,
		]
			.filter(Boolean)
			.join('\n\n');
		return { status: 'busy', prompt, trace: latestTrace };
	}

	state.running = true;
	const runToken = Symbol('manual-connection-diagnostic');
	state.activeRunToken = runToken;
	let handle: ConnectionDiagnosticTraceHandle | null = null;
	const ensureCurrentRun = () => {
		if (state.activeRunToken !== runToken) {
			throw new Error('Connection diagnostic run is no longer active');
		}
	};
	const timeoutMs = args.timeoutMs ?? DEFAULT_MANUAL_DIAGNOSTIC_TIMEOUT_MS;
	const runContext = createConnectionRunContext({
		callerSignal: undefined,
		isCurrent: () => state.activeRunToken === runToken,
		timeouts: {
			operationTimeoutMs: timeoutMs,
		},
	});

	try {
		const operation = await runContext.runOperation('operation', (signal) =>
			runManualConnectionDiagnosticAttempt(args, state, {
				setHandle: (next) => {
					handle = next;
				},
				ensureCurrentRun,
				runContext,
				signal,
			}),
		);
		if (operation.status === 'aborted' && operation.reason === 'timeout') {
			throw new Error(`Connection diagnostic timed out after ${timeoutMs}ms`);
		}
		if (operation.status === 'aborted') {
			throw new Error(`Connection diagnostic aborted: ${operation.reason}`);
		}
		return operation.value;
	} catch (error) {
		if (!handle) {
			throw error;
		}
		const isTimeout = runContext.abortReason === 'timeout';
		if (isTimeout) {
			safeTraceEvent(
				handle,
				manualDiagnosticEvents.timeout({
					timeoutMs,
					message: `Connection diagnostic timed out after ${timeoutMs}ms`,
				}),
			);
			return finish(handle, 'failed', args);
		}
		safeTraceEvent(
			handle,
			manualDiagnosticEvents.failed({
				source: 'manual-diagnostic',
				error,
			}),
		);
		return finish(handle, 'failed', args);
	} finally {
		runContext.finish();
		if (state.activeRunToken === runToken) {
			state.activeTraceHandle = null;
			state.activeRunToken = null;
			state.running = false;
		}
	}
}

export type ManualConnectionDiagnosticRunner = {
	run: (
		args: ManualConnectionDiagnosticArgs,
	) => Promise<ManualConnectionDiagnosticResult>;
};

export function createManualConnectionDiagnosticRunner(): ManualConnectionDiagnosticRunner {
	const state: ManualConnectionDiagnosticRunnerState = {
		running: false,
		activeTraceHandle: null,
		activeRunToken: null,
	};
	return {
		run: (args) => runManualConnectionDiagnosticWithState(args, state),
	};
}

export const manualConnectionDiagnosticRunner =
	createManualConnectionDiagnosticRunner();

export function runManualConnectionDiagnostic(
	args: ManualConnectionDiagnosticArgs,
): Promise<ManualConnectionDiagnosticResult> {
	return manualConnectionDiagnosticRunner.run(args);
}
