import * as Linking from 'expo-linking';
import { usePathname, useRouter } from 'expo-router';
import React from 'react';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { AgentNotificationBridgeManager } from './AgentNotificationBridgeManager';
import { getAutoConnectLaunchActionForUrl } from './auto-connect-launch';
import {
	createAutoConnectReconnectController,
	type AutoConnectReconnectController,
} from './auto-connect-reconnect-controller';
import { attemptSavedEntryWithTailscaleRecovery } from './auto-connect-saved-entry';
import {
	getStoredConnectionId,
	pickLatestConnection,
} from './connection-utils';
import {
	startForegroundService,
	stopForegroundService,
} from './foreground-service';
import {
	canRunAndroidBackgroundWork,
	createForegroundServiceStartCoordinator,
	getForegroundServiceStartRetryDelay,
	getForegroundServiceNotificationMessage,
	shouldPreservePendingWithoutTarget,
	shouldPreserveForegroundServiceForShellDrop,
	shouldRunForegroundService,
	shouldStartForegroundService,
	shouldStopReconnectOnBackground,
	shouldWaitForForegroundServiceCoverage,
	useForegroundServiceRuntimeStore,
} from './foreground-service-runtime';
import { rootLogger } from './logger';
import { connectAndOpenShell } from './query-fns';
import {
	secretsManager,
	type InputConnectionDetails,
	type StoredConnectionDetails,
} from './secrets-manager';
import { extractTmuxAttachFailureReason } from './ssh-error-details';
import { useSshStore } from './ssh-store';
import { tailscaleRecovery } from './tailscale-recovery';
import {
	createTailscaleRecoveryActions,
	type TailscaleRecoveryActions,
} from './tailscale-recovery-actions';
import {
	TailscaleRecoveryBanner,
	type TailscaleRecoveryBannerState,
} from './TailscaleRecoveryBanner';
import { AbortSignalTimeout, queryClient } from './utils';

const logger = rootLogger.extend('AutoConnect');
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000];
const RECONNECT_WINDOW_MS = 2 * 60 * 1_000;
const FOREGROUND_SERVICE_START_RETRY_MS = 5_000;
const FOREGROUND_SERVICE_START_MAX_RETRIES = 5;
const TAILSCALE_RESET_WAIT_FOR_IDLE_MS = 5_000;

type TailscaleRecoveryUiState = TailscaleRecoveryBannerState;

const hiddenTailscaleRecoveryState: TailscaleRecoveryUiState = {
	phase: 'hidden',
};

type AutoConnectState = {
	isAutoConnecting: boolean;
	isReconnecting: boolean;
	setAutoConnecting: (next: boolean) => void;
	setReconnecting: (next: boolean) => void;
};

export const useAutoConnectStore = create<AutoConnectState>((set) => ({
	isAutoConnecting: false,
	isReconnecting: false,
	setAutoConnecting: (next) => set({ isAutoConnecting: next }),
	setReconnecting: (next) => set({ isReconnecting: next }),
}));

const isActiveState = (state: string) => state === 'active';

// Auto-connect only supports key-based connections.
async function resolveKeySecurity(details: StoredConnectionDetails) {
	try {
		const keyEntry = await secretsManager.keys.utils.getPrivateKey(
			details.security.keyId,
		);
		return {
			type: 'key' as const,
			privateKey: keyEntry.value,
		};
	} catch (error) {
		logger.info('Auto-connect skipped, key missing', error);
		return null;
	}
}

