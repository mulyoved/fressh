import {
	executeResolvedAgentNotificationRouteTransaction,
	resolveAgentNotificationRoute,
	type AgentNotificationRouteTransactionOutcome,
	type ResolvedAgentNotificationRoute,
} from '../agent-notification-visibility';
import { type ControllerInvalidationReason } from './controller-core';
import {
	type ShellNotificationRoute,
	type ShellNotificationsState,
} from './notifications-core';

type RetryBudget = 'restoration-available' | 'none';

type RouteRequest = {
	contextRevision: number;
	generation: number;
	sequence: number;
	rawIdentityKey: string;
	transaction: ResolvedAgentNotificationRoute | null;
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
	| { kind: 'executing' }
	| { kind: 'selected'; transaction: ResolvedAgentNotificationRoute }
	| { kind: 'failed-restored'; transaction: ResolvedAgentNotificationRoute }
	| { kind: 'failed-not-restored'; transaction: ResolvedAgentNotificationRoute }
	| {
			kind: 'committed';
			transaction: ResolvedAgentNotificationRoute;
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
		left: Pick<RouteRequest, 'transaction' | 'rawIdentityKey'>,
		right: Pick<RouteRequest, 'transaction' | 'rawIdentityKey'>,
	): boolean => {
		if (left.transaction && right.transaction) {
			return (
				left.transaction.authorizationIdentityKey ===
				right.transaction.authorizationIdentityKey
			);
		}
		return (
			!left.transaction &&
			!right.transaction &&
			left.rawIdentityKey === right.rawIdentityKey
		);
	};

	const sameAuthorization = (
		left: RouteRequest,
		right: RouteRequest,
	): boolean =>
		Boolean(
			left.transaction &&
				right.transaction &&
				left.transaction.authorizationIdentityKey ===
					right.transaction.authorizationIdentityKey,
		);

	const currentRequest = (route: ShellNotificationRoute): RouteRequest => {
		const snapshot = input.getSnapshot();
		const context = { ...snapshot.context };
		const routeSnapshot: ShellNotificationRoute = {
			agentConnectionId: route.agentConnectionId,
			agentSession: route.agentSession,
			agentWindowId: route.agentWindowId,
			agentEventId: route.agentEventId,
			agentTapToken: route.agentTapToken,
		};
		return {
			contextRevision: snapshot.contextRevision,
			generation: snapshot.generation,
			sequence: 0,
			rawIdentityKey: rawIdentityKey(routeSnapshot),
			transaction: resolveAgentNotificationRoute({
				...routeSnapshot,
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

	const commitSelected = (
		attempt: ActiveAttempt,
		transaction: ResolvedAgentNotificationRoute,
	): AttemptOutcome => {
		attempt.phase = { kind: 'selected', transaction };
		if (!isRequestCurrent(attempt.request)) return 'stale-success';
		attempt.phase = { kind: 'committed', transaction };
		try {
			input.publishHandled(transaction.routeKey);
		} catch (error) {
			input.warn('agent notification route state publication failed', error);
		}
		try {
			input.acknowledge(
				transaction.connectionId,
				transaction.session,
				transaction.windowId,
			);
		} catch (error) {
			input.warn('agent notification route acknowledge failed', error);
		}
		return 'committed';
	};

	const mapTransactionOutcome = (
		attempt: ActiveAttempt,
		transaction: ResolvedAgentNotificationRoute,
		outcome: AgentNotificationRouteTransactionOutcome,
	): AttemptOutcome => {
		switch (outcome.kind) {
			case 'selected':
				return commitSelected(attempt, transaction);
			case 'failed-restored':
				attempt.phase = { kind: 'failed-restored', transaction };
				return 'restored';
			case 'failed-not-restored':
				attempt.phase = { kind: 'failed-not-restored', transaction };
				return 'restoration-failed';
			case 'duplicate':
			case 'not-authorized':
				return 'unauthorized';
		}
	};

	async function runAttempt(attempt: ActiveAttempt): Promise<AttemptOutcome> {
		const { transaction } = attempt.request;
		if (!transaction) return 'unauthorized';
		const outcome = await executeResolvedAgentNotificationRouteTransaction(
			transaction,
			{
				isRouteHandled: (routeKey) =>
					input.getSnapshot().handledRouteKey === routeKey,
				consumeAuthorizedRouteToken: input.consumeAuthorizedRouteToken,
				restoreAuthorizedRouteToken: input.restoreAuthorizedRouteToken,
				runWorkmuxCommand: input.runWorkmuxCommand,
				warn: input.warn,
			},
		);
		return mapTransactionOutcome(attempt, transaction, outcome);
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
			phase: { kind: 'executing' },
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
					settleQueued();
					active.request.sequence = ++latestSequence;
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
