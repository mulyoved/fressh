import {
	buildTmuxWindowConfigGetCommand,
	getHostBrowserUrlSlotLabel,
	parseHostBrowserUrlInput,
	type HostBrowserUrlSlot,
} from './host-browser-actions';
import { type RequestIdHandle } from './request-id';
import {
	createHostUrlOpenBrowserActionErrorInput,
	type BrowserActionErrorInput,
} from './shell-browser-action-error-inputs';

export type HostUrlReadRequestMode = 'open' | 'edit';

export type HostUrlReadModalState = {
	mode: 'open-missing' | 'edit';
	slot: HostBrowserUrlSlot;
	panePath: string;
	initialValue: string;
};

export function runHostUrlReadRequest({
	mode,
	slot,
	requestId,
	resolvePanePath,
	runHostBrowserCommand,
	openAndroidUrl,
	setOpen,
	setHostUrlModalState,
	setHostUrlModalError,
	showError,
	getErrorMessage,
}: {
	mode: HostUrlReadRequestMode;
	slot: HostBrowserUrlSlot;
	requestId: Pick<RequestIdHandle, 'next' | 'isCurrent'>;
	resolvePanePath: () => Promise<string>;
	runHostBrowserCommand: (
		command: string,
		timeoutMs?: number,
	) => Promise<string>;
	openAndroidUrl: (url: string) => Promise<void>;
	setOpen: (open: boolean) => void;
	setHostUrlModalState: (state: HostUrlReadModalState | null) => void;
	setHostUrlModalError: (message: string | null) => void;
	showError: (input: BrowserActionErrorInput) => void;
	getErrorMessage: (error: unknown) => string;
}) {
	setOpen(false);
	const id = requestId.next();
	let panePath: string | undefined;
	let command: string | undefined;
	let openedUrl: string | undefined;
	let operation: 'read' | 'open' = 'read';
	void (async () => {
		try {
			panePath = await resolvePanePath();
			if (!requestId.isCurrent(id)) return;
			command = buildTmuxWindowConfigGetCommand(slot, panePath);
			const value = await runHostBrowserCommand(command, 10_000);
			if (!requestId.isCurrent(id)) return;
			if (mode === 'edit') {
				setHostUrlModalError(null);
				setHostUrlModalState({
					mode: 'edit',
					slot,
					panePath,
					initialValue: value.trim(),
				});
				return;
			}
			const savedUrl = value.trim();
			if (savedUrl) {
				const parsed = parseHostBrowserUrlInput(savedUrl);
				if (parsed.type === 'invalid') {
					setHostUrlModalState({
						mode: 'edit',
						slot,
						panePath,
						initialValue: savedUrl,
					});
					setHostUrlModalError(parsed.message);
					return;
				}
				if (parsed.type === 'empty') return;
				operation = 'open';
				openedUrl = parsed.url;
				await openAndroidUrl(parsed.url);
				return;
			}
			setHostUrlModalError(null);
			setHostUrlModalState({
				mode: 'open-missing',
				slot,
				panePath,
				initialValue: '',
			});
		} catch (err) {
			if (!requestId.isCurrent(id)) return;
			const label = getHostBrowserUrlSlotLabel(slot);
			if (operation === 'open' && openedUrl && panePath) {
				showError(
					createHostUrlOpenBrowserActionErrorInput({
						slot,
						message: getErrorMessage(err),
						panePath,
						command,
						url: openedUrl,
					}),
				);
				return;
			}
			const input: BrowserActionErrorInput = {
				action: label,
				title: mode === 'edit' ? `Edit ${label} failed` : `${label} failed`,
				message: getErrorMessage(err),
			};
			if (panePath !== undefined) input.panePath = panePath;
			if (command !== undefined) input.command = command;
			showError(input);
		}
	})();
}
