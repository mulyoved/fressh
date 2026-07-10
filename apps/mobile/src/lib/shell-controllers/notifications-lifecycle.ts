import { type ShellActivitySnapshot } from './activity-core';
import { type ControllerInvalidationReason } from './controller-core';
import {
	type ShellNotificationContext,
	type ShellNotificationRoute,
} from './notifications-core';

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
		context.transportKey,
		context.targetKey,
		context.storedConnectionId,
	]);
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
