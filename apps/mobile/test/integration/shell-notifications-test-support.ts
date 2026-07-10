import { createShellActivityControllerCore } from '../../src/lib/shell-controllers/activity-core';
import {
	createShellNotificationsControllerCore,
	type ShellNotificationContext,
} from '../../src/lib/shell-controllers/notifications-core';
import {
	createShellTargetKey,
	createShellTransportKey,
} from '../../src/lib/shell-controllers/source-keys';

type Deferred<T> = {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
};

type WindowCommand = Deferred<string> & {
	argv: string[];
	timeoutMs: number;
};

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((innerResolve, innerReject) => {
		resolve = innerResolve;
		reject = innerReject;
	});
	return { promise, resolve, reject };
}

export function buildWorkmuxWindowOutput(windowId = '@12'): string {
	return JSON.stringify({
		sessionName: 'main',
		target: `main:${windowId}`,
		windowId,
		windowIndex: 12,
		windowName: 'mobile',
		workspaceId: 'workspace-1',
		role: 'codex',
		roleWindow: true,
		homeWindow: false,
	});
}

export function createNotificationsHarness(
	options: {
		acknowledgeError?: Error;
		deferRouteCommands?: boolean;
		routeCommandError?: Error;
		warnError?: Error;
	} = {},
) {
	const activity = createShellActivityControllerCore({
		focused: true,
		appState: 'active',
	});
	const windowCommands: WindowCommand[] = [];
	const acknowledgedWindowIds: string[] = [];
	const acknowledgements: {
		connectionId: string;
		session: string;
		windowId: string;
	}[] = [];
	const warnings: unknown[] = [];
	const consumedTokens: string[] = [];
	const restoredTokens: string[] = [];
	const routeCommands: WindowCommand[] = [];
	let routeTokenAvailable = true;

	const context = (
		overrides: Partial<
			Omit<ShellNotificationContext, 'transportKey' | 'targetKey'>
		> = {},
	): ShellNotificationContext => {
		const storedConnectionId = Object.hasOwn(overrides, 'storedConnectionId')
			? (overrides.storedConnectionId ?? null)
			: 'saved-host';
		const channelId = overrides.channelId ?? 7;
		const tmuxTarget = overrides.tmuxTarget ?? 'main';
		const transportKey = createShellTransportKey(
			storedConnectionId ?? '',
			channelId,
		);
		return {
			transportKey,
			targetKey: createShellTargetKey(transportKey, tmuxTarget),
			storedConnectionId,
			channelId,
			tmuxEnabled: overrides.tmuxEnabled ?? true,
			tmuxTarget,
		};
	};

	const core = createShellNotificationsControllerCore({
		activity,
		context: context(),
		platformOS: 'android',
		runWorkmuxCommand: (argv, timeoutMs) => {
			if (argv[2] === 'notification') {
				const deferred = createDeferred<string>();
				routeCommands.push({ ...deferred, argv, timeoutMs });
				if (!options.deferRouteCommands) {
					if (options.routeCommandError) {
						deferred.reject(options.routeCommandError);
					} else {
						deferred.resolve('');
					}
				}
				return deferred.promise;
			}
			const deferred = createDeferred<string>();
			windowCommands.push({ ...deferred, argv, timeoutMs });
			return deferred.promise;
		},
		consumeAuthorizedRouteToken: (
			_connectionId,
			_session,
			_windowId,
			_eventId,
			tapToken,
		) => {
			consumedTokens.push(tapToken);
			if (!routeTokenAvailable) return false;
			routeTokenAvailable = false;
			return true;
		},
		restoreAuthorizedRouteToken: (
			_connectionId,
			_session,
			_windowId,
			_eventId,
			tapToken,
		) => {
			restoredTokens.push(tapToken);
			routeTokenAvailable = true;
			return true;
		},
		acknowledge: (connectionId, session, windowId) => {
			if (options.acknowledgeError) throw options.acknowledgeError;
			acknowledgements.push({ connectionId, session, windowId });
			acknowledgedWindowIds.push(windowId);
		},
		warn: (_message, error) => {
			warnings.push(error);
			if (options.warnError) throw options.warnError;
		},
	});

	return {
		activity,
		acknowledgements,
		acknowledgedWindowIds,
		consumedTokens,
		context,
		core,
		restoredTokens,
		routeCommands,
		tick: () => new Promise((resolve) => setTimeout(resolve, 0)),
		validRoute: () => ({
			agentConnectionId: 'saved-host',
			agentSession: 'main',
			agentWindowId: '@12',
			agentEventId: 'event-1',
			agentTapToken: 'token-1',
		}),
		warnings,
		windowCommands,
	};
}
