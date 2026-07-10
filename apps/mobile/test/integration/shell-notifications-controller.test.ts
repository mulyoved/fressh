import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellActivityControllerCore } from '../../src/lib/shell-controllers/activity-core';
import {
	createShellNotificationsControllerCore,
	type ShellNotificationContext,
} from '../../src/lib/shell-controllers/notifications-core';
import {
	createShellNotificationAutomaticAcknowledger,
	createShellNotificationRouteEffectKey,
	setupShellNotificationActivityEffect,
	setupShellNotificationPendingEffect,
} from '../../src/lib/shell-controllers/notifications-lifecycle';
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

function buildWorkmuxWindowOutput(windowId = '@12'): string {
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

function createNotificationsHarness(
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

void test('notification core restores consumed token when route command fails', async () => {
	const harness = createNotificationsHarness({
		routeCommandError: new Error('failed'),
	});
	const handled = await harness.core.handleRoute(harness.validRoute());

	assert.equal(handled, false);
	assert.deepEqual(harness.consumedTokens, ['token-1']);
	assert.deepEqual(harness.restoredTokens, ['token-1']);
});

void test('notification core handles an authorized route only once', async () => {
	const harness = createNotificationsHarness();
	const route = harness.validRoute();

	assert.equal(await harness.core.handleRoute(route), true);
	assert.equal(await harness.core.handleRoute(route), false);
	assert.equal(harness.routeCommands.length, 1);
	assert.equal(
		harness.core.getSnapshot().handledRouteKey,
		'["saved-host","main","@12","event-1"]',
	);
});

void test('notification route acknowledgement remains best effort after selection', async () => {
	const failure = new Error('bridge failed');
	const harness = createNotificationsHarness({ acknowledgeError: failure });

	assert.equal(await harness.core.handleRoute(harness.validRoute()), true);
	assert.deepEqual(harness.restoredTokens, []);
	assert.deepEqual(harness.warnings, [failure]);
	assert.equal(
		harness.core.getSnapshot().handledRouteKey,
		'["saved-host","main","@12","event-1"]',
	);
});

async function assertStaleSuccessfulRoute(
	mutate: (harness: ReturnType<typeof createNotificationsHarness>) => void,
): Promise<void> {
	const harness = createNotificationsHarness({ deferRouteCommands: true });
	const pending = harness.core.handleRoute(harness.validRoute());
	assert.deepEqual(harness.consumedTokens, ['token-1']);
	mutate(harness);
	harness.routeCommands[0]?.resolve('');

	assert.equal(await pending, false);
	assert.equal(harness.core.getSnapshot().handledRouteKey, null);
	assert.deepEqual(harness.acknowledgements, []);
	assert.deepEqual(harness.consumedTokens, ['token-1']);
	assert.deepEqual(harness.restoredTokens, []);
}

void test('semantic context change suppresses a pending successful route', async () => {
	await assertStaleSuccessfulRoute((harness) => {
		harness.core.setContext(harness.context({ tmuxTarget: 'other' }));
	});
});

void test('stored connection change suppresses a pending successful route without advancing generation', async () => {
	await assertStaleSuccessfulRoute((harness) => {
		const before = harness.core.getSnapshot();
		harness.core.setContext({
			...before.context,
			storedConnectionId: 'replacement-host',
		});
		assert.equal(harness.core.getSnapshot().generation, before.generation);
	});
});

void test('explicit invalidation suppresses a pending successful route', async () => {
	await assertStaleSuccessfulRoute((harness) => {
		harness.core.invalidate('runtime-reset');
	});
});

void test('route handling establishes a fresh explicit invalidation epoch', async () => {
	const harness = createNotificationsHarness({ deferRouteCommands: true });
	harness.core.invalidate('source-change');
	const pending = harness.core.handleRoute(harness.validRoute());
	harness.core.invalidate('runtime-reset');
	harness.routeCommands[0]?.resolve('');

	assert.equal(await pending, false);
	assert.equal(harness.core.getSnapshot().handledRouteKey, null);
	assert.deepEqual(harness.acknowledgements, []);
	assert.deepEqual(harness.consumedTokens, ['token-1']);
	assert.deepEqual(harness.restoredTokens, []);
});

void test('disposal suppresses a pending successful route', async () => {
	await assertStaleSuccessfulRoute((harness) => {
		harness.core.dispose();
	});
});

void test('a newer route request supersedes a pending successful route', async () => {
	await assertStaleSuccessfulRoute((harness) => {
		void harness.core.handleRoute({
			...harness.validRoute(),
			agentTapToken: null,
		});
	});
});

void test('notification core coalesces concurrent visible acknowledgements', async () => {
	const harness = createNotificationsHarness();
	const first = harness.core.acknowledgeVisible();
	const queuedA = harness.core.acknowledgeVisible();
	const queuedB = harness.core.acknowledgeVisible();

	assert.equal(harness.windowCommands.length, 1);
	assert.equal(harness.core.getSnapshot().acknowledgeInFlight, true);
	assert.equal(harness.core.getSnapshot().acknowledgeQueued, true);

	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput('@12'));
	await harness.tick();
	assert.equal(harness.windowCommands.length, 2);
	harness.windowCommands[1]?.resolve(buildWorkmuxWindowOutput('@13'));
	await Promise.all([first, queuedA, queuedB]);

	assert.deepEqual(harness.acknowledgedWindowIds, ['@12', '@13']);
	assert.equal(harness.core.getSnapshot().acknowledgeInFlight, false);
	assert.equal(harness.core.getSnapshot().acknowledgeQueued, false);
});

void test('notification queued attempt stays stale across an activity round trip', async () => {
	const harness = createNotificationsHarness();
	const active = harness.core.acknowledgeVisible();
	const queued = harness.core.acknowledgeVisible();

	harness.activity.setFocused(false);
	harness.activity.setFocused(true);
	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput('@12'));
	await harness.tick();
	const commandCount = harness.windowCommands.length;
	for (const command of harness.windowCommands.slice(1)) {
		command.resolve(buildWorkmuxWindowOutput('@13'));
	}
	await Promise.all([active, queued]);

	assert.equal(commandCount, 1);
	assert.deepEqual(harness.acknowledgedWindowIds, []);
});

