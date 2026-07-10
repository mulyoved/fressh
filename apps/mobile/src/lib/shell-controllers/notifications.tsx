import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
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
import {
	createShellNotificationAutomaticAcknowledger,
	createShellNotificationHookOrchestrator,
	setupShellNotificationActivityEffect,
	setupShellNotificationPendingEffect,
} from './notifications-lifecycle';

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
	const [hookOrchestrator] = useState(() =>
		createShellNotificationHookOrchestrator(input),
	);
	const [automaticAcknowledger] = useState(() =>
		createShellNotificationAutomaticAcknowledger(),
	);
	const [core] = useState(() =>
		createShellNotificationsControllerCore({
			activity: {
				getSnapshot: () =>
					hookOrchestrator.getCommittedInput().activity.getSnapshot(),
			},
			context: input.context,
			platformOS: Platform.OS,
			runWorkmuxCommand: (argv, timeoutMs) =>
				hookOrchestrator.getCommittedInput().runWorkmuxCommand(argv, timeoutMs),
			consumeAuthorizedRouteToken: consumeAuthorizedAgentNotificationRouteToken,
			restoreAuthorizedRouteToken: restoreAuthorizedAgentNotificationRouteToken,
			acknowledge: acknowledgeRoutedAgentNotification,
			warn: (message, error) => {
				warnBestEffort(
					hookOrchestrator.getCommittedInput().logger,
					message,
					error,
				);
			},
		}),
	);
	const [coreLifecycle] = useState(() =>
		createReplaySafeControllerLifecycle(core),
	);

	const requestVisibleAcknowledgement = useCallback(() => {
		const activitySnapshot = hookOrchestrator
			.getCommittedInput()
			.activity.getSnapshot();
		automaticAcknowledger.request(activitySnapshot, core.getSnapshot(), () => {
			void core.acknowledgeVisible().catch((error: unknown) => {
				warnBestEffort(
					hookOrchestrator.getCommittedInput().logger,
					'agent notification visible acknowledge failed',
					error,
				);
			});
		});
	}, [automaticAcknowledger, core, hookOrchestrator]);

	useLayoutEffect(() => {
		hookOrchestrator.commitLayout(
			input,
			core.setContext,
			requestVisibleAcknowledgement,
		);
	}, [core, hookOrchestrator, input, requestVisibleAcknowledgement]);

	useEffect(() => {
		return setupShellNotificationPendingEffect({
			platformOS: Platform.OS,
			subscribe: subscribeAgentNotificationPending,
			onPending: core.notifyPending,
		});
	}, [core]);

	const getActivitySnapshot = input.activity.getSnapshot;
	const subscribeActivity = input.activity.subscribe;
	useEffect(() => {
		return setupShellNotificationActivityEffect({
			getSnapshot: getActivitySnapshot,
			subscribe: subscribeActivity,
			onInteractive: requestVisibleAcknowledgement,
			onInactive: core.invalidate,
		});
	}, [
		core,
		getActivitySnapshot,
		requestVisibleAcknowledgement,
		subscribeActivity,
	]);

	const routeEffectKey = hookOrchestrator.createRouteEffectKey(input);
	useEffect(() => {
		void hookOrchestrator.dispatchRoutePassive(
			core.handleRoute,
			(committedInput, error) => {
				warnBestEffort(
					committedInput.logger,
					'agent notification route handling failed',
					error,
				);
			},
		);
	}, [core, hookOrchestrator, routeEffectKey]);

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
