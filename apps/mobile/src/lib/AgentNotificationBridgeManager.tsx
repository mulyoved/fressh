import React from 'react';
import { AppState, Platform } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import {
	AgentNotificationBridgeStateMachine,
	HEARTBEAT_STALE_MS,
} from './agent-notification-bridge';
import {
	AgentNotificationDedupe,
	type AgentNotificationEvent,
	buildAgentNotificationListenCommand,
	handleAgentNotificationEvent,
	matchesAgentNotificationPendingKey,
	parseAgentNotificationLine,
} from './agent-notification-events';
import {
	canRunAgentNotificationBridge,
	shouldClearPendingAgentNotifications,
	shouldClearPendingAgentNotificationsForResumeKeyChange,
	useForegroundServiceRuntimeStore,
} from './agent-notification-runtime';
import { notifyAgentNotificationPending } from './agent-notification-visibility';
import {
	cancelAgentAlertNotification,
	postAgentAlertNotification,
} from './agent-notifications-native';
import { getStoredConnectionId } from './connection-utils';
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
const isActiveState = (state: string) => state === 'active';

type ListenerTarget = {
	key: string;
	resumeKey: string;
	shellKey: string;
	connection: NonNullable<
		ReturnType<typeof useSshStore.getState>['connections'][string]
	>;
	session: string;
};

type SessionSettings = {
	loaded: boolean;
	useTmux: boolean;
	session: string;
};

export function AgentNotificationBridgeManager() {
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
	const restartAttemptRef = React.useRef(0);
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
		if (!connection || !latestShellKey) return null;
		if (!settings?.loaded || !settings.useTmux) return null;
		return {
			key: `${connection.connectionId}:${latestShellKey}:${session}`,
			resumeKey: `${connection.connectionId}:${session}`,
			shellKey: latestShellKey,
			connection,
			session,
		};
	}, [connection, latestShellKey, session, settings]);
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

			clearHeartbeatTimer();
			const attempt = restartAttemptRef.current;
			restartAttemptRef.current = attempt + 1;
			const delayMs =
				RESTART_DELAYS_MS[Math.min(attempt, RESTART_DELAYS_MS.length - 1)] ??
				30_000;
			logger.info('agent notification listener restart scheduled', {
				reason,
				delayMs,
			});
			restartTimerRef.current = setTimeout(() => {
				restartTimerRef.current = null;
				void stopListener().then(() => startListenerRef.current?.());
			}, delayMs);
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
			connectionId: string;
		}) => {
			const { key, notificationId, event, connectionId } = input;
			const attemptId = dedupeRef.current.beginPost(key, event.id);
			if (attemptId === null) return;
			void postAgentAlertNotification({
				notificationId,
				title: event.status === 'waiting' ? 'Agent waiting' : 'Agent done',
				message: `${event.windowName || event.target} needs attention`,
				connectionId,
				session: event.session,
				target: event.target,
				windowId: event.windowId,
			}).then((posted) => {
				const result = dedupeRef.current.completePost(
					key,
					event.id,
					attemptId,
					posted,
				);
				if (result.type === 'cancel-posted') {
					void cancelAgentAlertNotification(result.notificationId);
					return;
				}
				if (result.type === 'superseded' && posted) {
					postPendingNotification({
						...result.current,
						connectionId,
					});
				}
			});
		},
		[],
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
					if (targetRef.current?.key !== activeTarget.key) return;

					const parsed = parseAgentNotificationLine(line);
					if (!parsed) {
						logger.warn('ignored malformed agent notification line', { line });
						return;
					}

					if (parsed.type === 'heartbeat') {
						bridgeRef.current.recordHeartbeat(Date.now());
						return;
					}

					bridgeRef.current.recordEventId(parsed.id);
					lastSeenIdByTargetRef.current.set(activeTarget.resumeKey, parsed.id);
					handleAgentNotificationEvent({
						event: parsed,
						connectionId: activeTarget.connection.connectionId,
						dedupe: dedupeRef.current,
						notifyPending: notifyAgentNotificationPending,
						onPending: ({ key, notificationId, event }) => {
							postPendingNotification({
								key,
								notificationId,
								event,
								connectionId: activeTarget.connection.connectionId,
							});
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
		if (
			shouldClearPendingAgentNotificationsForResumeKeyChange({
				previousResumeKey: previousConfiguredResumeKeyRef.current,
				nextResumeKey: configuredResumeKey,
			})
		) {
			clearPendingNotifications();
		}
		previousConfiguredResumeKeyRef.current = configuredResumeKey;
		if (target?.key !== previousTargetKeyRef.current) {
			restartAttemptRef.current = 0;
			previousTargetKeyRef.current = target?.key ?? null;
		}

		if (Platform.OS !== 'android') return;
		if (!target) {
			if (
				shouldClearPendingAgentNotifications({
					hasListenerTarget: false,
					hasConfiguredTarget: !!configuredTarget,
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
		configuredTarget,
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
