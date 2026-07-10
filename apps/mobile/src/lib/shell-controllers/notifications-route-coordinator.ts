import {
	handleAgentNotificationRoute,
	resolveAgentNotificationRoute,
	type ResolvedAgentNotificationRoute,
} from '../agent-notification-visibility';
import { type ControllerInvalidationReason } from './controller-core';
import {
	type ShellNotificationContext,
	type ShellNotificationRoute,
	type ShellNotificationsState,
} from './notifications-core';

type RetryBudget = 'restoration-available' | 'none';

type RouteRequest = {
	route: ShellNotificationRoute;
	context: ShellNotificationContext;
	contextRevision: number;
	generation: number;
	sequence: number;
	rawIdentityKey: string;
	resolved: ResolvedAgentNotificationRoute | null;
	retryBudget: RetryBudget;
	blockedByInvalidation: boolean;
};

type AttemptOutcome =
	| 'committed'
	| 'restored'
	| 'restoration-failed'
	| 'stale-success'
	| 'failed'
	| 'unauthorized';

type AttemptPhase =
	| { kind: 'authorizing' }
	| { kind: 'lease-consumed'; lease: ResolvedAgentNotificationRoute }
	| { kind: 'lease-restored'; lease: ResolvedAgentNotificationRoute }
	| { kind: 'restoration-failed'; lease: ResolvedAgentNotificationRoute }
	| {
			kind: 'committed';
			lease: ResolvedAgentNotificationRoute;
			routeKey: string;
	  }
	| { kind: 'settled'; outcome: AttemptOutcome };

type ActiveAttempt = {
	request: RouteRequest;
	phase: AttemptPhase;
	promise: Promise<boolean>;
};

type QueuedRequest = RouteRequest & {
	promise: Promise<boolean>;
	resolve(handled: boolean): void;
};

export type ShellNotificationRouteCoordinator = {
	handleRoute(route: ShellNotificationRoute): Promise<boolean>;
	invalidate(reason: ControllerInvalidationReason): void;
	contextChanged(): void;
	dispose(): void;
};

