import assert from 'node:assert/strict';
import test from 'node:test';
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
};

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((innerResolve) => {
		resolve = innerResolve;
	});
	return { promise, resolve };
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

function createNotificationsHarness() {
	const activity = createShellActivityControllerCore({
		focused: true,
		appState: 'active',
	});
	const windowCommands: Deferred<string>[] = [];
	const acknowledgedWindowIds: string[] = [];
	const warnings: unknown[] = [];

	const context = (
		overrides: Partial<
			Omit<ShellNotificationContext, 'transportKey' | 'targetKey'>
		> = {},
	): ShellNotificationContext => {
		const storedConnectionId = overrides.storedConnectionId ?? 'saved-host';
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
		runWorkmuxCommand: () => {
			const deferred = createDeferred<string>();
			windowCommands.push(deferred);
			return deferred.promise;
		},
		acknowledge: (_connectionId, _session, windowId) => {
			acknowledgedWindowIds.push(windowId);
		},
		warn: (_message, error) => {
			warnings.push(error);
		},
	});

	return {
		activity,
		acknowledgedWindowIds,
		context,
		core,
		tick: () => new Promise((resolve) => setTimeout(resolve, 0)),
		warnings,
		windowCommands,
	};
}

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
