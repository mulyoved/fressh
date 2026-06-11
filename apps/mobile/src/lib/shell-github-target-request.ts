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

export class GitHubRepositoryResolutionError extends Error {
	readonly panePath?: string;
	readonly command?: string;
	readonly output?: string;

	constructor({
		message,
		panePath,
		command,
		output,
	}: {
		message: string;
		panePath?: string;
		command?: string;
		output?: string;
	}) {
		super(message);
		this.name = 'GitHubRepositoryResolutionError';
		this.panePath = panePath;
		this.command = command;
		this.output = output;
	}
}

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
			const resolutionError =
				err instanceof GitHubRepositoryResolutionError ? err : null;
			const input: BrowserActionErrorInput = {
				action: target === 'issues' ? 'GitHub Issues' : 'GitHub Pull Requests',
				title,
				message: getErrorMessage(err),
			};
			const panePath = context?.panePath ?? resolutionError?.panePath;
			const command = context?.command ?? resolutionError?.command;
			const output = context?.output ?? resolutionError?.output;
			if (panePath !== undefined) input.panePath = panePath;
			if (command !== undefined) input.command = command;
			if (output !== undefined) input.output = output;
			if (url !== undefined) input.url = url;
			showError(input);
		}
	})();
}
