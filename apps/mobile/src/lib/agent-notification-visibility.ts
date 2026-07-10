import { createAgentNotificationRouteIdentityKey } from './agent-notification-route';
import { rootLogger } from './logger';
import {
	buildWorkmuxAppNotificationOpenArgv,
	buildWorkmuxAppWindowArgv,
	parseWorkmuxAppWindowOutput,
} from './workmux-app-commands';

const logger = rootLogger.extend('AgentNotificationVisibility');

export type VisibleAgentNotificationSnapshot = {
	isFocused: boolean;
	isAppActive: boolean;
	connectionId: string | null;
	channelId: number | null;
	tmuxTarget: string;
};

export type VisibleAgentNotificationAcknowledgeOptions = {
	platformOS: string;
	connectionId: string | null;
	channelId: number;
	tmuxEnabled: boolean;
	tmuxTarget: string;
	getVisibility: () => VisibleAgentNotificationSnapshot;
	nextRequestId: () => number;
	isCurrentRequest: (requestId: number) => boolean;
	runWorkmuxCommand: (argv: string[], timeoutMs: number) => Promise<string>;
	acknowledge: (
		connectionId: string,
		session: string,
		windowId: string,
	) => void;
	warn: (message: string, error: unknown) => void;
};

export type AgentNotificationRouteOptions = {
	agentConnectionId: string | null;
	storedConnectionId: string | null | undefined;
	agentSession: string | null;
	agentWindowId: string | null;
	agentEventId: string | null;
	agentTapToken: string | null;
	tmuxTarget: string;
	isRouteHandled: (routeKey: string) => boolean;
	markRouteHandled: (routeKey: string) => void;
	consumeAuthorizedRouteToken: (
		connectionId: string,
		session: string,
		windowId: string,
		eventId: string,
		tapToken: string,
	) => boolean;
	restoreAuthorizedRouteToken?: (
		connectionId: string,
		session: string,
		windowId: string,
		eventId: string,
		tapToken: string,
	) => boolean;
	runWorkmuxCommand: (argv: string[], timeoutMs: number) => Promise<string>;
	acknowledge: (
		connectionId: string,
		session: string,
		windowId: string,
	) => void;
	warn: (message: string, error: unknown) => void;
};

export type ResolvedAgentNotificationRoute = Readonly<{
	connectionId: string;
	session: string;
	windowId: string;
	eventId: string;
	tapToken: string;
	routeKey: string;
	authorizationIdentityKey: string;
}>;

export type AgentNotificationRouteTransactionOutcome =
	| { kind: 'duplicate' }
	| { kind: 'not-authorized' }
	| { kind: 'selected' }
	| { kind: 'failed-restored' }
	| { kind: 'failed-not-restored' };

export type ResolvedAgentNotificationRouteTransactionOptions = {
	isRouteHandled(routeKey: string): boolean;
	consumeAuthorizedRouteToken(
		connectionId: string,
		session: string,
		windowId: string,
		eventId: string,
		tapToken: string,
	): boolean;
	restoreAuthorizedRouteToken?(
		connectionId: string,
		session: string,
		windowId: string,
		eventId: string,
		tapToken: string,
	): boolean;
	runWorkmuxCommand(argv: string[], timeoutMs: number): Promise<string>;
	warn(message: string, error: unknown): void;
};

export function resolveAgentNotificationRoute(input: {
	agentConnectionId: string | null;
	storedConnectionId: string | null | undefined;
	agentSession: string | null;
	agentWindowId: string | null;
	agentEventId: string | null;
	agentTapToken: string | null;
	tmuxTarget: string;
}): ResolvedAgentNotificationRoute | null {
	const connectionId = input.agentConnectionId || input.storedConnectionId;
	if (!connectionId || !input.agentWindowId) return null;
	if (
		input.agentConnectionId &&
		input.storedConnectionId &&
		input.agentConnectionId !== input.storedConnectionId
	) {
		return null;
	}
	if (!input.agentEventId || !input.agentTapToken) return null;
	const session = input.agentSession || input.tmuxTarget.trim() || 'main';
	return Object.freeze({
		connectionId,
		session,
		windowId: input.agentWindowId,
		eventId: input.agentEventId,
		tapToken: input.agentTapToken,
		routeKey: createAgentNotificationRouteIdentityKey({
			connectionId,
			session,
			windowId: input.agentWindowId,
			eventId: input.agentEventId,
		}),
		authorizationIdentityKey: JSON.stringify([
			connectionId,
			session,
			input.agentWindowId,
			input.agentEventId,
			input.agentTapToken,
		]),
	});
}

function warnRouteBestEffort(
	warn: (message: string, error: unknown) => void,
	message: string,
	error: unknown,
): void {
	try {
		warn(message, error);
	} catch {
		// Notification routing must remain best effort.
	}
}

