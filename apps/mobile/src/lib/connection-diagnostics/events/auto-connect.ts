import {
	copyConnectionIdentity,
	copyOptionalConnectionIdentity,
} from './identity';
import { serializeConnectionDiagnosticError } from './snapshot';
import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticError,
	type ConnectionDiagnosticEventBase,
	type ConnectionDiagnosticSource,
} from './types';

export type AutoConnectLatestShellSelectedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.latest-shell.selected';
		connection: ConnectionDiagnosticConnectionIdentity;
		channelId: number;
		pathname: string;
	};

export type AutoConnectLatestShellMissingEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.latest-shell.missing';
		pathname: string;
	};

export type AutoConnectActiveConnectionSelectedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.active-connection.selected';
		connection: ConnectionDiagnosticConnectionIdentity;
	};

export type AutoConnectActiveConnectionMissingEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.active-connection.missing';
	};

export type AutoConnectActiveConnectionShellStartedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.active-connection.shell-started';
		connection: ConnectionDiagnosticConnectionIdentity;
	};

export type AutoConnectActiveConnectionShellConnectedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.active-connection.shell-connected';
		connection: ConnectionDiagnosticConnectionIdentity;
		channelId: number;
		pathname?: string;
	};

export type AutoConnectActiveConnectionShellFailedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.active-connection.shell-failed';
		connection: ConnectionDiagnosticConnectionIdentity;
		error: ConnectionDiagnosticError;
		tmuxSessionName?: string;
	};

export type AutoConnectActiveConnectionTmuxAttachFailedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.active-connection.tmux-attach-failed';
		connection: ConnectionDiagnosticConnectionIdentity;
		error: ConnectionDiagnosticError;
		tmuxAttachFailureReason: string | null;
		tmuxSessionName: string;
	};

export type AutoConnectSavedEntryConnectStartedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.saved-entry.connect.started';
		connection?: ConnectionDiagnosticConnectionIdentity;
	};

export type AutoConnectSavedEntryConnectConnectedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.saved-entry.connect.connected';
		connection: ConnectionDiagnosticConnectionIdentity;
		connectionId: string;
		channelId: number;
		storedConnectionId?: string;
	};

export type AutoConnectSavedEntryConnectFailedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.saved-entry.connect.failed';
		connection?: ConnectionDiagnosticConnectionIdentity;
		connectionId?: string;
		storedConnectionId?: string;
	};

export type AutoConnectSavedEntryConnectThrewEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.saved-entry.connect.threw';
		connection?: ConnectionDiagnosticConnectionIdentity;
		error: ConnectionDiagnosticError;
	};

export type AutoConnectSavedEntryConnectTmuxAttachFailedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.saved-entry.connect.tmux-attach-failed';
		connection: ConnectionDiagnosticConnectionIdentity;
		connectionId: string;
		tmuxAttachFailureReason: string | null;
		tmuxSessionName: string;
		storedConnectionId: string;
	};

export type AutoConnectSavedEntryRetryStartedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.saved-entry.retry.started';
		connection?: ConnectionDiagnosticConnectionIdentity;
	};

export type AutoConnectSavedEntryRetryThrewEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.saved-entry.retry.threw';
		connection?: ConnectionDiagnosticConnectionIdentity;
		error: ConnectionDiagnosticError;
	};

export type AutoConnectEvent =
	| AutoConnectLatestShellSelectedEvent
	| AutoConnectLatestShellMissingEvent
	| AutoConnectActiveConnectionSelectedEvent
	| AutoConnectActiveConnectionMissingEvent
	| AutoConnectActiveConnectionShellStartedEvent
	| AutoConnectActiveConnectionShellConnectedEvent
	| AutoConnectActiveConnectionShellFailedEvent
	| AutoConnectActiveConnectionTmuxAttachFailedEvent
	| AutoConnectSavedEntryConnectStartedEvent
	| AutoConnectSavedEntryConnectConnectedEvent
	| AutoConnectSavedEntryConnectFailedEvent
	| AutoConnectSavedEntryConnectThrewEvent
	| AutoConnectSavedEntryConnectTmuxAttachFailedEvent
	| AutoConnectSavedEntryRetryStartedEvent
	| AutoConnectSavedEntryRetryThrewEvent;