void test('new queued trigger refreshes the retained activity capture', async () => {
	const harness = createNotificationsHarness();
	const active = harness.core.acknowledgeVisible();
	const staleQueued = harness.core.acknowledgeVisible();
	harness.activity.setFocused(false);
	harness.activity.setFocused(true);
	const refreshedQueued = harness.core.acknowledgeVisible();

	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput('@12'));
	await harness.tick();
	assert.equal(harness.windowCommands.length, 2);
	harness.windowCommands[1]?.resolve(buildWorkmuxWindowOutput('@13'));
	await Promise.all([active, staleQueued, refreshedQueued]);

	assert.deepEqual(harness.acknowledgedWindowIds, ['@13']);
});

void test('notification worker recovers after an initial publication subscriber throws', async () => {
	const harness = createNotificationsHarness();
	const failure = new Error('subscriber failed');
	let shouldThrow = true;
	harness.core.subscribe(() => {
		if (shouldThrow && harness.core.getSnapshot().acknowledgeInFlight) {
			shouldThrow = false;
			throw failure;
		}
	});

	await assert.rejects(harness.core.acknowledgeVisible(), failure);
	const inFlightAfterFailure = harness.core.getSnapshot().acknowledgeInFlight;
	const recovered = harness.core.acknowledgeVisible();
	const commandCount = harness.windowCommands.length;
	if (harness.windowCommands[0]) {
		harness.windowCommands[0].resolve(buildWorkmuxWindowOutput('@12'));
	} else {
		harness.core.dispose();
	}
	await recovered;

	assert.equal(inFlightAfterFailure, false);
	assert.equal(commandCount, 1);
	assert.deepEqual(harness.acknowledgedWindowIds, ['@12']);
});

