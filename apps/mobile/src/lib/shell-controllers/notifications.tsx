import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { Platform } from 'react-native';
import {
	acknowledgeRoutedAgentNotification,
	consumeAuthorizedAgentNotificationRouteToken,
	restoreAuthorizedAgentNotificationRouteToken,
} from '../agent-notification-route-store';
import { subscribeAgentNotificationPending } from '../agent-notification-visibility';
import { type ShellActivityControllerHandle } from './activity';
import { type ControllerInvalidationReason } from './controller-core';
import { createReplaySafeControllerLifecycle } from './controller-lifecycle';
import {
	createShellNotificationsControllerCore,
	type ShellNotificationContext,
	type ShellNotificationRoute,
} from './notifications-core';

export type ShellNotificationsControllerHandle = {
	acknowledgeVisible(): Promise<void>;
	invalidate(reason: ControllerInvalidationReason): void;
};

export type ShellNotificationsLogger = {
	warn(message: string, error: unknown): void;
};

export type UseShellNotificationsControllerInput = {
	activity: ShellActivityControllerHandle;
	context: ShellNotificationContext;
	route: ShellNotificationRoute;
	runWorkmuxCommand(argv: string[], timeoutMs: number): Promise<string>;
	logger: ShellNotificationsLogger;
};

function warnBestEffort(
	logger: ShellNotificationsLogger,
	message: string,
	error: unknown,
): void {
	try {
		logger.warn(message, error);
	} catch {
		// Notification work must never interrupt the interactive shell.
	}
}

export function useShellNotificationsController(
	input: UseShellNotificationsControllerInput,
): ShellNotificationsControllerHandle {
	const committedInputRef = useRef(input);
	const lastActivitySnapshotRef = useRef<ReturnType<
		typeof input.activity.getSnapshot
	> | null>(null);
	const lastAutomaticAcknowledgeKeyRef = useRef<string | null>(null);
	const [core] = useState(() =>
		createShellNotificationsControllerCore({
			activity: {
				getSnapshot: () => committedInputRef.current.activity.getSnapshot(),
			},
			context: input.context,
			platformOS: Platform.OS,
			runWorkmuxCommand: (argv, timeoutMs) =>
				committedInputRef.current.runWorkmuxCommand(argv, timeoutMs),
			consumeAuthorizedRouteToken: consumeAuthorizedAgentNotificationRouteToken,
			restoreAuthorizedRouteToken: restoreAuthorizedAgentNotificationRouteToken,
			acknowledge: acknowledgeRoutedAgentNotification,
			warn: (message, error) => {
				warnBestEffort(committedInputRef.current.logger, message, error);
			},
		}),
	);
	const [coreLifecycle] = useState(() =>
		createReplaySafeControllerLifecycle(core),
	);

	const requestVisibleAcknowledgement = useCallback(() => {
		const activitySnapshot = committedInputRef.current.activity.getSnapshot();
		if (!activitySnapshot.interactive) return;
		const automaticKey = JSON.stringify([
			activitySnapshot.generation,
			core.getSnapshot().generation,
		]);
		if (lastAutomaticAcknowledgeKeyRef.current === automaticKey) return;
		lastAutomaticAcknowledgeKeyRef.current = automaticKey;
		void core.acknowledgeVisible().catch((error: unknown) => {
			warnBestEffort(
				committedInputRef.current.logger,
				'agent notification visible acknowledge failed',
				error,
			);
		});
	}, [core]);

	useLayoutEffect(() => {
		committedInputRef.current = input;
		const previousGeneration = core.getSnapshot().generation;
		core.setContext(input.context);
		if (core.getSnapshot().generation !== previousGeneration) {
			requestVisibleAcknowledgement();
		}
	}, [core, input, requestVisibleAcknowledgement]);

	useEffect(() => {
		if (Platform.OS !== 'android') return undefined;
		return subscribeAgentNotificationPending(core.notifyPending);
	}, [core]);

	const getActivitySnapshot = input.activity.getSnapshot;
	const subscribeActivity = input.activity.subscribe;
	useEffect(() => {
		const handleActivityChanged = (): void => {
			const snapshot = getActivitySnapshot();
			const previous = lastActivitySnapshotRef.current;
			lastActivitySnapshotRef.current = snapshot;
			if (snapshot.interactive) {
				requestVisibleAcknowledgement();
				return;
			}
			if (previous?.interactive) {
				core.invalidate(snapshot.focused ? 'app-inactive' : 'focus-lost');
			}
		};

		const unsubscribe = subscribeActivity(handleActivityChanged);
		handleActivityChanged();
		return unsubscribe;
	}, [
		core,
		getActivitySnapshot,
		requestVisibleAcknowledgement,
		subscribeActivity,
	]);

	const {
		agentConnectionId,
		agentSession,
		agentWindowId,
		agentEventId,
		agentTapToken,
	} = input.route;
	useEffect(() => {
		const route = committedInputRef.current.route;
		void core.handleRoute(route).catch((error: unknown) => {
			warnBestEffort(
				committedInputRef.current.logger,
				'agent notification route handling failed',
				error,
			);
		});
	}, [
		agentConnectionId,
		agentEventId,
		agentSession,
		agentTapToken,
		agentWindowId,
		core,
		input.context.targetKey,
		input.context.transportKey,
	]);

	useEffect(() => coreLifecycle.setup(), [coreLifecycle]);

	const acknowledgeVisible = useCallback(
		() => core.acknowledgeVisible(),
		[core],
	);
	const invalidate = useCallback(
		(reason: ControllerInvalidationReason) => core.invalidate(reason),
		[core],
	);

	return useMemo(
		() => ({ acknowledgeVisible, invalidate }),
		[acknowledgeVisible, invalidate],
	);
}
