import { type DetectedOpenCandidate } from '../detected-open-actions';
import {
	getHostBrowserUrlSlotLabel,
	type HostBrowserUrlSlot,
} from '../host-browser-actions';
import {
	type BrowserActionsState,
	type HostUrlModalMode,
} from './browser-actions-core';

export type BrowserActionsModalProps = {
	open: boolean;
	onClose: () => void;
	onOpenDiff: () => void;
	onOpenGitHubIssues: () => void;
	onOpenGitHubPulls: () => void;
	onOpenDetectedAuto: () => boolean;
	onOpenDetectedPick: () => boolean;
	onOpenUrlSlot: (slot: HostBrowserUrlSlot) => void;
	onEditUrlSlot: (slot: HostBrowserUrlSlot) => void;
};

export type HostUrlModalProps = {
	open: boolean;
	slot: HostBrowserUrlSlot | null;
	slotLabel: string;
	initialValue: string;
	mode: HostUrlModalMode;
	isSubmitting: boolean;
	error: string | null;
	onClose: () => void;
	onSubmit: (value: string) => void;
};

export type DetectedOpenPickerModalProps = {
	open: boolean;
	candidates: readonly DetectedOpenCandidate[];
	onClose: () => void;
	onSelect: (candidate: DetectedOpenCandidate) => void;
};

export type BrowserActionsModalCallbacks = {
	close(): void;
	openDiff(): void;
	openGitHubIssues(): void;
	openGitHubPulls(): void;
	openDetectedAuto(): boolean;
	openDetectedPick(): boolean;
	openUrlSlot(slot: HostBrowserUrlSlot): void;
	editUrlSlot(slot: HostBrowserUrlSlot): void;
	closeHostUrl(): void;
	submitHostUrl(value: string): void;
	closeDetectedPicker(): void;
	selectDetected(candidate: DetectedOpenCandidate): void;
};

export function createBrowserActionsModalProps(
	snapshot: BrowserActionsState,
	callbacks: BrowserActionsModalCallbacks,
): {
	browserActionsProps: BrowserActionsModalProps;
	hostUrlProps: HostUrlModalProps;
	detectedOpenPickerProps: DetectedOpenPickerModalProps;
} {
	return {
		browserActionsProps: {
			open: snapshot.open,
			onClose: callbacks.close,
			onOpenDiff: callbacks.openDiff,
			onOpenGitHubIssues: callbacks.openGitHubIssues,
			onOpenGitHubPulls: callbacks.openGitHubPulls,
			onOpenDetectedAuto: callbacks.openDetectedAuto,
			onOpenDetectedPick: callbacks.openDetectedPick,
			onOpenUrlSlot: callbacks.openUrlSlot,
			onEditUrlSlot: callbacks.editUrlSlot,
		},
		hostUrlProps: {
			open: snapshot.hostUrl !== null,
			slot: snapshot.hostUrl?.slot ?? null,
			slotLabel: snapshot.hostUrl
				? getHostBrowserUrlSlotLabel(snapshot.hostUrl.slot)
				: 'URL',
			initialValue: snapshot.hostUrl?.initialValue ?? '',
			mode: snapshot.hostUrl?.mode ?? 'edit',
			isSubmitting: snapshot.hostUrlSubmitting,
			error: snapshot.hostUrlError,
			onClose: callbacks.closeHostUrl,
			onSubmit: callbacks.submitHostUrl,
		},
		detectedOpenPickerProps: {
			open: snapshot.detectedOpenPicker !== null,
			candidates: snapshot.detectedOpenPicker?.candidates ?? [],
			onClose: callbacks.closeDetectedPicker,
			onSelect: callbacks.selectDetected,
		},
	};
}
