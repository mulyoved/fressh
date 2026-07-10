import {
	acknowledgeVisibleAgentNotification,
	handleAgentNotificationRoute,
	type VisibleAgentNotificationSnapshot,
} from '../agent-notification-visibility';
import { type ShellActivitySnapshot } from './activity-core';
import {
	createControllerPublisher,
	type ControllerCore,
	type ControllerInvalidationReason,
} from './controller-core';
import { type ShellTargetKey, type ShellTransportKey } from './source-keys';

export type ShellNotificationContext = {
	transportKey: ShellTransportKey;
	targetKey: ShellTargetKey;
	storedConnectionId: string | null;
	channelId: number;
	tmuxEnabled: boolean;
	tmuxTarget: string;
};

export type ShellNotificationRoute = {
	agentConnectionId: string | null;
	agentSession: string | null;
	agentWindowId: string | null;
	agentEventId: string | null;
	agentTapToken: string | null;
};

export type ShellNotificationsState = {
	context: ShellNotificationContext;
	handledRouteKey: string | null;
	generation: number;
	acknowledgeInFlight: boolean;
	acknowledgeQueued: boolean;
};

export type ShellNotificationsControllerCore =
	ControllerCore<ShellNotificationsState> & {
		setContext(context: ShellNotificationContext): void;
		acknowledgeVisible(): Promise<void>;
		notifyPending(): void;
		handleRoute(route: ShellNotificationRoute): Promise<boolean>;
	};

export type CreateShellNotificationsControllerCoreInput = {
	activity: { getSnapshot(): ShellActivitySnapshot };
	context: ShellNotificationContext;
	platformOS: string;
	runWorkmuxCommand(argv: string[], timeoutMs: number): Promise<string>;
	consumeAuthorizedRouteToken(
		connectionId: string,
		session: string,
		windowId: string,
		eventId: string,
		tapToken: string,
	): boolean;
	restoreAuthorizedRouteToken(
		connectionId: string,
		session: string,
		windowId: string,
		eventId: string,
		tapToken: string,
	): boolean;
	acknowledge(connectionId: string, session: string, windowId: string): void;
	warn(message: string, error: unknown): void;
};

type QueuedWaiter = {
	resolve(): void;
};

type AcknowledgementAttempt = Readonly<{
	generation: number;
	activityGeneration: number;
	context: Readonly<ShellNotificationContext>;
}>;

function contextsEqual(
	left: ShellNotificationContext,
	right: ShellNotificationContext,
): boolean {
	return (
		left.transportKey === right.transportKey &&
		left.targetKey === right.targetKey &&
		left.storedConnectionId === right.storedConnectionId &&
		left.channelId === right.channelId &&
		left.tmuxEnabled === right.tmuxEnabled &&
		left.tmuxTarget === right.tmuxTarget
	);
}

