import { type ShellActivitySnapshot } from './activity-core';
import { type ControllerInvalidationReason } from './controller-core';
import {
	createShellNotificationContextIdentity,
	type ShellNotificationCommandPortKey,
	type ShellNotificationContext,
	type ShellNotificationRoute,
	type ShellNotificationsState,
} from './notifications-core';
import { type ShellWorkmuxPort } from './session-contracts';

export function createShellNotificationAutomaticAcknowledger(): {
	request(
		activity: ShellActivitySnapshot,
		notifications: ShellNotificationsState,
		onRequest: () => void,
	): boolean;
} {
	let lastRequestKey: string | null = null;
	return {
		request: (activity, notifications, onRequest) => {
			if (!activity.interactive) return false;
			const requestKey = JSON.stringify([
				activity.generation,
				notifications.generation,
				notifications.contextRevision,
				notifications.commandPortRevision,
			]);
			if (lastRequestKey === requestKey) return false;
			lastRequestKey = requestKey;
			onRequest();
			return true;
		},
	};
}

export function createShellNotificationRouteEffectKey(
	route: ShellNotificationRoute,
	context: ShellNotificationContext,
): string {
	return JSON.stringify([
		route.agentConnectionId,
		route.agentSession,
		route.agentWindowId,
		route.agentEventId,
		route.agentTapToken,
		createShellNotificationContextIdentity(context),
	]);
}

export function createShellNotificationHookOrchestrator<
	TInput extends {
		context: ShellNotificationContext;
		route: ShellNotificationRoute;
		commandPortKey: ShellNotificationCommandPortKey;
		workmux: Pick<ShellWorkmuxPort, 'command'>;
	},
>(
	initialInput: TInput,
): {
	getCommittedInput(): TInput;
	createRouteEffectKey(input: TInput): string;
	commitLayout(
		nextInput: TInput,
		setCommandPort: (
			key: TInput['commandPortKey'],
			workmux: TInput['workmux'],
		) => void,
		setContext: (context: ShellNotificationContext) => void,
		afterContextCommit: () => void,
	): void;
	dispatchRoutePassive(
		handleRoute: (route: ShellNotificationRoute) => Promise<boolean>,
		onError: (input: TInput, error: unknown) => void,
	): Promise<void>;
} {
	let committedInput = initialInput;
	return {
		getCommittedInput: () => committedInput,
		createRouteEffectKey: (input) =>
			createShellNotificationRouteEffectKey(input.route, input.context),
		commitLayout: (
			nextInput,
			setCommandPort,
			setContext,
			afterContextCommit,
		) => {
			committedInput = nextInput;
			setCommandPort(nextInput.commandPortKey, nextInput.workmux);
			setContext(nextInput.context);
			afterContextCommit();
		},
		dispatchRoutePassive: async (handleRoute, onError) => {
			const route = committedInput.route;
			try {
				await handleRoute(route);
			} catch (error) {
				onError(committedInput, error);
			}
		},
	};
}

export function setupShellNotificationActivityEffect(input: {
	getSnapshot(): ShellActivitySnapshot;
	subscribe(listener: () => void): () => void;
	onInteractive(): void;
	onInactive(reason: ControllerInvalidationReason): void;
}): () => void {
	let previous: ShellActivitySnapshot | null = null;
	const reconcile = (): void => {
		const snapshot = input.getSnapshot();
		const priorSnapshot = previous;
		previous = snapshot;
		if (snapshot.interactive) {
			input.onInteractive();
		} else if (priorSnapshot?.interactive) {
			input.onInactive(snapshot.focused ? 'app-inactive' : 'focus-lost');
		}
	};
	const unsubscribe = input.subscribe(reconcile);
	reconcile();
	return unsubscribe;
}

export function setupShellNotificationPendingEffect(input: {
	platformOS: string;
	subscribe(listener: () => void): () => void;
	onPending(): void;
}): () => void {
	if (input.platformOS !== 'android') return () => {};
	return input.subscribe(input.onPending);
}