export const autoConnectEventKinds = [
	'auto-connect.latest-shell.selected',
	'auto-connect.latest-shell.missing',
	'auto-connect.active-connection.selected',
	'auto-connect.active-connection.missing',
	'auto-connect.active-connection.shell-started',
	'auto-connect.active-connection.shell-connected',
	'auto-connect.active-connection.shell-failed',
	'auto-connect.active-connection.tmux-attach-failed',
	'auto-connect.saved-entry.connect.started',
	'auto-connect.saved-entry.connect.connected',
	'auto-connect.saved-entry.connect.failed',
	'auto-connect.saved-entry.connect.threw',
	'auto-connect.saved-entry.connect.tmux-attach-failed',
	'auto-connect.saved-entry.retry.started',
	'auto-connect.saved-entry.retry.threw',
] as const satisfies readonly AutoConnectEvent['kind'][];

const withSource = <T extends AutoConnectEvent>(event: T): T => event;

export const autoConnectEvents = {
	latestShellSelected: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		channelId: number;
		pathname: string;
		message?: string;
	}): AutoConnectLatestShellSelectedEvent =>
		withSource({
			kind: 'auto-connect.latest-shell.selected',
			source: input.source,
			message: input.message,
			connection: copyConnectionIdentity(input.connection),
			channelId: input.channelId,
			pathname: input.pathname,
		}),
	latestShellMissing: (input: {
		source: ConnectionDiagnosticSource;
		pathname: string;
		message?: string;
	}): AutoConnectLatestShellMissingEvent =>
		withSource({
			kind: 'auto-connect.latest-shell.missing',
			source: input.source,
			message: input.message,
			pathname: input.pathname,
		}),
	activeConnectionSelected: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		message?: string;
	}): AutoConnectActiveConnectionSelectedEvent =>
		withSource({
			kind: 'auto-connect.active-connection.selected',
			source: input.source,
			message: input.message,
			connection: copyConnectionIdentity(input.connection),
		}),
	activeConnectionMissing: (input: {
		source: ConnectionDiagnosticSource;
		message?: string;
	}): AutoConnectActiveConnectionMissingEvent =>
		withSource({
			kind: 'auto-connect.active-connection.missing',
			source: input.source,
			message: input.message,
		}),
	activeConnectionShellStarted: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		message?: string;
	}): AutoConnectActiveConnectionShellStartedEvent =>
		withSource({
			kind: 'auto-connect.active-connection.shell-started',
			source: input.source,
			message: input.message,
			connection: copyConnectionIdentity(input.connection),
		}),
	activeConnectionShellConnected: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		channelId: number;
		pathname?: string;
		message?: string;
	}): AutoConnectActiveConnectionShellConnectedEvent =>
		withSource({
			kind: 'auto-connect.active-connection.shell-connected',
			source: input.source,
			message: input.message,
			connection: copyConnectionIdentity(input.connection),
			channelId: input.channelId,
			pathname: input.pathname,
		}),
	activeConnectionShellFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		error: unknown;
		tmuxSessionName?: string;
		message?: string;
	}): AutoConnectActiveConnectionShellFailedEvent =>
		withSource({
			kind: 'auto-connect.active-connection.shell-failed',
			source: input.source,
			message: input.message,
			connection: copyConnectionIdentity(input.connection),
			error: serializeConnectionDiagnosticError(input.error),
			tmuxSessionName: input.tmuxSessionName,
		}),
	activeConnectionTmuxAttachFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		error: unknown;
		tmuxAttachFailureReason: string | null;
		tmuxSessionName: string;
		message?: string;
	}): AutoConnectActiveConnectionTmuxAttachFailedEvent =>
		withSource({
			kind: 'auto-connect.active-connection.tmux-attach-failed',
			source: input.source,
			message: input.message,
			connection: copyConnectionIdentity(input.connection),
			error: serializeConnectionDiagnosticError(input.error),
			tmuxAttachFailureReason: input.tmuxAttachFailureReason,
			tmuxSessionName: input.tmuxSessionName,
		}),
	savedEntryConnectStarted: (input: {
		source: ConnectionDiagnosticSource;
		connection?: ConnectionDiagnosticConnectionIdentity;
		message?: string;
	}): AutoConnectSavedEntryConnectStartedEvent =>
		withSource({
			kind: 'auto-connect.saved-entry.connect.started',
			source: input.source,
			message: input.message,
			connection: copyOptionalConnectionIdentity(input.connection),
		}),
	savedEntryConnectConnected: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		connectionId: string;
		channelId: number;
		storedConnectionId?: string;
		message?: string;
	}): AutoConnectSavedEntryConnectConnectedEvent =>
		withSource({
			kind: 'auto-connect.saved-entry.connect.connected',
			source: input.source,
			message: input.message,
			connection: copyConnectionIdentity(input.connection),
			connectionId: input.connectionId,
			channelId: input.channelId,
			storedConnectionId: input.storedConnectionId,
		}),
	savedEntryConnectFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection?: ConnectionDiagnosticConnectionIdentity;
		connectionId?: string;
		storedConnectionId?: string;
		message?: string;
	}): AutoConnectSavedEntryConnectFailedEvent =>
		withSource({
			kind: 'auto-connect.saved-entry.connect.failed',
			source: input.source,
			message: input.message,
			connection: copyOptionalConnectionIdentity(input.connection),
			connectionId: input.connectionId,
			storedConnectionId: input.storedConnectionId,
		}),
	savedEntryConnectThrew: (input: {
		source: ConnectionDiagnosticSource;
		connection?: ConnectionDiagnosticConnectionIdentity;
		error: unknown;
		message?: string;
	}): AutoConnectSavedEntryConnectThrewEvent =>
		withSource({
			kind: 'auto-connect.saved-entry.connect.threw',
			source: input.source,
			message: input.message,
			connection: copyOptionalConnectionIdentity(input.connection),
			error: serializeConnectionDiagnosticError(input.error),
		}),
	savedEntryConnectTmuxAttachFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		connectionId: string;
		tmuxAttachFailureReason: string | null;
		tmuxSessionName: string;
		storedConnectionId: string;
		message?: string;
	}): AutoConnectSavedEntryConnectTmuxAttachFailedEvent =>
		withSource({
			kind: 'auto-connect.saved-entry.connect.tmux-attach-failed',
			source: input.source,
			message: input.message,
			connection: copyConnectionIdentity(input.connection),
			connectionId: input.connectionId,
			tmuxAttachFailureReason: input.tmuxAttachFailureReason,
			tmuxSessionName: input.tmuxSessionName,
			storedConnectionId: input.storedConnectionId,
		}),
	savedEntryRetryStarted: (input: {
		source: ConnectionDiagnosticSource;
		connection?: ConnectionDiagnosticConnectionIdentity;
		message?: string;
	}): AutoConnectSavedEntryRetryStartedEvent =>
		withSource({
			kind: 'auto-connect.saved-entry.retry.started',
			source: input.source,
			message: input.message,
			connection: copyOptionalConnectionIdentity(input.connection),
		}),
	savedEntryRetryThrew: (input: {
		source: ConnectionDiagnosticSource;
		connection?: ConnectionDiagnosticConnectionIdentity;
		error: unknown;
		message?: string;
	}): AutoConnectSavedEntryRetryThrewEvent =>
		withSource({
			kind: 'auto-connect.saved-entry.retry.threw',
			source: input.source,
			message: input.message,
			connection: copyOptionalConnectionIdentity(input.connection),
			error: serializeConnectionDiagnosticError(input.error),
		}),
} as const;
