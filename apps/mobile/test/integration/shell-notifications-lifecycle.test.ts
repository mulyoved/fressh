import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createShellNotificationsControllerCore,
	type ShellNotificationContext,
	type ShellNotificationRoute,
} from '../../src/lib/shell-controllers/notifications-core';
import {
	createShellNotificationAutomaticAcknowledger,
	createShellNotificationHookOrchestrator,
	createShellNotificationRouteEffectKey,
	setupShellNotificationActivityEffect,
	setupShellNotificationPendingEffect,
} from '../../src/lib/shell-controllers/notifications-lifecycle';
import {
	createShellTargetKey,
	createShellTransportKey,
} from '../../src/lib/shell-controllers/source-keys';
import {
	buildWorkmuxWindowOutput,
	createNotificationsHarness,
} from './shell-notifications-test-support';

type Deferred<T> = {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
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

function createCommandPortReplacementHarness() {
	const base = createNotificationsHarness();
	type Input = {
		context: ShellNotificationContext;
		route: ShellNotificationRoute;
		runWorkmuxCommand(argv: string[], timeoutMs: number): Promise<string>;
	};
	const oldCommands: Deferred<string>[] = [];
	const newCommands: Deferred<string>[] = [];
	const acknowledgements: string[] = [];
	const warnings: unknown[] = [];
	let authorized = true;
	let restores = 0;
	const oldPort = () => {
		const command = createDeferred<string>();
		oldCommands.push(command);
		return command.promise;
	};
	const newPort = () => {
		const command = createDeferred<string>();
		newCommands.push(command);
		return command.promise;
	};
	const initial: Input = {
		context: base.context(),
		route: base.validRoute(),
		runWorkmuxCommand: oldPort,
	};
	const orchestrator = createShellNotificationHookOrchestrator(initial);
	const core = createShellNotificationsControllerCore({
		activity: base.activity,
		context: initial.context,
		platformOS: 'android',
		runWorkmuxCommand: initial.runWorkmuxCommand,
		consumeAuthorizedRouteToken: () => {
			if (!authorized) return false;
			authorized = false;
			return true;
		},
		restoreAuthorizedRouteToken: () => {
			restores++;
			authorized = true;
			return true;
		},
		acknowledge: (_connectionId, _session, windowId) => {
			acknowledgements.push(windowId);
		},
		warn: (_message, error) => warnings.push(error),
	});
	const commit = (
		runWorkmuxCommand: Input['runWorkmuxCommand'],
		afterCommit: () => void = () => {},
	) => {
		const next = { ...initial, runWorkmuxCommand };
		orchestrator.commitLayout(
			next,
			core.setCommandPort,
			core.setContext,
			afterCommit,
		);
		return next;
	};
	return {
		acknowledgements,
		activity: base.activity,
		commit,
		core,
		initial,
		newCommands,
		newPort,
		oldCommands,
		oldPort,
		orchestrator,
		get restores() {
			return restores;
		},
		warnings,
	};
}

function requestAutomaticVisible(
	harness: ReturnType<typeof createCommandPortReplacementHarness>,
	automaticAcknowledger: ReturnType<
		typeof createShellNotificationAutomaticAcknowledger
	>,
	requests: Promise<void>[],
): boolean {
	return automaticAcknowledger.request(
		harness.activity.getSnapshot(),
		harness.core.getSnapshot(),
		() => requests.push(harness.core.acknowledgeVisible()),
	);
}

void test('hook orchestration commits latest input before context and route effects', async () => {
	type Observation = 'initial' | 'latest';
	type HookInput = {
		activity: { getSnapshot(): { marker: Observation } };
		context: ShellNotificationContext;
		route: ShellNotificationRoute;
		runWorkmuxCommand(argv: string[], timeoutMs: number): Promise<string>;
		logger: { warn(message: string, error: unknown): void };
	};
	const harness = createNotificationsHarness();
	const observations: Observation[] = [];
	const warnings: Observation[] = [];
	const consumed: string[] = [];
	const initialContext = harness.context({ storedConnectionId: null });
	const initial: HookInput = {
		activity: {
			getSnapshot: () => {
				observations.push('initial');
				return { marker: 'initial' };
			},
		},
		context: initialContext,
		route: { ...harness.validRoute(), agentConnectionId: null },
		runWorkmuxCommand: async () => {
			observations.push('initial');
			return '';
		},
		logger: { warn: () => warnings.push('initial') },
	};
	const orchestrator = createShellNotificationHookOrchestrator(initial);
	const initialRouteEffectKey = orchestrator.createRouteEffectKey(initial);
	const core = createShellNotificationsControllerCore({
		activity: {
			getSnapshot: () => ({
				focused: true,
				appState: 'active',
				appActive: true,
				interactive: true,
				generation: 0,
			}),
		},
		context: initialContext,
		platformOS: 'android',
		runWorkmuxCommand: initial.runWorkmuxCommand,
		consumeAuthorizedRouteToken: (
			connectionId,
			session,
			windowId,
			eventId,
			tapToken,
		) => {
			consumed.push(
				JSON.stringify([connectionId, session, windowId, eventId, tapToken]),
			);
			return true;
		},
		restoreAuthorizedRouteToken: () => false,
		acknowledge: () => {
			throw new Error('observe latest logger');
		},
		warn: (message, error) =>
			orchestrator.getCommittedInput().logger.warn(message, error),
	});
	const latest: HookInput = {
		activity: {
			getSnapshot: () => {
				observations.push('latest');
				return { marker: 'latest' };
			},
		},
		context: harness.context(),
		route: { ...harness.validRoute(), agentConnectionId: null },
		runWorkmuxCommand: async () => {
			observations.push('latest');
			return '';
		},
		logger: { warn: () => warnings.push('latest') },
	};
	const latestRouteEffectKey = orchestrator.createRouteEffectKey(latest);
	assert.notEqual(latestRouteEffectKey, initialRouteEffectKey);

	orchestrator.commitLayout(
		latest,
		core.setCommandPort,
		core.setContext,
		() => {
			orchestrator.getCommittedInput().activity.getSnapshot();
		},
	);
	await orchestrator.dispatchRoutePassive(core.handleRoute, (input) => {
		input.logger.warn('route failed', new Error('route failed'));
	});

	assert.equal(core.getSnapshot().context.storedConnectionId, 'saved-host');
	assert.deepEqual(consumed, [
		'["saved-host","main","@12","event-1","token-1"]',
	]);
	assert.deepEqual(observations, ['latest', 'latest']);
	assert.deepEqual(warnings, ['latest']);
});

void test('command port replacement retries a restored route through the latest port', async () => {
	const harness = createCommandPortReplacementHarness();
	const first = harness.core.handleRoute(harness.initial.route);
	assert.equal(harness.oldCommands.length, 1);
	harness.commit(harness.newPort);
	const replacement = harness.core.handleRoute(harness.initial.route);
	harness.oldCommands[0]?.reject(new Error('old port closed'));
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(harness.newCommands.length, 1);
	harness.newCommands[0]?.resolve('');

	assert.deepEqual(await Promise.all([first, replacement]), [false, true]);
	assert.equal(harness.restores, 1);
	assert.deepEqual(harness.acknowledgements, ['@12']);
});

void test('stale old-port success is not restored or replayed on the replacement', async () => {
	const harness = createCommandPortReplacementHarness();
	const first = harness.core.handleRoute(harness.initial.route);
	harness.commit(harness.newPort);
	const replacement = harness.core.handleRoute(harness.initial.route);
	harness.oldCommands[0]?.resolve('');

	assert.deepEqual(await Promise.all([first, replacement]), [false, false]);
	assert.equal(harness.restores, 0);
	assert.equal(harness.newCommands.length, 0);
	assert.deepEqual(harness.acknowledgements, []);
});

void test('identical command port commits coalesce without invalidation', async () => {
	const harness = createCommandPortReplacementHarness();
	const first = harness.core.handleRoute(harness.initial.route);
	harness.commit(harness.oldPort);
	const adopted = harness.core.handleRoute(harness.initial.route);
	assert.equal(harness.oldCommands.length, 1);
	harness.oldCommands[0]?.resolve('');

	assert.deepEqual(await Promise.all([first, adopted]), [true, true]);
	assert.equal(harness.restores, 0);
	assert.deepEqual(harness.acknowledgements, ['@12']);
});

void test('layout commit automatically replaces a stale successful visible lookup', async () => {
	const harness = createCommandPortReplacementHarness();
	const automaticAcknowledger = createShellNotificationAutomaticAcknowledger();
	const requests: Promise<void>[] = [];
	assert.equal(
		requestAutomaticVisible(harness, automaticAcknowledger, requests),
		true,
	);
	harness.commit(harness.newPort, () => {
		assert.equal(
			requestAutomaticVisible(harness, automaticAcknowledger, requests),
			true,
		);
	});
	harness.oldCommands[0]?.resolve(buildWorkmuxWindowOutput('@12'));
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(harness.newCommands.length, 1);
	harness.newCommands[0]?.resolve(buildWorkmuxWindowOutput('@13'));
	await Promise.all(requests);
	assert.deepEqual(harness.acknowledgements, ['@13']);
});

void test('layout commit automatically replaces a failed visible lookup', async () => {
	const harness = createCommandPortReplacementHarness();
	const automaticAcknowledger = createShellNotificationAutomaticAcknowledger();
	const requests: Promise<void>[] = [];
	requestAutomaticVisible(harness, automaticAcknowledger, requests);
	harness.commit(harness.newPort, () => {
		requestAutomaticVisible(harness, automaticAcknowledger, requests);
	});
	harness.oldCommands[0]?.reject(new Error('old visible port failed'));
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(harness.newCommands.length, 1);
	harness.newCommands[0]?.resolve(buildWorkmuxWindowOutput('@13'));
	await Promise.all(requests);
	assert.deepEqual(harness.acknowledgements, ['@13']);
});

void test('same-port layout commit deduplicates automatic visible acknowledgement', async () => {
	const harness = createCommandPortReplacementHarness();
	const automaticAcknowledger = createShellNotificationAutomaticAcknowledger();
	const requests: Promise<void>[] = [];
	requestAutomaticVisible(harness, automaticAcknowledger, requests);
	let requestedAgain = true;
	harness.commit(harness.oldPort, () => {
		requestedAgain = requestAutomaticVisible(
			harness,
			automaticAcknowledger,
			requests,
		);
	});
	assert.equal(requestedAgain, false);
	assert.equal(harness.oldCommands.length, 1);
	harness.oldCommands[0]?.resolve(buildWorkmuxWindowOutput('@12'));
	await Promise.all(requests);
	assert.deepEqual(harness.acknowledgements, ['@12']);
});

void test('multiple layout commits retain only the latest automatic visible attempt', async () => {
	const harness = createCommandPortReplacementHarness();
	const automaticAcknowledger = createShellNotificationAutomaticAcknowledger();
	const requests: Promise<void>[] = [];
	const latestCommands: Deferred<string>[] = [];
	const latestPort = () => {
		const command = createDeferred<string>();
		latestCommands.push(command);
		return command.promise;
	};
	requestAutomaticVisible(harness, automaticAcknowledger, requests);
	harness.commit(harness.newPort, () => {
		requestAutomaticVisible(harness, automaticAcknowledger, requests);
	});
	harness.commit(latestPort, () => {
		requestAutomaticVisible(harness, automaticAcknowledger, requests);
	});
	harness.oldCommands[0]?.resolve(buildWorkmuxWindowOutput('@12'));
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(harness.newCommands.length, 0);
	assert.equal(latestCommands.length, 1);
	latestCommands[0]?.resolve(buildWorkmuxWindowOutput('@14'));
	await Promise.all(requests);
	assert.deepEqual(harness.acknowledgements, ['@14']);
});

void test('notification route effect identity changes for every context field', async (t) => {
	const harness = createNotificationsHarness();
	const route = {
		...harness.validRoute(),
		agentConnectionId: null,
	};
	const context = harness.context();
	const cases = [
		{
			field: 'transportKey',
			context: {
				...context,
				transportKey: createShellTransportKey('replacement-host', 7),
			},
		},
		{
			field: 'targetKey',
			context: {
				...context,
				targetKey: createShellTargetKey(context.transportKey, 'other'),
			},
		},
		{
			field: 'storedConnectionId',
			context: { ...context, storedConnectionId: null },
		},
		{
			field: 'channelId',
			context: { ...context, channelId: 19 },
		},
		{
			field: 'tmuxEnabled',
			context: { ...context, tmuxEnabled: false },
		},
		{
			field: 'tmuxTarget',
			context: { ...context, tmuxTarget: 'other' },
		},
	];

	for (const entry of cases) {
		await t.test(entry.field, () => {
			assert.notEqual(
				createShellNotificationRouteEffectKey(route, context),
				createShellNotificationRouteEffectKey(route, entry.context),
			);
		});
	}
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
	assert.equal(unavailable.contextRevision, 1);
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
	assert.equal(hydrated.contextRevision, unavailable.contextRevision + 1);
	assert.equal(
		automaticAcknowledger.request(activity, hydrated, request),
		true,
	);
	assert.equal(harness.windowCommands.length, 1);
	harness.core.setContext(hydrated.context);
	assert.equal(
		harness.core.getSnapshot().contextRevision,
		hydrated.contextRevision,
	);
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

void test('automatic acknowledgement keys requests by command port revision', () => {
	const harness = createNotificationsHarness();
	const automaticAcknowledger = createShellNotificationAutomaticAcknowledger();
	let requests = 0;
	const request = () => requests++;
	const activity = harness.activity.getSnapshot();
	const notifications = harness.core.getSnapshot();

	assert.equal(
		automaticAcknowledger.request(activity, notifications, request),
		true,
	);
	assert.equal(
		automaticAcknowledger.request(activity, notifications, request),
		false,
	);
	const replacementPort = async () => '';
	harness.core.setCommandPort(replacementPort);
	assert.equal(
		automaticAcknowledger.request(
			activity,
			harness.core.getSnapshot(),
			request,
		),
		true,
	);
	assert.equal(requests, 2);
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
