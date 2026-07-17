import assert from 'node:assert/strict';
import test from 'node:test';
import { type ShellRouteRequest } from '../../src/app/shell/shell-route';
import { createShellSessionCore } from '../../src/lib/shell-controllers/session-core';

const routeRequest: ShellRouteRequest = {
	connectionId: 'connection-1',
	channelId: 7,
	storedConnectionId: 'saved-1',
	agentRoute: {
		connectionId: null,
		session: null,
		windowId: null,
		eventId: null,
		tapToken: null,
	},
	tmuxAttach: { status: 'normal', sessionName: 'main' },
};

const failedAttachRouteRequest: ShellRouteRequest = {
	...routeRequest,
	tmuxAttach: {
		status: 'failed',
		sessionName: 'main',
		failureReason: 'session-missing',
	},
};

const readySource = {
	connectionPresent: true,
	shellPresent: true,
	isAutoConnecting: false,
	isReconnecting: false,
	lastReconnectOutcome: null,
	storedConnectionId: 'saved-1',
} as const;

function createHarness(request = routeRequest) {
	const events: ({ type: 'back' } | { type: 'edit-host'; id: string })[] = [];
	const core = createShellSessionCore({
		request,
		navigate: {
			back: () => events.push({ type: 'back' }),
			editHost: (id) => events.push({ type: 'edit-host', id }),
		},
	});
	return { core, events };
}

void test('session becomes ready without taking SSH ownership', () => {
	const { core, events } = createHarness();
	core.reconcile(readySource);
	assert.deepEqual(core.getSnapshot(), {
		status: 'ready',
		generation: 1,
		storedConnectionId: 'saved-1',
	});
	core.dispose();
	assert.deepEqual(events, []);
});

void test('session waits while reconnect owns recovery', () => {
	const { core, events } = createHarness();
	core.reconcile({
		...readySource,
		shellPresent: false,
		isReconnecting: true,
	});
	assert.equal(core.getSnapshot().status, 'waiting');
	assert.deepEqual(events, []);
});

void test('failed reconnect routes to the stored host editor', () => {
	const { core, events } = createHarness();
	core.reconcile({
		...readySource,
		shellPresent: false,
		lastReconnectOutcome: { status: 'failed', destination: 'hostPage' },
	});
	assert.deepEqual(core.getSnapshot(), { status: 'leaving', generation: 1 });
	assert.deepEqual(events, [{ type: 'edit-host', id: 'saved-1' }]);
});

void test('missing connection navigates back once', () => {
	const { core, events } = createHarness();
	core.reconcile({
		...readySource,
		connectionPresent: false,
		shellPresent: false,
	});
	core.reconcile({
		...readySource,
		connectionPresent: false,
		shellPresent: false,
	});
	assert.deepEqual(core.getSnapshot(), { status: 'leaving', generation: 1 });
	assert.deepEqual(events, [{ type: 'back' }]);
});

void test('tmux attach failure is a render state and never navigates', () => {
	const { core, events } = createHarness(failedAttachRouteRequest);
	let notifications = 0;
	core.subscribe(() => {
		notifications += 1;
	});
	assert.deepEqual(core.getSnapshot(), {
		status: 'attach-error',
		failureReason: 'session-missing',
		sessionName: 'main',
		generation: 0,
	});
	core.reconcile({
		...readySource,
		connectionPresent: false,
		shellPresent: false,
	});
	core.reconcile(readySource);
	assert.deepEqual(core.getSnapshot(), {
		status: 'attach-error',
		failureReason: 'session-missing',
		sessionName: 'main',
		generation: 0,
	});
	assert.equal(notifications, 0);
	assert.deepEqual(events, []);
});

void test('session state precedence favors ready, then recovery, then departure', () => {
	const cases = [
		{
			source: {
				...readySource,
				isAutoConnecting: true,
				isReconnecting: true,
				lastReconnectOutcome: {
					status: 'failed',
					destination: 'hostPage',
				},
			},
			snapshot: {
				status: 'ready',
				storedConnectionId: 'saved-1',
				generation: 1,
			},
			events: [],
		},
		{
			source: {
				...readySource,
				connectionPresent: false,
				shellPresent: false,
				isAutoConnecting: true,
				isReconnecting: true,
				lastReconnectOutcome: {
					status: 'failed',
					destination: 'hostPage',
				},
			},
			snapshot: {
				status: 'waiting',
				reason: 'auto-connect',
				generation: 0,
			},
			events: [],
		},
		{
			source: {
				...readySource,
				connectionPresent: false,
				shellPresent: false,
				isReconnecting: true,
				lastReconnectOutcome: {
					status: 'failed',
					destination: 'hostPage',
				},
			},
			snapshot: {
				status: 'waiting',
				reason: 'reconnect',
				generation: 1,
			},
			events: [],
		},
		{
			source: {
				...readySource,
				connectionPresent: false,
				shellPresent: false,
				lastReconnectOutcome: {
					status: 'failed',
					destination: 'hostPage',
				},
			},
			snapshot: { status: 'leaving', generation: 1 },
			events: [{ type: 'back' }],
		},
	] as const;

	for (const { source, snapshot, events: expectedEvents } of cases) {
		const { core, events } = createHarness();
		core.reconcile(source);
		assert.deepEqual(core.getSnapshot(), snapshot);
		assert.deepEqual(events, expectedEvents);
	}
});

