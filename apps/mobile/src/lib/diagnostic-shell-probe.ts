// eslint-disable-next-line import/consistent-type-specifier-style -- Pure type import keeps Node integration tests from loading React Native.
import type {
	ConnectionDetails,
	RnRussh,
	SshConnection,
	SshConnectionProgress,
} from '@fressh/react-native-uniffi-russh';
import { type SavedEntryConnectResult } from './auto-connect-saved-entry';
import { type ConnectionDiagnosticEvent } from './connection-diagnostic-types';
import {
	serializeConnectionDiagnosticError,
	sshEvents,
} from './connection-diagnostics/events';
import { type InputConnectionDetails } from './connection-storage';
import { getStoredConnectionId } from './connection-utils';
import { rootLogger } from './logger';
import { connectWithoutRemembering } from './ssh-connect-flow';
import {
	getSshShellLifecycleConnectionIdentity,
	runSshShellLifecycle,
	type SshShellLifecycleOperationSignals,
} from './ssh-shell-lifecycle';
import { AbortSignalAny, AbortSignalTimeout } from './utils';

const logger = rootLogger.extend('DiagnosticShellProbe');
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

export type DiagnosticShellProbeResult = SavedEntryConnectResult;

type ProbeTrace = {
	event: (event: ConnectionDiagnosticEvent) => void;
};

type DiagnosticShellProbeOperationSignals =
	SshShellLifecycleOperationSignals & {
		cleanup?: AbortSignal;
	};

export class DiagnosticShellCleanupError extends Error {
	constructor(readonly cleanupError: unknown) {
		super(
			cleanupError instanceof Error
				? `Diagnostic SSH cleanup failed: ${cleanupError.message}`
				: 'Diagnostic SSH cleanup failed',
		);
		this.name = 'DiagnosticShellCleanupError';
	}
}

export function isDiagnosticShellCleanupError(
	error: unknown,
): error is DiagnosticShellCleanupError {
	return error instanceof DiagnosticShellCleanupError;
}

function diagnosticDisconnectTimeoutError(timeoutMs: number) {
	return new Error(`Diagnostic SSH disconnect timed out after ${timeoutMs}ms`);
}

async function withDiagnosticDisconnectTimeout<T>(
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
					reject(diagnosticDisconnectTimeoutError(timeoutMs));
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

export async function runDiagnosticShellProbe(args: {
	connectionDetails: InputConnectionDetails;
	connect: typeof RnRussh.connect;
	resolvedSecurity: ConnectionDetails['security'];
	onConnectionProgress?: (progressEvent: SshConnectionProgress) => void;
	abortSignalTimeoutMs?: number;
	operationSignals?: DiagnosticShellProbeOperationSignals;
	trace?: ProbeTrace;
}): Promise<DiagnosticShellProbeResult> {
	const {
		connectionDetails,
		connect,
		resolvedSecurity,
		onConnectionProgress,
		abortSignalTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
		operationSignals,
	} = args;
	const traceEvent = (event: ConnectionDiagnosticEvent) => {
		try {
			args.trace?.event(event);
		} catch (error) {
			logger.warn('Diagnostic probe trace event failed', error);
		}
	};
	const storedConnectionId = getStoredConnectionId(connectionDetails);

	const cleanupDiagnosticConnection = async (sshConnection: SshConnection) => {
		const connectedIdentity = {
			...getSshShellLifecycleConnectionIdentity(connectionDetails),
			connectionId: sshConnection.connectionId,
		};
		try {
			const disconnectSignal = operationSignals?.cleanup
				? AbortSignalAny([
						operationSignals.cleanup,
						AbortSignalTimeout(abortSignalTimeoutMs),
					])
				: AbortSignalTimeout(abortSignalTimeoutMs);
			await withDiagnosticDisconnectTimeout(
				Promise.resolve(
					sshConnection.disconnect?.({
						signal: disconnectSignal,
					}),
				),
				abortSignalTimeoutMs,
			);
			traceEvent(
				sshEvents.diagnosticDisconnected({
					source: 'saved-entry',
					connection: connectedIdentity,
				}),
			);
			return null;
		} catch (error) {
			traceEvent(
				sshEvents.diagnosticDisconnectFailed({
					source: 'saved-entry',
					connection: connectedIdentity,
					error: serializeConnectionDiagnosticError(error),
				}),
			);
			return error;
		}
	};

	const result = await runSshShellLifecycle({
		connectionDetails,
		abortSignalTimeoutMs,
		registerInStore: false,
		traceEvent,
		onConnectionProgress,
		operationSignals,
		connectConnection: async ({ onConnectionProgress, connectSignal }) => {
			const sshConnection = await connectWithoutRemembering({
				connectionDetails,
				connect,
				onConnectionProgress,
				abortSignalTimeoutMs,
				connectSignal,
				resolvedSecurity,
			});
			return { sshConnection, storedConnectionId };
		},
		afterConnectAbort: async ({ sshConnection }) => {
			await cleanupDiagnosticConnection(sshConnection);
		},
		afterShellFailure: async ({ sshConnection }) => {
			await cleanupDiagnosticConnection(sshConnection);
		},
	});

	if (result.status === 'tmux_attach_failed') return result;

	const cleanupError = await cleanupDiagnosticConnection(result.sshConnection);
	if (cleanupError !== null) {
		throw new DiagnosticShellCleanupError(cleanupError);
	}

	return {
		status: 'connected',
		connectionId: result.connectionId,
		channelId: result.channelId,
	};
}
