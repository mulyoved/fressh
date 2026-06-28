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
import { rootLogger } from './logger';
import { connectAndRememberConnection } from './ssh-connect-flow';
import { extractTmuxAttachFailureReason } from './ssh-error-details';
import { AbortSignalTimeout } from './utils';

const logger = rootLogger.extend('QueryFns');
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

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
export async function resolveSecurityFromDetails(
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

// Shared connect flow used by both manual and silent auto-connect.
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
		rememberedConnection = await connectAndRememberConnection({
			connectionDetails,
			connect,
			saveConnection,
			onConnectionProgress: (progressEvent) => {
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
	let shellHandle: Awaited<ReturnType<typeof sshConnection.startShell>>;
	try {
		traceEvent({
			type: 'ssh.shell.started',
			source: 'saved-entry',
			connection: connectedIdentity,
		});
		shellHandle = await sshConnection.startShell({
			term: 'Xterm',
			useTmux: connectionDetails.useTmux,
			tmuxSessionName: connectionDetails.tmuxSessionName,
			abortSignal: AbortSignalTimeout(abortSignalTimeoutMs),
		});
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
			args.navigateWithError?.({
				connectionId: sshConnection.connectionId,
				tmuxAttachFailureReason,
				tmuxSessionName: connectionDetails.tmuxSessionName,
				storedConnectionId,
			});
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

	if (args.diagnosticMode) {
		try {
			await Promise.resolve(sshConnection.disconnect?.());
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
	}

	return {
		status: 'connected',
		sshConnection,
		shellHandle,
		connectionId: sshConnection.connectionId,
		channelId: shellHandle.channelId,
	};
}

export const useSshConnMutation = (opts?: {
	onConnectionProgress?: (progressEvent: SshConnectionProgress) => void;
}) => {
	// Keep hook-only native dependencies lazy so connectAndOpenShell stays
	// importable in Node integration tests.
	/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports, react-compiler/react-compiler */
	const { useMutation } =
		require('@tanstack/react-query') as typeof import('@tanstack/react-query');
	const { useRouter } = require('expo-router') as typeof import('expo-router');
	const { useSshStore } =
		require('./ssh-store') as typeof import('./ssh-store');
	const router = useRouter();
	const connect = useSshStore((s) => s.connect);
	/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports, react-compiler/react-compiler */

	// eslint-disable-next-line react-compiler/react-compiler -- useMutation is loaded lazily so connectAndOpenShell remains Node-importable.
	return useMutation({
		mutationFn: async (connectionDetails: InputConnectionDetails) => {
			try {
				logger.info('Connecting to SSH server...');
				await connectAndOpenShell({
					connectionDetails,
					connect,
					onConnectionProgress: (progressEvent) => {
						opts?.onConnectionProgress?.(progressEvent);
					},
					navigate: ({ connectionId, channelId }) => {
						router.push({
							pathname: '/shell/detail',
							params: {
								connectionId,
								channelId,
							},
						});
					},
					navigateWithError: ({
						connectionId,
						tmuxAttachFailureReason,
						tmuxSessionName,
						storedConnectionId,
					}) => {
						router.push({
							pathname: '/shell/detail',
							params: {
								connectionId,
								channelId: '0',
								tmuxError: 'attach-failed',
								tmuxAttachFailureReason,
								tmuxSessionName,
								storedConnectionId,
							},
						});
					},
				});
			} catch (error) {
				logger.error('Error connecting to SSH server', error);
				throw error;
			}
		},
	});
};