void test('notification core skips an initial attempt invalidated during publication', async () => {
	const harness = createNotificationsHarness();
	let invalidated = false;
	harness.core.subscribe(() => {
		if (!invalidated && harness.core.getSnapshot().acknowledgeInFlight) {
			invalidated = true;
			harness.core.invalidate('source-change');
		}
	});

	const pending = harness.core.acknowledgeVisible();
	const commandCount = harness.windowCommands.length;
	for (const command of harness.windowCommands) {
		command.resolve(buildWorkmuxWindowOutput());
	}
	await pending;

	assert.equal(commandCount, 0);
	assert.deepEqual(harness.acknowledgedWindowIds, []);
	assert.equal(harness.core.getSnapshot().acknowledgeInFlight, false);
});

void test('notification queued publication registers its waiter before reentrant invalidation', async () => {
	const harness = createNotificationsHarness();
	const active = harness.core.acknowledgeVisible();
	let invalidated = false;
	harness.core.subscribe(() => {
		if (!invalidated && harness.core.getSnapshot().acknowledgeQueued) {
			invalidated = true;
			harness.core.invalidate('source-change');
		}
	});
	const queued = harness.core.acknowledgeVisible();
	let queuedSettled = false;
	void queued.then(() => {
		queuedSettled = true;
	});

	await harness.tick();
	const settledBeforeLookupCompletion = queuedSettled;
	const queuedBeforeLookupCompletion =
		harness.core.getSnapshot().acknowledgeQueued;
	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput());
	await Promise.all([active, queued]);
	assert.equal(settledBeforeLookupCompletion, true);
	assert.equal(queuedBeforeLookupCompletion, false);
	assert.deepEqual(harness.acknowledgedWindowIds, []);
});

void test('notification core skips a promoted attempt invalidated during publication', async () => {
	const harness = createNotificationsHarness();
	const active = harness.core.acknowledgeVisible();
	const promoted = harness.core.acknowledgeVisible();
	let invalidated = false;
	harness.core.subscribe(() => {
		const snapshot = harness.core.getSnapshot();
		if (
			!invalidated &&
			snapshot.acknowledgeInFlight &&
			!snapshot.acknowledgeQueued
		) {
			invalidated = true;
			harness.core.invalidate('source-change');
		}
	});

	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput('@12'));
	await harness.tick();
	const commandCount = harness.windowCommands.length;
	for (const command of harness.windowCommands.slice(1)) {
		command.resolve(buildWorkmuxWindowOutput('@13'));
	}
	await Promise.all([active, promoted]);

	assert.equal(commandCount, 1);
	assert.deepEqual(harness.acknowledgedWindowIds, ['@12']);
});

void test('notification core suppresses acknowledgement after target change', async () => {
	const harness = createNotificationsHarness();
	const pending = harness.core.acknowledgeVisible();
	const previousGeneration = harness.core.getSnapshot().generation;

	harness.core.setContext(harness.context({ tmuxTarget: 'other' }));
	assert.equal(harness.core.getSnapshot().generation, previousGeneration + 1);
	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput('@12'));
	await pending;

	assert.deepEqual(harness.acknowledgedWindowIds, []);
});

void test('target context change immediately settles queued callers without a stale rerun', async () => {
	const harness = createNotificationsHarness();
	const active = harness.core.acknowledgeVisible();
	const queued = harness.core.acknowledgeVisible();
	let queuedSettled = false;
	void queued.then(() => {
		queuedSettled = true;
	});

	harness.core.setContext(harness.context({ tmuxTarget: 'other' }));
	await harness.tick();
	assert.equal(queuedSettled, true);
	assert.equal(harness.core.getSnapshot().acknowledgeQueued, false);

	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput('@12'));
	await active;
	assert.equal(harness.windowCommands.length, 1);
	assert.deepEqual(harness.acknowledgedWindowIds, []);
});

