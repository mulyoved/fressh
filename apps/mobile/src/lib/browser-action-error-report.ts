export type BrowserActionErrorConnectionState = 'connected' | 'missing';

export type BrowserActionErrorReport = {
	action: string;
	title: string;
	message: string;
	connectionState: BrowserActionErrorConnectionState;
	tmuxEnabled: boolean;
	tmuxTarget: string;
	panePath?: string;
	command?: string;
	output?: string;
	url?: string;
	details?: string;
};

export type BrowserActionErrorReportInput = {
	action: string;
	title: string;
	message: string;
	connectionPresent: boolean;
	tmuxEnabled: boolean;
	tmuxTarget: string;
	panePath?: string;
	command?: string;
	output?: string;
	url?: string;
	details?: string;
};

function hasValue(value: string | undefined): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function appendOptionalLine(
	lines: string[],
	label: string,
	value: string | undefined,
) {
	if (!hasValue(value)) return;
	lines.push(`${label}: ${value}`);
}

export function normalizeBrowserActionTmuxTarget(tmuxTarget: string): string {
	return tmuxTarget.trim() || 'main';
}

export function createBrowserActionErrorReport({
	action,
	title,
	message,
	connectionPresent,
	tmuxEnabled,
	tmuxTarget,
	panePath,
	command,
	output,
	url,
	details,
}: BrowserActionErrorReportInput): BrowserActionErrorReport {
	return {
		action,
		title,
		message,
		connectionState: connectionPresent ? 'connected' : 'missing',
		tmuxEnabled,
		tmuxTarget: normalizeBrowserActionTmuxTarget(tmuxTarget),
		panePath,
		command,
		output,
		url,
		details,
	};
}

export function formatBrowserActionErrorReport(
	report: BrowserActionErrorReport,
): string {
	const lines = [
		'Fressh Browser Action Error',
		`Action: ${report.action}`,
		`Title: ${report.title}`,
		`Message: ${report.message}`,
		`Connection: ${report.connectionState}`,
		`Workmux enabled: ${String(report.tmuxEnabled)}`,
		`Tmux target: ${normalizeBrowserActionTmuxTarget(report.tmuxTarget)}`,
	];

	appendOptionalLine(lines, 'Pane path', report.panePath);
	appendOptionalLine(lines, 'Command', report.command);
	appendOptionalLine(lines, 'URL', report.url);
	appendOptionalLine(lines, 'Details', report.details);

	if (hasValue(report.output)) {
		lines.push('Output:');
		lines.push(report.output.trimEnd());
	}

	return lines.join('\n');
}
