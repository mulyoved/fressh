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
	command,
	url,
}: {
	slot: HostBrowserUrlSlot;
	message: string;
	panePath: string;
	command?: string;
	url?: string;
}): BrowserActionErrorInput {
	const label = getHostBrowserUrlSlotLabel(slot);
	const input: BrowserActionErrorInput = {
		action: label,
		title: `Save ${label} failed`,
		message,
		panePath,
		url,
	};
	if (command !== undefined) input.command = command;
	return input;
}

export function createHostUrlOpenBrowserActionErrorInput({
	slot,
	message,
	panePath,
	command,
	url,
}: {
	slot: HostBrowserUrlSlot;
	message: string;
	panePath: string;
	command?: string;
	url: string;
}): BrowserActionErrorInput {
	const label = getHostBrowserUrlSlotLabel(slot);
	const input: BrowserActionErrorInput = {
		action: label,
		title: `Open ${label} failed`,
		message,
		panePath,
		url,
	};
	if (command !== undefined) input.command = command;
	return input;
}
