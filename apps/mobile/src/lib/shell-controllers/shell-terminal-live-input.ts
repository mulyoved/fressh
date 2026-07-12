import { isWorkmuxScrollbackLiveInputRequestCurrent } from '../workmux-scrollback-live-input';
import { type ShellTerminalTransportPort } from './terminal-transport';

export type ShellTerminalLiveInputRequest = {
	isCurrent(): boolean;
	sendSegments(
		segments: readonly Uint8Array<ArrayBufferLike>[],
		options?: { interSegmentDelayMs?: number },
	): Promise<void> | undefined;
};

export function createShellTerminalLiveInputRequest({
	transport,
	requestInstanceId,
	getCurrentInstanceId,
	requestGeneration,
	getCurrentGeneration,
	getActivitySnapshot,
}: {
	transport: ShellTerminalTransportPort;
	requestInstanceId: string | null;
	getCurrentInstanceId(): string | null;
	requestGeneration: number;
	getCurrentGeneration(): number;
	getActivitySnapshot(): { focused: boolean; appActive: boolean };
}): ShellTerminalLiveInputRequest {
	const lease = transport.captureLease();
	const isCurrent = (): boolean => {
		const activity = getActivitySnapshot();
		return isWorkmuxScrollbackLiveInputRequestCurrent({
			requestInstanceId,
			requestWriter: lease,
			currentInstanceId: getCurrentInstanceId(),
			currentWriter: lease && transport.isLeaseCurrent(lease) ? lease : null,
			isFocused: activity.focused,
			isAppActive: activity.appActive,
			requestGeneration,
			currentGeneration: getCurrentGeneration(),
		});
	};

	return {
		isCurrent,
		sendSegments: (segments, options) =>
			lease
				? transport.sendBatch(lease, segments, {
						interSegmentDelayMs: options?.interSegmentDelayMs,
						isCurrent,
					})
				: undefined,
	};
}