export function createShellNotificationsControllerCore({
	activity,
	context: initialContext,
	platformOS,
	runWorkmuxCommand,
	consumeAuthorizedRouteToken,
	restoreAuthorizedRouteToken,
	acknowledge,
	warn,
}: CreateShellNotificationsControllerCoreInput): ShellNotificationsControllerCore {
	const publisher = createControllerPublisher<ShellNotificationsState>({
		context: initialContext,
		handledRouteKey: null,
		generation: 0,
		acknowledgeInFlight: false,
		acknowledgeQueued: false,
	});
	let generation = 0;
	let inFlight = false;
	let queued = false;
	let queuedWaiters: QueuedWaiter[] = [];
	let queuedAttempt: AcknowledgementAttempt | null = null;
	let promotedWaiters: QueuedWaiter[] = [];
	let epochInvalidated = false;
	let disposed = false;
	let handledRouteKey: string | null = null;

	const publish = (): void => {
		const current = publisher.getSnapshot();
		publisher.publish({
			...current,
			generation,
			acknowledgeInFlight: inFlight,
			acknowledgeQueued: queued,
		});
	};

	const settleWaiters = (waiters: QueuedWaiter[]): void => {
		for (const waiter of waiters) waiter.resolve();
	};

	const settleQueued = (): void => {
		const waiters = queuedWaiters;
		queuedWaiters = [];
		queuedAttempt = null;
		queued = false;
		settleWaiters(waiters);
	};

	const settlePromoted = (): void => {
		const waiters = promotedWaiters;
		promotedWaiters = [];
		settleWaiters(waiters);
	};

	const settleObsolete = (): void => {
		settlePromoted();
		settleQueued();
	};

	const getVisibility = (): VisibleAgentNotificationSnapshot => {
		const snapshot = activity.getSnapshot();
		const { context } = publisher.getSnapshot();
		return {
			isFocused: snapshot.focused,
			isAppActive: snapshot.appActive,
			connectionId: context.storedConnectionId,
			channelId: context.channelId,
			tmuxTarget: context.tmuxTarget.trim() || 'main',
		};
	};

	const captureAttempt = (): AcknowledgementAttempt => ({
		generation,
		activityGeneration: activity.getSnapshot().generation,
		context: { ...publisher.getSnapshot().context },
	});

	const isAttemptCurrent = (attempt: AcknowledgementAttempt): boolean =>
		!disposed &&
		attempt.generation === generation &&
		activity.getSnapshot().generation === attempt.activityGeneration;

	const runAttempt = async (attempt: AcknowledgementAttempt): Promise<void> => {
		const { context } = attempt;
		await acknowledgeVisibleAgentNotification({
			platformOS,
			connectionId: context.storedConnectionId,
			channelId: context.channelId,
			tmuxEnabled: context.tmuxEnabled,
			tmuxTarget: context.tmuxTarget,
			getVisibility,
			nextRequestId: () => attempt.generation,
			isCurrentRequest: (requestId) =>
				requestId === attempt.generation && isAttemptCurrent(attempt),
			runWorkmuxCommand,
			acknowledge,
			warn,
		});
	};

	const warnBestEffort = (message: string, error: unknown): void => {
		try {
			warn(message, error);
		} catch {
			// Notification acknowledgement must remain best effort.
		}
	};

	const acknowledgeVisible = async (): Promise<void> => {
		if (disposed) return;
		epochInvalidated = false;
		if (inFlight) {
			queuedAttempt = captureAttempt();
			const promise = new Promise<void>((resolve) => {
				queuedWaiters.push({ resolve });
			});
			if (!queued) {
				queued = true;
				publish();
			}
			return promise;
		}

		let attempt = captureAttempt();
		inFlight = true;
		try {
			publish();
			do {
				if (isAttemptCurrent(attempt)) {
					await runAttempt(attempt);
				}
				settlePromoted();
				if (disposed || !queued) break;
				promotedWaiters = queuedWaiters;
				queuedWaiters = [];
				const promotedAttempt = queuedAttempt;
				queuedAttempt = null;
				queued = false;
				if (!promotedAttempt) {
					settlePromoted();
					break;
				}
				attempt = promotedAttempt;
				publish();
			} while (!disposed);
		} finally {
			settleObsolete();
			inFlight = false;
			if (!disposed) publish();
		}
	};

	const invalidate = (_reason: ControllerInvalidationReason): void => {
		if (disposed || epochInvalidated) return;
		epochInvalidated = true;
		generation += 1;
		settleObsolete();
		publish();
	};

	return {
		getSnapshot: publisher.getSnapshot,
		subscribe: publisher.subscribe,
		setContext: (context) => {
			if (disposed) return;
			const current = publisher.getSnapshot();
			if (contextsEqual(current.context, context)) return;
			const semanticContextChanged =
				current.context.transportKey !== context.transportKey ||
				current.context.targetKey !== context.targetKey ||
				current.context.tmuxEnabled !== context.tmuxEnabled;
			if (semanticContextChanged) {
				generation += 1;
				settleObsolete();
				epochInvalidated = false;
			}
			publisher.publish({
				...current,
				context,
				generation,
				acknowledgeInFlight: inFlight,
				acknowledgeQueued: queued,
			});
		},
		acknowledgeVisible,
		notifyPending: () => {
			if (!disposed && activity.getSnapshot().interactive) {
				void acknowledgeVisible().catch((error: unknown) => {
					warnBestEffort(
						'agent notification pending acknowledge failed',
						error,
					);
				});
			}
		},
		handleRoute: async (route) => {
			if (disposed) return false;
			const { context } = publisher.getSnapshot();
			return handleAgentNotificationRoute({
				...route,
				storedConnectionId: context.storedConnectionId,
				tmuxTarget: context.tmuxTarget,
				isRouteHandled: (routeKey) => handledRouteKey === routeKey,
				markRouteHandled: (routeKey) => {
					handledRouteKey = routeKey;
					try {
						publisher.publish({
							...publisher.getSnapshot(),
							handledRouteKey,
						});
					} catch (error) {
						warnBestEffort(
							'agent notification route state publication failed',
							error,
						);
					}
				},
				consumeAuthorizedRouteToken,
				restoreAuthorizedRouteToken,
				runWorkmuxCommand,
				acknowledge: (connectionId, session, windowId) => {
					try {
						acknowledge(connectionId, session, windowId);
					} catch (error) {
						warnBestEffort(
							'agent notification route acknowledge failed',
							error,
						);
					}
				},
				warn: warnBestEffort,
			});
		},
		invalidate,
		dispose: () => {
			if (disposed) return;
			generation += 1;
			disposed = true;
			settleObsolete();
			inFlight = false;
			try {
				publish();
			} finally {
				publisher.disposePublisher();
			}
		},
	};
}
