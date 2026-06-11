import {
	buildGitHubRepositoryTargetUrl,
	type GitHubRepositoryTarget,
} from './repo-feature-request';
import { type RequestIdHandle } from './request-id';
import { type BrowserActionErrorInput } from './shell-browser-action-error-inputs';

export type GitHubRepositoryResolutionContext = {
	repository: string;
	panePath?: string;
	command?: string;
	output?: string;
};

export function runGitHubTargetOpenRequest({
	target,
	requestId,
	resolveRepositoryContext,
	openAndroidUrl,
	showError,
	getErrorMessage,
}: {
	target: GitHubRepositoryTarget;
	requestId: Pick<RequestIdHandle, 'next' | 'isCurrent'>;
	resolveRepositoryContext: () => Promise<GitHubRepositoryResolutionContext>;
	openAndroidUrl: (url: string) => Promise<void>;
	showError: (input: BrowserActionErrorInput) => void;
	getErrorMessage: (error: unknown) => string;
}) {
	const id = requestId.next();
	const title =
		target === 'issues'
			? 'GitHub Issues failed'
			: 'GitHub Pull Requests failed';
	void (async () => {
		let context: GitHubRepositoryResolutionContext | null = null;
		let url: string | undefined;
		try {
			context = await resolveRepositoryContext();
			if (!requestId.isCurrent(id)) return;
			url = buildGitHubRepositoryTargetUrl(context.repository, target);
			await openAndroidUrl(url);
		} catch (err) {
			if (!requestId.isCurrent(id)) return;
			showError({
				action: target === 'issues' ? 'GitHub Issues' : 'GitHub Pull Requests',
				title,
				message: getErrorMessage(err),
				panePath: context?.panePath,
				command: context?.command,
				output: context?.output,
				url,
			});
		}
	})();
}
