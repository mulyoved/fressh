import {
	copyConnectionIdentity,
	copyOptionalConnectionIdentity,
} from './identity';
import {
	safeDiagnosticString,
	serializeConnectionDiagnosticError,
} from './snapshot';
import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticError,
	type ConnectionDiagnosticEventBase,
	type ConnectionDiagnosticSource,
} from './types';

export type AutoConnectSavedEntryTrigger =
	| 'auto-connect'
	| 'reconnect'
	| 'manual-diagnostic';

type AutoConnectSavedEntryMetadata = {
	trigger?: AutoConnectSavedEntryTrigger;
	host?: string;
	port?: number;
	tmuxSessionName?: string;
	failureClass?: string;
};

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
	} & AutoConnectSavedEntryMetadata;

export type AutoConnectSavedEntryConnectConnectedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.saved-entry.connect.connected';
		connection: ConnectionDiagnosticConnectionIdentity;
		connectionId: string;
		channelId: number;
		storedConnectionId?: string;
	} & AutoConnectSavedEntryMetadata;

export type AutoConnectSavedEntryConnectFailedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.saved-entry.connect.failed';
		connection?: ConnectionDiagnosticConnectionIdentity;
		connectionId?: string;
		storedConnectionId?: string;
	} & AutoConnectSavedEntryMetadata;

export type AutoConnectSavedEntryConnectThrewEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.saved-entry.connect.threw';
		connection?: ConnectionDiagnosticConnectionIdentity;
		error: ConnectionDiagnosticError;
	} & AutoConnectSavedEntryMetadata;

export type AutoConnectSavedEntryConnectTmuxAttachFailedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.saved-entry.connect.tmux-attach-failed';
		connection: ConnectionDiagnosticConnectionIdentity;
		connectionId: string;
		tmuxAttachFailureReason: string | null;
		tmuxSessionName: string;
		storedConnectionId: string;
	} & AutoConnectSavedEntryMetadata;

export type AutoConnectSavedEntryRetryStartedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.saved-entry.retry.started';
		connection?: ConnectionDiagnosticConnectionIdentity;
	} & AutoConnectSavedEntryMetadata;

export type AutoConnectSavedEntryRetryThrewEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'auto-connect.saved-entry.retry.threw';
		connection?: ConnectionDiagnosticConnectionIdentity;
		error: ConnectionDiagnosticError;
	} & AutoConnectSavedEntryMetadata;

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

