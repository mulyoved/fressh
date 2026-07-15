import { buildCreateGitHubIssueCommand } from '../repo-feature-request';
import {
	createControllerPublisher,
	type ControllerCore,
} from './controller-core';
import { type ShellHostCommandPort } from './session-contracts';

export type FeatureRequestState = {
	open: boolean;
	isSubmitting: boolean;
	targetRepository: string | null;
	isResolvingTarget: boolean;
	error: string | undefined;
};

export type FeatureRequestSubmissionResult = Awaited<
	ReturnType<ShellHostCommandPort['run']>
>;

export type FeatureRequestControllerCore =
	ControllerCore<FeatureRequestState> & {
		open(): void;
		close(): boolean;
		markSourceStale(): void;
		submit(description: string, repository: string): Promise<void>;
	};

export type FeatureRequestControllerCoreDependencies = {
	resolveCurrentGitHubRepository(): Promise<string>;
	isSubmissionAvailable(): boolean;
	executeSubmission(
		command: string,
		timeoutMs: number,
	): Promise<FeatureRequestSubmissionResult>;
	requestOpen(onOpen: () => void): boolean;
	getErrorMessage(error: unknown): string;
	logger: {
		info(message: string, payload?: unknown): void;
		error(message: string, payload?: unknown): void;
	};
	showSubmittedAlert(issueUrl: string | null): void;
};

const CLOSED_STATE: FeatureRequestState = {
	open: false,
	isSubmitting: false,
	targetRepository: null,
	isResolvingTarget: false,
	error: undefined,
};

export function createFeatureRequestControllerCore(
	deps: FeatureRequestControllerCoreDependencies,
): FeatureRequestControllerCore {
	const publisher = createControllerPublisher(CLOSED_STATE);
	let resolveGeneration = 0;
	let submitGeneration = 0;
	let sourceStale = false;
	let disposed = false;

	const reset = () => publisher.publish(CLOSED_STATE);
	const cancelResolve = () => {
		resolveGeneration += 1;
	};
	const cancelSubmit = () => {
		submitGeneration += 1;
	};
	const cancelRequests = () => {
		cancelResolve();
		cancelSubmit();
	};
	const isCurrentResolve = (generation: number) =>
		!disposed && resolveGeneration === generation;
	const isCurrentSubmit = (generation: number) =>
		!disposed && submitGeneration === generation;

	const close = (): boolean => {
		if (disposed) return true;
		if (publisher.getSnapshot().isSubmitting) return false;
		cancelRequests();
		sourceStale = false;
		reset();
		return true;
	};

	const beginOpen = () => {
		if (disposed) return;
		const generation = ++resolveGeneration;
		sourceStale = false;
		publisher.publish({
			...CLOSED_STATE,
			open: true,
			isResolvingTarget: true,
		});

		void (async () => {
			try {
				const repository = await deps.resolveCurrentGitHubRepository();
				if (!isCurrentResolve(generation)) return;
				const current = publisher.getSnapshot();
				publisher.publish({
					...current,
					targetRepository: repository,
					isResolvingTarget: false,
					error: undefined,
				});
			} catch (error) {
				if (!isCurrentResolve(generation)) return;
				const current = publisher.getSnapshot();
				publisher.publish({
					...current,
					targetRepository: null,
					isResolvingTarget: false,
					error: deps.getErrorMessage(error),
				});
			}
		})();
	};

	const markSourceStale = () => {
		if (disposed) return;
		cancelResolve();
		if (publisher.getSnapshot().isSubmitting) {
			sourceStale = true;
			return;
		}
		close();
	};

	return {
		getSnapshot: publisher.getSnapshot,
		subscribe: publisher.subscribe,
		open: () => {
			if (disposed || publisher.getSnapshot().isSubmitting) {
				return;
			}
			deps.requestOpen(beginOpen);
		},
		close,
		markSourceStale,
		submit: async (description, repository) => {
			if (disposed || publisher.getSnapshot().isSubmitting) return;
			cancelResolve();
			publisher.publish({
				...publisher.getSnapshot(),
				isResolvingTarget: false,
			});
			const generation = ++submitGeneration;
			if (!deps.isSubmissionAvailable()) {
				publisher.publish({
					...publisher.getSnapshot(),
					error: 'No SSH connection available',
				});
				return;
			}
			if (!repository) {
				publisher.publish({
					...publisher.getSnapshot(),
					error: 'Could not resolve GitHub repository for current window.',
				});
				return;
			}

			sourceStale = false;
			publisher.publish({
				...publisher.getSnapshot(),
				isSubmitting: true,
				error: undefined,
			});
			const command = buildCreateGitHubIssueCommand({
				description,
				repository,
			});

			try {
				const result = await deps.executeSubmission(command, 60_000);
				if (!isCurrentSubmit(generation)) return;
				if (sourceStale) {
					reset();
					sourceStale = false;
					return;
				}
				if (result.status === 'superseded') {
					reset();
					sourceStale = false;
					return;
				}
				if (result.status === 'completed') {
					deps.logger.info('Feature request submitted successfully', {
						output: result.output,
						issueUrl: result.issueUrl,
					});
					reset();
					sourceStale = false;
					deps.showSubmittedAlert(result.issueUrl ?? null);
				} else {
					const errorMessage =
						result.status === 'failed'
							? result.failure.message
							: 'No SSH connection available';
					deps.logger.error('Feature request failed', {
						error: errorMessage,
					});
					if (!isCurrentSubmit(generation)) return;
					publisher.publish({
						...publisher.getSnapshot(),
						error: errorMessage,
					});
				}
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : 'Unknown error occurred';
				deps.logger.error('Feature request error', { error });
				if (!isCurrentSubmit(generation)) return;
				if (sourceStale) {
					reset();
					sourceStale = false;
					return;
				}
				publisher.publish({
					...publisher.getSnapshot(),
					error: errorMessage,
				});
			} finally {
				if (isCurrentSubmit(generation)) {
					publisher.publish({
						...publisher.getSnapshot(),
						isSubmitting: false,
					});
				}
			}
		},
		invalidate: () => markSourceStale(),
		dispose: () => {
			if (disposed) return;
			cancelRequests();
			sourceStale = false;
			reset();
			disposed = true;
			publisher.disposePublisher();
		},
	};
}
