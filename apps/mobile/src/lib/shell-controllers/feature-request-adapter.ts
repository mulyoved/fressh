import { type FeatureRequestControllerCoreDependencies } from './feature-request-core';
import { type ShellModalArbiter } from './modal-arbiter';
import { type ShellHostCommandPort } from './session-contracts';

export type FeatureRequestControllerDependencies = {
	hostCommands: ShellHostCommandPort | null;
	resolveCurrentGitHubRepository(): Promise<string>;
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

export function createFeatureRequestControllerAdapter(input: {
	getCommittedDependencies(): FeatureRequestControllerDependencies;
	showSubmittedAlert(issueUrl: string | null): void;
}): FeatureRequestControllerAdapter {
	return {
		resolveCurrentGitHubRepository: () =>
			input.getCommittedDependencies().resolveCurrentGitHubRepository(),
		isSubmissionAvailable: () =>
			input.getCommittedDependencies().hostCommands !== null,
		executeSubmission: (command, timeoutMs) => {
			const current = input.getCommittedDependencies();
			if (!current.hostCommands)
				return Promise.resolve({ status: 'unavailable' });
			return current.hostCommands.run(command, timeoutMs);
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
