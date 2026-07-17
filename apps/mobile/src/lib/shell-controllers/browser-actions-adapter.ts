import { HOST_BROWSER_NO_CONNECTION_MESSAGE } from '../host-browser-actions';
import { runHostCommandWithBoundary } from '../host-command-router';
import { type BrowserActionErrorInput } from '../shell-browser-action-error-inputs';
import { unwrapControllerOutput } from './controller-outcome';
import { type ShellModalArbiter } from './modal-arbiter';
import {
	type ShellHostCommandPort,
	type ShellWorkmuxPort,
} from './session-contracts';
import { type ShellTargetKey } from './source-keys';

export type BrowserActionsControllerDependencies = {
	hostCommands: ShellHostCommandPort | null;
	workmux: Pick<ShellWorkmuxPort, 'key' | 'command'>;
	tmuxEnabled: boolean;
	tmuxTarget: string;
	sourceKey: ShellTargetKey;
	getErrorMessage(error: unknown): string;
	arbiter: ShellModalArbiter;
};

export type BrowserActionsControllerAdapter = {
	getTmuxEnabled(): boolean;
	getTmuxTarget(): string;
	runHostBrowserCommand(command: string, timeoutMs: number): Promise<string>;
	runWorkmuxCommand(argv: string[], timeoutMs: number): Promise<string>;
	openAndroidUrl(url: string): Promise<void>;
	showError(input: BrowserActionErrorInput): void;
	getErrorMessage(error: unknown): string;
	requestOpen(onOpen: () => void): boolean;
	registerClose(input: {
		closeHostUrl(): boolean;
		closeDetectedPicker(): void;
		close(): void;
		invalidateHostUrlReads(): void;
	}): () => void;
};

const BROWSER_ACTIONS_CONFLICTS = [
	'command-menu',
	'commander',
	'skill-selector',
	'text-entry',
	'configure',
	'feature-request',
] as const;

const HOST_URL_READ_INVALIDATION_TARGETS = new Set([
	'feature-request',
	'configure',
	'text-entry',
]);

export function createBrowserActionsControllerAdapter(input: {
	getCommittedDependencies(): BrowserActionsControllerDependencies;
	openAndroidUrl(url: string): Promise<void>;
	showError(
		error: BrowserActionErrorInput,
		context: {
			connectionPresent: boolean;
			tmuxEnabled: boolean;
			tmuxTarget: string;
		},
	): void;
}): BrowserActionsControllerAdapter {
	return {
		getTmuxEnabled: () => input.getCommittedDependencies().tmuxEnabled,
		getTmuxTarget: () => input.getCommittedDependencies().tmuxTarget,
		runHostBrowserCommand: (command, timeoutMs) => {
			const current = input.getCommittedDependencies();
			return runHostCommandWithBoundary({
				hostCommands: current.hostCommands,
				command,
				timeoutMs,
				workmux: current.workmux,
			});
		},
		runWorkmuxCommand: (argv, timeoutMs) => {
			const current = input.getCommittedDependencies();
			if (!current.hostCommands) {
				throw new Error(HOST_BROWSER_NO_CONNECTION_MESSAGE);
			}
			return current.workmux.command(argv, { timeoutMs }).then((result) =>
				unwrapControllerOutput(result, {
					superseded: 'Workmux command superseded.',
					unavailable: 'Workmux command unavailable.',
				}),
			);
		},
		openAndroidUrl: input.openAndroidUrl,
		showError: (error) => {
			const current = input.getCommittedDependencies();
			input.showError(error, {
				connectionPresent: current.hostCommands !== null,
				tmuxEnabled: current.tmuxEnabled,
				tmuxTarget: current.tmuxTarget,
			});
		},
		getErrorMessage: (error) =>
			input.getCommittedDependencies().getErrorMessage(error),
		requestOpen: (onOpen) =>
			input.getCommittedDependencies().arbiter.requestOpen({
				target: 'browser-actions',
				conflicts: BROWSER_ACTIONS_CONFLICTS,
				onOpen,
			}),
		registerClose: ({
			closeHostUrl,
			closeDetectedPicker,
			close,
			invalidateHostUrlReads,
		}) =>
			input
				.getCommittedDependencies()
				.arbiter.register('browser-actions', ({ opening }) => {
					if (!closeHostUrl()) return false;
					if (HOST_URL_READ_INVALIDATION_TARGETS.has(opening)) {
						invalidateHostUrlReads();
					}
					closeDetectedPicker();
					close();
				}),
	};
}
