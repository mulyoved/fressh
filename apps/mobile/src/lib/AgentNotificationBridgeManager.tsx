import React from 'react';
import { AppState, Platform } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import {
	AgentNotificationBridgeStateMachine,
	HEARTBEAT_STALE_MS,
} from './agent-notification-bridge';
import { handleAgentNotificationListenerLine } from './agent-notification-bridge-runtime';
import {
	type AgentNotificationEvent,
	AgentNotificationDedupe,
	buildAgentNotificationListenCommand,
	matchesAgentNotificationPendingKey,
	shouldAdvanceAgentNotificationCursorAfterPost,
	shouldRestartAgentNotificationListenerAfterPost,
} from './agent-notification-events';
import {
	canRunAgentNotificationBridge,
	createAgentNotificationRestartCoordinator,
	getNextConfiguredResumeKey,
	shouldClearPendingAgentNotifications,
	shouldClearPendingAgentNotificationsForResumeKeyChange,
	shouldPreservePendingWithoutConfiguredTarget,
	useForegroundServiceRuntimeStore,
} from './agent-notification-runtime';
import { notifyAgentNotificationPending } from './agent-notification-visibility';
import {
	cancelAgentAlertNotification,
	postAgentAlertNotification,
} from './agent-notifications-native';
import { getStoredConnectionId } from './connection-utils';
import { isForegroundServiceRunning } from './foreground-service';
import { rootLogger } from './logger';
import { secretsManager } from './secrets-manager';
import {
	type SshJsonlListenerHandle,
	startSshJsonlListener,
} from './ssh-jsonl-listener';
import { useSshStore } from './ssh-store';
import { queryClient } from './utils';

const logger = rootLogger.extend('AgentNotificationBridge');
const RESTART_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
export const AGENT_NOTIFICATION_MAX_RESTART_ATTEMPTS = 6;
export const AGENT_NOTIFICATION_HEALTHY_RESTART_RESET_MS =
	HEARTBEAT_STALE_MS * 2;
const FOREGROUND_SERVICE_HEALTH_CHECK_MS = HEARTBEAT_STALE_MS;
const isActiveState = (state: string) => state === 'active';

type ListenerTarget = {
	key: string;
	resumeKey: string;
	shellKey: string;
	channelId: number;
	connection: NonNullable<
		ReturnType<typeof useSshStore.getState>['connections'][string]
	>;
	notificationConnectionId: string;
	session: string;
};

type SessionSettings = {
	loaded: boolean;
	useTmux: boolean;
	session: string;
};

