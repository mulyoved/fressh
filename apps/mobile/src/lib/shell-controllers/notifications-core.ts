import {
	acknowledgeVisibleAgentNotification,
	type VisibleAgentNotificationSnapshot,
} from '../agent-notification-visibility';
import { type ShellActivitySnapshot } from './activity-core';
import {
	createControllerPublisher,
	type ControllerCore,
	type ControllerInvalidationReason,
} from './controller-core';
import { createShellNotificationRouteCoordinator } from './notifications-route-coordinator';
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
	contextRevision: number;
	commandPortRevision: number;
	handledRouteKey: string | null;
	generation: number;
	acknowledgeInFlight: boolean;
	acknowledgeQueued: boolean;
};

export type ShellNotificationsControllerCore =
	ControllerCore<ShellNotificationsState> & {
		setCommandPort(
			runWorkmuxCommand: CreateShellNotificationsControllerCoreInput['runWorkmuxCommand'],
		): void;
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
	commandPortRevision: number;
	context: Readonly<ShellNotificationContext>;
}>;

export function createShellNotificationContextIdentity(
	context: ShellNotificationContext,
): string {
	return JSON.stringify([
		context.transportKey,
		context.targetKey,
		context.storedConnectionId,
		context.channelId,
		context.tmuxEnabled,
		context.tmuxTarget,
	]);
}

function contextsEqual(
	left: ShellNotificationContext,
	right: ShellNotificationContext,
): boolean {
	return (
		createShellNotificationContextIdentity(left) ===
		createShellNotificationContextIdentity(right)
	);
}

export function createShellNotificationsControllerCore({
	activity,
	context: initialContext,
	platformOS,
	runWorkmuxCommand: initialCommandPort,
	consumeAuthorizedRouteToken,
	restoreAuthorizedRouteToken,
	acknowledge,
	warn,
}: CreateShellNotificationsControllerCoreInput): ShellNotificationsControllerCore {
	const publisher = createControllerPublisher<ShellNotificationsState>({
		context: initialContext,
		contextRevision: 0,
		commandPortRevision: 0,
		handledRouteKey: null,
		generation: 0,
		acknowledgeInFlight: false,
		acknowledgeQueued: false,
	});
	let generation = 0;
	let commandPortRevision = 0;
	let commandPort = initialCommandPort;
	let inFlight = false;
	let queued = false;
	let queuedWaiters: QueuedWaiter[] = [];
	let queuedAttempt: AcknowledgementAttempt | null = null;
	let promotedWaiters: QueuedWaiter[] = [];
	let epochInvalidated = false;
	let disposed = false;

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
		commandPortRevision,
		context: { ...publisher.getSnapshot().context },
	});

	const isAttemptCurrent = (attempt: AcknowledgementAttempt): boolean =>
		!disposed &&
		attempt.generation === generation &&
		attempt.commandPortRevision === commandPortRevision &&
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
			runWorkmuxCommand: commandPort,
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

	const routeCoordinator = createShellNotificationRouteCoordinator({
		getSnapshot: publisher.getSnapshot,
		isDisposed: () => disposed,
		beginRouteEpoch: () => {
			epochInvalidated = false;
		},
		getCommandPortRevision: () => commandPortRevision,
		runWorkmuxCommand: (argv, timeoutMs) => commandPort(argv, timeoutMs),
		consumeAuthorizedRouteToken,
		restoreAuthorizedRouteToken,
		acknowledge,
		publishHandled: (routeKey) => {
			publisher.publish({
				...publisher.getSnapshot(),
				handledRouteKey: routeKey,
			});
		},
		warn: warnBestEffort,
	});

	const invalidate = (reason: ControllerInvalidationReason): void => {
		if (disposed) return;
		routeCoordinator.invalidate(reason);
		if (epochInvalidated) return;
		epochInvalidated = true;
		generation += 1;
		settleObsolete();
		publish();
	};

	return {
		getSnapshot: publisher.getSnapshot,
		subscribe: publisher.subscribe,
		setCommandPort: (nextCommandPort) => {
			if (disposed || commandPort === nextCommandPort) return;
			commandPort = nextCommandPort;
			commandPortRevision += 1;
			publisher.publish({
				...publisher.getSnapshot(),
				commandPortRevision,
			});
		},
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
			routeCoordinator.contextChanged();
			publisher.publish({
				...current,
				context,
				contextRevision: current.contextRevision + 1,
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
		handleRoute: routeCoordinator.handleRoute,
		invalidate,
		dispose: () => {
			if (disposed) return;
			routeCoordinator.dispose();
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
