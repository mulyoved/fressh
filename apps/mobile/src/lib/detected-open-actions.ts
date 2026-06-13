import {
	buildMdevOpenAutoPrintUrlCommand,
	buildMdevOpenBridgePrintUrlCommand,
	buildMdevOpenDetectJsonCommand,
	parseDetectedOpenCandidates,
	parsePrintedOpenUrl,
	type DetectedOpenCandidate,
	type HostBrowserOpenMode,
	type TmuxPaneContext,
} from '@/lib/host-browser-actions';

export type { DetectedOpenCandidate };

export type RunDetectedOpenHostCommandDeps = {
	mode: HostBrowserOpenMode;
	resolvePaneContext: () => Promise<TmuxPaneContext>;
	runHostBrowserCommand: (
		command: string,
		timeoutMs: number,
	) => Promise<string>;
};

export type DetectedOpenInFlightRef = { current: boolean };

export type DetectedOpenCallbackTarget = {
	onOpenDetectedAuto: () => boolean;
	onOpenDetectedPick: () => boolean;
};

export type DetectedOpenShortcutItem = {
	type: string;
	bytes?: readonly number[];
};

export type DetectedOpenShortcutSpec = {
	mode: HostBrowserOpenMode;
	keyboardId: string;
	bytes: readonly number[];
	actionId: DetectedOpenShortcutActionId;
};

export type DetectedOpenShortcutActionId =
	| 'OPEN_HOST_DETECTED_AUTO'
	| 'OPEN_HOST_DETECTED_PICK';

export type DetectedOpenShortcutPressPlan =
	| { type: 'action'; actionId: DetectedOpenShortcutActionId }
	| { type: 'bytes'; bytes: readonly number[] };

// These bytes are reserved by the bundled browser keyboard for old-client
// compatibility; new clients intercept them before writing to the terminal.
export const DETECTED_OPEN_SHORTCUTS = [
	{
		mode: 'auto',
		keyboardId: 'browser_keyboard',
		bytes: [27, 97],
		actionId: 'OPEN_HOST_DETECTED_AUTO',
	},
	{
		mode: 'pick',
		keyboardId: 'browser_keyboard',
		bytes: [27, 65],
		actionId: 'OPEN_HOST_DETECTED_PICK',
	},
] as const satisfies readonly DetectedOpenShortcutSpec[];

export const DETECTED_OPEN_ACTION_IDS = DETECTED_OPEN_SHORTCUTS.map(
	(shortcut) => shortcut.actionId,
);

export type DetectedOpenRequestId = {
	next: () => number;
	isCurrent: (requestId: number) => boolean;
};

export type DetectedOpenErrorReport = {
	title: string;
	message: string;
	panePath?: string;
	command?: string;
};

export type RunDetectedOpenControllerRequestDeps =
	RunDetectedOpenHostCommandDeps & {
		inFlightRef: DetectedOpenInFlightRef;
		requestId: DetectedOpenRequestId;
		setOpen: (open: boolean) => void;
		openUrl: (url: string) => Promise<void>;
		setPickerCandidates: (
			candidates: DetectedOpenCandidate[],
			context: TmuxPaneContext,
		) => void;
		showError: (title: string, message: string) => void;
		showErrorReport?: (report: DetectedOpenErrorReport) => void;
		getErrorMessage: (error: unknown) => string;
	};

export type RunDetectedOpenPickerSelectionRequestDeps = {
	context: TmuxPaneContext;
	candidate: DetectedOpenCandidate;
	runHostBrowserCommand: (
		command: string,
		timeoutMs: number,
	) => Promise<string>;
	openUrl: (url: string) => Promise<void>;
};

export type RunGuardedDetectedOpenPickerSelectionRequestDeps =
	RunDetectedOpenPickerSelectionRequestDeps & {
		id: number;
		requestId: DetectedOpenRequestId;
		getErrorMessage: (error: unknown) => string;
		showPickError: (report: {
			title: 'Pick failed';
			message: string;
			panePath?: string;
		}) => void;
	};

export type DetectedOpenControllerRequestResult =
	| { accepted: false; completion: null }
	| { accepted: true; completion: Promise<void> };

function bytesEqual(
	actual: readonly number[] | undefined,
	expected: readonly number[],
): boolean {
	return (
		actual?.length === expected.length &&
		expected.every((byte, index) => actual[index] === byte)
	);
}

export function tryBeginDetectedOpenRequest({
	inFlightRef,
	onBusy,
}: {
	inFlightRef: DetectedOpenInFlightRef;
	onBusy: () => void;
}): boolean {
	if (inFlightRef.current) {
		onBusy();
		return false;
	}
	inFlightRef.current = true;
	return true;
}

export function finishDetectedOpenRequest(
	inFlightRef: DetectedOpenInFlightRef,
) {
	inFlightRef.current = false;
}

export function getDetectedOpenTimeoutMs(mode: HostBrowserOpenMode): number {
	return mode === 'pick' ? 60_000 : 30_000;
}

export function runDetectedOpenCallback(
	mode: HostBrowserOpenMode,
	target: DetectedOpenCallbackTarget,
): boolean {
	return mode === 'pick'
		? target.onOpenDetectedPick()
		: target.onOpenDetectedAuto();
}

