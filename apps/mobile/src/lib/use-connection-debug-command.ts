import { RnRussh } from '@fressh/react-native-uniffi-russh';
import * as Clipboard from 'expo-clipboard';
import { useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import { useAutoConnectStore } from './auto-connect';
import { runConnectionDebugCommand } from './connection-debug-command';
import { connectionDiagnosticRecorder } from './connection-diagnostic-recorder';
import { pickLatestConnection } from './connection-utils';
import { runDiagnosticShellProbe } from './diagnostic-shell-probe';
import { rootLogger } from './logger';
import { secretsManager } from './secrets-manager';
import { tailscaleRecovery } from './tailscale-recovery';
import { queryClient } from './utils';

const logger = rootLogger.extend('ConnectionDebugCommand');

export type UseConnectionDebugCommandArgs = {
	appActive: boolean;
	closeMenu: () => void;
	allowTerminalPaste: boolean;
	pasteIntoTerminal: (value: string) => void;
};

export function useConnectionDebugCommand({
	appActive,
	closeMenu,
	allowTerminalPaste,
	pasteIntoTerminal,
}: UseConnectionDebugCommandArgs) {
	return useCallback(async () => {
		const autoState = useAutoConnectStore.getState();
		await runConnectionDebugCommand({
			recorder: connectionDiagnosticRecorder,
			appState: {
				platformOS: Platform.OS,
				isAutoConnecting: autoState.isAutoConnecting,
				isReconnecting: autoState.isReconnecting,
				pathname: '/shell/detail',
				appActive,
			},
			closeMenu,
			loadLatestSavedConnection: async () => {
				const entries = await queryClient.fetchQuery(
					secretsManager.connections.query.list,
				);
				return pickLatestConnection(
					entries?.filter((entry) => entry.value.autoConnect),
				);
			},
			resolvePrivateKey: async (keyId) => {
				const keyEntry = await secretsManager.keys.utils.getPrivateKey(keyId);
				return keyEntry.value;
			},
			runDiagnosticShellProbe,
			connect: RnRussh.connect,
			recovery: tailscaleRecovery,
			allowTerminalPaste,
			pasteIntoTerminal,
			copyToClipboard: async (value) => {
				await Clipboard.setStringAsync(value);
			},
			showAlert: (title, message) => {
				Alert.alert(title, message);
			},
			logger,
		});
	}, [allowTerminalPaste, appActive, closeMenu, pasteIntoTerminal]);
}
