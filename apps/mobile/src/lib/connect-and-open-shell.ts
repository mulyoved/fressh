// eslint-disable-next-line import/consistent-type-specifier-style -- Pure type import keeps Node integration tests from loading React Native.
import type {
	ConnectionDetails,
	RnRussh,
	SshConnectionProgress,
} from '@fressh/react-native-uniffi-russh';
import { type ConnectionDiagnosticEvent } from './connection-diagnostic-types';
import { type InputConnectionDetails } from './connection-storage';
import { rootLogger } from './logger';
import { connectAndRememberConnection } from './ssh-connect-flow';
import {
	runSshShellLifecycle,
	type SshShellLifecycleResult,
} from './ssh-shell-lifecycle';

const logger = rootLogger.extend('ConnectAndOpenShell');
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

type ConnectedSshShellLifecycleResult = Extract<
	SshShellLifecycleResult,
	{ status: 'connected' }
>;
type TmuxAttachFailedSshShellLifecycleResult = Extract<
	SshShellLifecycleResult,
	{ status: 'tmux_attach_failed' }
>;

export type ConnectAndOpenShellResult =
	| Omit<ConnectedSshShellLifecycleResult, 'storedConnectionId'>
	| TmuxAttachFailedSshShellLifecycleResult;

type SaveConnection = (params: {
	details: InputConnectionDetails;
	priority: number;
	label?: string;
}) => Promise<unknown>;

type ConnectTrace = {
	event: (event: ConnectionDiagnosticEvent) => void;
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

// Shared connect flow used by saved-entry and silent auto-connect.
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
	const traceEvent = (event: ConnectionDiagnosticEvent) => {
		try {
			args.trace?.event(event);
		} catch (error) {
			logger.warn('Connect trace event failed', error);
		}
	};
	const security =
		resolvedSecurity ?? (await resolveSecurityFromDetails(connectionDetails));

	const result = await runSshShellLifecycle({
		connectionDetails,
		abortSignalTimeoutMs,
		traceEvent,
		onConnectionProgress: (progressEvent) => {
			logger.info('SSH connect progress event', progressEvent);
			onConnectionProgress?.(progressEvent);
		},
		connectConnection: async ({ onConnectionProgress }) =>
			await connectAndRememberConnection({
				connectionDetails,
				connect,
				onConnectionProgress,
				abortSignalTimeoutMs,
				resolvedSecurity: security,
				saveConnection,
			}),
	});
	if (result.status === 'tmux_attach_failed') {
		args.navigateWithError?.({
			connectionId: result.connectionId,
			tmuxAttachFailureReason: result.tmuxAttachFailureReason,
			tmuxSessionName: result.tmuxSessionName,
			storedConnectionId: result.storedConnectionId,
		});
		return result;
	}

	logger.info(
		'Connected to SSH server',
		result.sshConnection.connectionId,
		result.shellHandle.channelId,
	);
	navigate({
		connectionId: result.sshConnection.connectionId,
		channelId: result.shellHandle.channelId,
	});

	return result;
}
