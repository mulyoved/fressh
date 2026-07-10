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
import { buildFeatureRequestSubmittedAlert } from '../repo-feature-request';
import { createReplaySafeControllerLifecycle } from './controller-lifecycle';
import {
	createFeatureRequestControllerAdapter,
	type FeatureRequestControllerDependencies,
} from './feature-request-adapter';
import {
	createFeatureRequestControllerCore,
	type FeatureRequestControllerCore,
} from './feature-request-core';

export type FeatureRequestModalProps = {
	open: boolean;
	isSubmitting: boolean;
	targetRepository: string | null;
	isResolvingTarget: boolean;
	error: string | undefined;
	onClose: () => boolean;
	onSubmit: (description: string, repository: string) => Promise<void>;
};

export type FeatureRequestControllerHandle = {
	modalProps: FeatureRequestModalProps;
	open: () => void;
	close: () => boolean;
	markSourceStale: () => void;
};

export type FeatureRequestControllerDeps<TConnection> =
	FeatureRequestControllerDependencies<TConnection>;

export function useFeatureRequestController<TConnection>(
	deps: FeatureRequestControllerDeps<TConnection>,
): FeatureRequestControllerHandle {
	const committedDepsRef = useRef(deps);
	const [adapter] = useState(() =>
		createFeatureRequestControllerAdapter({
			getCommittedDependencies: () => committedDepsRef.current,
			showSubmittedAlert: (issueUrl: string | null) => {
				const alert = buildFeatureRequestSubmittedAlert({ issueUrl });
				Alert.alert(alert.title, alert.message, [{ text: 'OK' }]);
			},
		}),
	);
	const [core] = useState<FeatureRequestControllerCore>(() =>
		createFeatureRequestControllerCore({
			resolveCurrentGitHubRepository: adapter.resolveCurrentGitHubRepository,
			isSubmissionAvailable: adapter.isSubmissionAvailable,
			executeSubmission: adapter.executeSubmission,
			requestOpen: adapter.requestOpen,
			getErrorMessage: adapter.getErrorMessage,
			logger: adapter.logger,
			showSubmittedAlert: adapter.showSubmittedAlert,
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
		committedDepsRef.current = deps;
	}, [deps]);

	useEffect(() => {
		return adapter.registerClose(core.close);
	}, [adapter, core, deps.arbiter]);

	useEffect(() => coreLifecycle.setup(), [coreLifecycle]);

	const open = useCallback(() => core.open(), [core]);
	const close = useCallback(() => core.close(), [core]);
	const markSourceStale = useCallback(() => core.markSourceStale(), [core]);
	const submit = useCallback(
		(description: string, repository: string) =>
			core.submit(description, repository),
		[core],
	);
	const modalProps = useMemo<FeatureRequestModalProps>(
		() => ({
			...snapshot,
			onClose: close,
			onSubmit: submit,
		}),
		[close, snapshot, submit],
	);

	return useMemo(
		() => ({ modalProps, open, close, markSourceStale }),
		[close, markSourceStale, modalProps, open],
	);
}
