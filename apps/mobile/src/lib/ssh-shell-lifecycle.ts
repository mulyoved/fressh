// eslint-disable-next-line import/consistent-type-specifier-style -- Pure type import keeps Node integration tests from loading React Native.
import type {
	SshConnection,
	SshConnectionProgress,
	SshShell,
} from '@fressh/react-native-uniffi-russh';
import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticEvent,
} from './connection-diagnostic-types';
import {
	serializeConnectionDiagnosticError,
	sshEvents,
} from './connection-diagnostics/events';
import { type InputConnectionDetails } from './connection-storage';
import { extractTmuxAttachFailureReason } from './ssh-error-details';
import { type RegisteredStartShellOptions } from './ssh-registry-store';
import { AbortSignalTimeout } from './utils';

export type SshShellLifecycleResult =
	| {
			status: 'connected';
			sshConnection: SshConnection;
			shellHandle: SshShell;
			connectionId: string;
			channelId: number;
			storedConnectionId: string;
	  }
	| {
			status: 'tmux_attach_failed';
			connectionId: string;
			tmuxAttachFailureReason: string | null;
			tmuxSessionName: string;
			storedConnectionId: string;
	  };

type ConnectedSshConnection = {
	sshConnection: SshConnection;
	storedConnectionId: string;
};

type ShellLifecycleFailureContext = {
	sshConnection: SshConnection;
	storedConnectionId: string;
	tmuxAttachFailureReason: string | null;
	error: unknown;
};

function readSshConnectionProgressPhase(
	progressEvent: SshConnectionProgress,
): string | undefined {
	const event = progressEvent as unknown;
	return typeof event === 'object' &&
		event !== null &&
		'phase' in event &&
		typeof event.phase === 'string'
		? event.phase
		: undefined;
}

export function getSshShellLifecycleConnectionIdentity(
	connectionDetails: InputConnectionDetails,
): ConnectionDiagnosticConnectionIdentity {
	return {
		username: connectionDetails.username,
		host: connectionDetails.host,
		port: connectionDetails.port,
		keyId: connectionDetails.security.keyId,
		useTmux: connectionDetails.useTmux,
		tmuxSessionName: connectionDetails.tmuxSessionName,
	};
}

export async function runSshShellLifecycle(args: {
	connectionDetails: InputConnectionDetails;
	connectConnection: (params: {
		onConnectionProgress?: (progressEvent: SshConnectionProgress) => void;
	}) => Promise<ConnectedSshConnection>;
	onConnectionProgress?: (progressEvent: SshConnectionProgress) => void;
	abortSignalTimeoutMs: number;
	registerInStore?: boolean;
	traceEvent: (event: ConnectionDiagnosticEvent) => void;
	afterShellFailure?: (context: ShellLifecycleFailureContext) => Promise<void>;
}): Promise<SshShellLifecycleResult> {
	const {
		connectionDetails,
		connectConnection,
		onConnectionProgress,
		abortSignalTimeoutMs,
		registerInStore,
		traceEvent,
		afterShellFailure,
	} = args;
	const connectionIdentity =
		getSshShellLifecycleConnectionIdentity(connectionDetails);

	traceEvent(
		sshEvents.connectStarted({
			source: 'saved-entry',
			connection: connectionIdentity,
		}),
	);

	let connected: ConnectedSshConnection;
	try {
		connected = await connectConnection({
			onConnectionProgress: (progressEvent) => {
				traceEvent(
					sshEvents.connectProgress({
						source: 'saved-entry',
						connection: connectionIdentity,
						phase: readSshConnectionProgressPhase(progressEvent),
					}),
				);
				onConnectionProgress?.(progressEvent);
			},
		});
	} catch (error) {
		traceEvent(
			sshEvents.connectFailed({
				source: 'saved-entry',
				connection: connectionIdentity,
				error: serializeConnectionDiagnosticError(error),
			}),
		);
		throw error;
	}

	const { sshConnection, storedConnectionId } = connected;
	const connectedIdentity = {
		...connectionIdentity,
		connectionId: sshConnection.connectionId,
	};
	traceEvent(
		sshEvents.connectConnected({
			source: 'saved-entry',
			connection: connectedIdentity,
			storedConnectionId,
		}),
	);

	let shellHandle: Awaited<ReturnType<typeof sshConnection.startShell>>;
	try {
		traceEvent(
			sshEvents.shellStarted({
				source: 'saved-entry',
				connection: connectedIdentity,
			}),
		);
		const startShellOptions: RegisteredStartShellOptions = {
			term: 'Xterm',
			useTmux: connectionDetails.useTmux,
			tmuxSessionName: connectionDetails.tmuxSessionName,
			abortSignal: AbortSignalTimeout(abortSignalTimeoutMs),
		};
		if (registerInStore !== undefined) {
			startShellOptions.registerInStore = registerInStore;
		}
		shellHandle = await sshConnection.startShell(startShellOptions);
	} catch (error) {
		const tmuxAttachFailureReason = extractTmuxAttachFailureReason(error);
		traceEvent(
			tmuxAttachFailureReason !== null
				? sshEvents.shellTmuxAttachFailed({
						source: 'saved-entry',
						connection: connectedIdentity,
						error: serializeConnectionDiagnosticError(error),
						tmuxAttachFailureReason,
						storedConnectionId,
					})
				: sshEvents.shellFailed({
						source: 'saved-entry',
						connection: connectedIdentity,
						error: serializeConnectionDiagnosticError(error),
						storedConnectionId,
					}),
		);
		await afterShellFailure?.({
			sshConnection,
			storedConnectionId,
			tmuxAttachFailureReason,
			error,
		});
		if (tmuxAttachFailureReason !== null) {
			return {
				status: 'tmux_attach_failed',
				connectionId: sshConnection.connectionId,
				tmuxAttachFailureReason,
				tmuxSessionName: connectionDetails.tmuxSessionName,
				storedConnectionId,
			};
		}
		throw error;
	}

	traceEvent(
		sshEvents.shellConnected({
			source: 'saved-entry',
			connection: connectedIdentity,
			channelId: shellHandle.channelId,
			storedConnectionId,
		}),
	);

	return {
		status: 'connected',
		sshConnection,
		shellHandle,
		connectionId: sshConnection.connectionId,
		channelId: shellHandle.channelId,
		storedConnectionId,
	};
}
