import {
	autoConnectEvents,
	manualDiagnosticEvents,
	reconnectEvents,
	savedEntryEvents,
	sshEvents,
	tailscaleDiagnosticEvents,
	type AutoConnectActiveConnectionMissingEvent,
	type AutoConnectActiveConnectionSelectedEvent,
	type AutoConnectActiveConnectionShellConnectedEvent,
	type AutoConnectActiveConnectionShellFailedEvent,
	type AutoConnectActiveConnectionShellStartedEvent,
	type AutoConnectActiveConnectionTmuxAttachFailedEvent,
	type AutoConnectLatestShellMissingEvent,
	type AutoConnectLatestShellSelectedEvent,
	type AutoConnectSavedEntryConnectConnectedEvent,
	type AutoConnectSavedEntryConnectFailedEvent,
	type AutoConnectSavedEntryConnectStartedEvent,
	type AutoConnectSavedEntryConnectThrewEvent,
	type AutoConnectSavedEntryConnectTmuxAttachFailedEvent,
	type AutoConnectSavedEntryRetryStartedEvent,
	type AutoConnectSavedEntryRetryThrewEvent,
	type ReconnectEvent,
} from './connection-diagnostics/events';

export type * from './connection-diagnostics/events';

export type ActiveConnectionEvent =
	| AutoConnectLatestShellSelectedEvent
	| AutoConnectLatestShellMissingEvent
	| AutoConnectActiveConnectionSelectedEvent
	| AutoConnectActiveConnectionMissingEvent
	| AutoConnectActiveConnectionShellStartedEvent
	| AutoConnectActiveConnectionShellConnectedEvent
	| AutoConnectActiveConnectionShellFailedEvent
	| AutoConnectActiveConnectionTmuxAttachFailedEvent;

export type SavedEntryConnectEvent =
	| AutoConnectSavedEntryConnectStartedEvent
	| AutoConnectSavedEntryConnectConnectedEvent
	| AutoConnectSavedEntryConnectFailedEvent
	| AutoConnectSavedEntryConnectThrewEvent
	| AutoConnectSavedEntryConnectTmuxAttachFailedEvent
	| AutoConnectSavedEntryRetryStartedEvent
	| AutoConnectSavedEntryRetryThrewEvent;

export const diagnosticEvents = {
	savedEntrySelected: savedEntryEvents.selected,
	savedEntryMissing: savedEntryEvents.missing,
	savedEntryInvalidTmuxSettings: savedEntryEvents.invalidTmuxSettings,
	keyResolved: savedEntryEvents.keyResolved,
	keyMissing: savedEntryEvents.keyMissing,
	sshConnectStarted: sshEvents.connectStarted,
	sshConnectProgress: sshEvents.connectProgress,
	sshConnectConnected: sshEvents.connectConnected,
	sshConnectFailed: sshEvents.connectFailed,
	sshShellStarted: sshEvents.shellStarted,
	sshShellConnected: sshEvents.shellConnected,
	sshShellFailed: sshEvents.shellFailed,
	sshShellTmuxAttachFailed: sshEvents.shellTmuxAttachFailed,
	manualDiagnosticTimeout: manualDiagnosticEvents.timeout,
	diagnosticDisconnected: sshEvents.diagnosticDisconnected,
	diagnosticDisconnectFailed: sshEvents.diagnosticDisconnectFailed,
	tailscaleEnsureReadyResult: tailscaleDiagnosticEvents.ensureReadyResult,
	tailscaleRecoveryResult: tailscaleDiagnosticEvents.recoveryResult,
	reconnect: (input: ReconnectEvent): ReconnectEvent => {
		switch (input.kind) {
			case 'reconnect.started':
				return reconnectEvents.started(input);
			case 'reconnect.stopped':
				return reconnectEvents.stopped(input);
			case 'reconnect.start.blocked':
				return reconnectEvents.startBlocked(input);
			case 'reconnect.retry.scheduled':
				return reconnectEvents.retryScheduled(input);
			case 'reconnect.attempt.started':
				return reconnectEvents.attemptStarted(input);
			case 'reconnect.attempt.connected':
				return reconnectEvents.attemptConnected(input);
			case 'reconnect.attempt.failed':
				return reconnectEvents.attemptFailed(input);
			case 'reconnect.timeout':
				return reconnectEvents.timeout(input);
		}
	},
	manualDiagnosticSavedEntryMissing: manualDiagnosticEvents.savedEntryMissing,
	manualDiagnosticTailscaleAttention: manualDiagnosticEvents.tailscaleAttention,
	manualDiagnosticTailscaleAttentionCleared:
		manualDiagnosticEvents.tailscaleAttentionCleared,
	manualDiagnosticTmuxAttachFailed: manualDiagnosticEvents.tmuxAttachFailed,
	manualDiagnosticWarning: manualDiagnosticEvents.warning,
	manualDiagnosticFailed: manualDiagnosticEvents.failed,
	autoConnectLatestShellSelected: autoConnectEvents.latestShellSelected,
	autoConnectLatestShellMissing: autoConnectEvents.latestShellMissing,
	autoConnectActiveConnectionSelected: autoConnectEvents.activeConnectionSelected,
	autoConnectActiveConnectionMissing: autoConnectEvents.activeConnectionMissing,
	autoConnectActiveConnectionShellStarted:
		autoConnectEvents.activeConnectionShellStarted,
	autoConnectActiveConnectionShellConnected:
		autoConnectEvents.activeConnectionShellConnected,
	autoConnectActiveConnectionShellFailed:
		autoConnectEvents.activeConnectionShellFailed,
	autoConnectActiveConnectionTmuxAttachFailed:
		autoConnectEvents.activeConnectionTmuxAttachFailed,
	autoConnectSavedEntryConnectStarted:
		autoConnectEvents.savedEntryConnectStarted,
	autoConnectSavedEntryConnectConnected:
		autoConnectEvents.savedEntryConnectConnected,
	autoConnectSavedEntryConnectFailed: autoConnectEvents.savedEntryConnectFailed,
	autoConnectSavedEntryConnectThrew: autoConnectEvents.savedEntryConnectThrew,
	autoConnectSavedEntryConnectTmuxAttachFailed:
		autoConnectEvents.savedEntryConnectTmuxAttachFailed,
	autoConnectSavedEntryRetryStarted: autoConnectEvents.savedEntryRetryStarted,
	autoConnectSavedEntryRetryThrew: autoConnectEvents.savedEntryRetryThrew,
} as const;
