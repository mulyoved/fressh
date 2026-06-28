// eslint-disable-next-line import/consistent-type-specifier-style -- Pure type import keeps Node integration tests from loading React Native.
import type {
	ConnectionDetails,
	RnRussh,
	SshConnection,
	SshConnectionProgress,
} from '@fressh/react-native-uniffi-russh';
import { type SavedEntryConnectResult } from './auto-connect-saved-entry';
import {
	serializeConnectionDiagnosticError,
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticEventInput,
} from './connection-diagnostics';
import { type InputConnectionDetails } from './connection-storage';
import { getStoredConnectionId } from './connection-utils';
import { rootLogger } from './logger';
import { connectWithoutRemembering } from './ssh-connect-flow';
import { extractTmuxAttachFailureReason } from './ssh-error-details';
import { type RegisteredStartShellOptions } from './ssh-registry-store';
import { AbortSignalTimeout } from './utils';

const logger = rootLogger.extend('DiagnosticShellProbe');
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

export type DiagnosticShellProbeResult = SavedEntryConnectResult;

type ProbeTrace = {
	event: (event: ConnectionDiagnosticEventInput) => void;
};

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
	trace?: ProbeTrace;
}): Promise<DiagnosticShellProbeResult> {
	const {
		connectionDetails,
		connect,
		resolvedSecurity,
		onConnectionProgress,
		abortSignalTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
	} = args;
	const traceEvent = (event: ConnectionDiagnosticEventInput) => {
		try {
			args.trace?.event(event);
		} catch (error) {
			logger.warn('Diagnostic probe trace event failed', error);
		}
	};
	const connectionIdentity: ConnectionDiagnosticConnectionIdentity = {
		username: connectionDetails.username,
		host: connectionDetails.host,
		port: connectionDetails.port,
		keyId: connectionDetails.security.keyId,
		useTmux: connectionDetails.useTmux,
		tmuxSessionName: connectionDetails.tmuxSessionName,
	};
	const storedConnectionId = getStoredConnectionId(connectionDetails);

	traceEvent({
		type: 'ssh.connect.started',
		source: 'saved-entry',
		connection: connectionIdentity,
	});

	let sshConnection: SshConnection;
	try {
		sshConnection = await connectWithoutRemembering({
			connectionDetails,
			connect,
			onConnectionProgress: (progressEvent) => {
				traceEvent({
					type: 'ssh.connect.progress',
					source: 'saved-entry',
					connection: connectionIdentity,
					details: { progressEvent },
				});
				onConnectionProgress?.(progressEvent);
			},
			abortSignalTimeoutMs,
			resolvedSecurity,
		});
	} catch (error) {
		traceEvent({
			type: 'ssh.connect.failed',
			source: 'saved-entry',
			connection: connectionIdentity,
			error: serializeConnectionDiagnosticError(error),
		});
		throw error;
	}

	const connectedIdentity = {
		...connectionIdentity,
		connectionId: sshConnection.connectionId,
	};
	traceEvent({
		type: 'ssh.connect.connected',
		source: 'saved-entry',
		connection: connectedIdentity,
		details: { storedConnectionId },
	});

	const cleanupDiagnosticConnection = async () => {
		try {
			await withDiagnosticDisconnectTimeout(
				Promise.resolve(
					sshConnection.disconnect?.({
						signal: AbortSignalTimeout(abortSignalTimeoutMs),
					}),
				),
				abortSignalTimeoutMs,
			);
			traceEvent({
				type: 'ssh.diagnostic.disconnected',
				source: 'saved-entry',
				connection: connectedIdentity,
			});
			return null;
		} catch (error) {
			traceEvent({
				type: 'ssh.diagnostic.disconnect-failed',
				source: 'saved-entry',
				connection: connectedIdentity,
				error: serializeConnectionDiagnosticError(error),
			});
			return error;
		}
	};

	let shellHandle: Awaited<ReturnType<typeof sshConnection.startShell>>;
	try {
		traceEvent({
			type: 'ssh.shell.started',
			source: 'saved-entry',
			connection: connectedIdentity,
		});
		const startShellOptions: RegisteredStartShellOptions = {
			term: 'Xterm',
			useTmux: connectionDetails.useTmux,
			tmuxSessionName: connectionDetails.tmuxSessionName,
			abortSignal: AbortSignalTimeout(abortSignalTimeoutMs),
			registerInStore: false,
		};
		shellHandle = await sshConnection.startShell(startShellOptions);
	} catch (error) {
		const tmuxAttachFailureReason = extractTmuxAttachFailureReason(error);
		traceEvent({
			type:
				tmuxAttachFailureReason !== null
					? 'ssh.shell.tmux-attach-failed'
					: 'ssh.shell.failed',
			source: 'saved-entry',
			connection: connectedIdentity,
			error: serializeConnectionDiagnosticError(error),
			details: { tmuxAttachFailureReason, storedConnectionId },
		});
		await cleanupDiagnosticConnection();
		if (tmuxAttachFailureReason !== null) {
			return {
				status: 'tmux_attach_failed',
				connectionId: sshConnection.connectionId,
				tmuxAttachFailureReason,
				tmuxSessionName: connectionDetails.tmuxSessionName,
				storedConnectionId,
			};
		}
		throw error;
	}

	traceEvent({
		type: 'ssh.shell.connected',
		source: 'saved-entry',
		connection: connectedIdentity,
		details: { channelId: shellHandle.channelId, storedConnectionId },
	});

	const cleanupError = await cleanupDiagnosticConnection();
	if (cleanupError !== null) {
		throw cleanupError;
	}

	return {
		status: 'connected',
		connectionId: sshConnection.connectionId,
		channelId: shellHandle.channelId,
	};
}
