import { type OutputProgressBridgeMessage } from './bridge';

export type XtermOutputDiagnostics = {
	webViewInstanceId: string | null;
	rnQueuedMessages: number;
	rnQueuedBytes: number;
	rnFlushes: number;
	rnSentMessages: number;
	rnSentBytes: number;
	webViewReceivedMessages: number;
	webViewReceivedBytes: number;
	webViewCompletedWrites: number;
};

type WebViewOutputProgress = Pick<
	OutputProgressBridgeMessage,
	| 'instanceId'
	| 'receivedMessages'
	| 'receivedBytes'
	| 'completedWrites'
>;

export type XtermOutputDiagnosticsCounter = {
	recordQueued(byteCount: number): void;
	recordFlush(): void;
	recordSent(byteCount: number): void;
	recordSendAttempt(input: {
		byteCount: number;
		isFlush: boolean;
		send(): boolean;
	}): boolean;
	recordWebViewProgress(progress: WebViewOutputProgress): void;
	getSnapshot(): XtermOutputDiagnostics;
};

export function createXtermOutputDiagnostics(): XtermOutputDiagnosticsCounter {
	const snapshot: XtermOutputDiagnostics = {
		webViewInstanceId: null,
		rnQueuedMessages: 0,
		rnQueuedBytes: 0,
		rnFlushes: 0,
		rnSentMessages: 0,
		rnSentBytes: 0,
		webViewReceivedMessages: 0,
		webViewReceivedBytes: 0,
		webViewCompletedWrites: 0,
	};

	const recordFlush = () => {
		snapshot.rnFlushes += 1;
	};
	const recordSent = (byteCount: number) => {
		snapshot.rnSentMessages += 1;
		snapshot.rnSentBytes += byteCount;
	};

	return {
		recordQueued: (byteCount) => {
			snapshot.rnQueuedMessages += 1;
			snapshot.rnQueuedBytes += byteCount;
		},
		recordFlush,
		recordSent,
		recordSendAttempt: ({ byteCount, isFlush, send }) => {
			if (!send()) return false;
			if (isFlush) recordFlush();
			recordSent(byteCount);
			return true;
		},
		recordWebViewProgress: (progress) => {
			snapshot.webViewInstanceId = progress.instanceId;
			snapshot.webViewReceivedMessages = progress.receivedMessages;
			snapshot.webViewReceivedBytes = progress.receivedBytes;
			snapshot.webViewCompletedWrites = progress.completedWrites;
		},
		getSnapshot: () => ({ ...snapshot }),
	};
}
