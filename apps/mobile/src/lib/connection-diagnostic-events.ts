import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticError,
	type ConnectionDiagnosticSource,
} from './connection-diagnostic-types';
import {
	type TailscaleReadyResult,
	type TailscaleRecoverAfterFailureResult,
} from './tailscale-recovery-core';

export type ConnectionDiagnosticEventBase = {
	source: ConnectionDiagnosticSource;
	message?: string;
};

export type SavedEntrySelectedEvent = ConnectionDiagnosticEventBase & {
	kind: 'saved-entry.selected';
	connection: ConnectionDiagnosticConnectionIdentity;
};

export type SavedEntryMissingEvent = ConnectionDiagnosticEventBase & {
	kind: 'saved-entry.missing';
};

export type SavedEntryInvalidTmuxSettingsEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'saved-entry.invalid-tmux-settings';
		connection: ConnectionDiagnosticConnectionIdentity;
		useTmuxType: string;
		tmuxSessionNameType: string;
	};

export type KeyResolvedEvent = ConnectionDiagnosticEventBase & {
	kind: 'key.resolved';
	connection: ConnectionDiagnosticConnectionIdentity;
};

export type KeyMissingEvent = ConnectionDiagnosticEventBase & {
	kind: 'key.missing';
	connection: ConnectionDiagnosticConnectionIdentity;
};

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

export type TailscaleEnsureReadyEvent = ConnectionDiagnosticEventBase & {
	kind: 'tailscale.ensure-ready.result';
	platformOS: string;
	readiness: TailscaleReadyResult;
};

export type TailscaleRecoveryResultEvent = ConnectionDiagnosticEventBase & {
	kind: 'tailscale.recovery.result';
	recoveryResult: TailscaleRecoverAfterFailureResult;
};

export type ReconnectStartedEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.started';
	reason: string;
	windowMs: number;
};

export type ReconnectStoppedEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.stopped';
	reason: string;
};

export type ReconnectStartBlockedEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.start.blocked';
	reason: string;
	isAutoConnecting?: boolean;
	isReconnecting?: boolean;
	resetInFlight?: boolean;
};

export type ReconnectRetryScheduledEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.retry.scheduled';
	attemptIndex: number;
	delayMs: number;
};

export type ReconnectAttemptStartedEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.attempt.started';
	reconnectElapsedMs: number;
};

export type ReconnectAttemptConnectedEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.attempt.connected';
	reconnectElapsedMs: number;
};

export type ReconnectAttemptFailedEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.attempt.failed';
	reconnectElapsedMs: number;
};

export type ReconnectTimeoutEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.timeout';
	reconnectElapsedMs: number;
	windowMs: number;
};

export type ReconnectEvent =
	| ReconnectStartedEvent
	| ReconnectStoppedEvent
	| ReconnectStartBlockedEvent
	| ReconnectRetryScheduledEvent
	| ReconnectAttemptStartedEvent
	| ReconnectAttemptConnectedEvent
	| ReconnectAttemptFailedEvent
	| ReconnectTimeoutEvent;

export type ManualDiagnosticSavedEntryMissingEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'manual-diagnostic.saved-entry.missing';
	};

export type ManualDiagnosticTailscaleAttentionEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'manual-diagnostic.tailscale.attention';
		message: string;
	};

export type ManualDiagnosticTailscaleAttentionClearedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'manual-diagnostic.tailscale.attention-cleared';
	};

export type ManualDiagnosticTmuxAttachFailedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'manual-diagnostic.tmux-attach-failed';
		connection: ConnectionDiagnosticConnectionIdentity;
		tmuxAttachFailureReason: string | null;
	};

export type ManualDiagnosticWarningEvent = ConnectionDiagnosticEventBase & {
	kind: 'manual-diagnostic.warning';
	message: string;
	error: ConnectionDiagnosticError;
};

