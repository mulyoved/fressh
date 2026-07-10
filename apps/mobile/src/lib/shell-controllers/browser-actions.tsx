import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
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
import { showBrowserActionErrorReport } from '../browser-action-error-alert';
import { createBrowserActionErrorReport } from '../browser-action-error-report';
import { type BrowserActionsWorkspace } from '../browser-actions-controller-actions';
import { type DetectedOpenCandidate } from '../detected-open-actions';
import {
	type HostBrowserUrlSlot,
	type TmuxPaneContext,
} from '../host-browser-actions';
import { rootLogger } from '../logger';
import {
	createBrowserActionsControllerAdapter,
	type BrowserActionsControllerDependencies,
} from './browser-actions-adapter';
import {
	createBrowserActionsControllerCore,
	type BrowserActionsControllerCore,
} from './browser-actions-core';
import {
	createBrowserActionsControllerLifecycle,
	syncBrowserActionsControllerSource,
} from './browser-actions-lifecycle';
import {
	createBrowserActionsModalProps,
	type BrowserActionsModalProps,
	type DetectedOpenPickerModalProps,
	type HostUrlModalProps,
} from './browser-actions-modal-props';

const logger = rootLogger.extend('BrowserActionsController');

export type {
	BrowserActionsModalProps,
	DetectedOpenPickerModalProps,
	HostUrlModalProps,
} from './browser-actions-modal-props';

export type BrowserActionsControllerHandle = {
	browserActionsProps: BrowserActionsModalProps;
	hostUrlProps: HostUrlModalProps;
	detectedOpenPickerProps: DetectedOpenPickerModalProps;
	open: () => void;
	close: () => void;
	resolveHostBrowserPaneContext: () => Promise<TmuxPaneContext>;
	resolveHostBrowserPanePath: () => Promise<string>;
	resolveHostBrowserWorkspace: () => Promise<BrowserActionsWorkspace>;
	resolveCurrentGitHubRepository: () => Promise<string>;
	runHostBrowserCommand: (
		command: string,
		timeoutMs?: number,
	) => Promise<string>;
	invalidateHostUrlReads: () => void;
	invalidateAll: () => void;
};

export type BrowserActionsControllerDeps<TConnection> =
	BrowserActionsControllerDependencies<TConnection>;

