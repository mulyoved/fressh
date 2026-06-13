import { extractLastHttpsUrl } from './host-browser-actions';

export type HostDiffityShareResult = {
	output: string;
	panePath?: string;
	command?: string;
};

export type HostDiffityOpenErrorReport = {
	title: string;
	message: string;
	panePath?: string;
	command?: string;
	output?: string;
	url?: string;
};

export type HostDiffityShareValue = string | HostDiffityShareResult;

export class HostDiffityShareError extends Error {
	readonly panePath: string;
	readonly command: string;

	constructor({
		message,
		panePath,
		command,
		cause,
	}: {
		message: string;
		panePath: string;
		command: string;
		cause?: unknown;
	}) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = 'HostDiffityShareError';
		this.panePath = panePath;
		this.command = command;
	}
}

export function runHostDiffityOpenRequest({
	hostDiffityInFlightRef,
	hostDiffityRequestId,
	runDiffityShare,
	openAndroidUrl,
	showError,
	showErrorReport,
	getErrorMessage,
}: {
	hostDiffityInFlightRef: { current: boolean };
	hostDiffityRequestId: {
		next: () => number;
		isCurrent: (id: number) => boolean;
	};
	runDiffityShare: () => Promise<HostDiffityShareValue>;
	openAndroidUrl: (url: string) => Promise<void>;
	showError: (title: string, message: string) => void;
	showErrorReport?: (report: HostDiffityOpenErrorReport) => void;
	getErrorMessage: (error: unknown) => string;
}): boolean {
	if (hostDiffityInFlightRef.current) return false;
	const id = hostDiffityRequestId.next();
	hostDiffityInFlightRef.current = true;
	void (async () => {
		let shareResult: HostDiffityShareResult | null = null;
		let url: string | null = null;
		try {
			const shareValue = await runDiffityShare();
			shareResult =
				typeof shareValue === 'string' ? { output: shareValue } : shareValue;
			url = extractLastHttpsUrl(shareResult.output);
			if (!url) {
				if (!hostDiffityRequestId.isCurrent(id)) return;
				showHostDiffityOpenError(
					{ showError, showErrorReport },
					{
						title: 'Diffity failed',
						message:
							shareResult.output ||
							'mdev diffity share did not return an HTTPS URL.',
						panePath: shareResult.panePath,
						command: shareResult.command,
						output: shareResult.output,
					},
				);
				return;
			}
			if (!hostDiffityRequestId.isCurrent(id)) return;
			await openAndroidUrl(url);
		} catch (err) {
			if (!hostDiffityRequestId.isCurrent(id)) return;
			const shareError = err instanceof HostDiffityShareError ? err : null;
			const panePath = shareResult?.panePath ?? shareError?.panePath;
			const command = shareResult?.command ?? shareError?.command;
			const report: HostDiffityOpenErrorReport = {
				title: 'Diffity failed',
				message: getErrorMessage(err),
			};
			if (panePath !== undefined) report.panePath = panePath;
			if (command !== undefined) report.command = command;
			if (shareResult?.output !== undefined) report.output = shareResult.output;
			if (url !== null) report.url = url;
			showHostDiffityOpenError({ showError, showErrorReport }, report);
		} finally {
			if (hostDiffityRequestId.isCurrent(id)) {
				hostDiffityInFlightRef.current = false;
			}
		}
	})();
	return true;
}

function showHostDiffityOpenError(
	{
		showError,
		showErrorReport,
	}: {
		showError: (title: string, message: string) => void;
		showErrorReport?: (report: HostDiffityOpenErrorReport) => void;
	},
	report: HostDiffityOpenErrorReport,
) {
	if (showErrorReport) {
		showErrorReport(report);
		return;
	}
	showError(report.title, report.message);
}