export const autoConnectEvents = {
	latestShellSelected: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		channelId: number;
		pathname: string;
		message?: string;
	}): AutoConnectLatestShellSelectedEvent =>
		({
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
		({
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
		({
			kind: 'auto-connect.active-connection.selected',
			source: input.source,
			message: input.message,
			connection: copyConnectionIdentity(input.connection),
		}),
	activeConnectionMissing: (input: {
		source: ConnectionDiagnosticSource;
		message?: string;
	}): AutoConnectActiveConnectionMissingEvent =>
		({
			kind: 'auto-connect.active-connection.missing',
			source: input.source,
			message: input.message,
		}),
	activeConnectionShellStarted: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		message?: string;
	}): AutoConnectActiveConnectionShellStartedEvent =>
		({
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
		({
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
		({
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
		({
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
		trigger?: AutoConnectSavedEntryMetadata['trigger'];
		host?: string;
		port?: number;
		tmuxSessionName?: string;
		failureClass?: string;
		message?: string;
	}): AutoConnectSavedEntryConnectStartedEvent =>
		({
			kind: 'auto-connect.saved-entry.connect.started',
			source: input.source,
			message: input.message,
			connection: copyOptionalConnectionIdentity(input.connection),
			trigger: input.trigger,
			host: input.host ?? input.connection?.host,
			port: input.port ?? input.connection?.port,
			tmuxSessionName: input.tmuxSessionName,
			failureClass: input.failureClass,
		}),
	savedEntryConnectConnected: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		connectionId: string;
		channelId: number;
		storedConnectionId?: string;
		trigger?: AutoConnectSavedEntryMetadata['trigger'];
		host?: string;
		port?: number;
		tmuxSessionName?: string;
		failureClass?: string;
		message?: string;
	}): AutoConnectSavedEntryConnectConnectedEvent =>
		({
			kind: 'auto-connect.saved-entry.connect.connected',
			source: input.source,
			message: input.message,
			connection: copyConnectionIdentity(input.connection),
			connectionId: input.connectionId,
			channelId: input.channelId,
			storedConnectionId: input.storedConnectionId,
			trigger: input.trigger,
			host: input.host ?? input.connection.host,
			port: input.port ?? input.connection.port,
			tmuxSessionName: input.tmuxSessionName,
			failureClass: input.failureClass,
		}),
	savedEntryConnectFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection?: ConnectionDiagnosticConnectionIdentity;
		connectionId?: string;
		storedConnectionId?: string;
		trigger?: AutoConnectSavedEntryMetadata['trigger'];
		host?: string;
		port?: number;
		tmuxSessionName?: string;
		failureClass?: string;
		message?: string;
	}): AutoConnectSavedEntryConnectFailedEvent =>
		({
			kind: 'auto-connect.saved-entry.connect.failed',
			source: input.source,
			message: input.message,
			connection: copyOptionalConnectionIdentity(input.connection),
			connectionId: input.connectionId,
			storedConnectionId: input.storedConnectionId,
			trigger: input.trigger,
			host: input.host ?? input.connection?.host,
			port: input.port ?? input.connection?.port,
			tmuxSessionName: input.tmuxSessionName,
			failureClass: input.failureClass,
		}),
	savedEntryConnectThrew: (input: {
		source: ConnectionDiagnosticSource;
		connection?: ConnectionDiagnosticConnectionIdentity;
		error: unknown;
		trigger?: AutoConnectSavedEntryMetadata['trigger'];
		host?: string;
		port?: number;
		tmuxSessionName?: string;
		failureClass?: string;
		message?: string;
	}): AutoConnectSavedEntryConnectThrewEvent =>
		({
			kind: 'auto-connect.saved-entry.connect.threw',
			source: input.source,
			message: input.message,
			connection: copyOptionalConnectionIdentity(input.connection),
			error: serializeConnectionDiagnosticError(input.error),
			trigger: input.trigger,
			host: input.host ?? input.connection?.host,
			port: input.port ?? input.connection?.port,
			tmuxSessionName: input.tmuxSessionName,
			failureClass: input.failureClass,
		}),
	savedEntryConnectTmuxAttachFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		connectionId: string;
		tmuxAttachFailureReason: string | null;
		tmuxSessionName: string;
		storedConnectionId: string;
		trigger?: AutoConnectSavedEntryMetadata['trigger'];
		host?: string;
		port?: number;
		failureClass?: string;
		message?: string;
	}): AutoConnectSavedEntryConnectTmuxAttachFailedEvent =>
		({
			kind: 'auto-connect.saved-entry.connect.tmux-attach-failed',
			source: input.source,
			message: input.message,
			connection: copyConnectionIdentity(input.connection),
			connectionId: input.connectionId,
			tmuxAttachFailureReason: input.tmuxAttachFailureReason,
			tmuxSessionName: input.tmuxSessionName,
			storedConnectionId: input.storedConnectionId,
			trigger: input.trigger,
			host: input.host ?? input.connection.host,
			port: input.port ?? input.connection.port,
			failureClass: input.failureClass,
		}),
	savedEntryRetryStarted: (input: {
		source: ConnectionDiagnosticSource;
		connection?: ConnectionDiagnosticConnectionIdentity;
		trigger?: AutoConnectSavedEntryMetadata['trigger'];
		host?: string;
		port?: number;
		tmuxSessionName?: string;
		failureClass?: string;
		message?: string;
	}): AutoConnectSavedEntryRetryStartedEvent =>
		({
			kind: 'auto-connect.saved-entry.retry.started',
			source: input.source,
			message: input.message,
			connection: copyOptionalConnectionIdentity(input.connection),
			trigger: input.trigger,
			host: input.host ?? input.connection?.host,
			port: input.port ?? input.connection?.port,
			tmuxSessionName: input.tmuxSessionName,
			failureClass: input.failureClass,
		}),
	savedEntryRetryThrew: (input: {
		source: ConnectionDiagnosticSource;
		connection?: ConnectionDiagnosticConnectionIdentity;
		error: unknown;
		trigger?: AutoConnectSavedEntryMetadata['trigger'];
		host?: string;
		port?: number;
		tmuxSessionName?: string;
		failureClass?: string;
		message?: string;
	}): AutoConnectSavedEntryRetryThrewEvent =>
		({
			kind: 'auto-connect.saved-entry.retry.threw',
			source: input.source,
			message: input.message,
			connection: copyOptionalConnectionIdentity(input.connection),
			error: serializeConnectionDiagnosticError(input.error),
			trigger: input.trigger,
			host: input.host ?? input.connection?.host,
			port: input.port ?? input.connection?.port,
			tmuxSessionName: input.tmuxSessionName,
			failureClass: input.failureClass,
		}),
} as const;

export function formatAutoConnectEventFields(
	event: AutoConnectEvent,
): string[] {
	switch (event.kind) {
		case 'auto-connect.latest-shell.selected':
			return [
				`channelId=${event.channelId}`,
				`pathname=${safeDiagnosticString(event.pathname)}`,
			];
		case 'auto-connect.latest-shell.missing':
			return [`pathname=${safeDiagnosticString(event.pathname)}`];
		case 'auto-connect.active-connection.shell-connected':
			return [
				`channelId=${event.channelId}`,
				...(event.pathname
					? [`pathname=${safeDiagnosticString(event.pathname)}`]
					: []),
			];
		case 'auto-connect.active-connection.shell-failed':
			return event.tmuxSessionName
				? [`tmuxSessionName=${safeDiagnosticString(event.tmuxSessionName)}`]
				: [];
		case 'auto-connect.active-connection.tmux-attach-failed':
			return [
				`tmuxAttachFailureReason=${
					event.tmuxAttachFailureReason === null
						? 'unknown'
						: safeDiagnosticString(event.tmuxAttachFailureReason)
				}`,
				`tmuxSessionName=${safeDiagnosticString(event.tmuxSessionName)}`,
			];
		case 'auto-connect.saved-entry.connect.connected':
			return [
				`connectionId=${safeDiagnosticString(event.connectionId)}`,
				`channelId=${event.channelId}`,
				...(event.trigger
					? [`trigger=${safeDiagnosticString(event.trigger)}`]
					: []),
				...(event.storedConnectionId
					? [
							`storedConnectionId=${safeDiagnosticString(
								event.storedConnectionId,
							)}`,
						]
					: []),
				...(event.host ? [`host=${safeDiagnosticString(event.host)}`] : []),
				...(typeof event.port === 'number' ? [`port=${event.port}`] : []),
				...(event.tmuxSessionName
					? [`tmuxSessionName=${safeDiagnosticString(event.tmuxSessionName)}`]
					: []),
				...(event.failureClass
					? [`failureClass=${safeDiagnosticString(event.failureClass)}`]
					: []),
			];
		case 'auto-connect.saved-entry.connect.failed':
			return [
				...(event.trigger
					? [`trigger=${safeDiagnosticString(event.trigger)}`]
					: []),
				...(event.connectionId
					? [`connectionId=${safeDiagnosticString(event.connectionId)}`]
					: []),
				...(event.storedConnectionId
					? [
							`storedConnectionId=${safeDiagnosticString(
								event.storedConnectionId,
							)}`,
						]
					: []),
				...(event.host ? [`host=${safeDiagnosticString(event.host)}`] : []),
				...(typeof event.port === 'number' ? [`port=${event.port}`] : []),
				...(event.tmuxSessionName
					? [`tmuxSessionName=${safeDiagnosticString(event.tmuxSessionName)}`]
					: []),
				...(event.failureClass
					? [`failureClass=${safeDiagnosticString(event.failureClass)}`]
					: []),
			];
		case 'auto-connect.saved-entry.connect.tmux-attach-failed':
			return [
				`connectionId=${safeDiagnosticString(event.connectionId)}`,
				...(event.trigger
					? [`trigger=${safeDiagnosticString(event.trigger)}`]
					: []),
				`tmuxAttachFailureReason=${
					event.tmuxAttachFailureReason === null
						? 'unknown'
						: safeDiagnosticString(event.tmuxAttachFailureReason)
				}`,
				`tmuxSessionName=${safeDiagnosticString(event.tmuxSessionName)}`,
				`storedConnectionId=${safeDiagnosticString(event.storedConnectionId)}`,
				...(event.host ? [`host=${safeDiagnosticString(event.host)}`] : []),
				...(typeof event.port === 'number' ? [`port=${event.port}`] : []),
				...(event.failureClass
					? [`failureClass=${safeDiagnosticString(event.failureClass)}`]
					: []),
			];
		case 'auto-connect.saved-entry.connect.started':
		case 'auto-connect.saved-entry.connect.threw':
		case 'auto-connect.saved-entry.retry.started':
		case 'auto-connect.saved-entry.retry.threw':
			return [
				...(event.trigger
					? [`trigger=${safeDiagnosticString(event.trigger)}`]
					: []),
				...(event.host ? [`host=${safeDiagnosticString(event.host)}`] : []),
				...(typeof event.port === 'number' ? [`port=${event.port}`] : []),
				...(event.tmuxSessionName
					? [`tmuxSessionName=${safeDiagnosticString(event.tmuxSessionName)}`]
					: []),
				...(event.failureClass
					? [`failureClass=${safeDiagnosticString(event.failureClass)}`]
					: []),
			];
		case 'auto-connect.active-connection.selected':
		case 'auto-connect.active-connection.missing':
		case 'auto-connect.active-connection.shell-started':
			return [];
	}
	const unreachable: never = event;
	return unreachable;
}
