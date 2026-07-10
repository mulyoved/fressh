import { HOST_BROWSER_NO_CONNECTION_MESSAGE } from '../host-browser-actions';
import { runHostCommandWithBoundary } from '../host-command-router';
import { type BrowserActionErrorInput } from '../shell-browser-action-error-inputs';
import { type ShellModalArbiter } from './modal-arbiter';
import { type ShellTargetKey } from './source-keys';

export type BrowserActionsControllerDependencies<TConnection> = {
	connection: TConnection | null;
	tmuxEnabled: boolean;
	tmuxTarget: string;
	sourceKey: ShellTargetKey;
	executeSideChannelCommand(
		connection: TConnection,
		command: string,
		timeoutMs: number,
	): Promise<{ success: boolean; output: string; error?: string }>;
	runWorkmuxCommand(
		connection: TConnection,
		argv: string[],
		timeoutMs: number,
	): Promise<string>;
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

export function createBrowserActionsControllerAdapter<TConnection>(input: {
	getCommittedDependencies(): BrowserActionsControllerDependencies<TConnection>;
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
				connection: current.connection,
				command,
				timeoutMs,
				executeSideChannelCommand: current.executeSideChannelCommand,
				runWorkmuxCommand: current.runWorkmuxCommand,
			});
		},
		runWorkmuxCommand: (argv, timeoutMs) => {
			const current = input.getCommittedDependencies();
			if (!current.connection) {
				throw new Error(HOST_BROWSER_NO_CONNECTION_MESSAGE);
			}
			return current.runWorkmuxCommand(current.connection, argv, timeoutMs);
		},
		openAndroidUrl: input.openAndroidUrl,
		showError: (error) => {
			const current = input.getCommittedDependencies();
			input.showError(error, {
				connectionPresent: current.connection !== null,
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
		registerClose: ({ close, invalidateHostUrlReads }) =>
			input
				.getCommittedDependencies()
				.arbiter.register('browser-actions', ({ opening }) => {
					if (HOST_URL_READ_INVALIDATION_TARGETS.has(opening)) {
						invalidateHostUrlReads();
					}
					close();
				}),
	};
}