export function AutoConnectManager() {
	const router = useRouter();
	const pathname = usePathname();
	const connect = useSshStore((s) => s.connect);
	const shells = useSshStore(useShallow((s) => Object.values(s.shells)));
	const connections = useSshStore((s) => s.connections);
	const foregroundServiceStarted = useForegroundServiceRuntimeStore(
		(s) => s.started,
	);
	const latestShell = React.useMemo(() => {
		if (shells.length === 0) return null;
		return shells.reduce((latest, shell) =>
			shell.createdAtMs > latest.createdAtMs ? shell : latest,
		);
	}, [shells]);

	const {
		isAutoConnecting,
		isReconnecting,
		setAutoConnecting,
		setReconnecting,
	} = useAutoConnectStore(
		useShallow((s) => ({
			isAutoConnecting: s.isAutoConnecting,
			isReconnecting: s.isReconnecting,
			setAutoConnecting: s.setAutoConnecting,
			setReconnecting: s.setReconnecting,
		})),
	);

	const inFlightRef = React.useRef(false);
	const foregroundStartRetryTimerRef = React.useRef<ReturnType<
		typeof setTimeout
	> | null>(null);
	const foregroundStartFailureCountRef = React.useRef(0);
	const [foregroundStartRetryNonce, setForegroundStartRetryNonce] =
		React.useState(0);
	const attemptAutoConnectRef = React.useRef<(() => Promise<boolean>) | null>(
		null,
	);
	const reconnectControllerRef =
		React.useRef<AutoConnectReconnectController | null>(null);
	const prevShellCountRef = React.useRef(shells.length);
	const isActiveRef = React.useRef(isActiveState(AppState.currentState));
	const foregroundKeyRef = React.useRef<string | null>(null);
	const foregroundStartCoordinatorRef = React.useRef(
		createForegroundServiceStartCoordinator(),
	);
	const allowBackgroundRef = React.useRef(false);
	const didInitRef = React.useRef(false);
	const launchUrlSuppressAutoConnectRef = React.useRef(false);
	const tailscaleRecoveryActionsRef =
		React.useRef<TailscaleRecoveryActions | null>(null);
	const [tailscaleRecoveryUiState, setTailscaleRecoveryUiState] =
		React.useState<TailscaleRecoveryUiState>(hiddenTailscaleRecoveryState);
	const clearTailscaleAttentionState = React.useCallback(() => {
		setTailscaleRecoveryUiState(hiddenTailscaleRecoveryState);
	}, []);
	const markTailscaleAttentionState = React.useCallback((message: string) => {
		setTailscaleRecoveryUiState({ phase: 'needsAttention', message });
	}, []);
	const clearTailscaleAttention = React.useCallback(() => {
		tailscaleRecoveryActionsRef.current?.attention.clear();
	}, []);
	const markTailscaleAttention = React.useCallback((message: string) => {
		tailscaleRecoveryActionsRef.current?.attention.mark(message);
	}, []);

	const setForegroundServiceStarted = React.useCallback((started: boolean) => {
		useForegroundServiceRuntimeStore.getState().setStarted(started);
		allowBackgroundRef.current = canRunAndroidBackgroundWork({
			platformOS: Platform.OS,
			foregroundServiceStarted: started,
		});
	}, []);

	const reconnectExpectedFromShellDrop = shouldPreservePendingWithoutTarget({
		previousShellCount: prevShellCountRef.current,
		shellCount: shells.length,
		appActive: isActiveRef.current,
		androidBackgroundWorkAllowed:
			Platform.OS === 'android' && allowBackgroundRef.current,
		isReconnecting,
	});

	const clearForegroundStartRetryTimer = React.useCallback(() => {
		if (foregroundStartRetryTimerRef.current) {
			clearTimeout(foregroundStartRetryTimerRef.current);
			foregroundStartRetryTimerRef.current = null;
		}
	}, []);

	const stopReconnectCycle = React.useCallback((reason: string) => {
		reconnectControllerRef.current?.stop(reason);
	}, []);

	const waitForAutoConnectIdle = React.useCallback(async () => {
		const deadlineMs = Date.now() + TAILSCALE_RESET_WAIT_FOR_IDLE_MS;
		while (inFlightRef.current && Date.now() < deadlineMs) {
			await new Promise<void>((resolve) => {
				setTimeout(resolve, 50);
			});
		}
		return !inFlightRef.current;
	}, []);

	if (tailscaleRecoveryActionsRef.current === null) {
		tailscaleRecoveryActionsRef.current = createTailscaleRecoveryActions({
			recovery: tailscaleRecovery,
			waitForAutoConnectIdle,
			reconnect: {
				stop: (reason) => {
					reconnectControllerRef.current?.stop(reason);
				},
				replace: (reason) =>
					reconnectControllerRef.current?.replace(reason) ?? false,
			},
			attention: {
				clear: clearTailscaleAttentionState,
				mark: markTailscaleAttentionState,
				recovering: (message) => {
					setTailscaleRecoveryUiState({
						phase: 'recovering',
						message,
					});
				},
			},
			logger,
		});
	}

	React.useEffect(() => {
		if (Platform.OS !== 'android') return;
		const syncBackgroundAllowance = (started: boolean) => {
			allowBackgroundRef.current = canRunAndroidBackgroundWork({
				platformOS: Platform.OS,
				foregroundServiceStarted: started,
			});
			if (
				shouldWaitForForegroundServiceCoverage({
					platformOS: Platform.OS,
					appActive: isActiveRef.current,
					backgroundWorkAllowed: allowBackgroundRef.current,
					foregroundServiceRequired: shouldRunForegroundService({
						shellCount: useSshStore.getState().shells
							? Object.keys(useSshStore.getState().shells).length
							: 0,
						isAutoConnecting: useAutoConnectStore.getState().isAutoConnecting,
						isReconnecting: useAutoConnectStore.getState().isReconnecting,
					}),
				})
			) {
				return;
			}
			if (!allowBackgroundRef.current && !isActiveRef.current) {
				stopReconnectCycle('foreground-service-stopped');
			}
		};
		syncBackgroundAllowance(
			useForegroundServiceRuntimeStore.getState().started,
		);
		return useForegroundServiceRuntimeStore.subscribe((state) => {
			syncBackgroundAllowance(state.started);
		});
	}, [stopReconnectCycle]);

	// Always replace to avoid stacking repeated resumes in history.
	const navigateToShell = React.useCallback(
		(connectionId: string, channelId: number) => {
			router.replace({
				pathname: '/shell/detail',
				params: { connectionId, channelId },
			});
		},
		[router],
	);

	const applyLaunchUrlAction = React.useCallback(
		(url: string | null) => {
			const action = getAutoConnectLaunchActionForUrl(url);
			if (!action.skipAutoConnect && !action.routeToConnectionForm) {
				return false;
			}
			if (action.skipAutoConnect) {
				launchUrlSuppressAutoConnectRef.current = true;
				stopReconnectCycle('launch-url-disabled-auto-connect');
			}
			if (action.routeToConnectionForm) {
				router.replace('/(tabs)');
			}
			return action.skipAutoConnect;
		},
		[router, stopReconnectCycle],
	);

	const loadLatestSavedConnection = React.useCallback(async () => {
		const entries = await queryClient.fetchQuery(
			secretsManager.connections.query.list,
		);
		const eligible = entries?.filter((entry) => entry.value.autoConnect);
		return pickLatestConnection(eligible);
	}, []);

	// Single attempt: use an active shell if present; otherwise connect silently.
	const attemptAutoConnect = React.useCallback(async () => {
		if (launchUrlSuppressAutoConnectRef.current) return false;
		if (inFlightRef.current) return false;
		inFlightRef.current = true;
		setAutoConnecting(true);

		try {
			if (latestShell) {
				// Avoid re-mounting the terminal if we're already on the detail screen.
				if (pathname !== '/shell/detail') {
					navigateToShell(latestShell.connectionId, latestShell.channelId);
				}
				return true;
			}

			const activeConnections = Object.values(connections);
			if (activeConnections.length > 0) {
				const activeConnection = activeConnections.reduce((latest, current) =>
					current.connectedAtMs > latest.connectedAtMs ? current : latest,
				);
				const storedConnectionId = getStoredConnectionId(
					activeConnection.connectionDetails,
				);
				let useTmux = true;
				let tmuxSessionName = 'main';
				try {
					const entry = await queryClient.fetchQuery(
						secretsManager.connections.query.get(storedConnectionId),
					);
					if (entry?.value) {
						useTmux = entry.value.useTmux ?? true;
						tmuxSessionName = entry.value.tmuxSessionName?.trim() || 'main';
					}
				} catch (error) {
					logger.warn(
						'Failed to load tmux settings for active connection',
						error,
					);
				}

				try {
					const shellHandle = await activeConnection.startShell({
						term: 'Xterm',
						useTmux,
						tmuxSessionName,
						abortSignal: AbortSignalTimeout(5_000),
					});
					logger.info('Reconnected by reopening shell on active connection', {
						connectionId: activeConnection.connectionId,
						channelId: shellHandle.channelId,
					});
					navigateToShell(activeConnection.connectionId, shellHandle.channelId);
					return true;
				} catch (error) {
					const tmuxAttachFailureReason = extractTmuxAttachFailureReason(error);
					if (tmuxAttachFailureReason !== null) {
						logger.info(
							'Tmux attach failed while reopening shell on active connection',
							{
								connectionId: activeConnection.connectionId,
								tmuxAttachFailureReason,
								tmuxSessionName,
							},
						);
					} else {
						logger.warn('Failed to reopen shell on active connection', error);
					}
				}
			}

			const latestEntry = await loadLatestSavedConnection();
			if (!latestEntry) return false;

			const details = latestEntry.value;
			if (
				typeof details.useTmux !== 'boolean' ||
				typeof details.tmuxSessionName !== 'string'
			) {
				return false;
			}
			const normalizedDetails: InputConnectionDetails = {
				...details,
				useTmux: details.useTmux,
				tmuxSessionName: details.tmuxSessionName,
				autoConnect: details.autoConnect ?? false,
			};
			const resolvedSecurity = await resolveKeySecurity(details);
			if (!resolvedSecurity) return false;

			const connectSavedEntry = () =>
				connectAndOpenShell({
					connectionDetails: normalizedDetails,
					resolvedSecurity,
					connect,
					navigate: ({ connectionId, channelId }) => {
						navigateToShell(connectionId, channelId);
					},
				});
			const logTmuxAttachFailure = (
				result: Extract<
					Awaited<ReturnType<typeof connectSavedEntry>>,
					{ status: 'tmux_attach_failed' }
				>,
			) => {
				logger.info('Auto-connect tmux attach failed, will retry', {
					connectionId: result.connectionId,
					tmuxAttachFailureReason: result.tmuxAttachFailureReason,
					tmuxSessionName: result.tmuxSessionName,
				});
			};

			const result = await attemptSavedEntryWithTailscaleRecovery({
				platformOS: Platform.OS,
				recovery: tailscaleRecovery,
				connectSavedEntry,
				markTailscaleAttention,
				clearTailscaleAttention,
				logTmuxAttachFailure,
				logWarning: (message, error) => {
					logger.warn(message, error);
				},
			});
			return result.connected;
		} catch (error) {
			logger.warn('Auto-connect attempt failed', error);
			return false;
		} finally {
			setAutoConnecting(false);
			inFlightRef.current = false;
		}
	}, [
		connect,
		connections,
		clearTailscaleAttention,
		latestShell,
		loadLatestSavedConnection,
		markTailscaleAttention,
		navigateToShell,
		pathname,
		setAutoConnecting,
	]);
	attemptAutoConnectRef.current = attemptAutoConnect;

	if (reconnectControllerRef.current === null) {
		reconnectControllerRef.current = createAutoConnectReconnectController({
			delaysMs: RECONNECT_DELAYS_MS,
			windowMs: RECONNECT_WINDOW_MS,
			now: () => Date.now(),
			setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
			clearTimeout: (timer) => {
				clearTimeout(timer as ReturnType<typeof setTimeout>);
			},
			getSnapshot: () => {
				const autoState = useAutoConnectStore.getState();
				const shellCount = useSshStore.getState().shells
					? Object.keys(useSshStore.getState().shells).length
					: 0;
				return {
					isAutoConnecting: autoState.isAutoConnecting,
					isReconnecting: autoState.isReconnecting,
					resetInFlight:
						tailscaleRecoveryActionsRef.current?.isResetInFlight() ?? false,
					platformOS: Platform.OS,
					appActive: isActiveRef.current,
					backgroundWorkAllowed: allowBackgroundRef.current,
					foregroundServiceRequired: shouldRunForegroundService({
						shellCount,
						isAutoConnecting: autoState.isAutoConnecting,
						isReconnecting: autoState.isReconnecting,
					}),
				};
			},
			setReconnecting,
			attemptAutoConnect: async () =>
				(await attemptAutoConnectRef.current?.()) ?? false,
			logger,
		});
	}

	const runAutoConnectOnce = React.useCallback(async () => {
		if (launchUrlSuppressAutoConnectRef.current) return;
		if (
			!isActiveRef.current &&
			!(Platform.OS === 'android' && allowBackgroundRef.current)
		)
			return;
		const autoState = useAutoConnectStore.getState();
		if (autoState.isAutoConnecting || autoState.isReconnecting) return;
		await attemptAutoConnect();
	}, [attemptAutoConnect]);

	const scheduleReconnect = React.useCallback(
		(reason: string, opts?: { replaceExisting?: boolean }) => {
			const controller = reconnectControllerRef.current;
			if (!controller) return false;
			if (opts?.replaceExisting === true) {
				return controller.replace(reason);
			}
			return controller.start(reason);
		},
		[],
	);

	React.useEffect(() => {
		if (Platform.OS !== 'android') return;
		const shouldRunService = shouldRunForegroundService({
			shellCount: shells.length,
			isAutoConnecting,
			isReconnecting,
		});

		if (!shouldRunService) {
			if (
				shouldPreserveForegroundServiceForShellDrop({
					platformOS: Platform.OS,
					appActive: isActiveRef.current,
					backgroundWorkAllowed: allowBackgroundRef.current,
					previousShellCount: prevShellCountRef.current,
					nextShellCount: shells.length,
					isAutoConnecting,
					isReconnecting,
				})
			) {
				return;
			}
			foregroundStartCoordinatorRef.current.invalidate();
			clearForegroundStartRetryTimer();
			foregroundStartFailureCountRef.current = 0;
			setForegroundServiceStarted(false);
			if (foregroundKeyRef.current !== null) {
				foregroundKeyRef.current = null;
				void stopForegroundService();
			}
			return;
		}

		const connection = latestShell
			? connections[latestShell.connectionId]
			: undefined;
		const title = 'Fressh Terminal';
		const message = getForegroundServiceNotificationMessage({
			hasConnection: connection !== undefined,
			isAutoConnecting,
			isReconnecting,
		});
		const nextKey = `${title}|${message}`;
		const currentForegroundKey = foregroundKeyRef.current;
		if (
			!shouldStartForegroundService({
				currentKey: currentForegroundKey,
				nextKey,
				foregroundServiceStarted,
			})
		) {
			return;
		}
		if (currentForegroundKey !== nextKey) {
			foregroundStartFailureCountRef.current = 0;
		}
		clearForegroundStartRetryTimer();
		foregroundKeyRef.current = nextKey;
		const request = foregroundStartCoordinatorRef.current.begin(nextKey);
		void startForegroundService({ title, message }).then((started) => {
			if (
				!foregroundStartCoordinatorRef.current.isCurrent(
					request,
					foregroundKeyRef.current,
				)
			) {
				return;
			}
			setForegroundServiceStarted(started);
			if (started) {
				foregroundStartFailureCountRef.current = 0;
				return;
			}
			if (!started) {
				foregroundKeyRef.current = null;
				const retryDelayMs = getForegroundServiceStartRetryDelay({
					shouldRunService: shouldRunForegroundService({
						shellCount: useSshStore.getState().shells
							? Object.keys(useSshStore.getState().shells).length
							: 0,
						isAutoConnecting: useAutoConnectStore.getState().isAutoConnecting,
						isReconnecting: useAutoConnectStore.getState().isReconnecting,
					}),
					failedAttempts: foregroundStartFailureCountRef.current,
					maxAttempts: FOREGROUND_SERVICE_START_MAX_RETRIES,
					retryDelayMs: FOREGROUND_SERVICE_START_RETRY_MS,
				});
				foregroundStartFailureCountRef.current += 1;
				if (retryDelayMs !== null) {
					// eslint-disable-next-line @eslint-react/web-api/no-leaked-timeout -- timer is tracked on a ref and cleared by clearForegroundStartRetryTimer in the effect cleanup and on unmount
					foregroundStartRetryTimerRef.current = setTimeout(() => {
						foregroundStartRetryTimerRef.current = null;
						setForegroundStartRetryNonce((value) => value + 1);
					}, retryDelayMs);
				}
				if (!isActiveRef.current) {
					stopReconnectCycle('foreground-service-unavailable');
				}
			}
		});
		return () => {
			clearForegroundStartRetryTimer();
		};
	}, [
		connections,
		foregroundServiceStarted,
		foregroundStartRetryNonce,
		isAutoConnecting,
		isReconnecting,
		latestShell,
		clearForegroundStartRetryTimer,
		setForegroundServiceStarted,
		shells.length,
		stopReconnectCycle,
	]);

	React.useEffect(() => {
		const foregroundStartCoordinator = foregroundStartCoordinatorRef.current;
		return () => {
			if (Platform.OS !== 'android') return;
			foregroundStartCoordinator.invalidate();
			clearForegroundStartRetryTimer();
			setForegroundServiceStarted(false);
			void stopForegroundService();
		};
	}, [clearForegroundStartRetryTimer, setForegroundServiceStarted]);

	React.useEffect(() => {
		if (didInitRef.current) return;
		didInitRef.current = true;
		void Linking.getInitialURL()
			.catch((error: unknown) => {
				logger.warn('Failed to read initial URL for auto-connect', error);
				return null;
			})
			.then((initialUrl) => {
				if (applyLaunchUrlAction(initialUrl)) {
					logger.info('Initial auto-connect skipped by launch URL');
					return;
				}
				void runAutoConnectOnce();
			});
	}, [applyLaunchUrlAction, runAutoConnectOnce]);

	React.useEffect(() => {
		// eslint-disable-next-line @eslint-react/web-api/no-leaked-event-listener -- Expo Linking returns a subscription removed by the cleanup below
		const subscription = Linking.addEventListener('url', ({ url }) => {
			if (applyLaunchUrlAction(url)) {
				logger.info('Warm auto-connect skipped by launch URL');
			}
		});
		return () => {
			subscription.remove();
		};
	}, [applyLaunchUrlAction]);

	React.useEffect(() => {
		// Trigger on warm resumes; pause retries when backgrounded.
		// eslint-disable-next-line @eslint-react/web-api/no-leaked-event-listener -- React Native AppState cleans up via subscription.remove()
		const subscription = AppState.addEventListener('change', (nextState) => {
			const wasActive = isActiveRef.current;
			isActiveRef.current = isActiveState(nextState);

			if (wasActive && !isActiveRef.current) {
				if (
					shouldStopReconnectOnBackground({
						platformOS: Platform.OS,
						backgroundWorkAllowed: allowBackgroundRef.current,
					})
				) {
					stopReconnectCycle('app-backgrounded');
				}
				return;
			}
			if (!wasActive && isActiveRef.current) {
				if (shells.length === 0) {
					scheduleReconnect('app-resume-no-shell');
				} else {
					void runAutoConnectOnce();
				}
			}
		});

		return () => {
			subscription.remove();
		};
	}, [
		runAutoConnectOnce,
		scheduleReconnect,
		stopReconnectCycle,
		shells.length,
	]);

	React.useEffect(() => {
		// Detect a shell drop and kick off a reconnect cycle.
		if (
			!isActiveRef.current &&
			!(Platform.OS === 'android' && allowBackgroundRef.current)
		) {
			prevShellCountRef.current = shells.length;
			return;
		}
		if (prevShellCountRef.current > 0 && shells.length === 0) {
			scheduleReconnect('shell-drop');
		}
		prevShellCountRef.current = shells.length;
	}, [scheduleReconnect, shells.length]);

	const handleOpenTailscale = React.useCallback(() => {
		void tailscaleRecoveryActionsRef.current?.open();
	}, []);

	const handleRetryAfterTailscaleRecovery = React.useCallback(() => {
		tailscaleRecoveryActionsRef.current?.retry();
	}, []);

	const handleResetTailscale = React.useCallback(() => {
		void tailscaleRecoveryActionsRef.current?.reset();
	}, []);

	return (
		<>
			<AgentNotificationBridgeManager
				preservePendingWithoutTarget={reconnectExpectedFromShellDrop}
			/>
			<TailscaleRecoveryBanner
				state={tailscaleRecoveryUiState}
				onOpenTailscale={handleOpenTailscale}
				onRetry={handleRetryAfterTailscaleRecovery}
				onReset={handleResetTailscale}
			/>
		</>
	);
}
