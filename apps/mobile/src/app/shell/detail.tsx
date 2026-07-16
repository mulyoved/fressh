import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from 'react';
import { Alert, Platform } from 'react-native';
import { runDetectedOpenCallback } from '@/lib/detected-open-actions';
import { HANDLE_DEV_SERVER_URL } from '@/lib/keyboard-actions';
import { rootLogger } from '@/lib/logger';
import { preferences } from '@/lib/preferences';
import {
	loadRuntimeShellConfigState,
	reloadRuntimeShellConfigFromRemote,
} from '@/lib/shell-config-store-native';
import { useShellActivityController } from '@/lib/shell-controllers/activity';
import {
	useBrowserActionsController,
	type BrowserActionsControllerHandle,
} from '@/lib/shell-controllers/browser-actions';
import {
	useFeatureRequestController,
	type FeatureRequestControllerHandle,
} from '@/lib/shell-controllers/feature-request';
import {
	useShellKeyboardController,
	type ShellKeyboardBrowserCommands,
	type ShellKeyboardModalCommands,
	type UseShellKeyboardControllerInput,
} from '@/lib/shell-controllers/keyboard';
import {
	createShellModalArbiter,
	type ShellModalArbiter,
} from '@/lib/shell-controllers/modal-arbiter';
import { useShellNotificationsController } from '@/lib/shell-controllers/notifications';
import { useShellScrollbackController } from '@/lib/shell-controllers/scrollback';
import {
	createShellSessionMountKey,
	type ShellSessionControllerHandle,
	useShellSessionController,
} from '@/lib/shell-controllers/session';
import {
	useShellSimpleModals,
	type SimpleModalHandle,
} from '@/lib/shell-controllers/simple-modals';
import { useSkillSelectorController } from '@/lib/shell-controllers/skill-selector';
import { useShellTerminalController } from '@/lib/shell-controllers/terminal';
import { useShellWisprController } from '@/lib/shell-controllers/wispr';
import { useWorktreeWorkspaceController } from '@/lib/shell-controllers/worktree-workspace';
import { useConnectionDebugCommand } from '@/lib/use-connection-debug-command';
import { type WorkmuxNavScope } from '@/lib/workmux-app-commands';
import { ShellRouteErrorScreen } from './components/ShellRouteErrorScreen';
import {
	parseShellRoute,
	type ShellRouteParams,
	type ShellRouteRequest,
} from './shell-route';
import { ShellRouteSkeleton } from './ShellScreenStates';
import {
	ShellScreenView,
	type ShellScreenSessionView,
} from './ShellScreenView';
import { useManualTerminalFit } from './use-manual-terminal-fit';
import { useShellRouteReady } from './use-shell-route-ready';
import { useShellTerminalViewPolicy } from './use-shell-terminal-view-policy';

const logger = rootLogger.extend('TabsShellDetail');

const getErrorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const GITHUB_ISSUES_URL = 'https://github.com/mulyoved/fressh/issues';
const SHELL_CONFIG_DOC_URL =
	'https://github.com/mulyoved/fressh/blob/dev/docs/shell-config.md';

function useBrowserCommands(
	browserActions: BrowserActionsControllerHandle,
): ShellKeyboardBrowserCommands {
	return useMemo(
		() => ({
			openDiff: browserActions.browserActionsProps.onOpenDiff,
			openUrlSlot: browserActions.browserActionsProps.onOpenUrlSlot,
			openDetected: (mode) =>
				runDetectedOpenCallback(mode, browserActions.browserActionsProps),
			editUrlSlot: browserActions.browserActionsProps.onEditUrlSlot,
		}),
		[browserActions.browserActionsProps],
	);
}

