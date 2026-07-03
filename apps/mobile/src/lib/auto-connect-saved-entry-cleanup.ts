import {
	type SavedEntryConnectResult,
	type TmuxAttachFailedResult,
} from './auto-connect-saved-entry';
import { type ConnectAndOpenShellResult } from './connect-and-open-shell';

export async function cleanupAutoConnectSavedEntryResult(
	result: Extract<ConnectAndOpenShellResult, { status: 'connected' }>,
	opts?: { signal?: AbortSignal },
) {
	const [closeResult, disconnectResult] = await Promise.allSettled([
		result.shellHandle.close?.(opts),
		result.sshConnection.disconnect?.(opts),
	]);
	if (disconnectResult.status === 'rejected') {
		throw disconnectResult.reason;
	}
	if (closeResult.status === 'rejected') {
		throw closeResult.reason;
	}
}

export function toAutoConnectSavedEntryResult(
	result: ConnectAndOpenShellResult,
): SavedEntryConnectResult {
	if (result.status !== 'connected') {
		return result as TmuxAttachFailedResult;
	}
	return {
		status: 'connected',
		connectionId: result.connectionId,
		channelId: result.channelId,
		cleanup: async (opts?: { signal?: AbortSignal }) => {
			await cleanupAutoConnectSavedEntryResult(result, opts);
		},
	};
}
