import {
	buildTmuxWindowConfigSetCommand,
	type HostBrowserUrlSlot,
} from './host-browser-actions';
import { type RequestIdHandle } from './request-id';
import {
	createHostUrlOpenBrowserActionErrorInput,
	createHostUrlSubmitBrowserActionErrorInput,
	type BrowserActionErrorInput,
} from './shell-browser-action-error-inputs';

export type HostUrlSubmitRequestState = {
	mode: 'edit' | 'open-missing';
	slot: HostBrowserUrlSlot;
	panePath: string;
};

export function runHostUrlSubmitRequest({
	state,
	url,
	hostUrlSubmitInFlightRef,
	hostUrlSubmitRequestId,
	runHostBrowserCommand,
	openAndroidUrl,
	setHostUrlModalState,
	setHostUrlModalSubmitting,
	setHostUrlModalError,
	showError,
	getErrorMessage,
}: {
	state: HostUrlSubmitRequestState;
	url: string;
	hostUrlSubmitInFlightRef: { current: boolean };
	hostUrlSubmitRequestId: RequestIdHandle;
	runHostBrowserCommand: (
		command: string,
		timeoutMs?: number,
	) => Promise<string>;
	openAndroidUrl: (url: string) => Promise<void>;
	setHostUrlModalState: (state: null) => void;
	setHostUrlModalSubmitting: (submitting: boolean) => void;
	setHostUrlModalError: (message: string | null) => void;
	showError: (input: BrowserActionErrorInput) => void;
	getErrorMessage: (error: unknown) => string;
}): boolean {
	if (hostUrlSubmitInFlightRef.current) return false;
	const id = hostUrlSubmitRequestId.next();
	hostUrlSubmitInFlightRef.current = true;
	void (async () => {
		let operation: 'save' | 'open' = 'save';
		setHostUrlModalSubmitting(true);
		setHostUrlModalError(null);
		try {
			await runHostBrowserCommand(
				buildTmuxWindowConfigSetCommand(state.slot, state.panePath, url),
				10_000,
			);
			if (!hostUrlSubmitRequestId.isCurrent(id)) return;
			if (state.mode === 'open-missing') {
				operation = 'open';
				await openAndroidUrl(url);
				if (!hostUrlSubmitRequestId.isCurrent(id)) return;
			}
			setHostUrlModalState(null);
		} catch (err) {
			if (!hostUrlSubmitRequestId.isCurrent(id)) return;
			const message = getErrorMessage(err);
			setHostUrlModalError(message);
			showError(
				operation === 'open'
					? createHostUrlOpenBrowserActionErrorInput({
							slot: state.slot,
							message,
							panePath: state.panePath,
							url,
						})
					: createHostUrlSubmitBrowserActionErrorInput({
							slot: state.slot,
							message,
							panePath: state.panePath,
							url,
						}),
			);
		} finally {
			if (hostUrlSubmitRequestId.isCurrent(id)) {
				hostUrlSubmitInFlightRef.current = false;
				setHostUrlModalSubmitting(false);
			}
		}
	})();
	return true;
}
