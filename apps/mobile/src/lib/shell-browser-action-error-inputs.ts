import { type BrowserActionErrorReportInput } from './browser-action-error-report';
import {
	getHostBrowserUrlSlotLabel,
	type HostBrowserUrlSlot,
} from './host-browser-actions';
import { type HostDiffityOpenErrorReport } from './host-diffity-open-request';

export type BrowserActionErrorInput = Omit<
	BrowserActionErrorReportInput,
	'connectionPresent' | 'tmuxEnabled' | 'tmuxTarget'
>;

export function createDiffBrowserActionErrorInput(
	report: HostDiffityOpenErrorReport,
): BrowserActionErrorInput {
	return {
		action: 'Diff',
		title: report.title,
		message: report.message,
		panePath: report.panePath,
		command: report.command,
		output: report.output,
		url: report.url,
	};
}

export function createHostUrlSubmitBrowserActionErrorInput({
	slot,
	message,
	panePath,
	url,
}: {
	slot: HostBrowserUrlSlot;
	message: string;
	panePath: string;
	url?: string;
}): BrowserActionErrorInput {
	const label = getHostBrowserUrlSlotLabel(slot);
	return {
		action: label,
		title: `Save ${label} failed`,
		message,
		panePath,
		url,
	};
}

export function createHostUrlOpenBrowserActionErrorInput({
	slot,
	message,
	panePath,
	url,
}: {
	slot: HostBrowserUrlSlot;
	message: string;
	panePath: string;
	url: string;
}): BrowserActionErrorInput {
	const label = getHostBrowserUrlSlotLabel(slot);
	return {
		action: label,
		title: `Open ${label} failed`,
		message,
		panePath,
		url,
	};
}
