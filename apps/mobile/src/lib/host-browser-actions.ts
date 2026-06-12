export const HOST_BROWSER_URL_SLOTS = [
	'window-url',
	'dev-web-server-url',
	'storybook-url',
	'app-url',
] as const;
export const HOST_BROWSER_NO_CONNECTION_MESSAGE = 'No SSH connection available.';

export type HostBrowserUrlSlot = (typeof HOST_BROWSER_URL_SLOTS)[number];

export type HostBrowserOpenMode = 'auto' | 'pick';

export type TmuxPaneContext = {
	paneId: string;
	paneTty: string;
	panePath: string;
};

export type DetectedOpenCandidateKind = 'remote-url' | 'local-url' | 'file';

export type DetectedOpenCandidate = {
	kind: DetectedOpenCandidateKind;
	raw: string;
	normalized: string;
	display: string;
	path: string | null;
	line: number | null;
	url: string | null;
};

export type ParsedDetectedOpenCandidates =
	| { type: 'invalid'; message: string }
	| { type: 'valid'; candidates: DetectedOpenCandidate[] };

export type ParsedPrintedOpenUrl =
	| { type: 'invalid'; message: string }
	| { type: 'valid'; url: string };

export type ParsedHostBrowserUrlInput =
	| { type: 'empty' }
	| { type: 'invalid'; message: string }
	| { type: 'valid'; url: string };

const hostBrowserUrlSlotLabels: Record<HostBrowserUrlSlot, string> = {
	'window-url': 'URL',
	'dev-web-server-url': 'Web',
	'storybook-url': 'Story',
	'app-url': 'App',
};

const hostBrowserUrlSlotSet = new Set<string>(HOST_BROWSER_URL_SLOTS);

export function isHostBrowserUrlSlot(
	value: string,
): value is HostBrowserUrlSlot {
	return hostBrowserUrlSlotSet.has(value);
}

export function getHostBrowserUrlSlotLabel(slot: HostBrowserUrlSlot): string {
	return hostBrowserUrlSlotLabels[slot];
}

