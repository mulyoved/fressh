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
	onDisconnectAfterAbortFailure?: (error: unknown) => void;
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

	let disconnectPromise: Promise<void> | undefined;
	let disconnectAfterAbortFailureReported = false;
	const reportDisconnectAfterAbortFailure = (error: unknown) => {
		if (disconnectAfterAbortFailureReported) {
			return;
		}
		disconnectAfterAbortFailureReported = true;
		args.onDisconnectAfterAbortFailure?.(error);
	};
	const disconnectAfterConnect = async () => {
		if (!disconnectPromise) {
			disconnectPromise =
				sshConnection.disconnect?.({
					signal: AbortSignalTimeout(args.abortSignalTimeoutMs),
				}) ?? Promise.resolve();
		}
		await disconnectPromise;
	};
	const disconnectAfterAbort = () => {
		void disconnectAfterConnect().catch((error) => {
			reportDisconnectAfterAbortFailure(error);
		});
	};
	connectSignal.addEventListener('abort', disconnectAfterAbort, {
		once: true,
	});
	args.abortSignal?.addEventListener('abort', disconnectAfterAbort, {
		once: true,
	});

	const storedConnectionId = getStoredConnectionId(args.connectionDetails);
	const getAbortReason = () => {
		if (connectSignal.aborted) {
			return connectSignal.reason ?? new Error('SSH connect aborted');
		}
		if (args.abortSignal?.aborted) {
			return args.abortSignal.reason ?? new Error('SSH connect aborted');
		}
		return null;
	};
	const throwIfAbortedAfterConnect = async () => {
		const abortReason = getAbortReason();
		if (abortReason === null) {
			return;
		}
		try {
			await disconnectAfterConnect();
		} catch (error) {
			reportDisconnectAfterAbortFailure(error);
		}
		throw abortReason;
	};
	try {
		await throwIfAbortedAfterConnect();
		await args.saveConnection({
			label: `${args.connectionDetails.username}@${args.connectionDetails.host}:${args.connectionDetails.port}`,
			details: args.connectionDetails,
			priority: 0,
		});
		await throwIfAbortedAfterConnect();
		return {
			sshConnection,
			storedConnectionId,
		};
	} catch (error) {
		try {
			await disconnectAfterConnect();
		} catch (cleanupError) {
			if (getAbortReason() !== null) {
				reportDisconnectAfterAbortFailure(cleanupError);
				throw error;
			}
			throw cleanupError;
		}
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