export type ManualDiagnosticTimeoutEvent = ConnectionDiagnosticEventBase & {
	kind: 'manual-diagnostic.timeout';
	message: string;
	timeoutMs: number;
};

export type ManualDiagnosticFailedEvent = ConnectionDiagnosticEventBase & {
	kind: 'manual-diagnostic.failed';
	error: ConnectionDiagnosticError;
};

export type ManualDiagnosticEvent =
	| ManualDiagnosticSavedEntryMissingEvent
	| ManualDiagnosticTailscaleAttentionEvent
	| ManualDiagnosticTailscaleAttentionClearedEvent
	| ManualDiagnosticTmuxAttachFailedEvent
	| ManualDiagnosticWarningEvent
	| ManualDiagnosticTimeoutEvent
	| ManualDiagnosticFailedEvent;

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

export type ActiveConnectionEvent =
	| AutoConnectLatestShellSelectedEvent
	| AutoConnectLatestShellMissingEvent
	| AutoConnectActiveConnectionSelectedEvent
	| AutoConnectActiveConnectionMissingEvent
	| AutoConnectActiveConnectionShellStartedEvent
	| AutoConnectActiveConnectionShellConnectedEvent
	| AutoConnectActiveConnectionShellFailedEvent
	| AutoConnectActiveConnectionTmuxAttachFailedEvent;

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

export type SavedEntryConnectEvent =
	| AutoConnectSavedEntryConnectStartedEvent
	| AutoConnectSavedEntryConnectConnectedEvent
	| AutoConnectSavedEntryConnectFailedEvent
	| AutoConnectSavedEntryConnectThrewEvent
	| AutoConnectSavedEntryConnectTmuxAttachFailedEvent
	| AutoConnectSavedEntryRetryStartedEvent
	| AutoConnectSavedEntryRetryThrewEvent;

export type ConnectionDiagnosticEvent =
	| SavedEntrySelectedEvent
	| SavedEntryMissingEvent
	| SavedEntryInvalidTmuxSettingsEvent
	| KeyResolvedEvent
	| KeyMissingEvent
	| SshConnectStartedEvent
	| SshConnectProgressEvent
	| SshConnectConnectedEvent
	| SshConnectFailedEvent
	| SshShellStartedEvent
	| SshShellConnectedEvent
	| SshShellFailedEvent
	| SshShellTmuxAttachFailedEvent
	| DiagnosticDisconnectedEvent
	| DiagnosticDisconnectFailedEvent
	| TailscaleEnsureReadyEvent
	| TailscaleRecoveryResultEvent
	| ReconnectEvent
	| ManualDiagnosticEvent
	| ActiveConnectionEvent
	| SavedEntryConnectEvent;

const CIRCULAR_DIAGNOSTIC_INNER_VALUE = '[Circular]';

const connectionIdentityCopyKeys = [
	'savedConnectionId',
	'connectionId',
	'username',
	'host',
	'port',
	'keyId',
	'useTmux',
	'tmuxSessionName',
] as const satisfies readonly (keyof ConnectionDiagnosticConnectionIdentity)[];

type ConnectionIdentityCopyKey = (typeof connectionIdentityCopyKeys)[number];
type ExactConnectionIdentityCopyKeys = [
	Exclude<
		keyof ConnectionDiagnosticConnectionIdentity,
		ConnectionIdentityCopyKey
	>,
	Exclude<
		ConnectionIdentityCopyKey,
		keyof ConnectionDiagnosticConnectionIdentity
	>,
] extends [never, never]
	? true
	: false;

const assertExactConnectionIdentityCopyKeys: ExactConnectionIdentityCopyKeys = true;

const copyConnectionIdentity = (
	connection: ConnectionDiagnosticConnectionIdentity,
): ConnectionDiagnosticConnectionIdentity => {
	void assertExactConnectionIdentityCopyKeys;
	return Object.fromEntries(
		connectionIdentityCopyKeys.flatMap((key) => {
			const value = connection[key];
			return value === undefined ? [] : [[key, value]];
		}),
	) as ConnectionDiagnosticConnectionIdentity;
};