function useConfigureCommandPorts({
	browserActions,
	closeSkillSelector,
	configureModal,
	connectionId,
	storedConnectionId,
	featureRequest,
	router,
}: {
	browserActions: BrowserActionsControllerHandle;
	closeSkillSelector(): void;
	configureModal: SimpleModalHandle;
	connectionId: string;
	storedConnectionId: string | null;
	featureRequest: FeatureRequestControllerHandle;
	router: ReturnType<typeof useRouter>;
}): {
	openConfigDialog(): void;
	configureCommands: UseShellKeyboardControllerInput['configureCommands'];
} {
	const openConfigDialog = useCallback(() => {
		browserActions.invalidateHostUrlReads();
		closeSkillSelector();
		browserActions.close();
		configureModal.onOpen();
	}, [browserActions, closeSkillSelector, configureModal]);
	const handleDevServer = useCallback(() => {
		configureModal.onClose();
		void Linking.openURL(HANDLE_DEV_SERVER_URL);
	}, [configureModal]);
	const handleHostConfig = useCallback(() => {
		configureModal.onClose();
		router.replace({
			pathname: '/',
			params: { editConnectionId: storedConnectionId ?? connectionId },
		});
	}, [configureModal, connectionId, router, storedConnectionId]);
	const handleOpenGitHubIssues = useCallback(() => {
		configureModal.onClose();
		void Linking.openURL(GITHUB_ISSUES_URL);
	}, [configureModal]);
	const handleOpenShellConfigDocs = useCallback(() => {
		configureModal.onClose();
		void Linking.openURL(SHELL_CONFIG_DOC_URL);
	}, [configureModal]);
	const configureCommands = useMemo(
		() => ({
			onDevServer: handleDevServer,
			onHostConfig: handleHostConfig,
			onRequestFeature: featureRequest.open,
			onOpenGitHubIssues: handleOpenGitHubIssues,
			onOpenShellConfigDocs: handleOpenShellConfigDocs,
		}),
		[
			featureRequest.open,
			handleDevServer,
			handleHostConfig,
			handleOpenGitHubIssues,
			handleOpenShellConfigDocs,
		],
	);
	return { openConfigDialog, configureCommands };
}

function buildShellSessionView(
	snapshot: ShellSessionControllerHandle['snapshot'],
	terminalHasRendered: boolean,
	onEdit: () => void,
): ShellScreenSessionView {
	if (snapshot.status === 'attach-error') return { ...snapshot, onEdit };
	if (snapshot.status === 'waiting') {
		return { status: 'waiting', terminalHasRendered };
	}
	return { status: snapshot.status };
}

function useShellWorktreeWorkspace(
	session: ShellSessionControllerHandle,
	connectionAvailable: boolean,
	arbiter: ShellModalArbiter,
) {
	return useWorktreeWorkspaceController({
		connectionAvailable,
		tmuxEnabled: session.tmux.enabled,
		sessionName: session.tmux.target.trim() || 'main',
		sourceKey: session.identity.targetKey,
		workmux: session.ports.workmux,
		arbiter,
	});
}

export default function TabsShellDetail() {
	const ready = useShellRouteReady();
	const searchParams = useLocalSearchParams<ShellRouteParams>();
	const router = useRouter();

	if (!ready) return <ShellRouteSkeleton />;
	return (
		<ShellDetailRoute params={searchParams} onBack={() => router.back()} />
	);
}

function ShellDetailRoute({
	params,
	onBack,
}: {
	params: ShellRouteParams;
	onBack(): void;
}) {
	const result = parseShellRoute(params);
	return result.status === 'invalid' ? (
		<ShellRouteErrorScreen error={result.error} onBack={onBack} />
	) : (
		<ShellDetail
			key={createShellSessionMountKey(result.request)}
			request={result.request}
		/>
	);
}

