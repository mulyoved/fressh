import { redactBrowserActionErrorText } from './browser-action-error-report';
import {
	buildGitHubRepositoryTargetUrl,
	buildResolveGitHubRepositoryCommand,
	parseGitHubRepositoryResolutionOutput,
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

export function redactGitHubRepositoryResolutionOutput(output: string): string {
	return redactBrowserActionErrorText(output);
}

export async function resolveGitHubRepositoryContext({
	resolvePanePath,
	runHostBrowserCommand,
	getErrorMessage,
}: {
	resolvePanePath: () => Promise<string>;
	runHostBrowserCommand: (
		command: string,
		timeoutMs: number,
	) => Promise<string>;
	getErrorMessage: (error: unknown) => string;
}): Promise<GitHubRepositoryResolutionContext> {
	const panePath = await resolvePanePath();
	const command = buildResolveGitHubRepositoryCommand(panePath);
	let output: string;
	try {
		output = await runHostBrowserCommand(command, 10_000);
	} catch (error) {
		throw new GitHubRepositoryResolutionError({
			message: getErrorMessage(error),
			panePath,
			command,
		});
	}
	const repository = parseGitHubRepositoryResolutionOutput(output);
	if (!repository) {
		throw new GitHubRepositoryResolutionError({
			message: 'Could not resolve GitHub repository for current window.',
			panePath,
			command,
			output,
		});
	}
	return { repository, panePath, command, output };
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
			if (output !== undefined) {
				input.output = redactGitHubRepositoryResolutionOutput(output);
			}
			if (url !== undefined) input.url = url;
			showError(input);
		}
	})();
}
