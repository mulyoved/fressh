import { XtermJsWebView } from '@fressh/react-native-xtermjs-webview';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import {
	Stack,
	useFocusEffect,
	useLocalSearchParams,
	useRouter,
} from 'expo-router';
import React, {
	startTransition,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
import {
	ActivityIndicator,
	Alert,
	Animated,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	Text,
	useWindowDimensions,
	View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { runDetectedOpenCallback } from '@/lib/detected-open-actions';
import { HANDLE_DEV_SERVER_URL } from '@/lib/keyboard-actions';
import { rootLogger } from '@/lib/logger';
import { resolveLucideIcon } from '@/lib/lucide-utils';
import { preferences } from '@/lib/preferences';
import {
	configureScrollTraceEnabled,
	emitScrollTrace,
	isScrollTraceEnabled,
	type ScrollTraceSink,
} from '@/lib/scroll-trace';
import {
	loadRuntimeShellConfigState,
	reloadRuntimeShellConfigFromRemote,
} from '@/lib/shell-config-store-native';
import { useShellActivityController } from '@/lib/shell-controllers/activity';
import { useBrowserActionsController } from '@/lib/shell-controllers/browser-actions';
import { useFeatureRequestController } from '@/lib/shell-controllers/feature-request';
import {
	useShellKeyboardController,
	type ShellKeyboardBrowserCommands,
} from '@/lib/shell-controllers/keyboard';
import { createShellModalArbiter } from '@/lib/shell-controllers/modal-arbiter';
import { useShellNotificationsController } from '@/lib/shell-controllers/notifications';
import { useShellScrollbackController } from '@/lib/shell-controllers/scrollback';
import {
	createShellSessionMountKey,
	useShellSessionController,
} from '@/lib/shell-controllers/session';
import { useShellSimpleModals } from '@/lib/shell-controllers/simple-modals';
import { useSkillSelectorController } from '@/lib/shell-controllers/skill-selector';
import { useShellTerminalController } from '@/lib/shell-controllers/terminal';
import { useShellWisprController } from '@/lib/shell-controllers/wispr';
import { useWorktreeWorkspaceController } from '@/lib/shell-controllers/worktree-workspace';
import { createManualTerminalFitRunner } from '@/lib/terminal-fit-runner';
import { useTheme } from '@/lib/theme';
import { useConnectionDebugCommand } from '@/lib/use-connection-debug-command';
import { type WorkmuxNavScope } from '@/lib/workmux-app-commands';
import { getWorkmuxAttachErrorCopy } from '@/lib/workmux-copy';
import { BrowserActionsModal } from './components/BrowserActionsModal';
import { CommandMenuModal } from './components/CommandMenuModal';
import { ConfigureModal } from './components/ConfigureModal';
import { DetectedOpenPickerModal } from './components/DetectedOpenPickerModal';
import { FeatureRequestModal } from './components/FeatureRequestModal';
import { HostUrlModal } from './components/HostUrlModal';
import { ShellRouteErrorScreen } from './components/ShellRouteErrorScreen';
import { SkillSelectorModal } from './components/SkillSelectorModal';
import { TerminalCommanderModal } from './components/TerminalCommanderModal';
import { TerminalKeyboard } from './components/TerminalKeyboard';
import { TextEntryModal } from './components/TextEntryModal';
import { WorktreeWorkspaceModal } from './components/WorktreeWorkspaceModal';
import {
	createShellDetailKeyboardAuthorityRuntime,
	createShellDetailKeyboardCommitPublication,
	createShellDetailKeyboardControllerInput,
	createShellDetailKeyboardLateBindings,
	createShellDetailKeyboardModalCommands,
} from './shell-keyboard-composition';
import {
	parseShellRoute,
	type ShellRouteParams,
	type ShellRouteRequest,
} from './shell-route';
import { resolveShellTouchScrollPolicy } from './shell-touch-scroll';

const logger = rootLogger.extend('TabsShellDetail');

type ExpoConstantsWithManifestExtra = typeof Constants & {
	manifest2?: {
		extra?: Record<string, unknown>;
	};
};

const isConfiguredScrollTraceEnabled = () => {
	const constants = Constants as ExpoConstantsWithManifestExtra;
	const extra =
		(Constants.expoConfig?.extra as Record<string, unknown> | undefined) ??
		constants.manifest2?.extra;
	return (
		extra?.fresshEnableScrollTrace === true ||
		extra?.fresshEnableScrollTrace === 'true' ||
		isScrollTraceEnabled()
	);
};

const getErrorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const GITHUB_ISSUES_URL = 'https://github.com/mulyoved/fressh/issues';
const SHELL_CONFIG_DOC_URL =
	'https://github.com/mulyoved/fressh/blob/dev/docs/shell-config.md';

export default function TabsShellDetail() {
	const [ready, setReady] = useState(false);
	const hasShownRef = useRef(false);
	const searchParams = useLocalSearchParams<ShellRouteParams>();
	const router = useRouter();

	useFocusEffect(
		React.useCallback(() => {
			if (hasShownRef.current) {
				setReady(true);
				return undefined;
			}

			let timeout: ReturnType<typeof setTimeout> | null = null;
			startTransition(() => {
				timeout = setTimeout(() => {
					// TODO: This is gross. It would be much better to switch
					// after the navigation animation completes.
					hasShownRef.current = true;
					setReady(true);
				}, 16);
			});

			return () => {
				if (timeout) clearTimeout(timeout);
			};
		}, []),
	);

	if (!ready) return <RouteSkeleton />;
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

function RouteSkeleton() {
	const theme = useTheme();
	return (
		<View
			style={{
				flex: 1,
				justifyContent: 'center',
				alignItems: 'center',
				backgroundColor: theme.colors.background,
			}}
		>
			<Text style={{ color: theme.colors.textPrimary, fontSize: 20 }}>
				Loading
			</Text>
		</View>
	);
}

type TmuxAttachErrorScreenProps = {
	failureReason?: string;
	sessionName: string;
	onEdit: () => void;
};

function TmuxAttachErrorScreen({
	failureReason,
	sessionName,
	onEdit,
}: TmuxAttachErrorScreenProps) {
	const theme = useTheme();
	const copy = getWorkmuxAttachErrorCopy(sessionName, failureReason);
	return (
		<View
			style={{
				flex: 1,
				justifyContent: 'center',
				alignItems: 'center',
				backgroundColor: theme.colors.background,
				padding: 24,
			}}
		>
			<Text
				style={{
					color: theme.colors.textPrimary,
					fontSize: 20,
					fontWeight: '700',
					marginBottom: 12,
					textAlign: 'center',
				}}
			>
				{copy.title}
			</Text>
			<Text
				style={{
					color: theme.colors.textSecondary,
					fontSize: 14,
					textAlign: 'center',
					marginBottom: 20,
				}}
			>
				{copy.body}
			</Text>
			<Pressable
				onPress={onEdit}
				style={{
					backgroundColor: theme.colors.primary,
					borderRadius: 10,
					paddingVertical: 12,
					paddingHorizontal: 20,
				}}
			>
				<Text style={{ color: '#fff', fontWeight: '700' }}>
					Edit Connection
				</Text>
			</Pressable>
		</View>
	);
}

type TerminalErrorBoundaryProps = {
	children: React.ReactNode;
	onRetry: () => void;
};

type TerminalErrorBoundaryState = {
	hasError: boolean;
};

class TerminalErrorBoundary extends React.Component<
	TerminalErrorBoundaryProps,
	TerminalErrorBoundaryState
> {
	constructor(props: TerminalErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(): TerminalErrorBoundaryState {
		return { hasError: true };
	}

	override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		logger.error('Terminal crashed', error, errorInfo);
	}

	handleRetry = () => {
		this.setState({ hasError: false });
		this.props.onRetry();
	};

	override render() {
		if (this.state.hasError) {
			return <TerminalErrorFallback onRetry={this.handleRetry} />;
		}
		return this.props.children;
	}
}

function TerminalErrorFallback({ onRetry }: { onRetry: () => void }) {
	const theme = useTheme();
	return (
		<View
			style={{
				flex: 1,
				justifyContent: 'center',
				alignItems: 'center',
				backgroundColor: theme.colors.background,
				padding: 20,
			}}
		>
			<Text
				style={{
					color: theme.colors.textPrimary,
					fontSize: 18,
					marginBottom: 12,
				}}
			>
				Terminal crashed
			</Text>
			<Pressable
				onPress={onRetry}
				style={{
					paddingHorizontal: 20,
					paddingVertical: 10,
					borderRadius: 8,
					backgroundColor: theme.colors.primary,
				}}
			>
				<Text style={{ color: '#fff', fontSize: 16 }}>Tap to retry</Text>
			</Pressable>
		</View>
	);
}

function ShellDetail({ request }: { request: ShellRouteRequest }) {
	const [shellConfigState] = useState(() => loadRuntimeShellConfigState());

	const { connectionId, channelId } = request;
	const {
		connectionId: agentConnectionId,
		session: agentSession,
		windowId: agentWindowId,
		eventId: agentEventId,
		tapToken: agentTapToken,
	} = request.agentRoute;
	const activity = useShellActivityController();

	const router = useRouter();
	const theme = useTheme();
	const insets = useSafeAreaInsets();
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
	const { transportKey, targetKey } = identity;
	const sessionGeneration = identity.generation;
	const { enabled: tmuxEnabled, target: tmuxTarget } = tmux;
	const normalizedTmuxTarget = tmuxTarget.trim() || 'main';
	const terminalSource = ports.terminalSource;
	const shellAvailable = terminalSource.isAvailable();
	const connection = snapshot.status === 'ready' ? ports.hostCommands : null;
	const connectionStoredConnectionId = storedConnectionId;
	const modalArbiter = useMemo(() => createShellModalArbiter(), []);
	const workmuxControlChannel = ports.workmux;
	const [keyboardLateBindings] = useState(
		createShellDetailKeyboardLateBindings,
	);
	const [keyboardAuthority] = useState(() =>
		createShellDetailKeyboardAuthorityRuntime(
			{
				targetKey,
				activityGeneration: activitySnapshot.generation,
				tmuxEnabled,
				workmux: workmuxControlChannel,
			},
			{
				late: keyboardLateBindings,
				onInvalidationError: (error) =>
					logger.warn('Keyboard authority invalidation failed', error),
			},
		),
	);
	const [keyboardPublication] = useState(() =>
		createShellDetailKeyboardCommitPublication({
			authority: keyboardAuthority,
			late: keyboardLateBindings,
		}),
	);
	useLayoutEffect(() => {
		keyboardAuthority.reconcile({
			targetKey,
			activityGeneration: activitySnapshot.generation,
			tmuxEnabled,
			workmux: workmuxControlChannel,
			appActive: activitySnapshot.appActive,
			focused: activitySnapshot.focused,
		});
	}, [
		activitySnapshot.appActive,
		activitySnapshot.focused,
		activitySnapshot.generation,
		keyboardAuthority,
		targetKey,
		tmuxEnabled,
		workmuxControlChannel,
	]);
	useEffect(() => keyboardAuthority.setup(), [keyboardAuthority]);

	const [navScope] = preferences.workmuxNavScope.useWorkmuxNavScopePref();
	const simpleModals = useShellSimpleModals(modalArbiter);
	const {
		commandMenu: commandMenuModal,
		commander: commanderModal,
		textEntry: textEntryModal,
		configure: configureModal,
	} = simpleModals;
	const { width, height } = useWindowDimensions();
	const scrollTraceEnabled = isConfiguredScrollTraceEnabled();
	configureScrollTraceEnabled(scrollTraceEnabled);
	const hasConnection = Boolean(connection);
	const remoteTouchScrollPolicy = useMemo(
		() =>
			resolveShellTouchScrollPolicy({
				platformOS: Platform.OS,
				width,
				height,
				tmuxEnabled,
				hasConnection,
				scrollTraceEnabled,
				debug: __DEV__,
			}),
		[hasConnection, height, scrollTraceEnabled, tmuxEnabled, width],
	);
	const traceScroll = useCallback<ScrollTraceSink>(
		(event) => {
			emitScrollTrace({
				targetName: normalizedTmuxTarget,
				...event,
			});
		},
		[normalizedTmuxTarget],
	);
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
			shellAvailable,
			tmuxEnabled,
			terminalTransport: terminal.transport,
			terminalView: terminal.view,
			workmux: workmuxControlChannel,
			trace: traceScroll,
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

	const activeTmuxSessionName = tmuxTarget.trim() || 'main';
	const worktreeWorkspace = useWorktreeWorkspaceController({
		connectionAvailable: connection !== null,
		tmuxEnabled,
		sessionName: activeTmuxSessionName,
		sourceKey: targetKey,
		workmux: workmuxControlChannel,
		arbiter: modalArbiter,
	});

	useShellNotificationsController({
		activity: activityPort,
		commandPortKey: workmuxControlChannel,
		context: {
			transportKey,
			targetKey,
			storedConnectionId: connectionStoredConnectionId ?? null,
			channelId,
			tmuxEnabled,
			tmuxTarget,
		},
		route: {
			agentConnectionId,
			agentSession,
			agentWindowId,
			agentEventId,
			agentTapToken,
		},
		workmux: workmuxControlChannel,
		logger,
	});
	const browserActions = useBrowserActionsController({
		hostCommands: connection,
		workmux: workmuxControlChannel,
		tmuxEnabled,
		tmuxTarget,
		sourceKey: targetKey,
		getErrorMessage,
		arbiter: modalArbiter,
	});
	const manualTerminalFitRunner = useMemo(
		() =>
			createManualTerminalFitRunner({
				getHostCommands: () => connection,
				isTmuxEnabled: () => tmuxEnabled,
				getTerminalSize: terminal.getLastSize,
				getXterm: () => terminal.view,
				getTargetName: () => tmuxTarget.trim() || 'main',
				waitForTerminalSizeAfterFit: terminal.waitForSizeAfterFit,
				resizePty: async (cols, rows) => {
					if (!terminalSource.isAvailable()) {
						throw new Error('No shell is available.');
					}
					await terminalSource.resizePty(cols, rows);
				},
				showFailure: (title, message) => {
					Alert.alert(title, message);
				},
				getErrorMessage,
			}),
		[
			connection,
			terminalSource,
			terminal.getLastSize,
			terminal.view,
			terminal.waitForSizeAfterFit,
			tmuxEnabled,
			tmuxTarget,
		],
	);
	useLayoutEffect(
		() => () => manualTerminalFitRunner.cancelCurrent(),
		[manualTerminalFitRunner],
	);
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
	const handleCloseTextEntry = wispr.textEntryProps.onClose;
	useEffect(
		() => modalArbiter.register('text-entry', handleCloseTextEntry),
		[handleCloseTextEntry, modalArbiter],
	);

	const openConfigDialog = useCallback(() => {
		browserActions.invalidateHostUrlReads();
		keyboardLateBindings.closeSkillSelector();
		browserActions.close();
		configureModal.onOpen();
	}, [browserActions, configureModal, keyboardLateBindings]);

	const handleDevServer = useCallback(() => {
		configureModal.onClose();
		void Linking.openURL(HANDLE_DEV_SERVER_URL);
	}, [configureModal]);

	const handleHostConfig = useCallback(() => {
		configureModal.onClose();
		const editConnectionId = storedConnectionId ?? connectionId;
		router.replace({
			pathname: '/',
			params: { editConnectionId },
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

	const handleFitTerminalToDevice = useCallback(() => {
		commandMenuModal.onClose();
		void manualTerminalFitRunner.run();
	}, [commandMenuModal, manualTerminalFitRunner]);

	const ignoreDiagnosticTerminalPaste = useCallback((_value: string) => {}, []);
	const debugConnectionInCodex = useConnectionDebugCommand({
		appActive: activitySnapshot.appActive,
		closeMenu: commandMenuModal.onClose,
		allowTerminalPaste: false,
		pasteIntoTerminal: ignoreDiagnosticTerminalPaste,
	});

	const modalCommands = useMemo(
		() =>
			createShellDetailKeyboardModalCommands({
				late: keyboardLateBindings,
				invalidateBrowserReads: browserActions.invalidateHostUrlReads,
				closeCommander: commanderModal.onClose,
				closeBrowser: browserActions.close,
				closeTextEntry: handleCloseTextEntry,
				isCommandMenuOpen: () => commandMenuModal.open,
				openCommandMenu: commandMenuModal.onOpen,
				closeCommandMenu: commandMenuModal.onClose,
				openCommander: commanderModal.onOpen,
				openNewWorktreeWorkspace: worktreeWorkspace.openNew,
				openCloseWorktreeWorkspace: worktreeWorkspace.openClose,
				openBrowserActions: browserActions.open,
				openFeatureRequest: featureRequest.open,
				openConfigurator: openConfigDialog,
			}),
		[
			browserActions,
			commandMenuModal,
			commanderModal,
			featureRequest.open,
			handleCloseTextEntry,
			keyboardLateBindings,
			openConfigDialog,
			worktreeWorkspace.openClose,
			worktreeWorkspace.openNew,
		],
	);
	const browserCommands = useMemo<ShellKeyboardBrowserCommands>(
		() => ({
			openDiff: browserActions.browserActionsProps.onOpenDiff,
			openUrlSlot: browserActions.browserActionsProps.onOpenUrlSlot,
			openDetected: (mode) =>
				runDetectedOpenCallback(mode, browserActions.browserActionsProps),
			editUrlSlot: browserActions.browserActionsProps.onEditUrlSlot,
		}),
		[browserActions.browserActionsProps],
	);
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
	const keyboardControllerInput = createShellDetailKeyboardControllerInput({
		initialShellConfigState: shellConfigState,
		activity: activityPort,
		targetKey,
		scrollback,
		terminal,
		remote: {
			tmuxEnabled,
			sessionName: activeTmuxSessionName,
			connectionId,
			channelId,
			workmux: workmuxControlChannel,
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
		invalidateShellTransport: session.invalidateShellTransport,
		configureCommands,
		logger,
		platformOS: Platform.OS,
	});
	const keyboard = useShellKeyboardController(keyboardControllerInput);
	const pendingKeyboardPublication = keyboardPublication.prepareKeyboard({
		handle: keyboard,
	});
	useLayoutEffect(
		() => pendingKeyboardPublication.commit(),
		[pendingKeyboardPublication],
	);

	const skillSelector = useSkillSelectorController({
		hostCommands: connection,
		workmux: workmuxControlChannel,
		input: scrollback.input,
		tmuxEnabled,
		sourceKey: targetKey,
		stableConnectionId: connectionStoredConnectionId ?? connectionId,
		tmuxTarget: activeTmuxSessionName,
		getErrorMessage,
		arbiter: modalArbiter,
	});
	const pendingKeyboardLatePublication =
		keyboardPublication.prepareLateBindings({
			skillSelector,
			openWispr: wispr.openTextEditor,
		});
	useLayoutEffect(
		() => pendingKeyboardLatePublication.commit(),
		[pendingKeyboardLatePublication],
	);
	let showReconnectOverlay = false;
	switch (snapshot.status) {
		case 'attach-error':
			return (
				<TmuxAttachErrorScreen
					failureReason={snapshot.failureReason}
					sessionName={snapshot.sessionName}
					onEdit={() => {
						router.replace({
							pathname: '/',
							params: { editConnectionId: storedConnectionId ?? connectionId },
						});
					}}
				/>
			);
		case 'leaving':
			return null;
		case 'waiting':
			if (!terminal.hasRendered) return <RouteSkeleton />;
			showReconnectOverlay = true;
			break;
		case 'ready':
			break;
	}

	const ScrollbackIcon = resolveLucideIcon('ArrowDownToLine');

	return (
		<>
			<Stack.Screen options={{ headerShown: false }} />
			<KeyboardAvoidingView
				// On Android, window resizing already handles keyboard avoidance.
				// Keep KeyboardAvoidingView behavior only for iOS.
				behavior={Platform.OS === 'ios' ? 'height' : undefined}
				keyboardVerticalOffset={0}
				style={{
					flex: 1,
					backgroundColor: theme.colors.background,
					// Respect system status/navigation bars on Android.
					paddingTop: Platform.OS === 'android' ? insets.top : 0,
					// Keep a small breathing gap above the Android navigation bar.
					paddingBottom: Platform.OS === 'android' ? insets.bottom + 4 : 0,
				}}
			>
				<TerminalErrorBoundary onRetry={terminal.retry}>
					<View style={{ flex: 1 }}>
						<XtermJsWebView
							ref={terminal.xtermRef}
							style={{ flex: 1 }}
							webViewOptions={{
								// Prevent iOS from adding automatic top inset inside WebView
								contentInsetAdjustmentBehavior: 'never',
								onLoadStart: terminal.onLoadStart,
								onLayout: () => {
									// Refit terminal when container size changes
									terminal.view.fit();
								},
							}}
							logger={{
								log: logger.info,
								// debug: logger.debug,
								warn: logger.warn,
								error: logger.error,
							}}
							xtermOptions={{
								scrollback: remoteTouchScrollPolicy.xtermScrollback,
								theme: {
									background: theme.colors.background,
									foreground: theme.colors.textPrimary,
									...(Platform.OS === 'android'
										? {
												// Android: reverse-style selection for readability; iOS keeps the default blue highlight.
												selectionBackground: '#F5F5F5',
												selectionForeground: '#000000',
												selectionInactiveBackground: 'rgba(255, 255, 255, 0.6)',
											}
										: {
												selectionBackground: 'rgba(37, 99, 235, 0.35)',
												selectionInactiveBackground: 'rgba(37, 99, 235, 0.2)',
											}),
								},
							}}
							touchScrollConfig={remoteTouchScrollPolicy.touchScrollConfig}
							onResize={terminal.onResize}
							onSelection={keyboard.onSelectionChanged}
							onSelectionModeChange={keyboard.onSelectionModeChange}
							onInitialized={terminal.onInitialized}
							onInput={keyboard.onWebViewInput}
							{...scrollback.xtermProps}
						/>
						{scrollback.visible && (
							<Pressable
								onPress={scrollback.jumpToLive}
								style={{
									position: 'absolute',
									right: 16,
									bottom: 16,
									width: 48,
									height: 48,
									borderRadius: 999,
									alignItems: 'center',
									justifyContent: 'center',
									backgroundColor: 'rgba(15, 23, 42, 0.92)',
									borderWidth: 1,
									borderColor: 'rgba(148, 163, 184, 0.35)',
								}}
							>
								{ScrollbackIcon ? (
									<ScrollbackIcon color={theme.colors.textPrimary} size={20} />
								) : null}
							</Pressable>
						)}
					</View>
				</TerminalErrorBoundary>
				<TerminalKeyboard {...keyboard.terminalKeyboardProps} />
				<CommandMenuModal
					open={commandMenuModal.open}
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					onClose={commandMenuModal.onClose}
					{...keyboard.commandMenuProps}
				/>
				<BrowserActionsModal
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					{...browserActions.browserActionsProps}
				/>
				<DetectedOpenPickerModal
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					{...browserActions.detectedOpenPickerProps}
				/>
				<TerminalCommanderModal
					open={commanderModal.open}
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					onClose={commanderModal.onClose}
					{...keyboard.commanderProps}
				/>
				<SkillSelectorModal
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					{...skillSelector.modalProps}
				/>
				<WorktreeWorkspaceModal
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					{...worktreeWorkspace.modalProps}
				/>
				<TextEntryModal
					open={textEntryModal.open}
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					{...keyboard.textEntryProps}
					{...wispr.textEntryProps}
				/>
				<HostUrlModal
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					open={browserActions.hostUrlProps.open}
					slotLabel={browserActions.hostUrlProps.slotLabel}
					initialValue={browserActions.hostUrlProps.initialValue}
					mode={browserActions.hostUrlProps.mode}
					isSubmitting={browserActions.hostUrlProps.isSubmitting}
					error={browserActions.hostUrlProps.error}
					onClose={browserActions.hostUrlProps.onClose}
					onSubmit={browserActions.hostUrlProps.onSubmit}
				/>
				<ConfigureModal
					open={configureModal.open}
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					onClose={configureModal.onClose}
					{...keyboard.configureProps}
				/>
				<FeatureRequestModal
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					{...featureRequest.modalProps}
				/>
				{showReconnectOverlay && (
					<View
						style={{
							position: 'absolute',
							top: 0,
							left: 0,
							right: 0,
							bottom: 0,
							alignItems: 'center',
							justifyContent: 'center',
							backgroundColor: theme.colors.overlay,
						}}
					>
						<View
							style={{
								paddingHorizontal: 20,
								paddingVertical: 16,
								borderRadius: 12,
								backgroundColor: theme.colors.surface,
								borderWidth: 1,
								borderColor: theme.colors.border,
								alignItems: 'center',
							}}
						>
							<ActivityIndicator color={theme.colors.textPrimary} />
							<Text
								style={{
									marginTop: 8,
									color: theme.colors.textPrimary,
									fontSize: 16,
									fontWeight: '600',
								}}
							>
								Reconnecting...
							</Text>
							<Text
								style={{
									marginTop: 4,
									color: theme.colors.textSecondary,
									fontSize: 12,
								}}
							>
								Keeping your session ready
							</Text>
						</View>
					</View>
				)}
				{keyboard.flash.name && (
					<Animated.View
						pointerEvents="none"
						style={{
							position: 'absolute',
							top: '40%',
							left: 0,
							right: 0,
							alignItems: 'center',
							opacity: keyboard.flash.opacity,
						}}
					>
						<View
							style={{
								backgroundColor: 'rgba(0, 0, 0, 0.75)',
								paddingHorizontal: 20,
								paddingVertical: 10,
								borderRadius: 8,
							}}
						>
							<Text
								style={{
									color: '#fff',
									fontSize: 16,
									fontWeight: '600',
								}}
							>
								{keyboard.flash.name}
							</Text>
						</View>
					</Animated.View>
				)}
			</KeyboardAvoidingView>
		</>
	);
}