export function useBrowserActionsController<TConnection>(
	deps: BrowserActionsControllerDeps<TConnection>,
): BrowserActionsControllerHandle {
	const committedDepsRef = useRef(deps);
	const trackedSourceRef = useRef({
		sourceKey: deps.sourceKey,
		tmuxEnabled: deps.tmuxEnabled,
	});
	const [adapter] = useState(() =>
		createBrowserActionsControllerAdapter({
			getCommittedDependencies: () => committedDepsRef.current,
			openAndroidUrl: async (url) => {
				try {
					await Linking.openURL(url);
				} catch (error) {
					throw new Error(
						`Android could not open ${url}: ${committedDepsRef.current.getErrorMessage(error)}`,
					);
				}
			},
			showError: (input, context) => {
				showBrowserActionErrorReport(
					createBrowserActionErrorReport({ ...input, ...context }),
					{
						alert: (title, message, buttons) =>
							Alert.alert(title, message, buttons),
						copyText: async (text) => {
							await Clipboard.setStringAsync(text);
						},
						warn: (message, error) => logger.warn(message, error),
					},
				);
			},
		}),
	);
	const [core] = useState<BrowserActionsControllerCore>(() =>
		createBrowserActionsControllerCore({
			initialSourceKey: deps.sourceKey,
			requestOpen: adapter.requestOpen,
			getTmuxEnabled: adapter.getTmuxEnabled,
			getTmuxTarget: adapter.getTmuxTarget,
			runHostBrowserCommand: adapter.runHostBrowserCommand,
			runWorkmuxCommand: adapter.runWorkmuxCommand,
			openAndroidUrl: adapter.openAndroidUrl,
			showError: adapter.showError,
			getErrorMessage: adapter.getErrorMessage,
		}),
	);
	const [coreLifecycle] = useState(() =>
		createBrowserActionsControllerLifecycle(core),
	);
	const snapshot = useSyncExternalStore(
		core.subscribe,
		core.getSnapshot,
		core.getSnapshot,
	);

	useLayoutEffect(() => {
		syncBrowserActionsControllerSource({
			committedDependencies: committedDepsRef,
			trackedSource: trackedSourceRef,
			dependencies: deps,
			core,
		});
	}, [core, deps]);

	useEffect(
		() =>
			adapter.registerClose({
				closeHostUrl: core.closeHostUrl,
				closeDetectedPicker: core.closeDetectedPicker,
				close: core.close,
				invalidateHostUrlReads: core.invalidateHostUrlReads,
			}),
		[adapter, core, deps.arbiter],
	);

	useEffect(() => coreLifecycle.setup(), [coreLifecycle]);

	const open = useCallback(() => void core.open(), [core]);
	const close = useCallback(() => core.close(), [core]);
	const openDiff = useCallback(() => void core.openDiffity(), [core]);
	const openGitHubIssues = useCallback(
		() => void core.openGitHubTarget('issues'),
		[core],
	);
	const openGitHubPulls = useCallback(
		() => void core.openGitHubTarget('pulls'),
		[core],
	);
	const openDetectedAuto = useCallback(() => core.openDetected('auto'), [core]);
	const openDetectedPick = useCallback(() => core.openDetected('pick'), [core]);
	const openUrlSlot = useCallback(
		(slot: HostBrowserUrlSlot) => core.openUrlSlot(slot),
		[core],
	);
	const editUrlSlot = useCallback(
		(slot: HostBrowserUrlSlot) => core.editUrlSlot(slot),
		[core],
	);
	const closeHostUrl = useCallback(() => void core.closeHostUrl(), [core]);
	const submitHostUrl = useCallback(
		(value: string) => core.submitHostUrl(value),
		[core],
	);
	const closeDetectedPicker = useCallback(
		() => core.closeDetectedPicker(),
		[core],
	);
	const selectDetected = useCallback(
		(candidate: DetectedOpenCandidate) => void core.selectDetected(candidate),
		[core],
	);

	const modalProps = useMemo(
		() =>
			createBrowserActionsModalProps(snapshot, {
				close,
				openDiff,
				openGitHubIssues,
				openGitHubPulls,
				openDetectedAuto,
				openDetectedPick,
				openUrlSlot,
				editUrlSlot,
				closeHostUrl,
				submitHostUrl,
				closeDetectedPicker,
				selectDetected,
			}),
		[
			close,
			closeDetectedPicker,
			closeHostUrl,
			editUrlSlot,
			openDetectedAuto,
			openDetectedPick,
			openDiff,
			openGitHubIssues,
			openGitHubPulls,
			openUrlSlot,
			selectDetected,
			snapshot,
			submitHostUrl,
		],
	);
	const browserActionsProps = useMemo<BrowserActionsModalProps>(
		() => modalProps.browserActionsProps,
		[modalProps.browserActionsProps],
	);
	const hostUrlProps = useMemo<HostUrlModalProps>(
		() => modalProps.hostUrlProps,
		[modalProps.hostUrlProps],
	);
	const detectedOpenPickerProps = useMemo<DetectedOpenPickerModalProps>(
		() => modalProps.detectedOpenPickerProps,
		[modalProps.detectedOpenPickerProps],
	);

	return useMemo<BrowserActionsControllerHandle>(
		() => ({
			browserActionsProps,
			hostUrlProps,
			detectedOpenPickerProps,
			open,
			close,
			resolveHostBrowserPaneContext: core.resolvePaneContext,
			resolveHostBrowserPanePath: core.resolvePanePath,
			resolveHostBrowserWorkspace: core.resolveWorkspace,
			resolveCurrentGitHubRepository: core.resolveCurrentGitHubRepository,
			runHostBrowserCommand: core.runHostBrowserCommand,
			invalidateHostUrlReads: core.invalidateHostUrlReads,
			invalidateAll: () => core.invalidate('runtime-reset'),
		}),
		[
			browserActionsProps,
			close,
			core,
			detectedOpenPickerProps,
			hostUrlProps,
			open,
		],
	);
}