void test('transport replacement settles obsolete work and fresh calls use replacement context', async () => {
	const harness = createNotificationsHarness();
	const active = harness.core.acknowledgeVisible();
	const queued = harness.core.acknowledgeVisible();
	let queuedSettled = false;
	void queued.then(() => {
		queuedSettled = true;
	});
	const generation = harness.core.getSnapshot().generation;
	const replacement = harness.context({
		storedConnectionId: 'replacement-host',
		channelId: 19,
		tmuxTarget: 'replacement-session',
	});

	harness.core.setContext(replacement);
	await harness.tick();
	assert.equal(harness.core.getSnapshot().generation, generation + 1);
	assert.equal(queuedSettled, true);
	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput('@12'));
	await active;
	assert.deepEqual(harness.acknowledgements, []);

	const fresh = harness.core.acknowledgeVisible();
	assert.deepEqual(harness.windowCommands[1]?.argv, [
		'tmux',
		'app',
		'window',
		'--session',
		'replacement-session',
	]);
	harness.windowCommands[1]?.resolve(buildWorkmuxWindowOutput('@19'));
	await fresh;
	assert.deepEqual(harness.core.getSnapshot().context, replacement);
	assert.deepEqual(harness.acknowledgements, [
		{
			connectionId: 'replacement-host',
			session: 'replacement-session',
			windowId: '@19',
		},
	]);
});

void test('notification core invalidates an acknowledgement when tmux is disabled', async () => {
	const harness = createNotificationsHarness();
	const pending = harness.core.acknowledgeVisible();
	const previousGeneration = harness.core.getSnapshot().generation;

	harness.core.setContext(harness.context({ tmuxEnabled: false }));
	assert.equal(harness.core.getSnapshot().generation, previousGeneration + 1);
	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput('@12'));
	await pending;

	assert.deepEqual(harness.acknowledgedWindowIds, []);
});

void test('notification core does not resurrect a lookup after tmux is re-enabled', async () => {
	const harness = createNotificationsHarness();
	const pending = harness.core.acknowledgeVisible();

	harness.core.setContext(harness.context({ tmuxEnabled: false }));
	harness.core.setContext(harness.context({ tmuxEnabled: true }));
	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput('@12'));
	await pending;

	assert.deepEqual(harness.acknowledgedWindowIds, []);
});

void test('notification core suppresses acknowledgement after activity changes', async () => {
	const harness = createNotificationsHarness();
	const pending = harness.core.acknowledgeVisible();

	harness.activity.setFocused(false);
	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput('@12'));
	await pending;

	assert.deepEqual(harness.acknowledgedWindowIds, []);
});

void test('notification core does not resurrect an acknowledgement after activity returns', async () => {
	const harness = createNotificationsHarness();
	const pending = harness.core.acknowledgeVisible();

	harness.activity.setFocused(false);
	harness.activity.setFocused(true);
	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput('@12'));
	await pending;

	assert.deepEqual(harness.acknowledgedWindowIds, []);
});

void test('notification core only handles pending notifications while interactive', async () => {
	const harness = createNotificationsHarness();

	harness.activity.setFocused(false);
	harness.core.notifyPending();
	assert.equal(harness.windowCommands.length, 0);

	harness.activity.setFocused(true);
	harness.core.notifyPending();
	assert.equal(harness.windowCommands.length, 1);
	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput());
	await harness.tick();
	assert.deepEqual(harness.acknowledgedWindowIds, ['@12']);
});

void test('notification invalidation settles queued acknowledgements without rerunning', async () => {
	const harness = createNotificationsHarness();
	const active = harness.core.acknowledgeVisible();
	const queued = harness.core.acknowledgeVisible();
	let queuedSettled = false;
	void queued.then(() => {
		queuedSettled = true;
	});

	harness.core.invalidate('source-change');
	await harness.tick();
	assert.equal(queuedSettled, true);
	assert.equal(harness.core.getSnapshot().acknowledgeQueued, false);

	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput());
	await active;
	assert.equal(harness.windowCommands.length, 1);
	assert.deepEqual(harness.acknowledgedWindowIds, []);
});

