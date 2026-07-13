import { OutputProgressBridgeMessage } from './bridge';
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
type WebViewOutputProgress = Pick<OutputProgressBridgeMessage, 'instanceId' | 'receivedMessages' | 'receivedBytes' | 'completedWrites'>;
export type XtermOutputDiagnosticsCounter = {
    recordQueued(byteCount: number): void;
    recordFlush(): void;
    recordSent(byteCount: number): void;
    recordWebViewProgress(progress: WebViewOutputProgress): void;
    getSnapshot(): XtermOutputDiagnostics;
};
export declare function createXtermOutputDiagnostics(): XtermOutputDiagnosticsCounter;
export {};
//# sourceMappingURL=output-diagnostics.d.ts.map