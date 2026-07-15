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
} from 'react';
import {
	ActivityIndicator,
	Alert,
	Animated,
	KeyboardAvoidingView,
	PixelRatio,
	Platform,
	Pressable,
	Text,
	useWindowDimensions,
	View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAutoConnectStore } from '@/lib/auto-connect';
import {
	formatConnectionDiagnosticEventFields,
	type ConnectionDiagnosticEvent,
} from '@/lib/connection-diagnostics';
import { getStoredConnectionId } from '@/lib/connection-utils';
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
import { secretsManager } from '@/lib/secrets-manager';
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
import { reportShellScrollbackChannelCleanupError } from '@/lib/shell-controllers/scrollback-channel-teardown';
import { useShellSimpleModals } from '@/lib/shell-controllers/simple-modals';
import { useSkillSelectorController } from '@/lib/shell-controllers/skill-selector';
import {
	createShellTargetKey,
	createShellTransportKey,
} from '@/lib/shell-controllers/source-keys';
import { useShellTerminalController } from '@/lib/shell-controllers/terminal';
import { type TerminalRuntimeKey } from '@/lib/shell-controllers/terminal-transport';
import { useWorktreeWorkspaceController } from '@/lib/shell-controllers/worktree-workspace';
import { executeSideChannelCommand } from '@/lib/ssh-side-channel';
import { useSshStore } from '@/lib/ssh-store';
import { createManualTerminalFitRunner } from '@/lib/terminal-fit-runner';
import { useTheme } from '@/lib/theme';
import { useConnectionDebugCommand } from '@/lib/use-connection-debug-command';
import { queryClient } from '@/lib/utils';
import {
	canStartWisprTextEntryAutomation,
	isWisprAutomationBusy,
	reduceWisprAutomationState,
	resolveTextEntryWisprControl,
	resolveWisprAutoCloseOnTextEntryClose,
	resolveWisprPendingAutoCloseRequests,
	resolveWisprTextEditorAvailability,
	tapWisprControlWithTimeout,
	WisprTapTimeoutError,
	withTimeout,
	type WisprAutomationEvent,
	type WisprAutomationFailureReason,
	type WisprAutomationState,
	type WisprPendingAutoCloseRequest,
	type WisprTextEditorAvailability,
} from '@/lib/wispr-automation';
import { wisprAutomationNative } from '@/lib/wispr-automation-native';
import { type WorkmuxNavScope } from '@/lib/workmux-app-commands';
import {
	createWorkmuxControlChannel,
	disposeWorkmuxControlChannelAfterCleanup,
	type WorkmuxControlChannel,
} from '@/lib/workmux-control-channel';
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
import {
	TextEntryModal,
	type TextInputScreenBounds,
} from './components/TextEntryModal';
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

const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

const WISPR_TAP_RETRY_WINDOW_MS = 2_500;
const WISPR_TAP_RETRY_INTERVAL_MS = 200;
const WISPR_TAP_ATTEMPT_TIMEOUT_MS = 750;
const WISPR_PENDING_AUTO_CLOSE_EXPIRY_MS = 5_000;
const WISPR_OPENING_FALLBACK_MS = 750;

const getErrorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const getWisprTapFailureReason = (
	error: unknown,
): WisprAutomationFailureReason => {
	const message = getErrorMessage(error).toLowerCase();
	return message.includes('not found') ? 'bubble-not-found' : 'tap-failed';
};

