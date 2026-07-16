import { type SavedEntryTailscaleRecovery } from './auto-connect-saved-entry';
import {
	deliverConnectionDiagnosticPrompt,
	type ConnectionDiagnosticDeliveryResult,
	type DiagnosticDelivery,
} from './connection-diagnostic-delivery';
import {
	manualConnectionDiagnosticRunner,
	type ManualConnectionDiagnosticRunner,
	type ManualConnectionDiagnosticResult,
} from './connection-diagnostic-runner';
import {
	type ConnectionDiagnosticAppState,
	type ConnectionDiagnosticRecorder,
	type ConnectionDiagnosticTrace,
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
	delivery?: DiagnosticDelivery;
	allowTerminalPaste?: boolean;
	pasteIntoTerminal?: (value: string) => void;
	copyToClipboard: (value: string) => Promise<void>;
	showAlert: (title: string, message: string) => void;
	logger: ConnectionDebugLogger;
	manualDiagnosticRunner?: ManualConnectionDiagnosticRunner;
};

function readEventMessage(event: ConnectionDiagnosticTrace['events'][number]) {
	const message = (event as { message?: unknown }).message;
	return typeof message === 'string' && message.length > 0 ? message : null;
}

function readEventDestination(
	event: ConnectionDiagnosticTrace['events'][number],
) {
	const destination = (event as { destination?: unknown }).destination;
	return typeof destination === 'string' && destination.length > 0
		? destination
		: null;
}

export function formatRecordedConnectionDiagnosticTrace(
	trace: ConnectionDiagnosticTrace,
): string {
	const lines = [
		`trace: ${trace.id}`,
		`trigger: ${trace.trigger}`,
		`reason: ${trace.reason}`,
		`status: ${trace.status}`,
	];
	for (const event of trace.events) {
		lines.push(`- ${event.kind}`);
		const message = readEventMessage(event);
		if (message) lines.push(`  message: ${message}`);
		const destination = readEventDestination(event);
		if (destination) lines.push(`  destination=${destination}`);
	}
	return lines.join('\n');
}

function formatRecordedReconnectTraceHistory(
	recorder: ConnectionDiagnosticRecorder,
): string {
	const reconnectTraces = recorder
		.getHistory()
		.filter((trace) => trace.trigger === 'reconnect');
	if (reconnectTraces.length === 0) return '';
	return [
		'Recorded reconnect traces',
		'',
		...reconnectTraces.map(formatRecordedConnectionDiagnosticTrace),
	].join('\n');
}

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
		connectSavedEntry: ({
			connectionDetails,
			resolvedSecurity,
			trace,
			signal,
		}) =>
			args.runDiagnosticShellProbe({
				connectionDetails,
				resolvedSecurity,
				trace,
				connect: args.connect,
				operationSignals: {
					connect: signal,
					shell: signal,
				},
			}),
		recovery: args.recovery,
	});
	const recordedHistory = formatRecordedReconnectTraceHistory(args.recorder);
	const prompt = recordedHistory
		? `${recordedHistory}\n\n${diagnostic.prompt}`
		: diagnostic.prompt;
	const delivery = await deliverConnectionDiagnosticPrompt({
		prompt,
		delivery:
			args.delivery ??
			(args.allowTerminalPaste && args.pasteIntoTerminal
				? { type: 'terminal', paste: args.pasteIntoTerminal }
				: { type: 'clipboard-only' }),
		copyToClipboard: args.copyToClipboard,
		showAlert: args.showAlert,
	});
	return { diagnostic, delivery };
}