export function resolveDetectedOpenShortcutMode(
	keyboardId: string | null | undefined,
	item: DetectedOpenShortcutItem,
): HostBrowserOpenMode | null {
	const shortcut = DETECTED_OPEN_SHORTCUTS.find(
		(entry) =>
			entry.keyboardId === keyboardId &&
			item.type === 'bytes' &&
			bytesEqual(item.bytes, entry.bytes),
	);
	return shortcut?.mode ?? null;
}

export function planDetectedOpenShortcutPress(
	keyboardId: string | null | undefined,
	item: { type: 'bytes'; bytes: readonly number[] },
): DetectedOpenShortcutPressPlan {
	const mode = resolveDetectedOpenShortcutMode(keyboardId, item);
	const shortcut = DETECTED_OPEN_SHORTCUTS.find((entry) => entry.mode === mode);
	if (shortcut) return { type: 'action', actionId: shortcut.actionId };
	return { type: 'bytes', bytes: item.bytes };
}

export function runDetectedOpenControllerRequest({
	mode,
	inFlightRef,
	requestId,
	resolvePaneContext,
	runHostBrowserCommand,
	setOpen,
	openUrl,
	setPickerCandidates,
	showError,
	showErrorReport,
	getErrorMessage,
}: RunDetectedOpenControllerRequestDeps): DetectedOpenControllerRequestResult {
	if (
		!tryBeginDetectedOpenRequest({
			inFlightRef,
			onBusy: () => {
				showDetectedOpenError(
					{ showError, showErrorReport },
					{
						title: 'Open already running',
						message: 'Wait for the current browser action to finish.',
					},
				);
			},
		})
	) {
		return { accepted: false, completion: null };
	}
	setOpen(false);
	const id = requestId.next();
	const completion = (async () => {
		let context: TmuxPaneContext | null = null;
		let command: string | undefined;
		try {
			context = await resolvePaneContext();
			command =
				mode === 'pick'
					? buildMdevOpenDetectJsonCommand(context)
					: buildMdevOpenAutoPrintUrlCommand(context);
			if (!requestId.isCurrent(id)) return;
			const output = await runHostBrowserCommand(
				command,
				getDetectedOpenTimeoutMs(mode),
			);
			if (!requestId.isCurrent(id)) return;
			if (mode === 'pick') {
				const parsed = parseDetectedOpenCandidates(output);
				if (parsed.type === 'invalid') throw new Error(parsed.message);
				if (parsed.candidates.length === 0) {
					throw new Error('mdev open detect returned no candidates.');
				}
				setPickerCandidates(parsed.candidates, context);
				return;
			}
			const parsed = parsePrintedOpenUrl(output);
			if (parsed.type === 'invalid') throw new Error(parsed.message);
			await openUrl(parsed.url);
		} catch (err) {
			if (!requestId.isCurrent(id)) return;
			showDetectedOpenError(
				{ showError, showErrorReport },
				{
					title: mode === 'pick' ? 'Pick failed' : 'Open failed',
					message: getErrorMessage(err),
					panePath: context?.panePath,
					command,
				},
			);
		} finally {
			if (requestId.isCurrent(id)) {
				finishDetectedOpenRequest(inFlightRef);
			}
		}
	})();
	return { accepted: true, completion };
}

export async function runDetectedOpenPickerSelectionRequest({
	context,
	candidate,
	runHostBrowserCommand,
	openUrl,
}: RunDetectedOpenPickerSelectionRequestDeps): Promise<void> {
	const url = await resolveDetectedOpenPickerSelectionUrl({
		context,
		candidate,
		runHostBrowserCommand,
	});
	await openUrl(url);
}

export async function runGuardedDetectedOpenPickerSelectionRequest({
	context,
	candidate,
	runHostBrowserCommand,
	openUrl,
	id,
	requestId,
	getErrorMessage,
	showPickError,
}: RunGuardedDetectedOpenPickerSelectionRequestDeps): Promise<void> {
	try {
		const url = await resolveDetectedOpenPickerSelectionUrl({
			context,
			candidate,
			runHostBrowserCommand,
		});
		if (!requestId.isCurrent(id)) return;
		await openUrl(url);
	} catch (error) {
		if (!requestId.isCurrent(id)) return;
		showPickError({
			title: 'Pick failed',
			message: getErrorMessage(error),
			panePath: context.panePath,
		});
	}
}

async function resolveDetectedOpenPickerSelectionUrl({
	context,
	candidate,
	runHostBrowserCommand,
}: Pick<
	RunDetectedOpenPickerSelectionRequestDeps,
	'context' | 'candidate' | 'runHostBrowserCommand'
>): Promise<string> {
	const output = await runHostBrowserCommand(
		buildMdevOpenBridgePrintUrlCommand(context, candidate.raw),
		getDetectedOpenTimeoutMs('pick'),
	);
	const parsed = parsePrintedOpenUrl(output);
	if (parsed.type === 'invalid') throw new Error(parsed.message);
	return parsed.url;
}

function showDetectedOpenError(
	{
		showError,
		showErrorReport,
	}: {
		showError: (title: string, message: string) => void;
		showErrorReport?: (report: DetectedOpenErrorReport) => void;
	},
	report: DetectedOpenErrorReport,
) {
	if (showErrorReport) {
		showErrorReport(report);
		return;
	}
	showError(report.title, report.message);
}