function ShellDetail({ request }: { request: ShellRouteRequest }) {
	const [shellConfigState] = useState(() => loadRuntimeShellConfigState());
	const { connectionId, channelId } = request;
	const agentRoute = request.agentRoute;
	const activity = useShellActivityController();
	const router = useRouter();
	const session = useShellSessionController({
		request,
		activity,
		router,
		logger,
	});
	const { snapshot, ports, identity, tmux, storedConnectionId } = session;
	const activityPort = ports.activity;
	const activitySnapshot = useSyncExternalStore(
		activityPort.subscribe,
		activityPort.getSnapshot,
		activityPort.getSnapshot,
	);
	const { transportKey, targetKey, generation: sessionGeneration } = identity;
	const { enabled: tmuxEnabled, target: tmuxTarget } = tmux;
	const normalizedTmuxTarget = tmuxTarget.trim() || 'main';
	const terminalSource = ports.terminalSource;
	const connection = snapshot.status === 'ready' ? ports.hostCommands : null;
	const modalArbiter = useMemo(() => createShellModalArbiter(), []);
	const worktreeWorkspace = useShellWorktreeWorkspace(
		session,
		connection !== null,
		modalArbiter,
	);
	const [navScope] = preferences.workmuxNavScope.useWorkmuxNavScopePref();
	const simpleModals = useShellSimpleModals(modalArbiter);
	const {
		commandMenu: commandMenuModal,
		commander: commanderModal,
		textEntry: textEntryModal,
		configure: configureModal,
	} = simpleModals;
	const terminalViewPolicy = useShellTerminalViewPolicy({
		hasConnection: Boolean(connection),
		tmuxEnabled,
		targetName: normalizedTmuxTarget,
	});
	const terminal = useShellTerminalController({
		source: terminalSource,
		platformOS: Platform.OS,
		systemKeyboardEnabled: Platform.OS === 'android',
		logger,
		router,
	});
	const scrollback = useShellScrollbackController({
		runtimeInstanceId: terminal.runtimeInstanceId,
		context: {
			activity: activityPort,
			targetKey,
			targetName: normalizedTmuxTarget,
			connectionAvailable: Boolean(connection),
			shellAvailable: terminalSource.isAvailable(),
			tmuxEnabled,
			terminalTransport: terminal.transport,
			terminalView: terminal.view,
			workmux: ports.workmux,
			trace: terminalViewPolicy.trace,
			feedback: {
				alert: (title, message, buttons) =>
					Alert.alert(title, message, buttons),
				copyMessage: (message) => {
					void Clipboard.setStringAsync(message).catch((error: unknown) => {
						logger.warn('copy Workmux scroll failure message failed', error);
					});
				},
			},
			getErrorMessage,
			logger,
		},
	});
	useShellNotificationsController({
		activity: activityPort,
		commandPortKey: ports.workmux,
		context: {
			transportKey,
			targetKey,
			storedConnectionId: storedConnectionId ?? null,
			channelId,
			tmuxEnabled,
			tmuxTarget,
		},
		route: {
			agentConnectionId: agentRoute.connectionId,
			agentSession: agentRoute.session,
			agentWindowId: agentRoute.windowId,
			agentEventId: agentRoute.eventId,
			agentTapToken: agentRoute.tapToken,
		},
		workmux: ports.workmux,
		logger,
	});
	const browserActions = useBrowserActionsController({
		hostCommands: connection,
		workmux: ports.workmux,
		tmuxEnabled,
		tmuxTarget,
		sourceKey: targetKey,
		getErrorMessage,
		arbiter: modalArbiter,
	});
	const manualTerminalFitRunner = useManualTerminalFit({
		hostCommands: connection,
		terminalSource,
		terminal,
		tmuxEnabled,
		tmuxTarget,
	});
	const featureRequest = useFeatureRequestController({
		hostCommands: connection,
		resolveCurrentGitHubRepository:
			browserActions.resolveCurrentGitHubRepository,
		getErrorMessage,
		logger,
		arbiter: modalArbiter,
	});
	const markFeatureRequestSourceStale = featureRequest.markSourceStale;
	useLayoutEffect(() => {
		markFeatureRequestSourceStale();
	}, [connection, markFeatureRequestSourceStale, targetKey, tmuxEnabled]);
	const wispr = useShellWisprController({
		activity: activityPort,
		sessionGeneration,
		textEntryModal: {
			isOpen: () => simpleModals.getSnapshot().textEntry,
			open: textEntryModal.onOpen,
			close: textEntryModal.onClose,
		},
		logger,
	});
	const closeWisprTextEntry = wispr.textEntryProps.onClose;
	useEffect(
		() => modalArbiter.register('text-entry', closeWisprTextEntry),
		[closeWisprTextEntry, modalArbiter],
	);
	const {
		modalProps: skillSelectorModalProps,
		open: openSkillSelector,
		close: closeSkillSelector,
	} = useSkillSelectorController({
		hostCommands: connection,
		workmux: ports.workmux,
		input: scrollback.input,
		tmuxEnabled,
		sourceKey: targetKey,
		stableConnectionId: storedConnectionId ?? connectionId,
		tmuxTarget: normalizedTmuxTarget,
		getErrorMessage,
		arbiter: modalArbiter,
	});

	const { openConfigDialog, configureCommands } = useConfigureCommandPorts({
		browserActions,
		closeSkillSelector,
		configureModal,
		connectionId,
		storedConnectionId: storedConnectionId ?? null,
		featureRequest,
		router,
	});

	const handleFitTerminalToDevice = useCallback(() => {
		commandMenuModal.onClose();
		void manualTerminalFitRunner.run();
	}, [commandMenuModal, manualTerminalFitRunner]);

	const debugConnectionInCodex = useConnectionDebugCommand({
		appActive: activitySnapshot.appActive,
		closeMenu: commandMenuModal.onClose,
		delivery: { type: 'clipboard-only' },
	});

	const modalCommands = useMemo<ShellKeyboardModalCommands>(
		() => ({
			toggleCommandMenu: () => {
				browserActions.invalidateHostUrlReads();
				commanderModal.onClose();
				browserActions.close();
				closeSkillSelector();
				closeWisprTextEntry();
				if (commandMenuModal.open) commandMenuModal.onClose();
				else commandMenuModal.onOpen();
			},
			openCommander: () => {
				browserActions.invalidateHostUrlReads();
				commandMenuModal.onClose();
				browserActions.close();
				closeSkillSelector();
				closeWisprTextEntry();
				commanderModal.onOpen();
			},
			openNewWorktreeWorkspace: worktreeWorkspace.openNew,
			openCloseWorktreeWorkspace: worktreeWorkspace.openClose,
			openSkillSelector,
			openBrowserActions: browserActions.open,
			openFeatureRequest: featureRequest.open,
			openWisprTextEditor: wispr.openTextEditor,
			openConfigurator: openConfigDialog,
			closeCommandMenu: commandMenuModal.onClose,
		}),
		[
			browserActions,
			commandMenuModal,
			commanderModal,
			featureRequest.open,
			closeWisprTextEntry,
			closeSkillSelector,
			openConfigDialog,
			openSkillSelector,
			wispr.openTextEditor,
			worktreeWorkspace.openClose,
			worktreeWorkspace.openNew,
		],
	);
	const browserCommands = useBrowserCommands(browserActions);
	const keyboard = useShellKeyboardController({
		initialShellConfigState: shellConfigState,
		activity: activityPort,
		sourceKey: targetKey,
		scrollbackInput: scrollback.input,
		terminalView: terminal.view,
		remoteTarget: {
			targetKey,
			tmuxEnabled,
			sessionName: normalizedTmuxTarget,
			connectionId,
			channelId,
			workmux: ports.workmux,
			hostCommands: connection,
		},
		navScope,
		setNavScope: (scope: WorkmuxNavScope) =>
			preferences.workmuxNavScope.set(scope),
		modalCommands,
		browserCommands,
		fitTerminalToDevice: handleFitTerminalToDevice,
		debugConnectionInCodex,
		reloadRuntimeShellConfig: reloadRuntimeShellConfigFromRemote,
		showAlert: (title: string, message: string) => Alert.alert(title, message),
		readTerminalOutputDiagnostics: terminal.getOutputDiagnostics,
		invalidateShellTransport: session.invalidateShellTransport,
		configureCommands,
		logger,
		platformOS: Platform.OS,
	});
	const sessionView = buildShellSessionView(
		snapshot,
		terminal.hasRendered,
		() => {
			router.replace({
				pathname: '/',
				params: { editConnectionId: storedConnectionId ?? connectionId },
			});
		},
	);

	return (
		<ShellScreenView
			session={sessionView}
			terminal={{
				xtermRef: terminal.xtermRef,
				onLoadStart: terminal.onLoadStart,
				onResize: terminal.onResize,
				onInitialized: terminal.onInitialized,
				retry: terminal.retry,
				view: terminal.view,
				policy: terminalViewPolicy.policy,
				scrollback,
			}}
			keyboard={keyboard}
			modals={{
				commandMenu: {
					state: commandMenuModal,
					props: keyboard.commandMenuProps,
				},
				browser: {
					actions: browserActions.browserActionsProps,
					detectedOpenPicker: browserActions.detectedOpenPickerProps,
					hostUrl: browserActions.hostUrlProps,
				},
				commander: { state: commanderModal, props: keyboard.commanderProps },
				skillSelector: skillSelectorModalProps,
				textEntry: {
					state: textEntryModal,
					keyboard: keyboard.textEntryProps,
					wispr: wispr.textEntryProps,
				},
				configure: { state: configureModal, props: keyboard.configureProps },
				featureRequest: featureRequest.modalProps,
				worktreeWorkspace: worktreeWorkspace.modalProps,
			}}
		/>
	);
}