const copyOptionalConnectionIdentity = (
	connection: ConnectionDiagnosticConnectionIdentity | undefined,
): ConnectionDiagnosticConnectionIdentity | undefined =>
	connection === undefined ? undefined : copyConnectionIdentity(connection);

const copyDiagnosticInnerValue = (
	value: unknown,
	path: WeakSet<object> = new WeakSet(),
): unknown => {
	if (value === null) return null;
	if (
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	) {
		return value;
	}
	if (typeof value === 'undefined') return undefined;
	if (typeof value === 'bigint') return `${value}n`;
	if (typeof value === 'function') {
		return '[Function]';
	}
	if (typeof value === 'symbol') return `[Symbol ${value.description ?? ''}]`;
	if (typeof value !== 'object') return '[Unreadable]';

	if (path.has(value)) return CIRCULAR_DIAGNOSTIC_INNER_VALUE;
	if (Array.isArray(value)) {
		const copy: unknown[] = [];
		path.add(value);
		try {
			for (const item of value) {
				copy.push(copyDiagnosticInnerValue(item, path));
			}
		} catch {
			copy.push('[Unreadable]');
		} finally {
			path.delete(value);
		}
		return copy;
	}

	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		return '[Unreadable]';
	}

	const copy: Record<string, unknown> = {};
	path.add(value);
	try {
		for (const key of Object.keys(value)) {
			try {
				copy[key] = copyDiagnosticInnerValue(
					(value as Record<string, unknown>)[key],
					path,
				);
			} catch {
				copy[key] = '[Unreadable]';
			}
		}
	} catch {
		return '[Unreadable]';
	} finally {
		path.delete(value);
	}
	return copy;
};

const copyDiagnosticError = (
	error: ConnectionDiagnosticError,
): ConnectionDiagnosticError => {
	const copy: ConnectionDiagnosticError = {
		name: error.name,
		message: error.message,
	};
	if (error.stack !== undefined) {
		copy.stack = error.stack;
	}
	if (error.tag !== undefined) {
		copy.tag = error.tag;
	}
	if (error.inner !== undefined) {
		copy.inner = copyDiagnosticInnerValue(error.inner);
	}
	return copy;
};

const copyTailscaleReadyResult = (
	readiness: TailscaleReadyResult,
): TailscaleReadyResult => {
	switch (readiness.kind) {
		case 'unsupported':
			return {
				kind: 'unsupported',
				attempted: readiness.attempted,
				available: readiness.available,
			};
		case 'unavailable':
			return {
				kind: 'unavailable',
				attempted: readiness.attempted,
				available: readiness.available,
			};
		case 'ready':
			return {
				kind: 'ready',
				attempted: readiness.attempted,
				available: readiness.available,
			};
		case 'cooldown':
			return {
				kind: 'cooldown',
				attempted: readiness.attempted,
				available: readiness.available,
			};
		case 'notStarted':
			return {
				kind: 'notStarted',
				attempted: readiness.attempted,
				available: readiness.available,
			};
		case 'failed':
			return {
				kind: 'failed',
				attempted: readiness.attempted,
				available: readiness.available,
			};
	}
	const unreachable: never = readiness;
	return unreachable;
};

const copyTailscaleRecoverAfterFailureResult = (
	recoveryResult: TailscaleRecoverAfterFailureResult,
): TailscaleRecoverAfterFailureResult => {
	switch (recoveryResult.kind) {
		case 'nonNetworkFailure':
			return {
				kind: 'nonNetworkFailure',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
			};
		case 'unsupported':
			return {
				kind: 'unsupported',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
			};
		case 'unavailable':
			return {
				kind: 'unavailable',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
			};
		case 'cooldown':
			return {
				kind: 'cooldown',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
			};
		case 'notStarted':
			return {
				kind: 'notStarted',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
			};
		case 'preflightReady':
			return {
				kind: 'preflightReady',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
			};
		case 'recovered':
			return {
				kind: 'recovered',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
			};
		case 'failed':
			return {
				kind: 'failed',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
			};
	}
	const unreachable: never = recoveryResult;
	return unreachable;
};

