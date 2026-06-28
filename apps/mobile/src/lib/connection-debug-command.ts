import { type SavedEntryTailscaleRecovery } from './auto-connect-saved-entry';
import {
	deliverConnectionDiagnosticPrompt,
	type ConnectionDiagnosticDeliveryResult,
} from './connection-diagnostic-delivery';
import {
	runManualConnectionDiagnostic,
	type ManualConnectionDiagnosticResult,
} from './connection-diagnostic-runner';
import {
	type ConnectionDiagnosticAppState,
	type ConnectionDiagnosticRecorder,
	type ConnectionDiagnosticTraceHandle,
} from './connection-diagnostics';
import { type SavedConnectionEntry } from './connection-utils';
import {
	type DiagnosticShellProbeResult,
	type runDiagnosticShellProbe,
} from './diagnostic-shell-probe';
// eslint-disable-next-line import/consistent-type-specifier-style -- keep secrets-manager type-only so Node tests do not load React Native at runtime
import type { InputConnectionDetails } from './secrets-manager';

export type ConnectionDebugResolvedKeySecurity = {
	type: 'key';
	privateKey: string;
};

export type ConnectionDebugLogger = {
	warn: (message: string, error: unknown) => void;
};

export type ConnectionDebugCommandArgs = {
	recorder: ConnectionDiagnosticRecorder;
	appState: ConnectionDiagnosticAppState;
	closeMenu: () => void;
	loadLatestSavedConnection: () => Promise<SavedConnectionEntry | null>;
	resolvePrivateKey: (keyId: string) => Promise<string>;
	runProbe: (args: {
		connectionDetails: InputConnectionDetails;
		resolvedSecurity: ConnectionDebugResolvedKeySecurity;
		trace: ConnectionDiagnosticTraceHandle;
	}) => Promise<DiagnosticShellProbeResult>;
	recovery: SavedEntryTailscaleRecovery;
	hasShell: boolean;
	pasteIntoTerminal: (value: string) => void;
	copyToClipboard: (value: string) => Promise<void>;
	showAlert: (title: string, message: string) => void;
	logger: ConnectionDebugLogger;
};

export type BuildConnectionDebugCommandArgsInput = {
	recorder: ConnectionDiagnosticRecorder;
	appState: ConnectionDiagnosticAppState;
	closeMenu: () => void;
	loadLatestSavedConnection: () => Promise<SavedConnectionEntry | null>;
	resolvePrivateKey: (keyId: string) => Promise<string>;
	runDiagnosticShellProbe: typeof runDiagnosticShellProbe;
	connect: Parameters<typeof runDiagnosticShellProbe>[0]['connect'];
	recovery: SavedEntryTailscaleRecovery;
	hasShell: boolean;
	pasteIntoTerminal: (value: string) => void;
	copyToClipboard: (value: string) => Promise<void>;
	showAlert: (title: string, message: string) => void;
	logger: ConnectionDebugLogger;
};

export function buildConnectionDebugCommandArgs(
	input: BuildConnectionDebugCommandArgsInput,
): ConnectionDebugCommandArgs {
	return {
		recorder: input.recorder,
		appState: input.appState,
		closeMenu: input.closeMenu,
		loadLatestSavedConnection: input.loadLatestSavedConnection,
		resolvePrivateKey: input.resolvePrivateKey,
		runProbe: ({ connectionDetails, resolvedSecurity, trace }) =>
			input.runDiagnosticShellProbe({
				connectionDetails,
				resolvedSecurity,
				trace,
				connect: input.connect,
			}),
		recovery: input.recovery,
		hasShell: input.hasShell,
		pasteIntoTerminal: input.pasteIntoTerminal,
		copyToClipboard: input.copyToClipboard,
		showAlert: input.showAlert,
		logger: input.logger,
	};
}

export async function runConnectionDebugCommand(
	args: ConnectionDebugCommandArgs,
): Promise<{
	diagnostic: ManualConnectionDiagnosticResult;
	delivery: ConnectionDiagnosticDeliveryResult;
}> {
	args.closeMenu();
	const diagnostic = await runManualConnectionDiagnostic({
		recorder: args.recorder,
		appState: args.appState,
		loadLatestSavedConnection: args.loadLatestSavedConnection,
		resolveKeySecurity: async (details: SavedConnectionEntry['value']) => {
			try {
				const privateKey = await args.resolvePrivateKey(
					details.security.keyId,
				);
				return { type: 'key', privateKey };
			} catch (error) {
				args.logger.warn('Connection diagnostic key resolution failed', error);
				return null;
			}
		},
		connectSavedEntry: args.runProbe,
		recovery: args.recovery,
	});
	const delivery = await deliverConnectionDiagnosticPrompt({
		prompt: diagnostic.prompt,
		hasShell: args.hasShell,
		pasteIntoTerminal: args.pasteIntoTerminal,
		copyToClipboard: args.copyToClipboard,
		showAlert: args.showAlert,
	});
	return { diagnostic, delivery };
}
