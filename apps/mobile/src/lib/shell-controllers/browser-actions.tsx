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
	getHostBrowserUrlSlotLabel,
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
	type HostUrlModalMode,
} from './browser-actions-core';
import { createReplaySafeDisposer } from './controller-core';

const logger = rootLogger.extend('BrowserActionsController');

export type BrowserActionsModalProps = {
	open: boolean;
	onClose: () => void;
	onOpenDiff: () => void;
	onOpenGitHubIssues: () => void;
	onOpenGitHubPulls: () => void;
	onOpenDetectedAuto: () => boolean;
	onOpenDetectedPick: () => boolean;
	onOpenUrlSlot: (slot: HostBrowserUrlSlot) => void;
	onEditUrlSlot: (slot: HostBrowserUrlSlot) => void;
};

export type HostUrlModalProps = {
	open: boolean;
	slot: HostBrowserUrlSlot | null;
	slotLabel: string;
	initialValue: string;
	mode: HostUrlModalMode;
	isSubmitting: boolean;
	error: string | null;
	onClose: () => void;
	onSubmit: (value: string) => void;
};

export type DetectedOpenPickerModalProps = {
	open: boolean;
	candidates: readonly DetectedOpenCandidate[];
	onClose: () => void;
	onSelect: (candidate: DetectedOpenCandidate) => void;
};

export type BrowserActionsControllerHandle = {
	browserActionsProps: BrowserActionsModalProps;
	hostUrlProps: HostUrlModalProps;
	detectedOpenPickerProps: DetectedOpenPickerModalProps;
	open: () => boolean;
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
		createReplaySafeDisposer(core.dispose),
	);
	const snapshot = useSyncExternalStore(
		core.subscribe,
		core.getSnapshot,
		core.getSnapshot,
	);

	useLayoutEffect(() => {
		committedDepsRef.current = deps;
		core.setSourceKey(deps.sourceKey);
	}, [core, deps]);

	useEffect(
		() =>
			adapter.registerClose({
				close: core.close,
				invalidateHostUrlReads: core.invalidateHostUrlReads,
			}),
		[adapter, core, deps.arbiter],
	);

	useEffect(() => coreLifecycle.setup(), [coreLifecycle]);

	const open = useCallback(() => core.open(), [core]);
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

	const browserActionsProps = useMemo<BrowserActionsModalProps>(
		() => ({
			open: snapshot.open,
			onClose: close,
			onOpenDiff: openDiff,
			onOpenGitHubIssues: openGitHubIssues,
			onOpenGitHubPulls: openGitHubPulls,
			onOpenDetectedAuto: openDetectedAuto,
			onOpenDetectedPick: openDetectedPick,
			onOpenUrlSlot: openUrlSlot,
			onEditUrlSlot: editUrlSlot,
		}),
		[
			close,
			editUrlSlot,
			openDetectedAuto,
			openDetectedPick,
			openDiff,
			openGitHubIssues,
			openGitHubPulls,
			openUrlSlot,
			snapshot.open,
		],
	);
	const hostUrlProps = useMemo<HostUrlModalProps>(
		() => ({
			open: snapshot.hostUrl !== null,
			slot: snapshot.hostUrl?.slot ?? null,
			slotLabel: snapshot.hostUrl
				? getHostBrowserUrlSlotLabel(snapshot.hostUrl.slot)
				: 'URL',
			initialValue: snapshot.hostUrl?.initialValue ?? '',
			mode: snapshot.hostUrl?.mode ?? 'edit',
			isSubmitting: snapshot.hostUrlSubmitting,
			error: snapshot.hostUrlError,
			onClose: closeHostUrl,
			onSubmit: submitHostUrl,
		}),
		[closeHostUrl, snapshot, submitHostUrl],
	);
	const detectedOpenPickerProps = useMemo<DetectedOpenPickerModalProps>(
		() => ({
			open: snapshot.detectedOpenPicker !== null,
			candidates: snapshot.detectedOpenPicker?.candidates ?? [],
			onClose: closeDetectedPicker,
			onSelect: selectDetected,
		}),
		[closeDetectedPicker, selectDetected, snapshot.detectedOpenPicker],
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
