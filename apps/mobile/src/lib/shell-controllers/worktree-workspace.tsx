import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
import { Alert } from 'react-native';
import { rootLogger } from '../logger';
import { type ControllerOutcome } from './controller-core';
import {
	createReplaySafeControllerLifecycle,
	syncControllerSource,
} from './controller-lifecycle';
import {
	createWorktreeWorkspaceControllerAdapter,
	type WorktreeWorkspaceControllerDependencies,
} from './worktree-workspace-adapter';
import {
	type WorktreeWorkspaceCore,
	type WorktreeWorkspaceFailure,
	type WorktreeWorkspaceState,
} from './worktree-workspace-contracts';
import {
	createWorktreeWorkspaceCore,
	type WorktreeWorkspaceCoreDependencies,
} from './worktree-workspace-core';
import {
	buildWorktreeWorkspaceModalControllerProps,
	type WorktreeWorkspaceModalControllerProps,
} from './worktree-workspace-modal-props';

const logger = rootLogger.extend('WorktreeWorkspaceController');

export type WorktreeWorkspaceControllerHandle = Readonly<{
	state: WorktreeWorkspaceState;
	modalProps: WorktreeWorkspaceModalControllerProps;
	openNew(): void;
	openClose(): void;
	retry(): void;
	create(branch: string): Promise<ControllerOutcome<WorktreeWorkspaceFailure>>;
	confirmClose(): Promise<ControllerOutcome<WorktreeWorkspaceFailure>>;
	close(): boolean;
}>;

export type WorktreeWorkspaceControllerDeps<TConnection> =
	WorktreeWorkspaceControllerDependencies<TConnection>;

export function useWorktreeWorkspaceController<TConnection>(
	deps: WorktreeWorkspaceControllerDeps<TConnection>,
): WorktreeWorkspaceControllerHandle {
	const committedDepsRef = useRef(deps);
	const trackedSourceRef = useRef({
		sourceKey: deps.sourceKey,
		tmuxEnabled: deps.tmuxEnabled,
		connection: deps.connection,
	});
	const [adapter] = useState(() =>
		createWorktreeWorkspaceControllerAdapter({
			getCommittedDependencies: () => committedDepsRef.current,
			reportPrecondition: (failure) => {
				Alert.alert('Worktree Workspace', failure.message, [{ text: 'OK' }]);
			},
			logger: {
				error: (message, payload) => logger.error(message, payload),
			},
		}),
	);
	const [core] = useState<WorktreeWorkspaceCore>(() => {
		const coreDependencies: WorktreeWorkspaceCoreDependencies = {
			initialSourceKey: deps.sourceKey,
			hasConnection: adapter.hasConnection,
			isWorkmuxEnabled: adapter.isWorkmuxEnabled,
			requestOpen: adapter.requestOpen,
			resolveTarget: adapter.resolveTarget,
			prepareNewWorktreeWorkspace: adapter.prepareNewWorktreeWorkspace,
			createWorktreeWorkspace: adapter.createWorktreeWorkspace,
			prepareCloseWorktreeWorkspace: adapter.prepareCloseWorktreeWorkspace,
			closeWorktreeWorkspace: adapter.closeWorktreeWorkspace,
			classifyFailure: adapter.classifyFailure,
			reportPrecondition: adapter.reportPrecondition,
			logger: adapter.logger,
		};
		return createWorktreeWorkspaceCore(coreDependencies);
	});
	const [coreLifecycle] = useState(() =>
		createReplaySafeControllerLifecycle(core),
	);
	const state = useSyncExternalStore(
		core.subscribe,
		core.getSnapshot,
		core.getSnapshot,
	);

	useLayoutEffect(() => {
		syncControllerSource({
			committedDependencies: committedDepsRef,
			trackedSource: trackedSourceRef,
			dependencies: deps,
			core,
		});
	}, [core, deps]);

	useEffect(
		() => adapter.registerClose(core.close),
		[adapter, core, deps.arbiter],
	);
	useEffect(() => coreLifecycle.setup(), [coreLifecycle]);

	const openNew = useCallback(() => core.openNew(), [core]);
	const openClose = useCallback(() => core.openClose(), [core]);
	const retry = useCallback(() => core.retry(), [core]);
	const create = useCallback((branch: string) => core.create(branch), [core]);
	const confirmClose = useCallback(() => core.confirmClose(), [core]);
	const close = useCallback(() => core.close(), [core]);
	const modalRetry = useCallback(() => retry(), [retry]);
	const modalClose = useCallback(() => close(), [close]);
	const modalCreate = useCallback(
		(branch: string) => {
			void create(branch);
		},
		[create],
	);
	const modalConfirm = useCallback(() => {
		void confirmClose();
	}, [confirmClose]);
	const modalProps = useMemo(
		() =>
			buildWorktreeWorkspaceModalControllerProps(state, {
				onRetry: modalRetry,
				onClose: modalClose,
				onCreate: modalCreate,
				onConfirm: modalConfirm,
			}),
		[state, modalRetry, modalClose, modalCreate, modalConfirm],
	);

	return useMemo(
		() => ({
			state,
			modalProps,
			openNew,
			openClose,
			retry,
			create,
			confirmClose,
			close,
		}),
		[state, modalProps, openNew, openClose, retry, create, confirmClose, close],
	);
}