function restoreResolvedAgentNotificationRouteTransaction(
	transaction: ResolvedAgentNotificationRoute,
	restoreAuthorizedRouteToken:
		| ResolvedAgentNotificationRouteTransactionOptions['restoreAuthorizedRouteToken']
		| undefined,
	warn: (message: string, error: unknown) => void,
): boolean {
	if (!restoreAuthorizedRouteToken) return false;
	try {
		return restoreAuthorizedRouteToken(
			transaction.connectionId,
			transaction.session,
			transaction.windowId,
			transaction.eventId,
			transaction.tapToken,
		);
	} catch (error) {
		warnRouteBestEffort(
			warn,
			'failed to restore agent notification route token',
			error,
		);
		return false;
	}
}

export async function executeResolvedAgentNotificationRouteTransaction(
	transaction: ResolvedAgentNotificationRoute,
	options: ResolvedAgentNotificationRouteTransactionOptions,
): Promise<AgentNotificationRouteTransactionOutcome> {
	if (options.isRouteHandled(transaction.routeKey)) {
		return { kind: 'duplicate' };
	}
	try {
		if (
			!options.consumeAuthorizedRouteToken(
				transaction.connectionId,
				transaction.session,
				transaction.windowId,
				transaction.eventId,
				transaction.tapToken,
			)
		) {
			return { kind: 'not-authorized' };
		}
	} catch (error) {
		warnRouteBestEffort(
			options.warn,
			'failed to consume agent notification route token',
			error,
		);
		return { kind: 'not-authorized' };
	}

	try {
		await options.runWorkmuxCommand(
			buildWorkmuxAppNotificationOpenArgv(
				transaction.session,
				transaction.windowId,
			),
			10_000,
		);
		return { kind: 'selected' };
	} catch (error) {
		const restored = restoreResolvedAgentNotificationRouteTransaction(
			transaction,
			options.restoreAuthorizedRouteToken,
			options.warn,
		);
		warnRouteBestEffort(
			options.warn,
			'failed to select agent notification window',
			error,
		);
		return { kind: restored ? 'failed-restored' : 'failed-not-restored' };
	}
}

const pendingListeners = new Set<() => void>();

export function subscribeAgentNotificationPending(listener: () => void) {
	pendingListeners.add(listener);
	return () => {
		pendingListeners.delete(listener);
	};
}

export function notifyAgentNotificationPending() {
	for (const listener of Array.from(pendingListeners)) {
		try {
			listener();
		} catch (error) {
			logger.warn('agent notification pending listener failed', error);
		}
	}
}

export async function handleAgentNotificationRoute({
	agentConnectionId,
	storedConnectionId,
	agentSession,
	agentWindowId,
	agentEventId,
	agentTapToken,
	tmuxTarget,
	isRouteHandled,
	markRouteHandled,
	consumeAuthorizedRouteToken,
	restoreAuthorizedRouteToken,
	runWorkmuxCommand,
	acknowledge,
	warn,
}: AgentNotificationRouteOptions) {
	const resolved = resolveAgentNotificationRoute({
		agentConnectionId,
		storedConnectionId,
		agentSession,
		agentWindowId,
		agentEventId,
		agentTapToken,
		tmuxTarget,
	});
	if (!resolved) return false;
	const outcome = await executeResolvedAgentNotificationRouteTransaction(
		resolved,
		{
			isRouteHandled,
			consumeAuthorizedRouteToken,
			restoreAuthorizedRouteToken,
			runWorkmuxCommand,
			warn,
		},
	);
	if (outcome.kind !== 'selected') return false;
	try {
		markRouteHandled(resolved.routeKey);
		acknowledge(resolved.connectionId, resolved.session, resolved.windowId);
		return true;
	} catch (error) {
		restoreResolvedAgentNotificationRouteTransaction(
			resolved,
			restoreAuthorizedRouteToken,
			warn,
		);
		warnRouteBestEffort(
			warn,
			'failed to select agent notification window',
			error,
		);
		return false;
	}
}

export async function acknowledgeVisibleAgentNotification({
	platformOS,
	connectionId,
	channelId,
	tmuxEnabled,
	tmuxTarget,
	getVisibility,
	nextRequestId,
	isCurrentRequest,
	runWorkmuxCommand,
	acknowledge,
	warn,
}: VisibleAgentNotificationAcknowledgeOptions) {
	if (platformOS !== 'android') return;
	if (!connectionId || !tmuxEnabled) return;

	const initialVisibility = getVisibility();
	if (!initialVisibility.isFocused || !initialVisibility.isAppActive) return;

	try {
		const sessionName = tmuxTarget.trim() || 'main';
		const requestId = nextRequestId();
		const connectionIdSnapshot = connectionId;
		const channelIdSnapshot = channelId;
		const sessionNameSnapshot = sessionName;
		const output = await runWorkmuxCommand(
			buildWorkmuxAppWindowArgv(sessionName),
			10_000,
		);
		const { windowId } = parseWorkmuxAppWindowOutput(output);
		const visibility = getVisibility();
		if (!windowId || !visibility.isFocused || !visibility.isAppActive) return;
		if (!isCurrentRequest(requestId)) return;
		if (visibility.connectionId !== connectionIdSnapshot) return;
		if (visibility.channelId !== channelIdSnapshot) return;
		if (visibility.tmuxTarget !== sessionNameSnapshot) return;
		acknowledge(connectionIdSnapshot, sessionNameSnapshot, windowId);
	} catch (error) {
		warn('agent notification acknowledge failed', error);
	}
}