export function createShellNotificationRouteCoordinator(input: {
	getSnapshot(): ShellNotificationsState;
	isDisposed(): boolean;
	beginRouteEpoch(): void;
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
	publishHandled(routeKey: string): void;
	warn(message: string, error: unknown): void;
}): ShellNotificationRouteCoordinator {
	let latestSequence = 0;
	let active: ActiveAttempt | null = null;
	let queued: QueuedRequest | null = null;
	let invalidationReason: ControllerInvalidationReason | null = null;
	let disposed = false;

	const rawIdentityKey = (route: ShellNotificationRoute): string =>
		JSON.stringify([
			route.agentConnectionId,
			route.agentSession,
			route.agentWindowId,
			route.agentEventId,
			route.agentTapToken,
		]);

	const equivalentIdentity = (
		left: Pick<RouteRequest, 'resolved' | 'rawIdentityKey'>,
		right: Pick<RouteRequest, 'resolved' | 'rawIdentityKey'>,
	): boolean => {
		if (left.resolved && right.resolved) {
			return (
				left.resolved.authorizationIdentityKey ===
				right.resolved.authorizationIdentityKey
			);
		}
		return (
			!left.resolved &&
			!right.resolved &&
			left.rawIdentityKey === right.rawIdentityKey
		);
	};

	const sameAuthorization = (
		left: RouteRequest,
		right: RouteRequest,
	): boolean =>
		Boolean(
			left.resolved &&
				right.resolved &&
				left.resolved.authorizationIdentityKey ===
					right.resolved.authorizationIdentityKey,
		);

	const currentRequest = (route: ShellNotificationRoute): RouteRequest => {
		const snapshot = input.getSnapshot();
		const context = { ...snapshot.context };
		return {
			route,
			context,
			contextRevision: snapshot.contextRevision,
			generation: snapshot.generation,
			sequence: 0,
			rawIdentityKey: rawIdentityKey(route),
			resolved: resolveAgentNotificationRoute({
				...route,
				storedConnectionId: context.storedConnectionId,
				tmuxTarget: context.tmuxTarget,
			}),
			retryBudget: 'restoration-available',
			blockedByInvalidation:
				invalidationReason !== null && invalidationReason !== 'unmount',
		};
	};

	const isRequestCurrent = (request: RouteRequest): boolean => {
		const snapshot = input.getSnapshot();
		return (
			!disposed &&
			!input.isDisposed() &&
			request.sequence === latestSequence &&
			request.generation === snapshot.generation &&
			request.contextRevision === snapshot.contextRevision
		);
	};

	const settleQueued = (handled = false): void => {
		const request = queued;
		queued = null;
		request?.resolve(handled);
	};

	const callerPromise = (
		attempt: ActiveAttempt,
		generation: number,
		contextRevision: number,
	): Promise<boolean> =>
		attempt.promise.then(
			(handled) =>
				handled &&
				attempt.request.generation === generation &&
				attempt.request.contextRevision === contextRevision,
		);

	const transitionConsume = (
		attempt: ActiveAttempt,
		lease: ResolvedAgentNotificationRoute,
	): boolean => {
		if (attempt.phase.kind !== 'authorizing') return false;
		const consumed = input.consumeAuthorizedRouteToken(
			lease.connectionId,
			lease.session,
			lease.windowId,
			lease.eventId,
			lease.tapToken,
		);
		if (consumed) attempt.phase = { kind: 'lease-consumed', lease };
		return consumed;
	};

	const transitionRestore = (
		attempt: ActiveAttempt,
		lease: ResolvedAgentNotificationRoute,
	): boolean => {
		if (attempt.phase.kind !== 'lease-consumed') return false;
		try {
			const restored = input.restoreAuthorizedRouteToken(
				lease.connectionId,
				lease.session,
				lease.windowId,
				lease.eventId,
				lease.tapToken,
			);
			attempt.phase = restored
				? { kind: 'lease-restored', lease }
				: { kind: 'restoration-failed', lease };
			return restored;
		} catch (error) {
			attempt.phase = { kind: 'restoration-failed', lease };
			throw error;
		}
	};

	const transitionCommit = (attempt: ActiveAttempt, routeKey: string): void => {
		if (attempt.phase.kind !== 'lease-consumed') return;
		if (!isRequestCurrent(attempt.request)) return;
		const lease = attempt.phase.lease;
		attempt.phase = { kind: 'committed', lease, routeKey };
		try {
			input.publishHandled(routeKey);
		} catch (error) {
			input.warn('agent notification route state publication failed', error);
		}
	};

	const outcomeFor = (
		phase: AttemptPhase,
		helperHandled: boolean,
	): AttemptOutcome => {
		switch (phase.kind) {
			case 'committed':
				return 'committed';
			case 'lease-restored':
				return 'restored';
			case 'restoration-failed':
				return 'restoration-failed';
			case 'lease-consumed':
				return helperHandled ? 'stale-success' : 'failed';
			case 'authorizing':
				return 'unauthorized';
			case 'settled':
				return phase.outcome;
		}
	};

	async function runAttempt(attempt: ActiveAttempt): Promise<AttemptOutcome> {
		const { route, context } = attempt.request;
		const helperHandled = await handleAgentNotificationRoute({
			...route,
			storedConnectionId: context.storedConnectionId,
			tmuxTarget: context.tmuxTarget,
			isRouteHandled: (routeKey) =>
				input.getSnapshot().handledRouteKey === routeKey,
			markRouteHandled: (routeKey) => transitionCommit(attempt, routeKey),
			consumeAuthorizedRouteToken: () =>
				attempt.request.resolved
					? transitionConsume(attempt, attempt.request.resolved)
					: false,
			restoreAuthorizedRouteToken: () =>
				attempt.request.resolved
					? transitionRestore(attempt, attempt.request.resolved)
					: false,
			runWorkmuxCommand: input.runWorkmuxCommand,
			acknowledge: (connectionId, session, windowId) => {
				if (attempt.phase.kind !== 'committed') return;
				try {
					input.acknowledge(connectionId, session, windowId);
				} catch (error) {
					input.warn('agent notification route acknowledge failed', error);
				}
			},
			warn: input.warn,
		});
		return outcomeFor(attempt.phase, helperHandled);
	}

	function promoteAfter(attempt: ActiveAttempt, outcome: AttemptOutcome): void {
		if (active !== attempt) return;
		active = null;
		const next = queued;
		queued = null;
		if (!next) return;
		if (!isRequestCurrent(next)) {
			next.resolve(false);
			return;
		}
		if (sameAuthorization(attempt.request, next)) {
			if (
				outcome !== 'restored' ||
				attempt.request.retryBudget !== 'restoration-available' ||
				next.blockedByInvalidation
			) {
				next.resolve(false);
				return;
			}
			next.retryBudget = 'none';
		}
		void startAttempt(next).then(next.resolve, (error: unknown) => {
			input.warn('agent notification queued route failed', error);
			next.resolve(false);
		});
	}

	function startAttempt(request: RouteRequest): Promise<boolean> {
		invalidationReason = null;
		let resolvePhysical!: (handled: boolean) => void;
		let rejectPhysical!: (error: unknown) => void;
		const promise = new Promise<boolean>((resolve, reject) => {
			resolvePhysical = resolve;
			rejectPhysical = reject;
		});
		const attempt: ActiveAttempt = {
			request,
			phase: { kind: 'authorizing' },
			promise,
		};
		active = attempt;
		void (async () => {
			let outcome: AttemptOutcome = 'failed';
			try {
				outcome = await runAttempt(attempt);
				attempt.phase = { kind: 'settled', outcome };
				resolvePhysical(outcome === 'committed');
			} catch (error) {
				attempt.phase = { kind: 'settled', outcome: 'failed' };
				rejectPhysical(error);
			} finally {
				promoteAfter(attempt, outcome);
			}
		})();
		return callerPromise(attempt, request.generation, request.contextRevision);
	}

	const queueRequest = (request: RouteRequest): Promise<boolean> => {
		if (
			queued &&
			queued.contextRevision === request.contextRevision &&
			queued.generation === request.generation &&
			equivalentIdentity(queued, request)
		) {
			return queued.promise;
		}
		settleQueued();
		request.sequence = ++latestSequence;
		let resolveQueued!: (handled: boolean) => void;
		const promise = new Promise<boolean>((resolve) => {
			resolveQueued = resolve;
		});
		queued = { ...request, promise, resolve: resolveQueued };
		return promise;
	};

	return {
		handleRoute: (route) => {
			if (disposed || input.isDisposed()) return Promise.resolve(false);
			input.beginRouteEpoch();
			const request = currentRequest(route);
			if (active) {
				const sameContext =
					active.request.contextRevision === request.contextRevision;
				if (
					active.phase.kind !== 'committed' &&
					active.phase.kind !== 'settled' &&
					sameContext &&
					equivalentIdentity(active.request, request) &&
					(active.request.generation === request.generation ||
						invalidationReason === 'unmount')
				) {
					invalidationReason = null;
					active.request.generation = request.generation;
					return callerPromise(
						active,
						request.generation,
						request.contextRevision,
					);
				}
				return queueRequest(request);
			}
			request.sequence = ++latestSequence;
			settleQueued();
			invalidationReason = null;
			return startAttempt(request);
		},
		invalidate: (reason) => {
			settleQueued();
			if (reason !== 'unmount' || invalidationReason === null) {
				invalidationReason = reason;
			}
		},
		contextChanged: () => {
			settleQueued();
		},
		dispose: () => {
			disposed = true;
			settleQueued();
		},
	};
}
