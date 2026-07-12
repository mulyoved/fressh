import { type BrowserActionsWorkspace } from '../browser-actions-controller-actions';
import { HOST_BROWSER_NO_CONNECTION_MESSAGE } from '../host-browser-actions';
import { type SkillDiscoveryCache } from '../skill-discovery-cache';
import { type loadSkillSelectorProject } from '../skill-selector-loader';
import { type ShellModalArbiter } from './modal-arbiter';
import { type SkillSelectorProject } from './skill-selector-core';

export type SkillSelectorControllerDependencies<TConnection> = {
	connection: TConnection | null;
	tmuxEnabled: boolean;
	runHostBrowserCommand: (
		command: string,
		timeoutMs?: number,
	) => Promise<string>;
	resolveHostBrowserWorkspace: () => Promise<BrowserActionsWorkspace>;
	sendTextRaw: (text: string) => void;
	sourceKey: string;
	stableConnectionId: string;
	tmuxTarget: string;
	getErrorMessage: (error: unknown) => string;
	arbiter: ShellModalArbiter;
};

export type SkillSelectorProjectLoader = typeof loadSkillSelectorProject;

export type SkillSelectorControllerAdapter = {
	loadProject(input: { forceRefresh: boolean }): Promise<SkillSelectorProject>;
	sendText(value: string): void;
	requestOpen(onOpen: () => void): boolean;
	getErrorMessage(error: unknown): string;
	registerClose(close: () => void): () => void;
};

const SKILL_SELECTOR_CONFLICTS = [
	'command-menu',
	'browser-actions',
	'commander',
	'configure',
	'feature-request',
	'text-entry',
] as const;

export function createSkillSelectorControllerAdapter<TConnection>(input: {
	getCommittedDependencies(): SkillSelectorControllerDependencies<TConnection>;
	cache: SkillDiscoveryCache;
	loadProject: SkillSelectorProjectLoader;
}): SkillSelectorControllerAdapter {
	return {
		loadProject: async ({ forceRefresh }) => {
			const current = input.getCommittedDependencies();
			if (!current.connection) {
				throw new Error(HOST_BROWSER_NO_CONNECTION_MESSAGE);
			}
			if (!current.tmuxEnabled) {
				throw new Error('Skill selector requires a tmux-enabled connection.');
			}
			return input.loadProject({
				cache: input.cache,
				stableConnectionId: current.stableConnectionId,
				tmuxTarget: current.tmuxTarget,
				resolveWorkspace: current.resolveHostBrowserWorkspace,
				runCommand: (command) => current.runHostBrowserCommand(command, 10_000),
				forceRefresh,
			});
		},
		sendText: (value) => input.getCommittedDependencies().sendTextRaw(value),
		requestOpen: (onOpen) =>
			input.getCommittedDependencies().arbiter.requestOpen({
				target: 'skill-selector',
				conflicts: SKILL_SELECTOR_CONFLICTS,
				onOpen,
			}),
		getErrorMessage: (error) =>
			input.getCommittedDependencies().getErrorMessage(error),
		registerClose: (close) =>
			input
				.getCommittedDependencies()
				.arbiter.register('skill-selector', close),
	};
}
