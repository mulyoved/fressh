import { HOST_BROWSER_NO_CONNECTION_MESSAGE } from '../host-browser-actions';
import { type SkillDiscoveryCache } from '../skill-discovery-cache';
import { type loadSkillSelectorProject } from '../skill-selector-loader';
import {
	buildWorkmuxAppContextArgv,
	formatWorkmuxAppBoundaryFailureMessage,
	parseWorkmuxAppContextOutput,
} from '../workmux-app-commands';
import { type ControllerOutcome } from './controller-core';
import { type ShellModalArbiter } from './modal-arbiter';
import { type ShellScrollbackInputPort } from './scrollback-contracts';
import {
	type ShellHostCommandPort,
	type ShellWorkmuxPort,
} from './session-contracts';
import { type SkillSelectorProject } from './skill-selector-core';

export type SkillSelectorControllerDependencies = {
	hostCommands: ShellHostCommandPort | null;
	workmux: Pick<ShellWorkmuxPort, 'key' | 'command'>;
	input: ShellScrollbackInputPort;
	tmuxEnabled: boolean;
	sourceKey: string;
	stableConnectionId: string;
	tmuxTarget: string;
	getErrorMessage: (error: unknown) => string;
	arbiter: ShellModalArbiter;
};

export type SkillSelectorProjectLoader = typeof loadSkillSelectorProject;

export type SkillSelectorControllerAdapter = {
	loadProject(input: { forceRefresh: boolean }): Promise<SkillSelectorProject>;
	sendInput(value: string): Promise<ControllerOutcome<{ message: string }>>;
	requestOpen(onOpen: () => void): boolean;
	getErrorMessage(error: unknown): string;
	registerClose(close: () => void): () => void;
};

const encoder = new TextEncoder();

const SKILL_SELECTOR_CONFLICTS = [
	'command-menu',
	'browser-actions',
	'commander',
	'configure',
	'feature-request',
	'text-entry',
] as const;

export function createSkillSelectorControllerAdapter(input: {
	getCommittedDependencies(): SkillSelectorControllerDependencies;
	cache: SkillDiscoveryCache;
	loadProject: SkillSelectorProjectLoader;
}): SkillSelectorControllerAdapter {
	return {
		loadProject: async ({ forceRefresh }) => {
			const current = input.getCommittedDependencies();
			const hostCommands = current.hostCommands;
			if (!hostCommands) {
				throw new Error(HOST_BROWSER_NO_CONNECTION_MESSAGE);
			}
			if (!current.tmuxEnabled) {
				throw new Error('Skill selector requires a tmux-enabled connection.');
			}
			return input.loadProject({
				cache: input.cache,
				stableConnectionId: current.stableConnectionId,
				tmuxTarget: current.tmuxTarget,
				resolveWorkspace: async () => {
					const sessionName = current.tmuxTarget.trim() || 'main';
					const result = await current.workmux.command(
						buildWorkmuxAppContextArgv(sessionName),
						{ timeoutMs: 10_000 },
					);
					if (result.status !== 'completed') {
						const message =
							result.status === 'failed'
								? result.failure.message
								: result.status === 'superseded'
									? 'Workmux command superseded.'
									: 'Workmux command unavailable.';
						throw new Error(formatWorkmuxAppBoundaryFailureMessage(message));
					}
					try {
						const context = parseWorkmuxAppContextOutput(result.output ?? '');
						return {
							panePath: context.panePath,
							projectRoot: context.projectRoot,
							projectName: context.projectName,
						};
					} catch (error) {
						throw new Error(
							`Could not resolve workspace for Workmux-enabled connection ${sessionName}: ${current.getErrorMessage(error)}`,
						);
					}
				},
				runCommand: async (command) => {
					const result = await hostCommands.run(command, 10_000);
					if (result.status === 'completed') return result.output ?? '';
					throw new Error(
						result.status === 'failed'
							? result.failure.message
							: result.status === 'superseded'
								? 'Skill discovery command superseded.'
								: HOST_BROWSER_NO_CONNECTION_MESSAGE,
					);
				},
				forceRefresh,
			});
		},
		sendInput: (value) =>
			input
				.getCommittedDependencies()
				.input.sendSegments([encoder.encode(value)]),
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