void test('unchanged ready state does not publish or advance generation', () => {
	const { core, events } = createHarness();
	let notifications = 0;
	core.subscribe(() => {
		notifications += 1;
	});

	core.reconcile(readySource);
	core.reconcile({ ...readySource });

	assert.deepEqual(core.getSnapshot(), {
		status: 'ready',
		storedConnectionId: 'saved-1',
		generation: 1,
	});
	assert.equal(notifications, 1);
	assert.deepEqual(events, []);
});

void test('edit-host navigation deduplicates until ready resets departure', () => {
	const { core, events } = createHarness();
	const failedSource = {
		...readySource,
		shellPresent: false,
		lastReconnectOutcome: { status: 'failed', destination: 'hostPage' },
	} as const;

	core.reconcile(failedSource);
	core.reconcile(failedSource);
	assert.deepEqual(core.getSnapshot(), { status: 'leaving', generation: 1 });
	assert.deepEqual(events, [{ type: 'edit-host', id: 'saved-1' }]);

	core.reconcile(readySource);
	core.reconcile(failedSource);
	assert.deepEqual(core.getSnapshot(), { status: 'leaving', generation: 3 });
	assert.deepEqual(events, [
		{ type: 'edit-host', id: 'saved-1' },
		{ type: 'edit-host', id: 'saved-1' },
	]);
});

void test('edit-host navigation falls back to the route connection id', () => {
	const { core, events } = createHarness();
	core.reconcile({
		connectionPresent: true,
		shellPresent: false,
		isAutoConnecting: false,
		isReconnecting: false,
		lastReconnectOutcome: { status: 'failed', destination: 'hostPage' },
	});

	assert.deepEqual(core.getSnapshot(), { status: 'leaving', generation: 1 });
	assert.deepEqual(events, [{ type: 'edit-host', id: 'connection-1' }]);
});

void test('invalidate publishes leaving once without disposing the core', () => {
	const { core, events } = createHarness();
	core.reconcile(readySource);
	let notifications = 0;
	core.subscribe(() => {
		notifications += 1;
	});

	core.invalidate('source-change');
	core.invalidate('unmount');

	assert.deepEqual(core.getSnapshot(), { status: 'leaving', generation: 2 });
	assert.equal(notifications, 1);
	assert.deepEqual(events, []);

	core.reconcile(readySource);
	assert.deepEqual(core.getSnapshot(), {
		status: 'ready',
		storedConnectionId: 'saved-1',
		generation: 3,
	});
	assert.equal(notifications, 2);
});

void test('dispose publishes once and makes every later operation a no-op', () => {
	const { core, events } = createHarness();
	core.reconcile(readySource);
	let notifications = 0;
	core.subscribe(() => {
		notifications += 1;
	});

	core.dispose();
	core.dispose();
	core.invalidate('unmount');
	core.reconcile(readySource);
	core.reconcile({
		...readySource,
		connectionPresent: false,
		shellPresent: false,
	});

	assert.deepEqual(core.getSnapshot(), { status: 'leaving', generation: 2 });
	assert.equal(notifications, 1);
	assert.deepEqual(events, []);
});

void test('dispose blocks ready reconciliation from synchronous subscribers', () => {
	const { core, events } = createHarness();
	let notifications = 0;
	core.subscribe(() => {
		notifications += 1;
		core.reconcile(readySource);
	});

	core.dispose();

	assert.deepEqual(core.getSnapshot(), { status: 'leaving', generation: 1 });
	assert.equal(notifications, 1);
	assert.deepEqual(events, []);
});

void test('dispose blocks missing-connection navigation from synchronous subscribers', () => {
	const { core, events } = createHarness();
	let notifications = 0;
	core.subscribe(() => {
		notifications += 1;
		core.reconcile({
			...readySource,
			connectionPresent: false,
			shellPresent: false,
		});
	});

	core.dispose();

	assert.deepEqual(core.getSnapshot(), { status: 'leaving', generation: 1 });
	assert.equal(notifications, 1);
	assert.deepEqual(events, []);
});
