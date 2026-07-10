import {
	type FeatureRequestControllerCoreDependencies,
	type FeatureRequestSubmissionResult,
} from './feature-request-core';
import { type ShellModalArbiter } from './modal-arbiter';

export type FeatureRequestControllerDependencies<TConnection> = {
	connection: TConnection | null;
	resolveCurrentGitHubRepository(): Promise<string>;
	executeSideChannelCommand(
		connection: TConnection,
		command: string,
		timeoutMs: number,
	): Promise<FeatureRequestSubmissionResult>;
	getErrorMessage(error: unknown): string;
	logger: {
		info(message: string, payload?: unknown): void;
		error(message: string, payload?: unknown): void;
	};
	arbiter: ShellModalArbiter;
};

export type FeatureRequestControllerAdapter =
	FeatureRequestControllerCoreDependencies & {
		registerClose(close: () => boolean): () => void;
	};

const FEATURE_REQUEST_CONFLICTS = [
	'browser-actions',
	'skill-selector',
	'configure',
] as const;

export function createFeatureRequestControllerAdapter<TConnection>(input: {
	getCommittedDependencies(): FeatureRequestControllerDependencies<TConnection>;
	showSubmittedAlert(issueUrl: string | null): void;
}): FeatureRequestControllerAdapter {
	return {
		resolveCurrentGitHubRepository: () =>
			input.getCommittedDependencies().resolveCurrentGitHubRepository(),
		isSubmissionAvailable: () =>
			input.getCommittedDependencies().connection !== null,
		executeSubmission: (command, timeoutMs) => {
			const current = input.getCommittedDependencies();
			if (!current.connection) {
				throw new Error('No SSH connection available');
			}
			return current.executeSideChannelCommand(
				current.connection,
				command,
				timeoutMs,
			);
		},
		requestOpen: (onOpen) =>
			input.getCommittedDependencies().arbiter.requestOpen({
				target: 'feature-request',
				conflicts: FEATURE_REQUEST_CONFLICTS,
				onOpen,
			}),
		getErrorMessage: (error) =>
			input.getCommittedDependencies().getErrorMessage(error),
		logger: {
			info: (message, payload) =>
				input.getCommittedDependencies().logger.info(message, payload),
			error: (message, payload) =>
				input.getCommittedDependencies().logger.error(message, payload),
		},
		showSubmittedAlert: input.showSubmittedAlert,
		registerClose: (close) =>
			input
				.getCommittedDependencies()
				.arbiter.register('feature-request', close),
	};
}