void test('notification invalidation immediately settles promoted rerun callers', async () => {
	const harness = createNotificationsHarness();
	const active = harness.core.acknowledgeVisible();
	const promoted = harness.core.acknowledgeVisible();
	let promotedSettled = false;
	void promoted.then(() => {
		promotedSettled = true;
	});

	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput('@12'));
	await harness.tick();
	assert.equal(harness.windowCommands.length, 2);

	harness.core.invalidate('source-change');
	await harness.tick();
	assert.equal(promotedSettled, true);

	const current = harness.core.acknowledgeVisible();
	let currentSettled = false;
	void current.then(() => {
		currentSettled = true;
	});
	harness.windowCommands[1]?.resolve(buildWorkmuxWindowOutput('@13'));
	await harness.tick();
	assert.equal(harness.windowCommands.length, 3);
	assert.equal(currentSettled, false);

	harness.windowCommands[2]?.resolve(buildWorkmuxWindowOutput('@14'));
	await Promise.all([active, current]);
	assert.equal(currentSettled, true);
	assert.deepEqual(harness.acknowledgedWindowIds, ['@12', '@14']);
});

void test('tmux context change immediately settles promoted callers without stale acknowledgement', async () => {
	const harness = createNotificationsHarness();
	const active = harness.core.acknowledgeVisible();
	const promoted = harness.core.acknowledgeVisible();
	let promotedSettled = false;
	void promoted.then(() => {
		promotedSettled = true;
	});

	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput('@12'));
	await harness.tick();
	assert.equal(harness.windowCommands.length, 2);
	harness.core.setContext(harness.context({ tmuxEnabled: false }));
	await harness.tick();
	assert.equal(promotedSettled, true);

	harness.windowCommands[1]?.resolve(buildWorkmuxWindowOutput('@13'));
	await active;
	assert.equal(harness.windowCommands.length, 2);
	assert.deepEqual(harness.acknowledgedWindowIds, ['@12']);
});

void test('notification invalidation advances once per acknowledgement epoch', async () => {
	const harness = createNotificationsHarness();
	let publications = 0;
	harness.core.subscribe(() => {
		publications += 1;
	});

	harness.core.invalidate('source-change');
	assert.equal(harness.core.getSnapshot().generation, 1);
	assert.equal(publications, 1);
	harness.core.invalidate('runtime-reset');
	assert.equal(harness.core.getSnapshot().generation, 1);
	assert.equal(publications, 1);

	const pending = harness.core.acknowledgeVisible();
	harness.core.invalidate('focus-lost');
	assert.equal(harness.core.getSnapshot().generation, 2);
	harness.core.invalidate('app-inactive');
	assert.equal(harness.core.getSnapshot().generation, 2);
	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput());
	await pending;
});

void test('semantic context establishes a fresh invalidation epoch', () => {
	const harness = createNotificationsHarness();

	harness.core.invalidate('source-change');
	harness.core.setContext(harness.context({ tmuxEnabled: false }));
	const contextGeneration = harness.core.getSnapshot().generation;
	harness.core.invalidate('runtime-reset');
	assert.equal(harness.core.getSnapshot().generation, contextGeneration + 1);
	harness.core.invalidate('focus-lost');
	assert.equal(harness.core.getSnapshot().generation, contextGeneration + 1);
});

void test('notification disposal settles queued acknowledgements and is idempotent', async () => {
	const harness = createNotificationsHarness();
	const active = harness.core.acknowledgeVisible();
	const queued = harness.core.acknowledgeVisible();
	let queuedSettled = false;
	void queued.then(() => {
		queuedSettled = true;
	});

	harness.core.dispose();
	harness.core.dispose();
	await harness.tick();
	assert.equal(queuedSettled, true);

	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput());
	await active;
	assert.deepEqual(harness.acknowledgedWindowIds, []);
	await harness.core.acknowledgeVisible();
	assert.equal(harness.windowCommands.length, 1);
});