export function quoteShell(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

function formatMdevOpenEnv(context: TmuxPaneContext): string {
	return [
		`TMUX_PANE=${quoteShell(context.paneId)}`,
		`TMUX_PANE_TTY=${quoteShell(context.paneTty)}`,
		`TMUX_PANE_PATH=${quoteShell(context.panePath)}`,
	].join(' ');
}

export function extractLastHttpsUrl(output: string): string | null {
	const matches = output.match(/https:\/\/[^\s"'<>]+/g);
	return matches?.at(-1) ?? null;
}

export function parseHostBrowserUrlInput(
	input: string,
): ParsedHostBrowserUrlInput {
	const trimmed = input.trim();
	if (!trimmed) return { type: 'empty' };
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return { type: 'invalid', message: 'Enter a valid URL.' };
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return {
			type: 'invalid',
			message: 'Enter an http:// or https:// URL.',
		};
	}
	return { type: 'valid', url: parsed.href };
}

export function buildDiffityShareCommand(panePath: string): string {
	return `cd ${quoteShell(panePath)} && mdev diffity share`;
}

export function buildTmuxWindowConfigGetCommand(
	slot: HostBrowserUrlSlot,
	panePath: string,
): string {
	return `TMUX_PANE_PATH=${quoteShell(panePath)} mdev tmux url get ${quoteShell(slot)}`;
}

export function buildTmuxWindowConfigSetCommand(
	slot: HostBrowserUrlSlot,
	panePath: string,
	url: string,
): string {
	return `TMUX_PANE_PATH=${quoteShell(panePath)} mdev tmux url set-value ${quoteShell(slot)} ${quoteShell(url)}`;
}

export function buildMdevOpenCommand(
	mode: HostBrowserOpenMode,
	context: TmuxPaneContext,
): string {
	return [formatMdevOpenEnv(context), 'mdev', 'open', mode].join(' ');
}

export function buildMdevOpenAutoPrintUrlCommand(
	context: TmuxPaneContext,
): string {
	return [
		formatMdevOpenEnv(context),
		'mdev',
		'open',
		'auto',
		'--print-url',
	].join(' ');
}

export function buildMdevOpenDetectJsonCommand(
	context: TmuxPaneContext,
): string {
	return [formatMdevOpenEnv(context), 'mdev', 'open', 'detect', '--json'].join(
		' ',
	);
}

export function buildMdevOpenBridgePrintUrlCommand(
	context: TmuxPaneContext,
	candidateRaw: string,
): string {
	return [
		formatMdevOpenEnv(context),
		'mdev',
		'open',
		'bridge',
		'--print-url',
		'--',
		quoteShell(candidateRaw),
	].join(' ');
}

export function parsePrintedOpenUrl(output: string): ParsedPrintedOpenUrl {
	const trimmed = output.trim();
	if (!trimmed) {
		return { type: 'invalid', message: 'mdev open did not return a URL.' };
	}
	const parsedHttpUrls: URL[] = [];
	const parsedNonHttpUrls: URL[] = [];
	let hasMalformedUrlLine = false;
	for (const line of output.split(/\r?\n/)) {
		const candidate = line.trim();
		if (!candidate) continue;
		const urlPrefixCount = candidate.match(/https?:\/\//g)?.length ?? 0;
		if (urlPrefixCount > 1) {
			hasMalformedUrlLine = true;
			continue;
		}
		if (urlPrefixCount === 1 && !candidate.match(/^https?:\/\//)) {
			hasMalformedUrlLine = true;
			continue;
		}
		if (/\s/.test(candidate)) {
			if (urlPrefixCount === 1) hasMalformedUrlLine = true;
			continue;
		}
		let parsed: URL;
		try {
			parsed = new URL(candidate);
		} catch {
			if (urlPrefixCount === 1) hasMalformedUrlLine = true;
			continue;
		}
		if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
			parsedHttpUrls.push(parsed);
		} else {
			parsedNonHttpUrls.push(parsed);
		}
	}
	if (hasMalformedUrlLine) {
		return { type: 'invalid', message: 'mdev open returned an invalid URL.' };
	}
	if (parsedHttpUrls.length === 1) {
		const parsed = parsedHttpUrls[0]!;
		return { type: 'valid', url: parsed.href };
	}
	if (parsedHttpUrls.length > 1) {
		return { type: 'invalid', message: 'mdev open returned an invalid URL.' };
	}
	if (parsedNonHttpUrls.length === 1) {
		return { type: 'invalid', message: 'mdev open returned a non-http URL.' };
	}
	return { type: 'invalid', message: 'mdev open returned an invalid URL.' };
}

export function parseDetectedOpenCandidates(
	output: string,
): ParsedDetectedOpenCandidates {
	if (!output.trim()) {
		return {
			type: 'invalid',
			message: 'mdev open detect did not return JSON.',
		};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(output);
	} catch {
		return {
			type: 'invalid',
			message: 'mdev open detect returned invalid JSON.',
		};
	}
	if (!Array.isArray(parsed)) {
		return {
			type: 'invalid',
			message: 'mdev open detect returned an unexpected payload.',
		};
	}
	const candidates: DetectedOpenCandidate[] = [];
	for (const item of parsed) {
		const candidate = parseDetectedOpenCandidate(item);
		if (!candidate) {
			return {
				type: 'invalid',
				message: 'mdev open detect returned an invalid candidate.',
			};
		}
		candidates.push(candidate);
	}
	return { type: 'valid', candidates };
}

function parseDetectedOpenCandidate(value: unknown): DetectedOpenCandidate | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;
	if (
		record.kind !== 'remote-url' &&
		record.kind !== 'local-url' &&
		record.kind !== 'file'
	) {
		return null;
	}
	if (
		typeof record.raw !== 'string' ||
		typeof record.normalized !== 'string' ||
		typeof record.display !== 'string'
	) {
		return null;
	}
	if (record.path !== null && typeof record.path !== 'string') return null;
	if (record.line !== null && typeof record.line !== 'number') return null;
	if (record.url !== null && typeof record.url !== 'string') return null;
	return {
		kind: record.kind,
		raw: record.raw,
		normalized: record.normalized,
		display: record.display,
		path: record.path,
		line: record.line,
		url: record.url,
	};
}
