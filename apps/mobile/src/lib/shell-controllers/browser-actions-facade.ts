import { type TmuxPaneContext } from '../host-browser-actions';
import { type BrowserActionsControllerCore } from './browser-actions-core';
import {
	type BrowserActionsModalCallbacks,
	type BrowserActionsModalProps,
	type DetectedOpenPickerModalProps,
	type HostUrlModalProps,
} from './browser-actions-modal-props';

export type BrowserActionsControllerHandle = {
	browserActionsProps: BrowserActionsModalProps;
	hostUrlProps: HostUrlModalProps;
	detectedOpenPickerProps: DetectedOpenPickerModalProps;
	open: () => void;
	close: () => void;
	resolveHostBrowserPaneContext: () => Promise<TmuxPaneContext>;
	resolveHostBrowserPanePath: () => Promise<string>;
	resolveCurrentGitHubRepository: () => Promise<string>;
	invalidateHostUrlReads: () => void;
	invalidateAll: () => void;
};

type BrowserActionsFacadeCore = Pick<
	BrowserActionsControllerCore,
	| 'open'
	| 'close'
	| 'openDiffity'
	| 'openGitHubTarget'
	| 'openDetected'
	| 'openUrlSlot'
	| 'editUrlSlot'
	| 'closeHostUrl'
	| 'submitHostUrl'
	| 'closeDetectedPicker'
	| 'selectDetected'
	| 'resolvePaneContext'
	| 'resolvePanePath'
	| 'resolveCurrentGitHubRepository'
	| 'invalidateHostUrlReads'
	| 'invalidate'
>;

export function createBrowserActionsControllerFacade(
	core: BrowserActionsFacadeCore,
): {
	modalCallbacks: BrowserActionsModalCallbacks;
	createHandle(props: {
		browserActionsProps: BrowserActionsModalProps;
		hostUrlProps: HostUrlModalProps;
		detectedOpenPickerProps: DetectedOpenPickerModalProps;
	}): BrowserActionsControllerHandle;
} {
	const close = () => core.close();
	const modalCallbacks: BrowserActionsModalCallbacks = {
		close,
		openDiff: () => void core.openDiffity(),
		openGitHubIssues: () => void core.openGitHubTarget('issues'),
		openGitHubPulls: () => void core.openGitHubTarget('pulls'),
		openDetectedAuto: () => core.openDetected('auto'),
		openDetectedPick: () => core.openDetected('pick'),
		openUrlSlot: (slot) => core.openUrlSlot(slot),
		editUrlSlot: (slot) => core.editUrlSlot(slot),
		closeHostUrl: () => void core.closeHostUrl(),
		submitHostUrl: (value) => core.submitHostUrl(value),
		closeDetectedPicker: () => core.closeDetectedPicker(),
		selectDetected: (candidate) => void core.selectDetected(candidate),
	};

	return {
		modalCallbacks,
		createHandle: (props) => ({
			...props,
			open: () => void core.open(),
			close,
			resolveHostBrowserPaneContext: () => core.resolvePaneContext(),
			resolveHostBrowserPanePath: () => core.resolvePanePath(),
			resolveCurrentGitHubRepository: () =>
				core.resolveCurrentGitHubRepository(),
			invalidateHostUrlReads: () => core.invalidateHostUrlReads(),
			invalidateAll: () => core.invalidate('runtime-reset'),
		}),
	};
}
