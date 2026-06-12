import { type RequestIdHandle } from './request-id';

export type BrowserActionsRequestCleanupDeps = {
	hostUrlReadRequestId: RequestIdHandle;
	hostUrlSubmitRequestId: RequestIdHandle;
	hostUrlSubmitInFlightRef: { current: boolean };
	browserGitHubTargetRequestId: RequestIdHandle;
	hostDiffityRequestId: RequestIdHandle;
	hostDiffityInFlightRef: { current: boolean };
	hostDetectedOpenRequestId: RequestIdHandle;
	hostDetectedOpenInFlightRef: { current: boolean };
	hostDetectedOpenPickerSelectionRequestId: RequestIdHandle;
};

export function cleanupBrowserActionRequests({
	hostUrlReadRequestId,
	hostUrlSubmitRequestId,
	hostUrlSubmitInFlightRef,
	browserGitHubTargetRequestId,
	hostDiffityRequestId,
	hostDiffityInFlightRef,
	hostDetectedOpenRequestId,
	hostDetectedOpenInFlightRef,
	hostDetectedOpenPickerSelectionRequestId,
}: BrowserActionsRequestCleanupDeps): void {
	hostUrlReadRequestId.invalidate();
	hostUrlSubmitRequestId.invalidate();
	hostUrlSubmitInFlightRef.current = false;
	browserGitHubTargetRequestId.invalidate();
	hostDiffityRequestId.invalidate();
	hostDiffityInFlightRef.current = false;
	hostDetectedOpenRequestId.invalidate();
	hostDetectedOpenInFlightRef.current = false;
	hostDetectedOpenPickerSelectionRequestId.invalidate();
}