const getWisprTapFailureMessage = (
	reason: WisprAutomationFailureReason,
	error: unknown,
) => {
	if (reason === 'bubble-not-found') return 'Wispr bubble not found.';
	if (reason === 'tap-failed') {
		const message = getErrorMessage(error);
		return message ? `Wispr tap failed: ${message}` : 'Wispr tap failed.';
	}
	return 'Wispr automation failed.';
};

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
		<ShellDetail request={result.request} />
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
	const hasTmuxAttachError = request.tmuxAttach.status === 'failed';
	const tmuxSessionName = request.tmuxAttach.sessionName;
	const tmuxAttachFailureReason =
		request.tmuxAttach.status === 'failed'
			? request.tmuxAttach.failureReason
			: undefined;
	const activity = useShellActivityController();
	const getActivitySnapshot = activity.getSnapshot;

	const router = useRouter();
	const theme = useTheme();
	const insets = useSafeAreaInsets();

	const shell = useSshStore(
		(s) => s.shells[`${connectionId}-${channelId}` as const],
	);
	const connection = useSshStore((s) => s.connections[connectionId]);
	const connectionStoredConnectionId = connection
		? getStoredConnectionId(connection.connectionDetails)
		: undefined;
	const storedConnectionId =
		request.storedConnectionId ?? connectionStoredConnectionId;
	const isAutoConnecting = useAutoConnectStore((s) => s.isAutoConnecting);
	const isReconnecting = useAutoConnectStore((s) => s.isReconnecting);
	const lastReconnectOutcome = useAutoConnectStore(
		(s) => s.lastReconnectOutcome,
	);
	const activeDiagnosticTrace = useAutoConnectStore(
		(s) => s.activeDiagnosticTrace,
	);
	const activeDiagnosticTraceRef = useRef(activeDiagnosticTrace);
	useLayoutEffect(() => {
		activeDiagnosticTraceRef.current = activeDiagnosticTrace;
	}, [activeDiagnosticTrace]);
	const workmuxDiagnosticTrace = useMemo(
		() => ({
			event: (event: ConnectionDiagnosticEvent) => {
				activeDiagnosticTraceRef.current?.event(event);
				const state = useSshStore.getState();
				const storeKey = `${connectionId}-${channelId}` as const;
				logger.info('Workmux diagnostic event', {
					connectionId,
					channelId,
					kind: event.kind,
					fields: formatConnectionDiagnosticEventFields(event),
					message: (event as { message?: unknown }).message,
					hasConnection: Boolean(state.connections[connectionId]),
					hasShell: Boolean(state.shells[storeKey]),
					connectionCount: Object.keys(state.connections).length,
					shellCount: Object.keys(state.shells).length,
				});
			},
		}),
		[channelId, connectionId],
	);
	const [tmuxTarget, setTmuxTarget] = useState(
		tmuxSessionName?.trim().length ? tmuxSessionName.trim() : 'main',
	);
	const [tmuxEnabled, setTmuxEnabled] = useState(false);
	const normalizedTmuxTarget = tmuxTarget.trim().length
		? tmuxTarget.trim()
		: 'main';
	const transportKey = useMemo(
		() => createShellTransportKey(connectionId, channelId),
		[channelId, connectionId],
	);
	const targetKey = useMemo(
		() => createShellTargetKey(transportKey, tmuxTarget),
		[tmuxTarget, transportKey],
	);
	const modalArbiter = useMemo(() => createShellModalArbiter(), []);
	const workmuxControlChannel = useMemo<WorkmuxControlChannel>(() => {
		void normalizedTmuxTarget;
		return createWorkmuxControlChannel({
			connection: connection ?? null,
			trace: workmuxDiagnosticTrace,
		});
	}, [connection, normalizedTmuxTarget, workmuxDiagnosticTrace]);
	const [keyboardLateBindings] = useState(
		createShellDetailKeyboardLateBindings,
	);
	const keyboardSelectionModeRef = useRef(false);
	const [keyboardAuthority] = useState(() =>
		createShellDetailKeyboardAuthorityRuntime(
			{
				targetKey,
				activityGeneration: activity.snapshot.generation,
				tmuxEnabled,
				workmuxControlChannel,
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
			publishSelectionMode: (enabled) => {
				keyboardSelectionModeRef.current = enabled;
			},
		}),
	);
	useLayoutEffect(() => {
		keyboardAuthority.reconcile({
			targetKey,
			activityGeneration: activity.snapshot.generation,
			tmuxEnabled,
			workmuxControlChannel,
			appActive: activity.snapshot.appActive,
			focused: activity.snapshot.focused,
		});
	}, [
		activity.snapshot.appActive,
		activity.snapshot.focused,
		activity.snapshot.generation,
		keyboardAuthority,
		targetKey,
		tmuxEnabled,
		workmuxControlChannel,
	]);
	useEffect(() => keyboardAuthority.setup(), [keyboardAuthority]);

	useEffect(() => {
		if (hasTmuxAttachError) return;
		if (shell && connection) return;
		if (isAutoConnecting || isReconnecting) return;
		if (connection && !shell) {
			if (
				isReconnecting === false &&
				lastReconnectOutcome &&
				lastReconnectOutcome.destination === 'hostPage'
			) {
				logger.info('reconnect failed, replacing route with host page', {
					outcome: lastReconnectOutcome.status,
				});
				router.replace({
					pathname: '/',
					params: { editConnectionId: storedConnectionId ?? connectionId },
				});
				return;
			}
			logger.info(
				'shell missing on active connection, waiting for reconnect cycle',
			);
			return;
		}
		logger.info('connection not found, replacing route with /shell');
		router.back();
	}, [
		connection,
		hasTmuxAttachError,
		isAutoConnecting,
		isReconnecting,
		lastReconnectOutcome,
		storedConnectionId,
		connectionId,
		router,
		shell,
	]);

	useEffect(() => {
		if (tmuxSessionName?.trim().length) {
			// eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- Sync state from prop
			setTmuxTarget(tmuxSessionName.trim());
		}
	}, [tmuxSessionName]);

	useEffect(() => {
		if (!storedConnectionId) return;
		let cancelled = false;
		void queryClient
			.fetchQuery(secretsManager.connections.query.get(storedConnectionId))
			.then((entry) => {
				if (cancelled) return;
				const details = entry?.value;
				if (!details) return;
				const useTmux = details.useTmux ?? true;
				setTmuxEnabled(useTmux);
				if (useTmux) {
					const sessionName = details.tmuxSessionName?.trim() || 'main';
					setTmuxTarget(sessionName);
				}
			})
			.catch((error) => {
				logger.warn('Failed to load tmux session info', error);
			});
		return () => {
			cancelled = true;
		};
	}, [storedConnectionId]);

	const [navScope] = preferences.workmuxNavScope.useWorkmuxNavScopePref();
	const {
		commandMenu: commandMenuModal,
		commander: commanderModal,
		textEntry: textEntryModal,
		configure: configureModal,
	} = useShellSimpleModals(modalArbiter);
	const [autoWisprEnabled, setAutoWisprEnabled] = useState(false);
	const [wisprTextEditorAvailability, setWisprTextEditorAvailability] =
		useState<WisprTextEditorAvailability>({ type: 'ready' });
	const [wisprAutomationState, setWisprAutomationState] =
		useState<WisprAutomationState>({ phase: 'idle' });
	const wisprAutomationStateRef = useRef<WisprAutomationState>({
		phase: 'idle',
	});
	const autoWisprEnabledRef = useRef(false);
	const wisprTextEntryValueRef = useRef('');
	const cleanupWisprTextEntryOnUnmountRef = useRef<() => void>(() => {});
	const wisprTextEntryAutoStartedRequestIdRef = useRef<number | null>(null);
	const wisprTextEntryControlTapStartedRequestIdRef = useRef<number | null>(
		null,
	);
	const wisprTextEntryTimedOutStartRequestIdRef = useRef<number | null>(null);
	const wisprDeferredAutoStartRequestIdRef = useRef<number | null>(null);
	const flushDeferredWisprAutoStartRef = useRef<() => void>(() => {});
	const wisprTextEntryCloseAfterStartRequestsRef = useRef(
		new Map<number, WisprPendingAutoCloseRequest>(),
	);
	const wisprPendingAutoCloseTimeoutsRef = useRef(
		new Map<number, ReturnType<typeof setTimeout>>(),
	);
	const wisprAutoCloseInFlightCountRef = useRef(0);
	const wisprAutoCloseInFlightTimeoutsRef = useRef(
		new Set<ReturnType<typeof setTimeout>>(),
	);
	const wisprAutoCloseAttemptIdRef = useRef(0);
	const wisprAutomationRequestIdRef = useRef(0);
	const wisprOpeningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const { width, height } = useWindowDimensions();
	autoWisprEnabledRef.current = autoWisprEnabled;
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
	const scrollbackRuntimeChangedRef = useRef<
		(instanceId: string | null) => void
	>(() => {});
	const handleTerminalRuntimeChanged = useCallback(
		(runtimeKey: TerminalRuntimeKey | null, instanceId: string | null) => {
			keyboardAuthority.onRuntimeChanged(runtimeKey, instanceId, () => {
				scrollbackRuntimeChangedRef.current(instanceId);
			});
		},
		[keyboardAuthority],
	);
	const terminal = useShellTerminalController({
		shell,
		transportKey,
		platformOS: Platform.OS,
		systemKeyboardEnabled: Platform.OS === 'android',
		selectionModeEnabled: false,
		logger,
		router,
		onRuntimeChanged: handleTerminalRuntimeChanged,
	});
	const scrollback = useShellScrollbackController({
		activity,
		context: {
			targetKey,
			targetName: normalizedTmuxTarget,
			connectionAvailable: Boolean(connection),
			shellAvailable: Boolean(shell),
			tmuxEnabled,
			getActivitySnapshot,
			getSelectionModeEnabled: () => keyboardSelectionModeRef.current,
			terminalTransport: terminal.transport,
			terminalView: terminal.view,
			workmuxScroll: workmuxControlChannel.scroll,
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
		onTeardownCleanup: (cleanup) => {
			const disposeReason = useAutoConnectStore.getState().isReconnecting
				? 'reconnect'
				: 'unmount';
			disposeWorkmuxControlChannelAfterCleanup({
				cleanup,
				prepareDispose: () =>
					workmuxControlChannel.prepareDispose({ reason: disposeReason }),
				dispose: () => workmuxControlChannel.dispose({ reason: disposeReason }),
				onCleanupError: (error) =>
					reportShellScrollbackChannelCleanupError({
						error,
						logger,
					}),
				onDisposeError: (error) => {
					try {
						logger.warn('Workmux control channel dispose failed', error);
					} catch {
						// Channel teardown must not depend on diagnostics.
					}
				},
			});
		},
	});
	scrollbackRuntimeChangedRef.current = scrollback.onTerminalRuntimeChanged;
	const terminalSizeSnapshotRef = useRef(terminal.lastSize);
	terminalSizeSnapshotRef.current = terminal.lastSize;

	const clearWisprOpeningTimeout = useCallback(() => {
		if (!wisprOpeningTimeoutRef.current) return;
		clearTimeout(wisprOpeningTimeoutRef.current);
		wisprOpeningTimeoutRef.current = null;
	}, []);

	const setWisprAutomationStateSnapshot = useCallback(
		(nextState: WisprAutomationState) => {
			wisprAutomationStateRef.current = nextState;
			setWisprAutomationState(nextState);
		},
		[],
	);

	const applyWisprAutomationEvent = useCallback(
		(event: WisprAutomationEvent) => {
			const nextState = reduceWisprAutomationState(
				wisprAutomationStateRef.current,
				event,
			);
			setWisprAutomationStateSnapshot(nextState);
			if (nextState.phase !== 'openingTextEntry') {
				clearWisprOpeningTimeout();
			}
			return nextState;
		},
		[clearWisprOpeningTimeout, setWisprAutomationStateSnapshot],
	);

	const resetWisprAutomation = useCallback(() => {
		wisprAutomationRequestIdRef.current += 1;
		clearWisprOpeningTimeout();
		applyWisprAutomationEvent({ type: 'reset' });
	}, [applyWisprAutomationEvent, clearWisprOpeningTimeout]);

	const failWisprAutomation = useCallback(
		(reason: WisprAutomationFailureReason, message: string) => {
			wisprAutomationRequestIdRef.current += 1;
			applyWisprAutomationEvent({
				type: 'failed',
				reason,
				message,
			});
		},
		[applyWisprAutomationEvent],
	);

	const isWisprAutomationRequestActive = useCallback((requestId: number) => {
		return requestId === wisprAutomationRequestIdRef.current;
	}, []);

	const tapWisprControlWithinRetryWindow = useCallback(
		async ({
			retry,
			shouldContinue,
			initialError,
			onLateSuccess,
			onLateFailure,
			returnSuccessAfterCancel,
			returnFailureAfterCancel,
		}: {
			retry: boolean;
			shouldContinue: () => boolean;
			initialError: unknown;
			onLateSuccess?: () => void;
			onLateFailure?: () => void;
			returnSuccessAfterCancel?: boolean;
			returnFailureAfterCancel?: boolean;
		}) => {
			let lastError = initialError;
			let hasAttemptedTap = false;
			const deadline =
				Date.now() +
				(retry ? WISPR_TAP_RETRY_WINDOW_MS : WISPR_TAP_ATTEMPT_TIMEOUT_MS);

			do {
				if (!shouldContinue()) {
					if (returnFailureAfterCancel && hasAttemptedTap) break;
					return null;
				}
				try {
					const remainingMs = Math.max(1, deadline - Date.now());
					hasAttemptedTap = true;
					await tapWisprControlWithTimeout({
						tapWisprControl: () => wisprAutomationNative.tapWisprControl(),
						timeoutMs: Math.min(WISPR_TAP_ATTEMPT_TIMEOUT_MS, remainingMs),
						onLateSuccess,
						onLateFailure,
					});
					if (!shouldContinue() && !returnSuccessAfterCancel) return null;
					return { ok: true as const };
				} catch (error) {
					lastError = error;
					if (!shouldContinue()) {
						if (!returnFailureAfterCancel) return null;
						break;
					}
					// The native tap can still complete after JS times out. Retrying a
					// hung tap could toggle the same Wispr control twice.
					if (error instanceof WisprTapTimeoutError) break;
				}
				if (!retry) break;
				const remainingMs = deadline - Date.now();
				if (remainingMs <= 0) break;
				await sleep(Math.min(WISPR_TAP_RETRY_INTERVAL_MS, remainingMs));
			} while (Date.now() <= deadline);

			return { ok: false as const, error: lastError };
		},
		[],
	);

	const tapWisprControlWithRetry = useCallback(
		async (
			requestId: number,
			options?: {
				notFoundMessage?: string;
				onLateSuccess?: () => void;
				onLateFailure?: () => void;
				returnSuccessAfterCancel?: boolean;
				returnFailureAfterCancel?: boolean;
			},
		) => {
			const result = await tapWisprControlWithinRetryWindow({
				retry: true,
				shouldContinue: () => isWisprAutomationRequestActive(requestId),
				initialError: new Error(
					options?.notFoundMessage ?? 'Wispr bubble not found',
				),
				onLateSuccess: options?.onLateSuccess,
				onLateFailure: options?.onLateFailure,
				returnSuccessAfterCancel: options?.returnSuccessAfterCancel,
				returnFailureAfterCancel: options?.returnFailureAfterCancel,
			});
			if (!result) return null;
			if (result.ok) return result;

			const reason = getWisprTapFailureReason(result.error);
			return {
				ok: false as const,
				reason,
				message: getWisprTapFailureMessage(reason, result.error),
				timedOut: result.error instanceof WisprTapTimeoutError,
			};
		},
		[isWisprAutomationRequestActive, tapWisprControlWithinRetryWindow],
	);

	const closeAutoStartedWisprControl = useCallback(
		async (options?: {
			retry?: boolean;
			onLateSuccess?: () => void;
			onLateFailure?: () => void;
		}) => {
			const attemptId = wisprAutoCloseAttemptIdRef.current + 1;
			wisprAutoCloseAttemptIdRef.current = attemptId;
			const result = await tapWisprControlWithinRetryWindow({
				retry: options?.retry ?? true,
				shouldContinue: () => attemptId === wisprAutoCloseAttemptIdRef.current,
				initialError: new Error('Wispr bubble not found'),
				onLateSuccess: options?.onLateSuccess,
				onLateFailure: options?.onLateFailure,
			});
			if (!result) return { closed: false, timedOut: false };
			if (result.ok) return { closed: true, timedOut: false };

			logger.warn('Failed to close auto-started Wispr control', result.error);
			return {
				closed: false,
				timedOut: result.error instanceof WisprTapTimeoutError,
			};
		},
		[tapWisprControlWithinRetryWindow],
	);

	const beginBlockingWisprAutoClose = useCallback(() => {
		wisprAutoCloseInFlightCountRef.current += 1;
		let finished = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const finish = (replayDeferredAutoStart: boolean) => {
			if (finished) return;
			finished = true;
			if (timeout) {
				clearTimeout(timeout);
				wisprAutoCloseInFlightTimeoutsRef.current.delete(timeout);
			}
			wisprAutoCloseInFlightCountRef.current = Math.max(
				0,
				wisprAutoCloseInFlightCountRef.current - 1,
			);
			if (replayDeferredAutoStart) {
				flushDeferredWisprAutoStartRef.current();
			} else {
				wisprDeferredAutoStartRequestIdRef.current = null;
			}
		};
		timeout = setTimeout(() => {
			finish(false);
		}, WISPR_PENDING_AUTO_CLOSE_EXPIRY_MS);
		wisprAutoCloseInFlightTimeoutsRef.current.add(timeout);
		return {
			finishAfterSuccess: () => {
				finish(true);
			},
			finishWithoutReplay: () => {
				finish(false);
			},
		};
	}, []);

	const clearPendingWisprAutoCloseTimeout = useCallback((requestId: number) => {
		const timeout = wisprPendingAutoCloseTimeoutsRef.current.get(requestId);
		if (!timeout) return;
		clearTimeout(timeout);
		wisprPendingAutoCloseTimeoutsRef.current.delete(requestId);
	}, []);

	const removePendingWisprAutoCloseRequest = useCallback(
		(requestId: number) => {
			clearPendingWisprAutoCloseTimeout(requestId);
			wisprTextEntryCloseAfterStartRequestsRef.current.delete(requestId);
			flushDeferredWisprAutoStartRef.current();
		},
		[clearPendingWisprAutoCloseTimeout],
	);

	const expirePendingWisprAutoCloseRequest = useCallback(
		(requestId: number) => {
			clearPendingWisprAutoCloseTimeout(requestId);
			const timeout = setTimeout(() => {
				wisprPendingAutoCloseTimeoutsRef.current.delete(requestId);
				wisprTextEntryCloseAfterStartRequestsRef.current.delete(requestId);
				wisprDeferredAutoStartRequestIdRef.current = null;
			}, WISPR_PENDING_AUTO_CLOSE_EXPIRY_MS);
			wisprPendingAutoCloseTimeoutsRef.current.set(requestId, timeout);
		},
		[clearPendingWisprAutoCloseTimeout],
	);

	const setPendingWisprAutoCloseRequests = useCallback(
		(pendingRequests: WisprPendingAutoCloseRequest[]) => {
			for (const requestId of wisprTextEntryCloseAfterStartRequestsRef.current.keys()) {
				if (
					!pendingRequests.some((request) => request.requestId === requestId)
				) {
					clearPendingWisprAutoCloseTimeout(requestId);
				}
			}
			wisprTextEntryCloseAfterStartRequestsRef.current = new Map(
				pendingRequests.map((request) => [request.requestId, request]),
			);
		},
		[clearPendingWisprAutoCloseTimeout],
	);

	const consumeWisprAutoCloseDecision = useCallback(
		(
			decision: ReturnType<typeof resolveWisprAutoCloseOnTextEntryClose>,
			options?: { retryClose?: boolean },
		) => {
			const resolution = resolveWisprPendingAutoCloseRequests({
				pendingRequests: [
					...wisprTextEntryCloseAfterStartRequestsRef.current.values(),
				],
				decision,
				retryClose: options?.retryClose ?? true,
			});
			const closeAfterStartRequestId =
				decision.type === 'close-after-start' ? decision.requestId : null;
			const closeAfterTimedOutStart =
				closeAfterStartRequestId != null &&
				wisprTextEntryTimedOutStartRequestIdRef.current ===
					closeAfterStartRequestId;
			wisprTextEntryAutoStartedRequestIdRef.current = null;
			if (
				wisprTextEntryControlTapStartedRequestIdRef.current ===
				closeAfterStartRequestId
			) {
				wisprTextEntryControlTapStartedRequestIdRef.current = null;
			}
			if (
				wisprTextEntryTimedOutStartRequestIdRef.current ===
				closeAfterStartRequestId
			) {
				wisprTextEntryTimedOutStartRequestIdRef.current = null;
			}
			setPendingWisprAutoCloseRequests(resolution.pendingRequests);
			if (closeAfterTimedOutStart && closeAfterStartRequestId != null) {
				expirePendingWisprAutoCloseRequest(closeAfterStartRequestId);
			}
			if (!resolution.closeNow) return;
			const finishBlockingClose = beginBlockingWisprAutoClose();
			void closeAutoStartedWisprControl({
				retry: options?.retryClose ?? true,
				onLateSuccess: finishBlockingClose.finishAfterSuccess,
				onLateFailure: finishBlockingClose.finishWithoutReplay,
			}).then((closeResult) => {
				if (closeResult?.timedOut) return;
				if (closeResult?.closed) {
					finishBlockingClose.finishAfterSuccess();
					return;
				}
				finishBlockingClose.finishWithoutReplay();
			});
		},
		[
			beginBlockingWisprAutoClose,
			closeAutoStartedWisprControl,
			expirePendingWisprAutoCloseRequest,
			setPendingWisprAutoCloseRequests,
		],
	);

	const consumePendingWisprAutoCloseForRequest = useCallback(
		(requestId: number, startTapSucceeded: boolean) => {
			const pendingClose =
				wisprTextEntryCloseAfterStartRequestsRef.current.get(requestId);
			if (!pendingClose) return false;
			if (!startTapSucceeded) {
				removePendingWisprAutoCloseRequest(requestId);
				return true;
			}
			void (async () => {
				clearPendingWisprAutoCloseTimeout(requestId);
				const closeResult = await closeAutoStartedWisprControl({
					retry: pendingClose.retryClose,
					onLateSuccess: () => {
						removePendingWisprAutoCloseRequest(requestId);
					},
				});
				if (closeResult?.timedOut) {
					expirePendingWisprAutoCloseRequest(requestId);
					return;
				}
				if (!closeResult?.closed) {
					expirePendingWisprAutoCloseRequest(requestId);
					return;
				}
				removePendingWisprAutoCloseRequest(requestId);
			})();
			return true;
		},
		[
			clearPendingWisprAutoCloseTimeout,
			closeAutoStartedWisprControl,
			expirePendingWisprAutoCloseRequest,
			removePendingWisprAutoCloseRequest,
		],
	);

	const clearWisprStartMarkersForRequest = useCallback((requestId: number) => {
		if (wisprTextEntryTimedOutStartRequestIdRef.current === requestId) {
			wisprTextEntryTimedOutStartRequestIdRef.current = null;
		}
		if (wisprTextEntryControlTapStartedRequestIdRef.current === requestId) {
			wisprTextEntryControlTapStartedRequestIdRef.current = null;
		}
	}, []);

	const startWisprOpeningFallback = useCallback(
		(requestId: number, onFallback: () => void) => {
			clearWisprOpeningTimeout();
			wisprOpeningTimeoutRef.current = setTimeout(() => {
				if (
					!isWisprAutomationRequestActive(requestId) ||
					wisprAutomationStateRef.current.phase !== 'openingTextEntry'
				) {
					return;
				}
				onFallback();
			}, WISPR_OPENING_FALLBACK_MS);
		},
		[clearWisprOpeningTimeout, isWisprAutomationRequestActive],
	);

	const handleWisprTextEntryFocus = useCallback(
		(value: string, bounds?: TextInputScreenBounds) => {
			if (wisprAutomationStateRef.current.phase !== 'openingTextEntry') {
				return;
			}

			const requestId = wisprAutomationRequestIdRef.current;
			clearWisprOpeningTimeout();
			applyWisprAutomationEvent({
				type: 'textEntryFocused',
				textBeforeStart: value,
			});

			void (async () => {
				if (bounds && bounds.width > 0 && bounds.height > 0) {
					const pixelRatio = PixelRatio.get();
					const x = (bounds.x + bounds.width / 2) * pixelRatio;
					const y = (bounds.y + Math.min(bounds.height / 2, 48)) * pixelRatio;
					try {
						await withTimeout(
							wisprAutomationNative.tapScreen(x, y),
							WISPR_TAP_ATTEMPT_TIMEOUT_MS,
						);
					} catch (error) {
						logger.warn('Failed to prime Wispr text field', error);
					}
				}
				if (
					!isWisprAutomationRequestActive(requestId) ||
					wisprAutomationStateRef.current.phase !== 'waitingForBubble'
				) {
					return null;
				}
				wisprTextEntryControlTapStartedRequestIdRef.current = requestId;
				return tapWisprControlWithRetry(requestId, {
					returnSuccessAfterCancel: true,
					returnFailureAfterCancel: true,
					onLateSuccess: () => {
						if (consumePendingWisprAutoCloseForRequest(requestId, true)) {
							return;
						}
						if (
							!textEntryModal.openRef.current ||
							!isWisprAutomationRequestActive(requestId) ||
							wisprTextEntryAutoStartedRequestIdRef.current !== requestId
						) {
							return;
						}
						if (wisprTextEntryTimedOutStartRequestIdRef.current === requestId) {
							wisprTextEntryTimedOutStartRequestIdRef.current = null;
						}
						if (wisprAutomationStateRef.current.phase === 'waitingForBubble') {
							applyWisprAutomationEvent({ type: 'wisprTapSucceeded' });
							return;
						}
						if (wisprAutomationStateRef.current.phase === 'failed') {
							setWisprAutomationStateSnapshot({
								phase: 'recording',
								textBeforeStart: wisprTextEntryValueRef.current,
							});
						}
					},
					onLateFailure: () => {
						if (consumePendingWisprAutoCloseForRequest(requestId, false)) {
							return;
						}
						clearWisprStartMarkersForRequest(requestId);
					},
				});
			})().then((result) => {
				if (
					!result &&
					wisprTextEntryCloseAfterStartRequestsRef.current.has(requestId)
				) {
					expirePendingWisprAutoCloseRequest(requestId);
					return;
				}
				if (
					result?.ok &&
					consumePendingWisprAutoCloseForRequest(requestId, true)
				) {
					return;
				}
				if (result?.ok) {
					clearWisprStartMarkersForRequest(requestId);
				}
				if (
					result &&
					!result.ok &&
					!result.timedOut &&
					consumePendingWisprAutoCloseForRequest(requestId, false)
				) {
					return;
				}
				if (result && !result.ok && !result.timedOut) {
					clearWisprStartMarkersForRequest(requestId);
				}
				if (
					result &&
					!result.ok &&
					result.timedOut &&
					wisprTextEntryCloseAfterStartRequestsRef.current.has(requestId)
				) {
					expirePendingWisprAutoCloseRequest(requestId);
					return;
				}
				if (
					!result ||
					!isWisprAutomationRequestActive(requestId) ||
					wisprAutomationStateRef.current.phase !== 'waitingForBubble'
				) {
					return;
				}
				if (result.ok) {
					applyWisprAutomationEvent({ type: 'wisprTapSucceeded' });
					return;
				}
				if (result.timedOut) {
					wisprTextEntryTimedOutStartRequestIdRef.current = requestId;
				}
				applyWisprAutomationEvent({
					type: 'failed',
					reason: result.reason,
					message: result.message,
				});
			});
		},
		[
			applyWisprAutomationEvent,
			setWisprAutomationStateSnapshot,
			clearWisprStartMarkersForRequest,
			clearWisprOpeningTimeout,
			consumePendingWisprAutoCloseForRequest,
			expirePendingWisprAutoCloseRequest,
			isWisprAutomationRequestActive,
			tapWisprControlWithRetry,
			textEntryModal,
		],
	);

	const handleWisprTextEntryValueChange = useCallback(
		(value: string) => {
			wisprTextEntryValueRef.current = value;
			const previousPhase = wisprAutomationStateRef.current.phase;
			const nextState = applyWisprAutomationEvent({
				type: 'textChanged',
				value,
			});
			if (previousPhase === 'recording' && nextState.phase === 'idle') {
				wisprAutomationRequestIdRef.current += 1;
			}
		},
		[applyWisprAutomationEvent],
	);

	const canStartWisprTextEntryAutomationNow = useCallback(() => {
		return canStartWisprTextEntryAutomation({
			closeInFlight: wisprAutoCloseInFlightCountRef.current > 0,
			pendingRequests: [
				...wisprTextEntryCloseAfterStartRequestsRef.current.values(),
			],
		});
	}, []);

	const startWisprTextEntryAutomationNow = useCallback(
		(requestId: number) => {
			wisprAutoCloseAttemptIdRef.current += 1;
			wisprTextEntryAutoStartedRequestIdRef.current = requestId;
			wisprTextEntryControlTapStartedRequestIdRef.current = null;
			wisprTextEntryTimedOutStartRequestIdRef.current = null;
			applyWisprAutomationEvent({ type: 'press' });
			startWisprOpeningFallback(requestId, () => {
				handleWisprTextEntryFocus(wisprTextEntryValueRef.current);
			});
		},
		[
			applyWisprAutomationEvent,
			handleWisprTextEntryFocus,
			startWisprOpeningFallback,
		],
	);

	const startWisprTextEntryAutomation = useCallback(
		(requestId: number) => {
			if (!canStartWisprTextEntryAutomationNow()) {
				wisprDeferredAutoStartRequestIdRef.current = requestId;
				logger.info('Deferring Wispr auto-start while auto-close is pending');
				return;
			}
			wisprDeferredAutoStartRequestIdRef.current = null;
			startWisprTextEntryAutomationNow(requestId);
		},
		[canStartWisprTextEntryAutomationNow, startWisprTextEntryAutomationNow],
	);

	flushDeferredWisprAutoStartRef.current = () => {
		const requestId = wisprDeferredAutoStartRequestIdRef.current;
		if (requestId == null) return;
		if (
			!textEntryModal.openRef.current ||
			!autoWisprEnabledRef.current ||
			!isWisprAutomationRequestActive(requestId)
		) {
			wisprDeferredAutoStartRequestIdRef.current = null;
			return;
		}
		if (!canStartWisprTextEntryAutomationNow()) return;
		wisprDeferredAutoStartRequestIdRef.current = null;
		startWisprTextEntryAutomationNow(requestId);
	};

	const handleWisprAutoStartChange = useCallback(
		(enabled: boolean) => {
			autoWisprEnabledRef.current = enabled;
			setAutoWisprEnabled(enabled);
			if (!enabled) {
				wisprDeferredAutoStartRequestIdRef.current = null;
			}
			if (
				!enabled ||
				!textEntryModal.open ||
				wisprTextEditorAvailability.type !== 'ready'
			) {
				return;
			}

			const currentState = wisprAutomationStateRef.current;
			if (currentState.phase !== 'idle' && currentState.phase !== 'failed') {
				return;
			}

			const requestId = wisprAutomationRequestIdRef.current + 1;
			wisprAutomationRequestIdRef.current = requestId;
			startWisprTextEntryAutomation(requestId);
		},
		[
			startWisprTextEntryAutomation,
			textEntryModal,
			wisprTextEditorAvailability,
		],
	);

	const handleCloseTextEntry = useCallback(() => {
		const autoCloseDecision = resolveWisprAutoCloseOnTextEntryClose({
			autoStartedRequestId: wisprTextEntryAutoStartedRequestIdRef.current,
			automationState: wisprAutomationStateRef.current,
			controlTapStartedRequestId:
				wisprTextEntryControlTapStartedRequestIdRef.current,
			timedOutStartRequestId: wisprTextEntryTimedOutStartRequestIdRef.current,
		});
		textEntryModal.onClose();
		wisprDeferredAutoStartRequestIdRef.current = null;
		resetWisprAutomation();
		consumeWisprAutoCloseDecision(autoCloseDecision);
	}, [consumeWisprAutoCloseDecision, resetWisprAutomation, textEntryModal]);

	useEffect(
		() => modalArbiter.register('text-entry', handleCloseTextEntry),
		[handleCloseTextEntry, modalArbiter],
	);

	const activeTmuxSessionName = tmuxTarget.trim() || 'main';
	const worktreeWorkspace = useWorktreeWorkspaceController({
		connection: connection ?? null,
		tmuxEnabled,
		sessionName: activeTmuxSessionName,
		sourceKey: targetKey,
		workmuxControlChannel,
		arbiter: modalArbiter,
	});

	const runBrowserActionsWorkmuxCommand = useCallback(
		async (_connection: unknown, argv: string[], timeoutMs: number) => {
			const result = await workmuxControlChannel.command(argv, {
				timeoutMs,
			});
			if (!result.success) {
				throw new Error(
					result.error || result.output || 'Workmux command failed.',
				);
			}
			return result.output;
		},
		[workmuxControlChannel],
	);
	const runNotificationWorkmuxCommand = useCallback(
		(argv: string[], timeoutMs: number) =>
			runBrowserActionsWorkmuxCommand(null, argv, timeoutMs),
		[runBrowserActionsWorkmuxCommand],
	);
	useShellNotificationsController({
		activity,
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
		runWorkmuxCommand: runNotificationWorkmuxCommand,
		logger,
	});

	const browserActions = useBrowserActionsController({
		connection: connection ?? null,
		tmuxEnabled,
		tmuxTarget,
		sourceKey: targetKey,
		executeSideChannelCommand,
		runWorkmuxCommand: runBrowserActionsWorkmuxCommand,
		getErrorMessage,
		arbiter: modalArbiter,
	});
	const manualTerminalFitRunner = useMemo(
		() =>
			createManualTerminalFitRunner({
				getConnection: () => connection ?? null,
				isTmuxEnabled: () => tmuxEnabled,
				getTerminalSize: () => terminalSizeSnapshotRef.current,
				getXterm: () => terminal.view,
				getTargetName: () => tmuxTarget.trim() || 'main',
				waitForTerminalSizeAfterFit: terminal.waitForSizeAfterFit,
				resizePty: async (cols, rows) => {
					if (!shell) {
						throw new Error('No shell is available.');
					}
					await shell.resizePty(cols, rows);
				},
				executeSideChannelCommand,
				showFailure: (title, message) => {
					Alert.alert(title, message);
				},
				getErrorMessage,
			}),
		[
			connection,
			shell,
			terminal.view,
			terminal.waitForSizeAfterFit,
			tmuxEnabled,
			tmuxTarget,
		],
	);
	const featureRequest = useFeatureRequestController({
		connection: connection ?? null,
		resolveCurrentGitHubRepository:
			browserActions.resolveCurrentGitHubRepository,
		executeSideChannelCommand,
		getErrorMessage,
		logger,
		arbiter: modalArbiter,
	});

	const markFeatureRequestSourceStale = featureRequest.markSourceStale;

	useLayoutEffect(() => {
		markFeatureRequestSourceStale();
	}, [connection, markFeatureRequestSourceStale, targetKey, tmuxEnabled]);

	const handleOpenWisprTextEditor = useCallback(() => {
		browserActions.invalidateHostUrlReads();
		const currentState = wisprAutomationStateRef.current;
		if (currentState.phase !== 'idle' && currentState.phase !== 'failed') {
			logger.info('Ignoring Wispr text entry while automation is busy', {
				phase: currentState.phase,
			});
			return;
		}
		keyboardLateBindings.closeSkillSelector();
		browserActions.close();
		if (Platform.OS !== 'android') {
			commanderModal.onClose();
			commandMenuModal.onClose();
			setWisprTextEditorAvailability({
				type: 'setup-required',
				reason: 'service-disabled',
				message: 'Wispr automation is only available on Android.',
				openAccessibilitySettings: false,
			});
			textEntryModal.onOpen();
			failWisprAutomation(
				'unsupported-platform',
				'Wispr automation is only available on Android.',
			);
			return;
		}

		const requestId = wisprAutomationRequestIdRef.current + 1;
		wisprAutomationRequestIdRef.current = requestId;
		void (async () => {
			try {
				const status = await wisprAutomationNative.getStatus();
				if (!isWisprAutomationRequestActive(requestId)) return;
				const availability = resolveWisprTextEditorAvailability(status);
				setWisprTextEditorAvailability(availability);
				if (availability.type === 'setup-required') {
					commanderModal.onClose();
					commandMenuModal.onClose();
					textEntryModal.onOpen();
					applyWisprAutomationEvent({
						type: 'failed',
						reason: availability.reason,
						message: availability.message,
					});
					return;
				}

				commanderModal.onClose();
				commandMenuModal.onClose();
				textEntryModal.onOpen();
				if (availability.type === 'ready' && autoWisprEnabledRef.current) {
					startWisprTextEntryAutomation(requestId);
				}
			} catch (error) {
				if (!isWisprAutomationRequestActive(requestId)) return;
				commanderModal.onClose();
				commandMenuModal.onClose();
				setWisprTextEditorAvailability({
					type: 'setup-required',
					reason: 'service-disabled',
					message: 'Wispr automation is unavailable.',
					openAccessibilitySettings: false,
				});
				textEntryModal.onOpen();
				applyWisprAutomationEvent({
					type: 'failed',
					reason: 'service-disabled',
					message: 'Wispr automation is unavailable.',
				});
				logger.warn('Wispr automation status check failed', error);
			}
		})();
	}, [
		applyWisprAutomationEvent,
		browserActions,
		commanderModal,
		commandMenuModal,
		failWisprAutomation,
		isWisprAutomationRequestActive,
		keyboardLateBindings,
		startWisprTextEntryAutomation,
		textEntryModal,
	]);

	const handleOpenWisprAutomationSettings = useCallback(() => {
		if (Platform.OS !== 'android') return;
		void wisprAutomationNative.openAccessibilitySettings().catch((error) => {
			logger.warn('Failed to open accessibility settings', error);
		});
	}, []);

	cleanupWisprTextEntryOnUnmountRef.current = () => {
		consumeWisprAutoCloseDecision(
			resolveWisprAutoCloseOnTextEntryClose({
				autoStartedRequestId: wisprTextEntryAutoStartedRequestIdRef.current,
				automationState: wisprAutomationStateRef.current,
				controlTapStartedRequestId:
					wisprTextEntryControlTapStartedRequestIdRef.current,
				timedOutStartRequestId: wisprTextEntryTimedOutStartRequestIdRef.current,
			}),
			{ retryClose: false },
		);
		wisprAutomationRequestIdRef.current += 1;
		wisprTextEntryControlTapStartedRequestIdRef.current = null;
		wisprTextEntryTimedOutStartRequestIdRef.current = null;
		wisprDeferredAutoStartRequestIdRef.current = null;
		clearWisprOpeningTimeout();
		// Keep pending-close expiry timers alive: late native start callbacks can
		// still use pending close state after unmount, and the timers bound it.
		for (const timeout of wisprAutoCloseInFlightTimeoutsRef.current.values()) {
			clearTimeout(timeout);
		}
		wisprAutoCloseInFlightTimeoutsRef.current.clear();
		wisprAutoCloseInFlightCountRef.current = 0;
	};

	useEffect(() => {
		return () => {
			cleanupWisprTextEntryOnUnmountRef.current();
		};
	}, []);

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
		appActive: activity.snapshot.appActive,
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
		activity,
		targetKey,
		scrollback,
		terminal,
		remote: {
			tmuxEnabled,
			sessionName: activeTmuxSessionName,
			connectionId,
			channelId,
			workmuxControlChannel,
			source: connection,
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
		invalidateShellTransport: (
			nextConnectionId: string,
			nextChannelId: number,
		) =>
			useSshStore
				.getState()
				.invalidateShellTransport(nextConnectionId, nextChannelId),
		configureCommands,
		logger,
		platformOS: Platform.OS,
	});
	const keyboard = useShellKeyboardController(keyboardControllerInput);
	const pendingKeyboardPublication = keyboardPublication.prepareKeyboard({
		handle: keyboard,
		selectionModeEnabled: keyboard.selectionModeEnabled,
	});
	useLayoutEffect(
		() => pendingKeyboardPublication.commit(),
		[pendingKeyboardPublication],
	);

	const skillSelector = useSkillSelectorController({
		connection,
		tmuxEnabled,
		runHostBrowserCommand: browserActions.runHostBrowserCommand,
		resolveHostBrowserWorkspace: browserActions.resolveHostBrowserWorkspace,
		sendTextRaw: keyboard.commanderProps.onPasteText,
		sourceKey: targetKey,
		stableConnectionId: connectionStoredConnectionId ?? connectionId,
		tmuxTarget: activeTmuxSessionName,
		getErrorMessage,
		arbiter: modalArbiter,
	});
	const pendingKeyboardLatePublication =
		keyboardPublication.prepareLateBindings({
			skillSelector,
			openWispr: handleOpenWisprTextEditor,
		});
	useLayoutEffect(
		() => pendingKeyboardLatePublication.commit(),
		[pendingKeyboardLatePublication],
	);
	const wisprMode = isWisprAutomationBusy(wisprAutomationState);
	const wisprControl = useMemo(
		() =>
			resolveTextEntryWisprControl({
				availability: wisprTextEditorAvailability,
				autoStartEnabled: autoWisprEnabled,
				automationState: wisprAutomationState,
			}),
		[autoWisprEnabled, wisprAutomationState, wisprTextEditorAvailability],
	);

	if (hasTmuxAttachError) {
		return (
			<TmuxAttachErrorScreen
				failureReason={tmuxAttachFailureReason}
				sessionName={tmuxSessionName ?? 'main'}
				onEdit={() => {
					router.replace({
						pathname: '/',
						params: { editConnectionId: storedConnectionId ?? connectionId },
					});
				}}
			/>
		);
	}

	const shouldRenderTerminal =
		terminal.hasRendered || Boolean(shell && connection);
	const showReconnectOverlay =
		(isAutoConnecting || isReconnecting) && (!shell || !connection);
	const ScrollbackIcon = resolveLucideIcon('ArrowDownToLine');
	if (!shouldRenderTerminal) {
		return isAutoConnecting || isReconnecting ? <RouteSkeleton /> : null;
	}

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
					wisprMode={wisprMode}
					wisprControl={wisprControl}
					{...keyboard.textEntryProps}
					onWisprSetup={handleOpenWisprAutomationSettings}
					onWisprAutoStartChange={handleWisprAutoStartChange}
					onClose={handleCloseTextEntry}
					onWisprFocus={handleWisprTextEntryFocus}
					onValueChange={handleWisprTextEntryValueChange}
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
