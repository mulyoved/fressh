import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import {
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
	createBrowserActionsControllerFacade,
	type BrowserActionsControllerHandle,
} from './browser-actions-facade';
import {
	createBrowserActionsModalProps,
	type BrowserActionsModalProps,
	type DetectedOpenPickerModalProps,
	type HostUrlModalProps,
} from './browser-actions-modal-props';
import {
	createReplaySafeControllerLifecycle,
	syncControllerSource,
} from './controller-lifecycle';

const logger = rootLogger.extend('BrowserActionsController');

export type {
	BrowserActionsModalProps,
	DetectedOpenPickerModalProps,
	HostUrlModalProps,
} from './browser-actions-modal-props';
export type { BrowserActionsControllerHandle } from './browser-actions-facade';

export type BrowserActionsControllerDeps<TConnection> =
	BrowserActionsControllerDependencies<TConnection>;

export function useBrowserActionsController<TConnection>(
	deps: BrowserActionsControllerDeps<TConnection>,
): BrowserActionsControllerHandle {
	const committedDepsRef = useRef(deps);
	const trackedSourceRef = useRef({
		sourceKey: deps.sourceKey,
		tmuxEnabled: deps.tmuxEnabled,
		connection: deps.connection,
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
		createReplaySafeControllerLifecycle(core),
	);
	const [facade] = useState(() => createBrowserActionsControllerFacade(core));
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

	const modalProps = useMemo(
		() => createBrowserActionsModalProps(snapshot, facade.modalCallbacks),
		[facade.modalCallbacks, snapshot],
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
		() =>
			facade.createHandle({
				browserActionsProps,
				hostUrlProps,
				detectedOpenPickerProps,
			}),
		[browserActionsProps, detectedOpenPickerProps, facade, hostUrlProps],
	);
}
