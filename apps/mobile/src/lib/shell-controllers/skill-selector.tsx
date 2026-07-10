import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
import { type BrowserActionsWorkspace } from '@/lib/browser-actions-controller-actions';
import { HOST_BROWSER_NO_CONNECTION_MESSAGE } from '@/lib/host-browser-actions';
import { type DiscoveredSkill } from '@/lib/skill-discovery';
import { skillDiscoveryCache } from '@/lib/skill-discovery-cache-native';
import { loadSkillSelectorProject } from '@/lib/skill-selector-loader';
import { type ShellModalArbiter } from './modal-arbiter';
import { createReplaySafeDisposer } from './simple-modals';
import {
	createSkillSelectorControllerCore,
	type SkillSelectorControllerCore,
} from './skill-selector-core';

export type SkillSelectorModalProps = {
	open: boolean;
	skills: DiscoveredSkill[];
	projectName: string | null;
	projectRoot: string | null;
	updatedAt: string | null;
	isLoading: boolean;
	isRefreshing: boolean;
	error: string | null;
	refreshError: string | null;
	onClose: () => void;
	onRetry: () => void;
	onRefresh: () => void;
	onSelect: (skill: DiscoveredSkill) => void;
};

export type SkillSelectorControllerHandle = {
	modalProps: SkillSelectorModalProps;
	open: () => void;
	close: () => void;
};

type SkillSelectorControllerDependencies<TConnection> = {
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

const SKILL_SELECTOR_CONFLICTS = [
	'command-menu',
	'browser-actions',
	'commander',
	'configure',
	'feature-request',
	'text-entry',
] as const;

export function useSkillSelectorController<TConnection>(
	deps: SkillSelectorControllerDependencies<TConnection>,
): SkillSelectorControllerHandle {
	const depsRef = useRef(deps);
	depsRef.current = deps;
	const [core] = useState<SkillSelectorControllerCore>(() =>
		createSkillSelectorControllerCore({
			initialSourceKey: deps.sourceKey,
			loadProject: async ({ forceRefresh }) => {
				const current = depsRef.current;
				const requestSourceKey = current.sourceKey;
				if (!current.connection) {
					throw new Error(HOST_BROWSER_NO_CONNECTION_MESSAGE);
				}
				if (!current.tmuxEnabled) {
					throw new Error('Skill selector requires a tmux-enabled connection.');
				}
				return loadSkillSelectorProject({
					cache: skillDiscoveryCache,
					stableConnectionId: current.stableConnectionId,
					tmuxTarget: current.tmuxTarget,
					resolveWorkspace: async () => {
						const workspace = await current.resolveHostBrowserWorkspace();
						if (depsRef.current.sourceKey !== requestSourceKey) {
							throw new Error('Skill selector source changed.');
						}
						return workspace;
					},
					runCommand: (command) =>
						current.runHostBrowserCommand(command, 10_000),
					forceRefresh,
				});
			},
			sendText: (value) => depsRef.current.sendTextRaw(value),
			requestOpen: (onOpen) =>
				depsRef.current.arbiter.requestOpen({
					target: 'skill-selector',
					conflicts: SKILL_SELECTOR_CONFLICTS,
					onOpen,
				}),
			getErrorMessage: (error) => depsRef.current.getErrorMessage(error),
		}),
	);
	const [coreLifecycle] = useState(() =>
		createReplaySafeDisposer(core.dispose),
	);
	const snapshot = useSyncExternalStore(
		core.subscribe,
		core.getSnapshot,
		core.getSnapshot,
	);

	useLayoutEffect(() => {
		core.setSourceKey(deps.sourceKey);
	}, [core, deps.sourceKey]);

	useEffect(() => {
		return deps.arbiter.register('skill-selector', core.close);
	}, [core, deps.arbiter]);

	useEffect(() => coreLifecycle.setup(), [coreLifecycle]);

	const open = useCallback(() => core.open(), [core]);
	const close = useCallback(() => core.close(), [core]);
	const retry = useCallback(() => core.retry(), [core]);
	const refresh = useCallback(() => core.refresh(), [core]);
	const select = useCallback(
		(skill: DiscoveredSkill) => core.select(skill),
		[core],
	);
	const modalProps = useMemo<SkillSelectorModalProps>(
		() => ({
			...snapshot,
			onClose: close,
			onRetry: retry,
			onRefresh: refresh,
			onSelect: select,
		}),
		[close, refresh, retry, select, snapshot],
	);

	return useMemo(
		() => ({ modalProps, open, close }),
		[close, modalProps, open],
	);
}
