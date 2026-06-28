// eslint-disable-next-line import/consistent-type-specifier-style -- Pure type import keeps Node integration tests from loading React Native.
import type {
	ConnectionDetails,
	RnRussh,
	SshConnection,
	SshConnectionProgress,
	SshShell,
} from '@fressh/react-native-uniffi-russh';
import {
	serializeConnectionDiagnosticError,
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticEventInput,
} from './connection-diagnostics';
import { type InputConnectionDetails } from './connection-storage';
import { getStoredConnectionId } from './connection-utils';
import { rootLogger } from './logger';
import { connectAndRememberConnection } from './ssh-connect-flow';
import { extractTmuxAttachFailureReason } from './ssh-error-details';
import { type RegisteredStartShellOptions } from './ssh-registry-store';
import { AbortSignalTimeout } from './utils';

const logger = rootLogger.extend('ConnectAndOpenShell');
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

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

export type ConnectAndOpenShellResult =
	| {
			status: 'connected';
			sshConnection: SshConnection;
			shellHandle: SshShell;
			connectionId: string;
			channelId: number;
	  }
	| {
			status: 'tmux_attach_failed';
			connectionId: string;
			tmuxAttachFailureReason: string | null;
			tmuxSessionName: string;
			storedConnectionId: string;
	  };

type SaveConnection = (params: {
	details: InputConnectionDetails;
	priority: number;
	label?: string;
}) => Promise<unknown>;

type ConnectTrace = {
	event: (event: ConnectionDiagnosticEventInput) => void;
};

const getSecretsManager = async () => {
	const { secretsManager } = await import('./secrets-manager');
	return secretsManager;
};

const defaultSaveConnection: SaveConnection = async (params) => {
	const secretsManager = await getSecretsManager();
	return await secretsManager.connections.utils.upsertConnection(params);
};

// Shared resolver for turning stored details into a connect-ready security object.
async function resolveSecurityFromDetails(
	connectionDetails: InputConnectionDetails,
): Promise<ConnectionDetails['security']> {
	const secretsManager = await getSecretsManager();
	const privateKey = await secretsManager.keys.utils
		.getPrivateKey(connectionDetails.security.keyId)
		.then((e) => e.value);
	return {
		type: 'key',
		privateKey,
	};
}

async function connectDiagnosticOnly(args: {
	connectionDetails: InputConnectionDetails;
	connect: typeof RnRussh.connect;
	onConnectionProgress?: (progressEvent: SshConnectionProgress) => void;
	abortSignalTimeoutMs: number;
	resolvedSecurity: ConnectionDetails['security'];
}): Promise<{
	sshConnection: SshConnection;
	storedConnectionId: string;
}> {
	const sshConnection = await args.connect({
		host: args.connectionDetails.host,
		port: args.connectionDetails.port,
		username: args.connectionDetails.username,
		security: args.resolvedSecurity,
		onConnectionProgress: (progressEvent) => {
			args.onConnectionProgress?.(progressEvent);
		},
		// TODO: Implement proper host key verification (known_hosts).
		// Currently accepts all server keys, which is vulnerable to MITM attacks.
		// Future: store known host keys, verify against them, prompt user on mismatch.
		onServerKey: async () => true,
		abortSignal: AbortSignalTimeout(args.abortSignalTimeoutMs),
	});

	return {
		sshConnection,
		storedConnectionId: getStoredConnectionId(args.connectionDetails),
	};
}

// Shared connect flow used by manual diagnostics and silent auto-connect.
export async function connectAndOpenShell(args: {
	connectionDetails: InputConnectionDetails;
	connect: typeof RnRussh.connect;
	navigate: (params: { connectionId: string; channelId: number }) => void;
	navigateWithError?: (params: {
		connectionId: string;
		tmuxAttachFailureReason: string | null;
		tmuxSessionName: string;
		storedConnectionId: string;
	}) => void;
	onConnectionProgress?: (progressEvent: SshConnectionProgress) => void;
	abortSignalTimeoutMs?: number;
	resolvedSecurity?: ConnectionDetails['security'];
	saveConnection?: SaveConnection;
	trace?: ConnectTrace;
	diagnosticMode?: boolean;
}): Promise<ConnectAndOpenShellResult> {
	const {
		connectionDetails,
		connect,
		navigate,
		onConnectionProgress,
		abortSignalTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
		resolvedSecurity,
		saveConnection = defaultSaveConnection,
	} = args;
	const traceEvent = (event: ConnectionDiagnosticEventInput) => {
		try {
			args.trace?.event(event);
		} catch (error) {
			logger.warn('Connect trace event failed', error);
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
	const security =
		resolvedSecurity ?? (await resolveSecurityFromDetails(connectionDetails));

	traceEvent({
		type: 'ssh.connect.started',
		source: 'saved-entry',
		connection: connectionIdentity,
	});
	let rememberedConnection: {
		sshConnection: SshConnection;
		storedConnectionId: string;
	};
	try {
		const connectArgs = {
			connectionDetails,
			connect,
			onConnectionProgress: (progressEvent: SshConnectionProgress) => {
				logger.info('SSH connect progress event', progressEvent);
				traceEvent({
					type: 'ssh.connect.progress',
					source: 'saved-entry',
					connection: connectionIdentity,
					details: { progressEvent },
				});
				onConnectionProgress?.(progressEvent);
			},
			abortSignalTimeoutMs,
			resolvedSecurity: security,
		};
		rememberedConnection = args.diagnosticMode
			? await connectDiagnosticOnly(connectArgs)
			: await connectAndRememberConnection({
					...connectArgs,
					saveConnection,
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
	const { sshConnection, storedConnectionId } = rememberedConnection;
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
		if (!args.diagnosticMode) return;
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
		} catch (error) {
			traceEvent({
				type: 'ssh.diagnostic.disconnect-failed',
				source: 'saved-entry',
				connection: connectedIdentity,
				error: serializeConnectionDiagnosticError(error),
			});
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
			...(args.diagnosticMode ? { registerInStore: false } : {}),
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
		if (tmuxAttachFailureReason !== null) {
			if (!args.diagnosticMode) {
				args.navigateWithError?.({
					connectionId: sshConnection.connectionId,
					tmuxAttachFailureReason,
					tmuxSessionName: connectionDetails.tmuxSessionName,
					storedConnectionId,
				});
			}
			await cleanupDiagnosticConnection();
			return {
				status: 'tmux_attach_failed',
				connectionId: sshConnection.connectionId,
				tmuxAttachFailureReason,
				tmuxSessionName: connectionDetails.tmuxSessionName,
				storedConnectionId,
			};
		}
		await cleanupDiagnosticConnection();
		throw error;
	}
	traceEvent({
		type: 'ssh.shell.connected',
		source: 'saved-entry',
		connection: connectedIdentity,
		details: { channelId: shellHandle.channelId, storedConnectionId },
	});

	logger.info(
		'Connected to SSH server',
		sshConnection.connectionId,
		shellHandle.channelId,
	);
	if (!args.diagnosticMode) {
		navigate({
			connectionId: sshConnection.connectionId,
			channelId: shellHandle.channelId,
		});
	}

	await cleanupDiagnosticConnection();

	return {
		status: 'connected',
		sshConnection,
		shellHandle,
		connectionId: sshConnection.connectionId,
		channelId: shellHandle.channelId,
	};
}
