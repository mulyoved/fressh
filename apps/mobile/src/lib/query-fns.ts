import { type SshConnectionProgress } from '@fressh/react-native-uniffi-russh';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Platform } from 'react-native';
import { connectAndOpenShell } from './connect-and-open-shell';
import { connectionDiagnosticRecorder } from './connection-diagnostic-recorder';
import { type InputConnectionDetails } from './connection-storage';
import { rootLogger } from './logger';
import { connectWithTailscaleRecovery } from './manual-connect-tailscale-recovery';
import { createSavedEntryTailscaleDiagnosticRecovery } from './saved-entry-tailscale-diagnostic-recovery';
import { useSshStore } from './ssh-store';
import { tailscaleRecovery } from './tailscale-recovery';
import {
	clearTailscaleRecoveryUiState,
	markTailscaleRecoveryUiNeedsAttention,
} from './tailscale-recovery-ui-store';

const logger = rootLogger.extend('QueryFns');

export const useSshConnMutation = (opts?: {
	onConnectionProgress?: (progressEvent: SshConnectionProgress) => void;
}) => {
	const router = useRouter();
	const connect = useSshStore((s) => s.connect);

	return useMutation({
		mutationFn: async (connectionDetails: InputConnectionDetails) => {
			const trace = connectionDiagnosticRecorder.startTrace({
				trigger: 'manual-diagnostic',
				reason: 'host-connect',
			});
			try {
				logger.info('Connecting to SSH server...');
				const result = await connectWithTailscaleRecovery({
					platformOS: Platform.OS,
					recovery: createSavedEntryTailscaleDiagnosticRecovery({
						platformOS: Platform.OS,
						recovery: tailscaleRecovery,
						emit: (event) => {
							trace.event(event);
						},
					}),
					connect: async () =>
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
							trace,
						}),
					onAttention: markTailscaleRecoveryUiNeedsAttention,
					onClearAttention: clearTailscaleRecoveryUiState,
					logger,
				});
				trace.finish(result.status === 'connected' ? 'connected' : 'failed');
			} catch (error) {
				trace.finish('failed');
				logger.error('Error connecting to SSH server', error);
				throw error;
			}
		},
	});
};