export function AgentNotificationBridgeManager({
	preservePendingWithoutTarget = false,
}: {
	preservePendingWithoutTarget?: boolean;
} = {}) {
	const { shells, connections } = useSshStore(
		useShallow((s) => ({
			shells: s.shells,
			connections: s.connections,
		})),
	);
	const foregroundServiceStarted = useForegroundServiceRuntimeStore(
		(s) => s.started,
	);
	const bridgeRef = React.useRef(new AgentNotificationBridgeStateMachine());
	const dedupeRef = React.useRef(new AgentNotificationDedupe());
	const listenerRef = React.useRef<SshJsonlListenerHandle | null>(null);
	const restartTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const heartbeatTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(
		null,
	);
	const restartCoordinatorRef = React.useRef(
		createAgentNotificationRestartCoordinator({
			maxAttempts: AGENT_NOTIFICATION_MAX_RESTART_ATTEMPTS,
			delaysMs: RESTART_DELAYS_MS,
			healthyResetMs: AGENT_NOTIFICATION_HEALTHY_RESTART_RESET_MS,
		}),
	);
	const listenerStartedAtMsRef = React.useRef<number | null>(null);
	const listenerStartingRef = React.useRef(false);
	const startQueuedRef = React.useRef(false);
	const generationRef = React.useRef(0);
	const targetRef = React.useRef<ListenerTarget | null>(null);
	const startListenerRef = React.useRef<(() => Promise<void>) | null>(null);
	const lastSeenIdByTargetRef = React.useRef(new Map<string, string>());
	const previousTargetKeyRef = React.useRef<string | null>(null);
	const previousConfiguredResumeKeyRef = React.useRef<string | null>(null);
	const [settingsByConnectionId, setSettingsByConnectionId] = React.useState<
		Record<string, SessionSettings>
	>({});
	const [appActive, setAppActive] = React.useState(() =>
		isActiveState(AppState.currentState),
	);
	const runtimeAllowed = canRunAgentNotificationBridge({
		platformOS: Platform.OS,
		appActive,
		foregroundServiceStarted,
	});

	const latestShellEntry = React.useMemo(() => {
		const entries = Object.entries(shells);
		if (entries.length === 0) return null;

		const latestEntry = entries.reduce((latest, current) =>
			current[1].createdAtMs > latest[1].createdAtMs ? current : latest,
		);
		return { key: latestEntry[0], shell: latestEntry[1] };
	}, [shells]);

	const latestShell = latestShellEntry?.shell ?? null;
	const latestShellKey = latestShellEntry?.key ?? null;
	const connection = latestShell
		? connections[latestShell.connectionId]
		: undefined;
	const settings = connection
		? settingsByConnectionId[connection.connectionId]
		: undefined;
	const session = settings?.session ?? 'main';
	const configuredTarget = React.useMemo<ListenerTarget | null>(() => {
		if (!connection || !latestShell || !latestShellKey) return null;
		if (!settings?.loaded || !settings.useTmux) return null;
		const notificationConnectionId = getStoredConnectionId(
			connection.connectionDetails,
		);
		return {
			key: `${connection.connectionId}:${latestShellKey}:${session}`,
			resumeKey: `${notificationConnectionId}:${session}`,
			shellKey: latestShellKey,
			channelId: latestShell.channelId,
			connection,
			notificationConnectionId,
			session,
		};
	}, [connection, latestShell, latestShellKey, session, settings]);
	const target = runtimeAllowed ? configuredTarget : null;

	React.useEffect(() => {
		if (Platform.OS !== 'android') return;
		// eslint-disable-next-line @eslint-react/web-api/no-leaked-event-listener -- React Native AppState cleans up via subscription.remove()
		const subscription = AppState.addEventListener('change', (nextState) => {
			setAppActive(isActiveState(nextState));
		});
		return () => {
			subscription.remove();
		};
	}, []);

	React.useEffect(() => {
		if (Platform.OS !== 'android' || !foregroundServiceStarted) return;
		let cancelled = false;
		const checkRunning = () => {
			void isForegroundServiceRunning().then((running) => {
				if (cancelled || running) return;
				logger.warn('foreground service stopped unexpectedly');
				useForegroundServiceRuntimeStore.getState().setStarted(false);
			});
		};
		const timer = setInterval(checkRunning, FOREGROUND_SERVICE_HEALTH_CHECK_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [foregroundServiceStarted]);

	React.useEffect(() => {
		if (Platform.OS !== 'android') return;
		if (!connection) return;
		let cancelled = false;
		const connectionId = connection.connectionId;

		void queryClient
			.fetchQuery(
				secretsManager.connections.query.get(
					getStoredConnectionId(connection.connectionDetails),
				),
			)
			.then((entry) => {
				if (cancelled) return;
				const useTmux = entry?.value.useTmux ?? true;
				const nextSession = entry?.value.tmuxSessionName?.trim() || 'main';
				setSettingsByConnectionId((current) => {
					const existing = current[connectionId];
					if (
						existing?.loaded &&
						existing.useTmux === useTmux &&
						existing.session === nextSession
					) {
						return current;
					}
					return {
						...current,
						[connectionId]: {
							loaded: true,
							useTmux,
							session: nextSession,
						},
					};
				});
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				logger.warn('failed to load agent notification tmux session', error);
				setSettingsByConnectionId((current) => {
					const existing = current[connectionId];
					if (existing?.loaded) return current;
					return {
						...current,
						[connectionId]: {
							loaded: true,
							useTmux: true,
							session: 'main',
						},
					};
				});
			});

		return () => {
			cancelled = true;
		};
	}, [connection]);

	const clearRestartTimer = React.useCallback(() => {
		if (!restartTimerRef.current) return;
		clearTimeout(restartTimerRef.current);
		restartTimerRef.current = null;
	}, []);

	const clearHeartbeatTimer = React.useCallback(() => {
		if (!heartbeatTimerRef.current) return;
		clearInterval(heartbeatTimerRef.current);
		heartbeatTimerRef.current = null;
	}, []);

	const stopListener = React.useCallback(async () => {
		generationRef.current += 1;
		clearHeartbeatTimer();
		listenerStartedAtMsRef.current = null;
		const listener = listenerRef.current;
		listenerRef.current = null;
		if (listener) await listener.stop();
	}, [clearHeartbeatTimer]);

	const stopAll = React.useCallback(async () => {
		startQueuedRef.current = false;
		clearRestartTimer();
		await stopListener();
	}, [clearRestartTimer, stopListener]);

	const clearPendingNotifications = React.useCallback(() => {
		const notificationIds = dedupeRef.current.clear();
		for (const notificationId of notificationIds) {
			void cancelAgentAlertNotification(notificationId);
		}
	}, []);

	const scheduleRestart = React.useCallback(
		(reason: string) => {
			if (Platform.OS !== 'android') return;
			if (!targetRef.current) return;
			if (restartTimerRef.current) return;

			const restart = restartCoordinatorRef.current.consume();
			if (!restart) {
				logger.warn('agent notification listener restart budget exhausted', {
					reason,
					attempt: restartCoordinatorRef.current.attempts,
				});
				return;
			}
			clearHeartbeatTimer();
			logger.info('agent notification listener restart scheduled', {
				reason,
				delayMs: restart.delayMs,
			});
			restartTimerRef.current = setTimeout(() => {
				restartTimerRef.current = null;
				void stopListener().then(() => startListenerRef.current?.());
			}, restart.delayMs);
		},
		[clearHeartbeatTimer, stopListener],
	);

	const handleStaleHeartbeat = React.useCallback(
		(targetKey: string) => {
			if (targetRef.current?.key !== targetKey) return;

			const nowMs = Date.now();
			const state = bridgeRef.current.state;
			if (state.status === 'starting') {
				if (
					listenerStartedAtMsRef.current !== null &&
					nowMs - listenerStartedAtMsRef.current >= HEARTBEAT_STALE_MS
				) {
					bridgeRef.current.markDegraded();
				}
			} else if (
				state.lastHeartbeatAtMs === null &&
				listenerStartedAtMsRef.current !== null &&
				nowMs - listenerStartedAtMsRef.current >= HEARTBEAT_STALE_MS
			) {
				bridgeRef.current.markDegraded();
			} else {
				bridgeRef.current.checkHeartbeat(nowMs);
			}

			if (bridgeRef.current.state.status !== 'degraded') return;
			logger.warn('agent notification heartbeat stale');
			scheduleRestart('heartbeat-stale');
		},
		[scheduleRestart],
	);

	const postPendingNotification = React.useCallback(
		(input: {
			key: string;
			notificationId: number;
			event: AgentNotificationEvent;
			targetKey: string;
			connectionId: string;
			channelId: number;
			notificationConnectionId: string;
			onPosted?: (posted: boolean) => void;
		}) => {
			const {
				key,
				notificationId,
				event,
				targetKey,
				connectionId,
				channelId,
				notificationConnectionId,
				onPosted,
			} = input;
			const attemptId = dedupeRef.current.beginPost(key, event.id);
			if (attemptId === null) return;
			void postAgentAlertNotification({
				notificationId,
				title: event.status === 'waiting' ? 'Agent waiting' : 'Agent done',
				message: `${event.windowName || event.target} needs attention`,
				connectionId,
				channelId,
				notificationConnectionId,
				session: event.session,
				target: event.target,
				windowId: event.windowId,
				eventId: event.id,
			}).then((posted) => {
				const result = dedupeRef.current.completePost(
					key,
					event.id,
					attemptId,
					posted,
				);
				const currentPending = dedupeRef.current.getPendingEvent(key);
				onPosted?.(
					shouldAdvanceAgentNotificationCursorAfterPost({
						posted,
						completion: result,
						currentEventId: currentPending?.event.id ?? null,
						eventId: event.id,
					}),
				);
				const postWithCurrentTarget = (current: {
					key: string;
					notificationId: number;
					event: AgentNotificationEvent;
				}) => {
					const currentTarget = targetRef.current;
					if (!currentTarget) return;
					if (
						!matchesAgentNotificationPendingKey(current.key, {
							connectionId: currentTarget.notificationConnectionId,
							session: current.event.session,
							windowId: current.event.windowId,
						})
					) {
						return;
					}
					postPendingNotification({
						...current,
						targetKey: currentTarget.key,
						connectionId: currentTarget.connection.connectionId,
						channelId: currentTarget.channelId,
						notificationConnectionId: currentTarget.notificationConnectionId,
					});
				};
				if (result.type === 'cancel-posted') {
					void cancelAgentAlertNotification(result.notificationId);
					return;
				}
				if (shouldRestartAgentNotificationListenerAfterPost(result)) {
					scheduleRestart('notification-post-failure');
					return;
				}
				const current =
					result.type === 'superseded' && posted
						? result.current
						: posted && targetRef.current?.key !== targetKey
							? dedupeRef.current.getPendingEvent(key)
							: null;
				if (current) {
					postWithCurrentTarget(current);
				}
			});
		},
		[scheduleRestart],
	);

	const startListener = React.useCallback(async () => {
		const activeTarget = targetRef.current;
		if (Platform.OS !== 'android' || !activeTarget) return;
		if (listenerRef.current) return;
		if (listenerStartingRef.current) {
			startQueuedRef.current = true;
			return;
		}

		clearRestartTimer();
		listenerStartingRef.current = true;
		startQueuedRef.current = false;
		const generation = generationRef.current;
		bridgeRef.current.markStarting();
		let exitedBeforeReady = false;

		try {
			const command = buildAgentNotificationListenCommand(
				activeTarget.session,
				lastSeenIdByTargetRef.current.get(activeTarget.resumeKey),
			);
			const listener = await startSshJsonlListener({
				connection: activeTarget.connection,
				command,
				onLine: (line) => {
					handleAgentNotificationListenerLine({
						line,
						activeTarget: {
							key: activeTarget.key,
							resumeKey: activeTarget.resumeKey,
							connectionId: activeTarget.connection.connectionId,
							channelId: activeTarget.channelId,
							notificationConnectionId: activeTarget.notificationConnectionId,
						},
						currentTargetKey: targetRef.current?.key ?? null,
						nowMs: Date.now(),
						bridge: bridgeRef.current,
						lastSeenIdByTarget: lastSeenIdByTargetRef.current,
						dedupe: dedupeRef.current,
						notifyPending: notifyAgentNotificationPending,
						postPendingNotification,
						onHeartbeat: () => {
							restartCoordinatorRef.current.resetIfHealthy({
								nowMs: Date.now(),
								startedAtMs: listenerStartedAtMsRef.current,
							});
						},
						warn: (message, context) => {
							logger.warn(message, context);
						},
					});
				},
				onExit: (error) => {
					if (targetRef.current?.key !== activeTarget.key) return;
					exitedBeforeReady = true;
					logger.warn('agent notification listener exited', error);
					listenerRef.current = null;
					listenerStartedAtMsRef.current = null;
					bridgeRef.current.markDegraded();
					scheduleRestart('listener-exit');
				},
			});

			if (
				generationRef.current !== generation ||
				targetRef.current?.key !== activeTarget.key ||
				exitedBeforeReady
			) {
				await listener.stop();
				return;
			}

			listenerRef.current = listener;
			listenerStartedAtMsRef.current = Date.now();
			clearHeartbeatTimer();
			heartbeatTimerRef.current = setInterval(() => {
				handleStaleHeartbeat(activeTarget.key);
			}, HEARTBEAT_STALE_MS);
		} catch (error) {
			if (targetRef.current?.key !== activeTarget.key) return;
			logger.warn('failed to start agent notification listener', error);
			bridgeRef.current.markDegraded();
			scheduleRestart('startup-failure');
		} finally {
			listenerStartingRef.current = false;
			if (startQueuedRef.current && targetRef.current && !listenerRef.current) {
				startQueuedRef.current = false;
				void startListenerRef.current?.();
			}
		}
	}, [
		clearHeartbeatTimer,
		clearRestartTimer,
		handleStaleHeartbeat,
		postPendingNotification,
		scheduleRestart,
	]);

	React.useEffect(() => {
		startListenerRef.current = startListener;
		return () => {
			if (startListenerRef.current === startListener) {
				startListenerRef.current = null;
			}
		};
	}, [startListener]);

	React.useEffect(() => {
		targetRef.current = target;
		const configuredResumeKey = configuredTarget?.resumeKey ?? null;
		const preservePendingWithoutConfiguredTarget =
			shouldPreservePendingWithoutConfiguredTarget({
				reconnectExpected: preservePendingWithoutTarget,
				hasShell: latestShell !== null,
				hasConnection: connection !== undefined,
				settingsLoaded: settings?.loaded === true,
			});
		if (
			shouldClearPendingAgentNotificationsForResumeKeyChange({
				previousResumeKey: previousConfiguredResumeKeyRef.current,
				nextResumeKey: configuredResumeKey,
				reconnectExpected: preservePendingWithoutConfiguredTarget,
			})
		) {
			clearPendingNotifications();
		}
		previousConfiguredResumeKeyRef.current = getNextConfiguredResumeKey({
			previousResumeKey: previousConfiguredResumeKeyRef.current,
			nextResumeKey: configuredResumeKey,
			reconnectExpected: preservePendingWithoutConfiguredTarget,
		});
		if (target?.key !== previousTargetKeyRef.current) {
			if (target) {
				for (const pending of dedupeRef.current.getPendingEvents()) {
					postPendingNotification({
						...pending,
						targetKey: target.key,
						connectionId: target.connection.connectionId,
						channelId: target.channelId,
						notificationConnectionId: target.notificationConnectionId,
					});
				}
			}
			restartCoordinatorRef.current.reset();
			previousTargetKeyRef.current = target?.key ?? null;
		}

		if (Platform.OS !== 'android') return;
		if (!target) {
			if (
				shouldClearPendingAgentNotifications({
					hasListenerTarget: false,
					hasConfiguredTarget: !!configuredTarget,
					reconnectExpected: preservePendingWithoutConfiguredTarget,
				})
			) {
				clearPendingNotifications();
			}
			void stopAll();
			bridgeRef.current.markStoppedByOsOrConnection();
			return;
		}

		const bridge = bridgeRef.current;
		void stopAll().then(() => {
			void startListener();
		});
		return () => {
			targetRef.current = null;
			bridge.markStoppedByOsOrConnection();
			void stopAll();
		};
	}, [
		clearPendingNotifications,
		connection,
		configuredTarget,
		latestShell,
		postPendingNotification,
		preservePendingWithoutTarget,
		settings,
		startListener,
		stopAll,
		target,
	]);

	React.useEffect(() => {
		if (Platform.OS !== 'android') return;
		globalThis.__FRESSH_AGENT_NOTIFICATIONS__ = {
			acknowledge: (
				connectionId: string,
				session: string,
				windowId: string,
			) => {
				const ids = dedupeRef.current.acknowledgeMatching((key) =>
					matchesAgentNotificationPendingKey(key, {
						connectionId,
						session,
						windowId,
					}),
				);
				for (const id of ids) void cancelAgentAlertNotification(id);
			},
		};

		return () => {
			delete globalThis.__FRESSH_AGENT_NOTIFICATIONS__;
		};
	}, []);

	return null;
}

declare global {
	var __FRESSH_AGENT_NOTIFICATIONS__:
		| {
				acknowledge: (
					connectionId: string,
					session: string,
					windowId: string,
				) => void;
		  }
		| undefined;
}
