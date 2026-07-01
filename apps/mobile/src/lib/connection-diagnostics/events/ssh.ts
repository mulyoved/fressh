import { copyConnectionIdentity } from './identity';
import { serializeConnectionDiagnosticError } from './snapshot';
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

const withSource = <T extends SshDiagnosticEvent>(event: T): T => event;

export const sshEvents = {
	connectStarted: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
	}): SshConnectStartedEvent =>
		withSource({
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
		withSource({
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
		withSource({
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
		withSource({
			kind: 'ssh.connect.failed',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
			error: serializeConnectionDiagnosticError(input.error),
		}),
	shellStarted: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
	}): SshShellStartedEvent =>
		withSource({
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
		withSource({
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
		withSource({
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
		withSource({
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
		withSource({
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
		withSource({
			kind: 'ssh.diagnostic.disconnect-failed',
			source: input.source,
			message: input.message,
			connection: copyConnectionIdentity(input.connection),
			error: serializeConnectionDiagnosticError(input.error),
		}),
} as const;
