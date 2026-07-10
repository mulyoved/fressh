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
	acknowledge(connectionId: string, session: string, windowId: string): void;
	warn(message: string, error: unknown): void;
};

type QueuedWaiter = {
	resolve(): void;
};

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

	const settleQueued = (): void => {
		const waiters = queuedWaiters;
		queuedWaiters = [];
		queued = false;
		for (const waiter of waiters) waiter.resolve();
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

	const runAttempt = async (): Promise<void> => {
		const requestGeneration = generation;
		const activityGeneration = activity.getSnapshot().generation;
		const { context } = publisher.getSnapshot();
		await acknowledgeVisibleAgentNotification({
			platformOS,
			connectionId: context.storedConnectionId,
			channelId: context.channelId,
			tmuxEnabled: context.tmuxEnabled,
			tmuxTarget: context.tmuxTarget,
			getVisibility,
			nextRequestId: () => requestGeneration,
			isCurrentRequest: (requestId) =>
				!disposed &&
				requestId === generation &&
				activity.getSnapshot().generation === activityGeneration,
			runWorkmuxCommand,
			acknowledge,
			warn,
		});
	};

	const acknowledgeVisible = async (): Promise<void> => {
		if (disposed) return;
		if (inFlight) {
			if (!queued) {
				queued = true;
				publish();
			}
			return new Promise<void>((resolve) => {
				queuedWaiters.push({ resolve });
			});
		}

		inFlight = true;
		publish();
		let activeWaiters: QueuedWaiter[] = [];
		try {
			do {
				await runAttempt();
				for (const waiter of activeWaiters) waiter.resolve();
				activeWaiters = [];
				if (disposed || !queued) break;
				activeWaiters = queuedWaiters;
				queuedWaiters = [];
				queued = false;
				publish();
			} while (!disposed);
		} finally {
			for (const waiter of activeWaiters) waiter.resolve();
			settleQueued();
			inFlight = false;
			if (!disposed) publish();
		}
	};

	const invalidate = (_reason: ControllerInvalidationReason): void => {
		if (disposed) return;
		generation += 1;
		settleQueued();
		publish();
	};

	return {
		getSnapshot: publisher.getSnapshot,
		subscribe: publisher.subscribe,
		setContext: (context) => {
			if (disposed) return;
			const current = publisher.getSnapshot();
			if (contextsEqual(current.context, context)) return;
			if (
				current.context.transportKey !== context.transportKey ||
				current.context.targetKey !== context.targetKey
			) {
				generation += 1;
				settleQueued();
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
				void acknowledgeVisible();
			}
		},
		handleRoute: async (_route) => false,
		invalidate,
		dispose: () => {
			if (disposed) return;
			generation += 1;
			disposed = true;
			settleQueued();
			inFlight = false;
			publish();
			publisher.disposePublisher();
		},
	};
}
