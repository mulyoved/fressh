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
	lines.push(`${label}: ${redactBrowserActionErrorText(value)}`);
}

export function normalizeBrowserActionTmuxTarget(tmuxTarget: string): string {
	return tmuxTarget.trim() || 'main';
}

const secretParamPattern =
	/(^|[_-])(access[_-]?token|api[_-]?key|auth|client[_-]?secret|code|credential|id[_-]?token|key|password|refresh[_-]?token|secret|session|sig|signature|token)$/iu;
const secretAssignmentPattern =
	/(^|[^\w-])([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"';&|]+))/gu;
const secretHeaderPattern =
	/(^|[^\w-])([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(?:(Bearer|Basic|Token)\s+)?(?:"([^"]*)"|'([^']*)'|([^\s"',;]+))/giu;

function redactSecretParam(param: string): string {
	const equalsIndex = param.indexOf('=');
	if (equalsIndex < 0) return param;
	const name = param.slice(0, equalsIndex);
	if (!secretParamPattern.test(name)) return param;
	return `${name}=[redacted]`;
}

function redactSecretParams(value: string): string {
	return value.replace(/([?#&])([^#&\s"'<>]+)/gu, (match, prefix, param) => {
		const redacted = redactSecretParam(param);
		return redacted === param ? match : `${prefix}${redacted}`;
	});
}

function redactSecretAssignments(value: string): string {
	return value.replace(
		secretAssignmentPattern,
		(match, prefix, name, doubleQuoted, singleQuoted) => {
			if (!secretParamPattern.test(name)) return match;
			const quote =
				doubleQuoted !== undefined
					? '"'
					: singleQuoted !== undefined
						? "'"
						: '';
			return `${prefix}${name}=${quote}[redacted]${quote}`;
		},
	);
}

function redactSecretHeaders(value: string): string {
	return value.replace(
		secretHeaderPattern,
		(match, prefix, name, scheme = '', doubleQuoted, singleQuoted) => {
			const isAuthorization = name.toLowerCase() === 'authorization';
			if (!isAuthorization && !secretParamPattern.test(name)) return match;
			const schemeText = scheme ? `${scheme} ` : '';
			const quote =
				doubleQuoted !== undefined
					? '"'
					: singleQuoted !== undefined
						? "'"
						: '';
			return `${prefix}${name}: ${schemeText}${quote}[redacted]${quote}`;
		},
	);
}

export function redactBrowserActionErrorText(value: string): string {
	return value
		.replace(/([a-z][a-z0-9+.-]*:\/\/)([^@/\s"'<>]+)@/giu, '$1[redacted]@')
		.split('\n')
		.map(redactSecretParams)
		.map(redactSecretAssignments)
		.map(redactSecretHeaders)
		.join('\n');
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
		`Action: ${redactBrowserActionErrorText(report.action)}`,
		`Title: ${redactBrowserActionErrorText(report.title)}`,
		`Message: ${redactBrowserActionErrorText(report.message)}`,
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
		lines.push(redactBrowserActionErrorText(report.output.trimEnd()));
	}

	return lines.join('\n');
}