void test('notification disposal immediately settles promoted rerun callers', async () => {
	const harness = createNotificationsHarness();
	const active = harness.core.acknowledgeVisible();
	const promoted = harness.core.acknowledgeVisible();
	let promotedSettled = false;
	void promoted.then(() => {
		promotedSettled = true;
	});

	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput());
	await harness.tick();
	harness.core.dispose();
	await harness.tick();
	assert.equal(promotedSettled, true);

	harness.windowCommands[1]?.resolve(buildWorkmuxWindowOutput());
	await active;
});

void test('notification core warns and settles when the Workmux lookup rejects', async () => {
	const harness = createNotificationsHarness();
	const failure = new Error('lookup failed');
	const pending = harness.core.acknowledgeVisible();

	harness.windowCommands[0]?.reject(failure);
	await pending;

	assert.deepEqual(harness.warnings, [failure]);
	assert.equal(harness.core.getSnapshot().acknowledgeInFlight, false);
	assert.equal(harness.core.getSnapshot().acknowledgeQueued, false);
});

void test('notification core warns and settles when bridge acknowledgement throws', async () => {
	const failure = new Error('bridge failed');
	const harness = createNotificationsHarness({ acknowledgeError: failure });
	const pending = harness.core.acknowledgeVisible();

	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput());
	await pending;

	assert.deepEqual(harness.warnings, [failure]);
	assert.equal(harness.core.getSnapshot().acknowledgeInFlight, false);
	assert.equal(harness.core.getSnapshot().acknowledgeQueued, false);
});

void test('notification core runs the queued attempt after the first lookup fails', async () => {
	const harness = createNotificationsHarness();
	const failure = new Error('first lookup failed');
	const active = harness.core.acknowledgeVisible();
	const queuedA = harness.core.acknowledgeVisible();
	const queuedB = harness.core.acknowledgeVisible();

	harness.windowCommands[0]?.reject(failure);
	await harness.tick();
	assert.equal(harness.windowCommands.length, 2);
	harness.windowCommands[1]?.resolve(buildWorkmuxWindowOutput('@13'));
	await Promise.all([active, queuedA, queuedB]);

	assert.deepEqual(harness.warnings, [failure]);
	assert.deepEqual(harness.acknowledgedWindowIds, ['@13']);
	assert.equal(harness.core.getSnapshot().acknowledgeInFlight, false);
	assert.equal(harness.core.getSnapshot().acknowledgeQueued, false);
});

void test('notification pending failure settles without an unhandled rejection', async () => {
	const harness = createNotificationsHarness();
	const failure = new Error('pending lookup failed');
	const unhandled: unknown[] = [];
	const onUnhandled = (error: unknown) => {
		unhandled.push(error);
	};
	process.on('unhandledRejection', onUnhandled);
	try {
		harness.core.notifyPending();
		harness.windowCommands[0]?.reject(failure);
		await harness.tick();
		await harness.tick();

		assert.deepEqual(unhandled, []);
		assert.deepEqual(harness.warnings, [failure]);
		assert.equal(harness.core.getSnapshot().acknowledgeInFlight, false);
		assert.equal(harness.core.getSnapshot().acknowledgeQueued, false);
	} finally {
		process.off('unhandledRejection', onUnhandled);
	}
});