const withSource = <T extends ConnectionDiagnosticEvent>(event: T): T => event;

export const diagnosticEvents = {
	savedEntrySelected: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
	}): SavedEntrySelectedEvent =>
		withSource({
			kind: 'saved-entry.selected',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
		}),
	savedEntryMissing: (input: {
		source: ConnectionDiagnosticSource;
		message?: string;
	}): SavedEntryMissingEvent =>
		withSource({
			kind: 'saved-entry.missing',
			source: input.source,
			message: input.message,
		}),
	savedEntryInvalidTmuxSettings: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		useTmuxType: string;
		tmuxSessionNameType: string;
	}): SavedEntryInvalidTmuxSettingsEvent =>
		withSource({
			kind: 'saved-entry.invalid-tmux-settings',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
			useTmuxType: input.useTmuxType,
			tmuxSessionNameType: input.tmuxSessionNameType,
		}),
	keyResolved: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
	}): KeyResolvedEvent =>
		withSource({
			kind: 'key.resolved',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
		}),
	keyMissing: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
	}): KeyMissingEvent =>
		withSource({
			kind: 'key.missing',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
		}),
	sshConnectStarted: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
	}): SshConnectStartedEvent =>
		withSource({
			kind: 'ssh.connect.started',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
		}),
	sshConnectProgress: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		phase?: string;
	}): SshConnectProgressEvent =>
		withSource({
			kind: 'ssh.connect.progress',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
			phase: input.phase,
		}),
	sshConnectConnected: (input: {
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
	sshConnectFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		error: ConnectionDiagnosticError;
	}): SshConnectFailedEvent =>
		withSource({
			kind: 'ssh.connect.failed',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
			error: copyDiagnosticError(input.error),
		}),
	sshShellStarted: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
	}): SshShellStartedEvent =>
		withSource({
			kind: 'ssh.shell.started',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
		}),
	sshShellConnected: (input: {
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
	sshShellFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		error: ConnectionDiagnosticError;
		storedConnectionId: string;
	}): SshShellFailedEvent =>
		withSource({
			kind: 'ssh.shell.failed',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
			error: copyDiagnosticError(input.error),
			storedConnectionId: input.storedConnectionId,
		}),
	sshShellTmuxAttachFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		error: ConnectionDiagnosticError;
		tmuxAttachFailureReason: string | null;
		storedConnectionId: string;
	}): SshShellTmuxAttachFailedEvent =>
		withSource({
			kind: 'ssh.shell.tmux-attach-failed',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
			error: copyDiagnosticError(input.error),
			tmuxAttachFailureReason: input.tmuxAttachFailureReason,
			storedConnectionId: input.storedConnectionId,
		}),
	manualDiagnosticTimeout: (input: {
		timeoutMs: number;
		message: string;
	}): ManualDiagnosticTimeoutEvent =>
		withSource({
			kind: 'manual-diagnostic.timeout',
			source: 'manual-diagnostic',
			timeoutMs: input.timeoutMs,
			message: input.message,
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
		error: ConnectionDiagnosticError;
		message?: string;
	}): DiagnosticDisconnectFailedEvent =>
		withSource({
			kind: 'ssh.diagnostic.disconnect-failed',
			source: input.source,
			message: input.message,
			connection: copyConnectionIdentity(input.connection),
			error: copyDiagnosticError(input.error),
		}),
	tailscaleEnsureReadyResult: (input: {
		source: ConnectionDiagnosticSource;
		platformOS: string;
		readiness: TailscaleReadyResult;
		message?: string;
	}): TailscaleEnsureReadyEvent =>
		withSource({
			kind: 'tailscale.ensure-ready.result',
			source: input.source,
			message: input.message,
			platformOS: input.platformOS,
			readiness: copyTailscaleReadyResult(input.readiness),
		}),
	tailscaleRecoveryResult: (input: {
		source: ConnectionDiagnosticSource;
		recoveryResult: TailscaleRecoverAfterFailureResult;
		message?: string;
	}): TailscaleRecoveryResultEvent =>
		withSource({
			kind: 'tailscale.recovery.result',
			source: input.source,
			message: input.message,
			recoveryResult: copyTailscaleRecoverAfterFailureResult(
				input.recoveryResult,
			),
		}),
	reconnect: (input: ReconnectEvent): ReconnectEvent => {
		switch (input.kind) {
			case 'reconnect.started':
				return withSource({
					kind: 'reconnect.started',
					source: input.source,
					message: input.message,
					reason: input.reason,
					windowMs: input.windowMs,
				});
			case 'reconnect.stopped':
				return withSource({
					kind: 'reconnect.stopped',
					source: input.source,
					message: input.message,
					reason: input.reason,
				});
			case 'reconnect.start.blocked':
				return withSource({
					kind: 'reconnect.start.blocked',
					source: input.source,
					message: input.message,
					reason: input.reason,
					isAutoConnecting: input.isAutoConnecting,
					isReconnecting: input.isReconnecting,
					resetInFlight: input.resetInFlight,
				});
			case 'reconnect.retry.scheduled':
				return withSource({
					kind: 'reconnect.retry.scheduled',
					source: input.source,
					message: input.message,
					attemptIndex: input.attemptIndex,
					delayMs: input.delayMs,
				});
			case 'reconnect.attempt.started':
				return withSource({
					kind: 'reconnect.attempt.started',
					source: input.source,
					message: input.message,
					reconnectElapsedMs: input.reconnectElapsedMs,
				});
			case 'reconnect.attempt.connected':
				return withSource({
					kind: 'reconnect.attempt.connected',
					source: input.source,
					message: input.message,
					reconnectElapsedMs: input.reconnectElapsedMs,
				});
			case 'reconnect.attempt.failed':
				return withSource({
					kind: 'reconnect.attempt.failed',
					source: input.source,
					message: input.message,
					reconnectElapsedMs: input.reconnectElapsedMs,
				});
			case 'reconnect.timeout':
				return withSource({
					kind: 'reconnect.timeout',
					source: input.source,
					message: input.message,
					reconnectElapsedMs: input.reconnectElapsedMs,
					windowMs: input.windowMs,
				});
		}
		const unreachable: never = input;
		return unreachable;
	},
	manualDiagnosticSavedEntryMissing: (input: {
		source: ConnectionDiagnosticSource;
		message?: string;
	}): ManualDiagnosticSavedEntryMissingEvent =>
		withSource({
			kind: 'manual-diagnostic.saved-entry.missing',
			source: input.source,
			message: input.message,
		}),
	manualDiagnosticTailscaleAttention: (input: {
		source: ConnectionDiagnosticSource;
		message: string;
	}): ManualDiagnosticTailscaleAttentionEvent =>
		withSource({
			kind: 'manual-diagnostic.tailscale.attention',
			source: input.source,
			message: input.message,
		}),
	manualDiagnosticTailscaleAttentionCleared: (input: {
		source: ConnectionDiagnosticSource;
		message?: string;
	}): ManualDiagnosticTailscaleAttentionClearedEvent =>
		withSource({
			kind: 'manual-diagnostic.tailscale.attention-cleared',
			source: input.source,
			message: input.message,
		}),
	manualDiagnosticTmuxAttachFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		tmuxAttachFailureReason: string | null;
		message?: string;
	}): ManualDiagnosticTmuxAttachFailedEvent =>
		withSource({
			kind: 'manual-diagnostic.tmux-attach-failed',
			source: input.source,
			message: input.message,
			connection: copyConnectionIdentity(input.connection),
			tmuxAttachFailureReason: input.tmuxAttachFailureReason,
		}),
	manualDiagnosticWarning: (input: {
		source: ConnectionDiagnosticSource;
		message: string;
		error: ConnectionDiagnosticError;
	}): ManualDiagnosticWarningEvent =>
		withSource({
			kind: 'manual-diagnostic.warning',
			source: input.source,
			message: input.message,
			error: copyDiagnosticError(input.error),
		}),
	manualDiagnosticFailed: (input: {
		source: ConnectionDiagnosticSource;
		error: ConnectionDiagnosticError;
		message?: string;
	}): ManualDiagnosticFailedEvent =>
		withSource({
			kind: 'manual-diagnostic.failed',
			source: input.source,
			message: input.message,
			error: copyDiagnosticError(input.error),
		}),
	autoConnectLatestShellSelected: (input: {
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
	autoConnectLatestShellMissing: (input: {
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
	autoConnectActiveConnectionSelected: (input: {
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
	autoConnectActiveConnectionMissing: (input: {
		source: ConnectionDiagnosticSource;
		message?: string;
	}): AutoConnectActiveConnectionMissingEvent =>
		withSource({
			kind: 'auto-connect.active-connection.missing',
			source: input.source,
			message: input.message,
		}),
	autoConnectActiveConnectionShellStarted: (input: {
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
	autoConnectActiveConnectionShellConnected: (input: {
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
	autoConnectActiveConnectionShellFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		error: ConnectionDiagnosticError;
		tmuxSessionName?: string;
		message?: string;
	}): AutoConnectActiveConnectionShellFailedEvent =>
		withSource({
			kind: 'auto-connect.active-connection.shell-failed',
			source: input.source,
			message: input.message,
			connection: copyConnectionIdentity(input.connection),
			error: copyDiagnosticError(input.error),
			tmuxSessionName: input.tmuxSessionName,
		}),
	autoConnectActiveConnectionTmuxAttachFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		error: ConnectionDiagnosticError;
		tmuxAttachFailureReason: string | null;
		tmuxSessionName: string;
		message?: string;
	}): AutoConnectActiveConnectionTmuxAttachFailedEvent =>
		withSource({
			kind: 'auto-connect.active-connection.tmux-attach-failed',
			source: input.source,
			message: input.message,
			connection: copyConnectionIdentity(input.connection),
			error: copyDiagnosticError(input.error),
			tmuxAttachFailureReason: input.tmuxAttachFailureReason,
			tmuxSessionName: input.tmuxSessionName,
		}),
	autoConnectSavedEntryConnectStarted: (input: {
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
	autoConnectSavedEntryConnectConnected: (input: {
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
	autoConnectSavedEntryConnectFailed: (input: {
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
	autoConnectSavedEntryConnectThrew: (input: {
		source: ConnectionDiagnosticSource;
		connection?: ConnectionDiagnosticConnectionIdentity;
		error: ConnectionDiagnosticError;
		message?: string;
	}): AutoConnectSavedEntryConnectThrewEvent =>
		withSource({
			kind: 'auto-connect.saved-entry.connect.threw',
			source: input.source,
			message: input.message,
			connection: copyOptionalConnectionIdentity(input.connection),
			error: copyDiagnosticError(input.error),
		}),
	autoConnectSavedEntryConnectTmuxAttachFailed: (input: {
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
	autoConnectSavedEntryRetryStarted: (input: {
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
	autoConnectSavedEntryRetryThrew: (input: {
		source: ConnectionDiagnosticSource;
		connection?: ConnectionDiagnosticConnectionIdentity;
		error: ConnectionDiagnosticError;
		message?: string;
	}): AutoConnectSavedEntryRetryThrewEvent =>
		withSource({
			kind: 'auto-connect.saved-entry.retry.threw',
			source: input.source,
			message: input.message,
			connection: copyOptionalConnectionIdentity(input.connection),
			error: copyDiagnosticError(input.error),
		}),
};
