import {
	RnRussh,
	type ConnectionDetails,
	type SshConnectionProgress,
} from '@fressh/react-native-uniffi-russh';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { rootLogger } from './logger';
import { secretsManager, type InputConnectionDetails } from './secrets-manager';
import { useSshStore } from './ssh-store';
import { AbortSignalTimeout } from './utils';

const logger = rootLogger.extend('QueryFns');
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

// Shared resolver for turning stored details into a connect-ready security object.
export async function resolveSecurityFromDetails(
	connectionDetails: InputConnectionDetails,
): Promise<ConnectionDetails['security']> {
	if (connectionDetails.security.type === 'password') {
		return {
			type: 'password',
			password: connectionDetails.security.password,
		};
	}
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
	onConnectionProgress?: (progressEvent: SshConnectionProgress) => void;
	abortSignalTimeoutMs?: number;
	resolvedSecurity?: ConnectionDetails['security'];
}) {
	const {
		connectionDetails,
		connect,
		navigate,
		onConnectionProgress,
		abortSignalTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
		resolvedSecurity,
	} = args;
	const security =
		resolvedSecurity ?? (await resolveSecurityFromDetails(connectionDetails));

	const sshConnection = await connect({
		host: connectionDetails.host,
		port: connectionDetails.port,
		username: connectionDetails.username,
		security,
		onConnectionProgress: (progressEvent) => {
			logger.info('SSH connect progress event', progressEvent);
			onConnectionProgress?.(progressEvent);
		},
		onServerKey: async (serverKeyInfo) => {
			logger.info('SSH server key', serverKeyInfo);
			return true;
		},
		abortSignal: AbortSignalTimeout(abortSignalTimeoutMs),
	});

	await secretsManager.connections.utils.upsertConnection({
		label: `${connectionDetails.username}@${connectionDetails.host}:${connectionDetails.port}`,
		details: connectionDetails,
		priority: 0,
	});
	const shellHandle = await sshConnection.startShell({
		term: 'Xterm',
		abortSignal: AbortSignalTimeout(abortSignalTimeoutMs),
	});

	logger.info(
		'Connected to SSH server',
		sshConnection.connectionId,
		shellHandle.channelId,
	);
	navigate({
		connectionId: sshConnection.connectionId,
		channelId: shellHandle.channelId,
	});

	return { sshConnection, shellHandle };
}

export const useSshConnMutation = (opts?: {
	onConnectionProgress?: (progressEvent: SshConnectionProgress) => void;
}) => {
	const router = useRouter();
	const connect = useSshStore((s) => s.connect);

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
				});
			} catch (error) {
				logger.error('Error connecting to SSH server', error);
				throw error;
			}
		},
	});
};