void test('notification pending subscriber failure is reported without an unhandled rejection and recovers', async () => {
	const warnFailure = new Error('warning callback failed');
	const harness = createNotificationsHarness({ warnError: warnFailure });
	const subscriberFailure = new Error('pending subscriber failed');
	const unhandled: unknown[] = [];
	let shouldThrow = true;
	harness.core.subscribe(() => {
		if (shouldThrow && harness.core.getSnapshot().acknowledgeInFlight) {
			shouldThrow = false;
			throw subscriberFailure;
		}
	});
	const onUnhandled = (error: unknown) => {
		unhandled.push(error);
	};
	process.on('unhandledRejection', onUnhandled);
	try {
		harness.core.notifyPending();
		await harness.tick();
		await harness.tick();
		assert.deepEqual(unhandled, []);
		assert.deepEqual(harness.warnings, [subscriberFailure]);
		assert.equal(harness.core.getSnapshot().acknowledgeInFlight, false);

		const recovered = harness.core.acknowledgeVisible();
		harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput('@12'));
		await recovered;
		assert.deepEqual(harness.acknowledgedWindowIds, ['@12']);
	} finally {
		process.off('unhandledRejection', onUnhandled);
	}
});

void test('notification disposal tears down its publisher when final publication throws', () => {
	const harness = createNotificationsHarness();
	const failure = new Error('dispose subscriber failed');
	let subscriberCalls = 0;
	harness.core.subscribe(() => {
		subscriberCalls += 1;
		throw failure;
	});

	assert.throws(() => harness.core.dispose(), failure);
	let laterCalls = 0;
	harness.core.subscribe(() => {
		laterCalls += 1;
	});
	harness.core.invalidate('source-change');
	harness.core.setContext(harness.context({ tmuxTarget: 'other' }));
	harness.core.notifyPending();

	assert.equal(subscriberCalls, 1);
	assert.equal(laterCalls, 0);
});

void test('notification route effect identity changes when the stored connection hydrates', () => {
	const harness = createNotificationsHarness();
	const route = {
		...harness.validRoute(),
		agentConnectionId: null,
	};
	const unavailable = harness.context({ storedConnectionId: null });
	const hydrated = {
		...unavailable,
		storedConnectionId: 'saved-host',
	};

	assert.notEqual(
		createShellNotificationRouteEffectKey(route, unavailable),
		createShellNotificationRouteEffectKey(route, hydrated),
	);
});

void test('automatic acknowledgement retries interactive stored connection hydration once', async () => {
	const harness = createNotificationsHarness();
	const automaticAcknowledger = createShellNotificationAutomaticAcknowledger();
	const activity = harness.activity.getSnapshot();
	const initialContext = harness.core.getSnapshot().context;
	harness.core.setContext({
		...initialContext,
		storedConnectionId: null,
	});
	const unavailable = harness.core.getSnapshot();
	const requests: Promise<void>[] = [];
	const request = () => {
		requests.push(harness.core.acknowledgeVisible());
	};

	assert.equal(
		automaticAcknowledger.request(activity, unavailable, request),
		true,
	);
	await requests[0];
	assert.equal(harness.windowCommands.length, 0);

	harness.core.setContext({
		...unavailable.context,
		storedConnectionId: 'saved-host',
	});
	const hydrated = harness.core.getSnapshot();
	assert.equal(hydrated.generation, unavailable.generation);
	assert.equal(
		automaticAcknowledger.request(activity, hydrated, request),
		true,
	);
	assert.equal(harness.windowCommands.length, 1);
	assert.equal(
		automaticAcknowledger.request(activity, hydrated, request),
		false,
	);
	assert.equal(harness.windowCommands.length, 1);
	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput());
	await Promise.all(requests);
});

void test('automatic acknowledgement waits for interactive reconciliation after hydration', async () => {
	const harness = createNotificationsHarness();
	const automaticAcknowledger = createShellNotificationAutomaticAcknowledger();
	harness.activity.setFocused(false);
	harness.core.setContext(harness.context({ storedConnectionId: null }));
	const inactive = harness.activity.getSnapshot();
	const requests: Promise<void>[] = [];
	const request = () => {
		requests.push(harness.core.acknowledgeVisible());
	};

	assert.equal(
		automaticAcknowledger.request(
			inactive,
			harness.core.getSnapshot(),
			request,
		),
		false,
	);
	harness.core.setContext(harness.context());
	assert.equal(
		automaticAcknowledger.request(
			inactive,
			harness.core.getSnapshot(),
			request,
		),
		false,
	);
	assert.equal(harness.windowCommands.length, 0);
	harness.activity.setFocused(true);
	assert.equal(
		automaticAcknowledger.request(
			harness.activity.getSnapshot(),
			harness.core.getSnapshot(),
			request,
		),
		true,
	);
	assert.equal(harness.windowCommands.length, 1);
	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput());
	await Promise.all(requests);
});

