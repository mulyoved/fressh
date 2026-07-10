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
	contextRevision: number;
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

type ActiveRouteAttempt = {
	routeIdentityKey: string;
	contextRevision: number;
	generation: number;
	requestId: number;
	committed: boolean;
	restorationRetryAvailable: boolean;
	tokenConsumed: boolean;
	tokenRestored: boolean;
	promise: Promise<boolean>;
};

type RouteRequestSnapshot = {
	route: ShellNotificationRoute;
	context: ShellNotificationContext;
	contextRevision: number;
	generation: number;
	routeIdentityKey: string;
};

type QueuedRouteRequest = RouteRequestSnapshot & {
	promise: Promise<boolean>;
	resolve(handled: boolean): void;
};

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

function createRouteIdentityKey(route: ShellNotificationRoute): string {
	return JSON.stringify([
		route.agentConnectionId,
		route.agentSession,
		route.agentWindowId,
		route.agentEventId,
		route.agentTapToken,
	]);
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
		contextRevision: 0,
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
	let routeRequestId = 0;
	let activeRouteAttempt: ActiveRouteAttempt | null = null;
	let queuedRouteRequest: QueuedRouteRequest | null = null;
	let routeInvalidationReason: ControllerInvalidationReason | null = null;

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

	const settleQueuedRouteRequest = (handled = false): void => {
		const queuedRequest = queuedRouteRequest;
		queuedRouteRequest = null;
		queuedRequest?.resolve(handled);
	};

	const invalidate = (reason: ControllerInvalidationReason): void => {
		if (disposed) return;
		settleQueuedRouteRequest();
		if (reason !== 'unmount' || routeInvalidationReason === null) {
			routeInvalidationReason = reason;
		}
		if (epochInvalidated) {
			return;
		}
		epochInvalidated = true;
		generation += 1;
		settleObsolete();
		publish();
	};

	const isRouteAttemptCurrent = (attempt: ActiveRouteAttempt): boolean =>
		!disposed &&
		attempt.requestId === routeRequestId &&
		attempt.generation === generation &&
		attempt.contextRevision === publisher.getSnapshot().contextRevision;

	const runRouteAttempt = async (
		attempt: ActiveRouteAttempt,
		route: ShellNotificationRoute,
		context: ShellNotificationContext,
	): Promise<boolean> => {
		const handled = await handleAgentNotificationRoute({
			...route,
			storedConnectionId: context.storedConnectionId,
			tmuxTarget: context.tmuxTarget,
			isRouteHandled: (routeKey) =>
				publisher.getSnapshot().handledRouteKey === routeKey,
			markRouteHandled: (routeKey) => {
				if (!isRouteAttemptCurrent(attempt)) return;
				attempt.committed = true;
				try {
					publisher.publish({
						...publisher.getSnapshot(),
						handledRouteKey: routeKey,
					});
				} catch (error) {
					warnBestEffort(
						'agent notification route state publication failed',
						error,
					);
				}
			},
			consumeAuthorizedRouteToken: (...args) => {
				const consumed = consumeAuthorizedRouteToken(...args);
				attempt.tokenConsumed = consumed;
				return consumed;
			},
			restoreAuthorizedRouteToken: (...args) => {
				const restored = restoreAuthorizedRouteToken(...args);
				attempt.tokenRestored = restored;
				return restored;
			},
			runWorkmuxCommand,
			acknowledge: (connectionId, session, windowId) => {
				if (!attempt.committed) return;
				try {
					acknowledge(connectionId, session, windowId);
				} catch (error) {
					warnBestEffort('agent notification route acknowledge failed', error);
				}
			},
			warn: warnBestEffort,
		});
		return handled && attempt.committed;
	};

	const createRouteCallerPromise = (
		attempt: ActiveRouteAttempt,
		callerGeneration: number,
		callerContextRevision: number,
	): Promise<boolean> =>
		attempt.promise.then(
			(handled) =>
				handled &&
				attempt.generation === callerGeneration &&
				attempt.contextRevision === callerContextRevision,
		);

	function startRouteAttempt(
		request: RouteRequestSnapshot,
		restorationRetryAvailable: boolean,
	): Promise<boolean> {
		epochInvalidated = false;
		routeInvalidationReason = null;
		const requestId = ++routeRequestId;
		let resolveAttempt!: (handled: boolean) => void;
		let rejectAttempt!: (error: unknown) => void;
		const promise = new Promise<boolean>((resolve, reject) => {
			resolveAttempt = resolve;
			rejectAttempt = reject;
		});
		const attempt: ActiveRouteAttempt = {
			routeIdentityKey: request.routeIdentityKey,
			contextRevision: request.contextRevision,
			generation: request.generation,
			requestId,
			committed: false,
			restorationRetryAvailable,
			tokenConsumed: false,
			tokenRestored: false,
			promise,
		};
		activeRouteAttempt = attempt;
		void (async () => {
			let handled = false;
			try {
				handled = await runRouteAttempt(
					attempt,
					request.route,
					request.context,
				);
				resolveAttempt(handled);
			} catch (error) {
				rejectAttempt(error);
			} finally {
				finishRouteAttempt(attempt, handled);
			}
		})();
		return createRouteCallerPromise(
			attempt,
			request.generation,
			request.contextRevision,
		);
	}

	function finishRouteAttempt(
		attempt: ActiveRouteAttempt,
		handled: boolean,
	): void {
		if (activeRouteAttempt !== attempt) return;
		activeRouteAttempt = null;
		const queuedRequest = queuedRouteRequest;
		queuedRouteRequest = null;
		if (!queuedRequest) return;
		const snapshot = publisher.getSnapshot();
		if (
			handled ||
			!attempt.restorationRetryAvailable ||
			!attempt.tokenRestored ||
			disposed ||
			queuedRequest.generation !== generation ||
			queuedRequest.contextRevision !== snapshot.contextRevision
		) {
			queuedRequest.resolve(false);
			return;
		}
		void startRouteAttempt(queuedRequest, false).then(
			queuedRequest.resolve,
			(error: unknown) => {
				warnBestEffort('agent notification restored route retry failed', error);
				queuedRequest.resolve(false);
			},
		);
	}

	const queueRouteRequest = (
		request: RouteRequestSnapshot,
	): Promise<boolean> => {
		if (
			queuedRouteRequest &&
			queuedRouteRequest.routeIdentityKey === request.routeIdentityKey &&
			queuedRouteRequest.contextRevision === request.contextRevision &&
			queuedRouteRequest.generation === request.generation
		) {
			return queuedRouteRequest.promise;
		}
		settleQueuedRouteRequest();
		let resolveQueued!: (handled: boolean) => void;
		const promise = new Promise<boolean>((resolve) => {
			resolveQueued = resolve;
		});
		queuedRouteRequest = {
			...request,
			promise,
			resolve: resolveQueued,
		};
		return promise;
	};

	return {
		getSnapshot: publisher.getSnapshot,
		subscribe: publisher.subscribe,
		setContext: (context) => {
			if (disposed) return;
			const current = publisher.getSnapshot();
			if (contextsEqual(current.context, context)) return;
			settleQueuedRouteRequest();
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
		handleRoute: (route) => {
			if (disposed) return Promise.resolve(false);
			const snapshot = publisher.getSnapshot();
			const context = { ...snapshot.context };
			const contextRevision = snapshot.contextRevision;
			const routeIdentityKey = createRouteIdentityKey(route);
			const request: RouteRequestSnapshot = {
				route,
				context,
				contextRevision,
				generation,
				routeIdentityKey,
			};
			if (
				activeRouteAttempt &&
				!activeRouteAttempt.committed &&
				activeRouteAttempt.routeIdentityKey === routeIdentityKey &&
				activeRouteAttempt.contextRevision === contextRevision &&
				(activeRouteAttempt.generation === generation ||
					routeInvalidationReason === 'unmount')
			) {
				const attempt = activeRouteAttempt;
				epochInvalidated = false;
				routeInvalidationReason = null;
				attempt.generation = generation;
				const callerGeneration = generation;
				return attempt.promise.then(
					(handled) =>
						handled &&
						attempt.generation === callerGeneration &&
						attempt.contextRevision === contextRevision,
				);
			}
			if (
				activeRouteAttempt &&
				!activeRouteAttempt.committed &&
				activeRouteAttempt.tokenConsumed &&
				activeRouteAttempt.routeIdentityKey === routeIdentityKey &&
				activeRouteAttempt.contextRevision !== contextRevision &&
				routeInvalidationReason === null
			) {
				return queueRouteRequest(request);
			}
			settleQueuedRouteRequest();
			return startRouteAttempt(request, true);
		},
		invalidate,
		dispose: () => {
			if (disposed) return;
			settleQueuedRouteRequest();
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
