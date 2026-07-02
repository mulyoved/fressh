import { copyConnectionIdentity } from './identity';
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

export type SshConnectStartedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.connect.started';
	connection: ConnectionDiagnosticConnectionIdentity;
};

export type SshConnectProgressEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.connect.progress';
	connection: ConnectionDiagnosticConnectionIdentity;
	phase?: string;
};

export type SshConnectConnectedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.connect.connected';
	connection: ConnectionDiagnosticConnectionIdentity;
	storedConnectionId: string;
};

export type SshConnectFailedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.connect.failed';
	connection: ConnectionDiagnosticConnectionIdentity;
	error: ConnectionDiagnosticError;
};

export type SshShellStartedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.shell.started';
	connection: ConnectionDiagnosticConnectionIdentity;
};

export type SshShellConnectedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.shell.connected';
	connection: ConnectionDiagnosticConnectionIdentity;
	channelId: number;
	storedConnectionId: string;
};

export type SshShellFailedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.shell.failed';
	connection: ConnectionDiagnosticConnectionIdentity;
	error: ConnectionDiagnosticError;
	storedConnectionId: string;
};

export type SshShellTmuxAttachFailedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.shell.tmux-attach-failed';
	connection: ConnectionDiagnosticConnectionIdentity;
	error: ConnectionDiagnosticError;
	tmuxAttachFailureReason: string | null;
	storedConnectionId: string;
};

export type DiagnosticDisconnectedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.diagnostic.disconnected';
	connection: ConnectionDiagnosticConnectionIdentity;
};

export type DiagnosticDisconnectFailedEvent = ConnectionDiagnosticEventBase & {
	kind: 'ssh.diagnostic.disconnect-failed';
	connection: ConnectionDiagnosticConnectionIdentity;
	error: ConnectionDiagnosticError;
};

export type SshDiagnosticEvent =
	| SshConnectStartedEvent
	| SshConnectProgressEvent
	| SshConnectConnectedEvent
	| SshConnectFailedEvent
	| SshShellStartedEvent
	| SshShellConnectedEvent
	| SshShellFailedEvent
	| SshShellTmuxAttachFailedEvent
	| DiagnosticDisconnectedEvent
	| DiagnosticDisconnectFailedEvent;

export const sshDiagnosticEventKinds = [
	'ssh.connect.started',
	'ssh.connect.progress',
	'ssh.connect.connected',
	'ssh.connect.failed',
	'ssh.shell.started',
	'ssh.shell.connected',
	'ssh.shell.failed',
	'ssh.shell.tmux-attach-failed',
	'ssh.diagnostic.disconnected',
	'ssh.diagnostic.disconnect-failed',
] as const satisfies readonly SshDiagnosticEvent['kind'][];

export const sshEvents = {
	connectStarted: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
	}): SshConnectStartedEvent =>
		({
			kind: 'ssh.connect.started',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
		}),
	connectProgress: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		phase?: string;
		message?: string;
	}): SshConnectProgressEvent =>
		({
			kind: 'ssh.connect.progress',
			source: input.source,
			...(input.message === undefined ? {} : { message: input.message }),
			connection: copyConnectionIdentity(input.connection),
			phase: input.phase,
		}),
	connectConnected: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		storedConnectionId: string;
	}): SshConnectConnectedEvent =>
		({
			kind: 'ssh.connect.connected',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
			storedConnectionId: input.storedConnectionId,
		}),
	connectFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		error: unknown;
	}): SshConnectFailedEvent =>
		({
			kind: 'ssh.connect.failed',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
			error: serializeConnectionDiagnosticError(input.error),
		}),
	shellStarted: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
	}): SshShellStartedEvent =>
		({
			kind: 'ssh.shell.started',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
		}),
	shellConnected: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		channelId: number;
		storedConnectionId: string;
	}): SshShellConnectedEvent =>
		({
			kind: 'ssh.shell.connected',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
			channelId: input.channelId,
			storedConnectionId: input.storedConnectionId,
		}),
	shellFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		error: unknown;
		storedConnectionId: string;
	}): SshShellFailedEvent =>
		({
			kind: 'ssh.shell.failed',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
			error: serializeConnectionDiagnosticError(input.error),
			storedConnectionId: input.storedConnectionId,
		}),
	shellTmuxAttachFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		error: unknown;
		tmuxAttachFailureReason: string | null;
		storedConnectionId: string;
	}): SshShellTmuxAttachFailedEvent =>
		({
			kind: 'ssh.shell.tmux-attach-failed',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
			error: serializeConnectionDiagnosticError(input.error),
			tmuxAttachFailureReason: input.tmuxAttachFailureReason,
			storedConnectionId: input.storedConnectionId,
		}),
	diagnosticDisconnected: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		message?: string;
	}): DiagnosticDisconnectedEvent =>
		({
			kind: 'ssh.diagnostic.disconnected',
			source: input.source,
			message: input.message,
			connection: copyConnectionIdentity(input.connection),
		}),
	diagnosticDisconnectFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		error: unknown;
		message?: string;
	}): DiagnosticDisconnectFailedEvent =>
		({
			kind: 'ssh.diagnostic.disconnect-failed',
			source: input.source,
			message: input.message,
			connection: copyConnectionIdentity(input.connection),
			error: serializeConnectionDiagnosticError(input.error),
		}),
} as const;

export function formatSshEventFields(event: SshDiagnosticEvent): string[] {
	switch (event.kind) {
		case 'ssh.connect.progress':
			return event.phase ? [`phase=${safeDiagnosticString(event.phase)}`] : [];
		case 'ssh.connect.connected':
			return [
				`storedConnectionId=${safeDiagnosticString(event.storedConnectionId)}`,
			];
		case 'ssh.shell.connected':
			return [
				`channelId=${event.channelId}`,
				`storedConnectionId=${safeDiagnosticString(event.storedConnectionId)}`,
			];
		case 'ssh.shell.failed':
			return [
				`storedConnectionId=${safeDiagnosticString(event.storedConnectionId)}`,
			];
		case 'ssh.shell.tmux-attach-failed':
			return [
				`tmuxAttachFailureReason=${
					event.tmuxAttachFailureReason === null
						? 'unknown'
						: safeDiagnosticString(event.tmuxAttachFailureReason)
				}`,
				`storedConnectionId=${safeDiagnosticString(event.storedConnectionId)}`,
			];
		case 'ssh.connect.started':
		case 'ssh.connect.failed':
		case 'ssh.shell.started':
		case 'ssh.diagnostic.disconnected':
		case 'ssh.diagnostic.disconnect-failed':
			return [];
	}
	const unreachable: never = event;
	return unreachable;
}