void test('notification activity effect subscribes before reconciling and cleans up', () => {
	const events: string[] = [];
	const cleanup = setupShellNotificationActivityEffect({
		getSnapshot: () => ({
			focused: true,
			appState: 'active',
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		subscribe: () => {
			events.push('subscribe');
			return () => events.push('cleanup');
		},
		onInteractive: () => events.push('interactive'),
		onInactive: () => events.push('inactive'),
	});

	assert.deepEqual(events, ['subscribe', 'interactive']);
	cleanup();
	assert.deepEqual(events, ['subscribe', 'interactive', 'cleanup']);
});

void test('notification activity effect acknowledges interactive transitions and invalidates inactive transitions', () => {
	let snapshot = {
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 0,
	};
	const listeners = new Set<() => void>();
	const acknowledgements: number[] = [];
	const invalidations: string[] = [];
	const cleanup = setupShellNotificationActivityEffect({
		getSnapshot: () => snapshot,
		subscribe: (next) => {
			listeners.add(next);
			return () => listeners.delete(next);
		},
		onInteractive: () => acknowledgements.push(snapshot.generation),
		onInactive: (reason) => invalidations.push(reason),
	});

	snapshot = {
		...snapshot,
		appState: 'background',
		appActive: false,
		interactive: false,
		generation: 1,
	};
	listeners.values().next().value?.();
	snapshot = {
		...snapshot,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 2,
	};
	listeners.values().next().value?.();
	snapshot = {
		...snapshot,
		focused: false,
		interactive: false,
		generation: 3,
	};
	listeners.values().next().value?.();
	cleanup();

	assert.deepEqual(acknowledgements, [0, 2]);
	assert.deepEqual(invalidations, ['app-inactive', 'focus-lost']);
	assert.equal(listeners.size, 0);
});

void test('notification activity replay leaves only the current subscription', () => {
	const listeners = new Set<() => void>();
	const setup = () =>
		setupShellNotificationActivityEffect({
			getSnapshot: () => ({
				focused: true,
				appState: 'active',
				appActive: true,
				interactive: true,
				generation: 0,
			}),
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			onInteractive: () => {},
			onInactive: () => {},
		});

	const firstCleanup = setup();
	firstCleanup();
	const replayCleanup = setup();
	assert.equal(listeners.size, 1);
	replayCleanup();
	assert.equal(listeners.size, 0);
});

void test('notification pending effect is Android-only and cleans up', () => {
	let subscriptions = 0;
	let cleanups = 0;
	let pendingEvents = 0;
	const pendingListeners = new Set<() => void>();
	const subscribe = (listener: () => void) => {
		subscriptions += 1;
		pendingListeners.add(listener);
		return () => {
			cleanups += 1;
			pendingListeners.delete(listener);
		};
	};

	const androidCleanup = setupShellNotificationPendingEffect({
		platformOS: 'android',
		subscribe,
		onPending: () => {
			pendingEvents += 1;
		},
	});
	const iosCleanup = setupShellNotificationPendingEffect({
		platformOS: 'ios',
		subscribe,
		onPending: () => {},
	});
	assert.equal(subscriptions, 1);
	for (const listener of pendingListeners) listener();
	assert.equal(pendingEvents, 1);
	androidCleanup();
	iosCleanup();
	assert.equal(cleanups, 1);
	assert.equal(pendingListeners.size, 0);
});
