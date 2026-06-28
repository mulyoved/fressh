import { type SshConnectionProgress } from '@fressh/react-native-uniffi-russh';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { connectAndOpenShell } from './connect-and-open-shell';
import { type InputConnectionDetails } from './connection-storage';
import { rootLogger } from './logger';
import { useSshStore } from './ssh-store';

const logger = rootLogger.extend('QueryFns');

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
