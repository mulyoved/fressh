import assert from 'node:assert/strict';
import test from 'node:test';
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
import {
	buildWorkmuxWindowOutput,
	createNotificationsHarness,
} from './shell-notifications-test-support';

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
