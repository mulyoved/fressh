import { type InputConnectionDetails } from './connection-storage';
import { getStoredConnectionId } from './connection-utils';
import { AbortSignalAny, AbortSignalTimeout } from './utils';

type ConnectParamsBase<TSecurity, TProgressEvent, TServerKeyInfo> = {
	host: string;
	port: number;
	username: string;
	security: TSecurity;
	onConnectionProgress?: (progressEvent: TProgressEvent) => void;
	onServerKey: (serverKeyInfo: TServerKeyInfo) => Promise<boolean>;
	abortSignal: AbortSignal;
};

export async function connectAndRememberConnection<
	TSecurity,
	TProgressEvent,
	TServerKeyInfo,
	TResult extends {
		connectionId: string;
		disconnect?: (opts?: { signal?: AbortSignal }) => Promise<void>;
	},
>(args: {
	connectionDetails: InputConnectionDetails;
	connect: (
		params: ConnectParamsBase<TSecurity, TProgressEvent, TServerKeyInfo>,
	) => Promise<TResult>;
	saveConnection: (params: {
		details: InputConnectionDetails;
		priority: number;
		label?: string;
	}) => Promise<unknown>;
	onConnectionProgress?: (progressEvent: TProgressEvent) => void;
	abortSignalTimeoutMs: number;
	abortSignal?: AbortSignal;
	connectSignal?: AbortSignal;
	resolvedSecurity: TSecurity;
}): Promise<{
	sshConnection: TResult;
	storedConnectionId: string;
}> {
	const { sshConnection, connectSignal } =
		await connectWithoutRememberingWithSignal({
			connectionDetails: args.connectionDetails,
			connect: args.connect,
			onConnectionProgress: args.onConnectionProgress,
			abortSignalTimeoutMs: args.abortSignalTimeoutMs,
			abortSignal: args.abortSignal,
			connectSignal: args.connectSignal,
			resolvedSecurity: args.resolvedSecurity,
		});

	let disconnectStarted = false;
	const disconnectAfterConnect = async () => {
		if (disconnectStarted) {
			return;
		}
		disconnectStarted = true;
		await sshConnection.disconnect?.({
			signal: AbortSignalTimeout(args.abortSignalTimeoutMs),
		});
	};
	const disconnectAfterAbort = () => {
		void disconnectAfterConnect().catch(() => {});
	};
	connectSignal.addEventListener('abort', disconnectAfterAbort, {
		once: true,
	});
	args.abortSignal?.addEventListener('abort', disconnectAfterAbort, {
		once: true,
	});

	const storedConnectionId = getStoredConnectionId(args.connectionDetails);
	try {
		if (connectSignal.aborted || args.abortSignal?.aborted) {
			await disconnectAfterConnect();
			throw (
				(connectSignal.aborted ? connectSignal.reason : undefined) ??
				(args.abortSignal?.aborted ? args.abortSignal.reason : undefined) ??
				new Error('SSH connect aborted')
			);
		}
		await args.saveConnection({
			label: `${args.connectionDetails.username}@${args.connectionDetails.host}:${args.connectionDetails.port}`,
			details: args.connectionDetails,
			priority: 0,
		});
		if (connectSignal.aborted || args.abortSignal?.aborted) {
			await disconnectAfterConnect();
			throw (
				(connectSignal.aborted ? connectSignal.reason : undefined) ??
				(args.abortSignal?.aborted ? args.abortSignal.reason : undefined) ??
				new Error('SSH connect aborted')
			);
		}
		return {
			sshConnection,
			storedConnectionId,
		};
	} catch (error) {
		await disconnectAfterConnect();
		throw error;
	} finally {
		connectSignal.removeEventListener('abort', disconnectAfterAbort);
		args.abortSignal?.removeEventListener('abort', disconnectAfterAbort);
	}
}

export async function connectWithoutRemembering<
	TSecurity,
	TProgressEvent,
	TServerKeyInfo,
	TResult extends { connectionId: string },
>(args: {
	connectionDetails: InputConnectionDetails;
	connect: (
		params: ConnectParamsBase<TSecurity, TProgressEvent, TServerKeyInfo>,
	) => Promise<TResult>;
	onConnectionProgress?: (progressEvent: TProgressEvent) => void;
	abortSignalTimeoutMs: number;
	abortSignal?: AbortSignal;
	connectSignal?: AbortSignal;
	resolvedSecurity: TSecurity;
}): Promise<TResult> {
	const { sshConnection } = await connectWithoutRememberingWithSignal(args);
	return sshConnection;
}

async function connectWithoutRememberingWithSignal<
	TSecurity,
	TProgressEvent,
	TServerKeyInfo,
	TResult extends { connectionId: string },
>(args: {
	connectionDetails: InputConnectionDetails;
	connect: (
		params: ConnectParamsBase<TSecurity, TProgressEvent, TServerKeyInfo>,
	) => Promise<TResult>;
	onConnectionProgress?: (progressEvent: TProgressEvent) => void;
	abortSignalTimeoutMs: number;
	abortSignal?: AbortSignal;
	connectSignal?: AbortSignal;
	resolvedSecurity: TSecurity;
}): Promise<{ sshConnection: TResult; connectSignal: AbortSignal }> {
	const effectiveConnectSignal =
		args.connectSignal ??
		AbortSignalAny([
			AbortSignalTimeout(args.abortSignalTimeoutMs),
			args.abortSignal,
		]);
	const result = await args.connect({
		host: args.connectionDetails.host,
		port: args.connectionDetails.port,
		username: args.connectionDetails.username,
		security: args.resolvedSecurity,
		onConnectionProgress: (progressEvent) => {
			args.onConnectionProgress?.(progressEvent);
		},
		// TODO: Implement proper host key verification (known_hosts).
		// Currently accepts all server keys, which is vulnerable to MITM attacks.
		// Future: store known host keys, verify against them, prompt user on mismatch.
		onServerKey: async () => true,
		abortSignal: effectiveConnectSignal,
	});
	return { sshConnection: result, connectSignal: effectiveConnectSignal };
}
