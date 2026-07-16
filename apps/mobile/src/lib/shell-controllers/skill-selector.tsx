import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
import { type DiscoveredSkill } from '@/lib/skill-discovery';
import { skillDiscoveryCache } from '@/lib/skill-discovery-cache-native';
import { loadSkillSelectorProject } from '@/lib/skill-selector-loader';
import {
	createReplaySafeControllerLifecycle,
	syncControllerSource,
} from './controller-lifecycle';
import {
	createSkillSelectorControllerAdapter,
	type SkillSelectorControllerDependencies,
} from './skill-selector-adapter';
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
	isSelecting: boolean;
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

export function useSkillSelectorController(
	deps: SkillSelectorControllerDependencies,
): SkillSelectorControllerHandle {
	const committedDepsRef = useRef(deps);
	const trackedSourceRef = useRef({
		sourceKey: deps.sourceKey,
		tmuxEnabled: deps.tmuxEnabled,
		authority: deps.hostCommands,
	});
	const [adapter] = useState(() =>
		createSkillSelectorControllerAdapter({
			getCommittedDependencies: () => committedDepsRef.current,
			cache: skillDiscoveryCache,
			loadProject: loadSkillSelectorProject,
		}),
	);
	const [core] = useState<SkillSelectorControllerCore>(() =>
		createSkillSelectorControllerCore({
			initialSourceKey: deps.sourceKey,
			loadProject: adapter.loadProject,
			sendInput: adapter.sendInput,
			requestOpen: adapter.requestOpen,
			getErrorMessage: adapter.getErrorMessage,
		}),
	);
	const [coreLifecycle] = useState(() =>
		createReplaySafeControllerLifecycle(core),
	);
	const snapshot = useSyncExternalStore(
		core.subscribe,
		core.getSnapshot,
		core.getSnapshot,
	);

	useLayoutEffect(() => {
		syncControllerSource({
			committedDependencies: committedDepsRef,
			trackedSource: trackedSourceRef,
			dependencies: deps,
			getAuthority: (dependencies) => dependencies.hostCommands,
			core,
		});
	}, [core, deps]);

	useEffect(() => {
		return adapter.registerClose(core.close);
	}, [adapter, core, deps.arbiter]);

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
