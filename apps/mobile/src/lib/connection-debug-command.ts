import { type SavedEntryTailscaleRecovery } from './auto-connect-saved-entry';
import {
	deliverConnectionDiagnosticPrompt,
	type ConnectionDiagnosticDeliveryResult,
} from './connection-diagnostic-delivery';
import {
	manualConnectionDiagnosticRunner,
	type ManualConnectionDiagnosticRunner,
	type ManualConnectionDiagnosticResult,
} from './connection-diagnostic-runner';
import {
	type ConnectionDiagnosticAppState,
	type ConnectionDiagnosticRecorder,
} from './connection-diagnostic-types';
import { type SavedConnectionEntry } from './connection-utils';
import { type runDiagnosticShellProbe } from './diagnostic-shell-probe';

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
	runDiagnosticShellProbe: typeof runDiagnosticShellProbe;
	connect: Parameters<typeof runDiagnosticShellProbe>[0]['connect'];
	recovery: SavedEntryTailscaleRecovery;
	allowTerminalPaste: boolean;
	pasteIntoTerminal: (value: string) => void;
	copyToClipboard: (value: string) => Promise<void>;
	showAlert: (title: string, message: string) => void;
	logger: ConnectionDebugLogger;
	manualDiagnosticRunner?: ManualConnectionDiagnosticRunner;
};

export async function runConnectionDebugCommand(
	args: ConnectionDebugCommandArgs,
): Promise<{
	diagnostic: ManualConnectionDiagnosticResult;
	delivery: ConnectionDiagnosticDeliveryResult;
}> {
	args.closeMenu();
	const diagnostic = await (
		args.manualDiagnosticRunner ?? manualConnectionDiagnosticRunner
	).run({
		recorder: args.recorder,
		appState: args.appState,
		loadLatestSavedConnection: args.loadLatestSavedConnection,
		resolveKeySecurity: async (details: SavedConnectionEntry['value']) => {
			try {
				const privateKey = await args.resolvePrivateKey(details.security.keyId);
				return { type: 'key', privateKey };
			} catch (error) {
				args.logger.warn('Connection diagnostic key resolution failed', error);
				return null;
			}
		},
		connectSavedEntry: ({ connectionDetails, resolvedSecurity, trace }) =>
			args.runDiagnosticShellProbe({
				connectionDetails,
				resolvedSecurity,
				trace,
				connect: args.connect,
			}),
		recovery: args.recovery,
	});
	const delivery = await deliverConnectionDiagnosticPrompt({
		prompt: diagnostic.prompt,
		allowTerminalPaste: args.allowTerminalPaste,
		pasteIntoTerminal: args.pasteIntoTerminal,
		copyToClipboard: args.copyToClipboard,
		showAlert: args.showAlert,
	});
	return { diagnostic, delivery };
}
