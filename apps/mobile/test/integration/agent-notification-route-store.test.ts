import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentNotificationRouteTokenStore } from '../../src/lib/agent-notification-route-store-core';

function createMemoryStorage() {
	const values = new Map<string, string>();
	return {
		getString: (key: string) => values.get(key),
		set: (key: string, value: string) => {
			values.set(key, value);
		},
		delete: (key: string) => {
			values.delete(key);
		},
		getAllKeys: () => Array.from(values.keys()),
	};
}

void test('agent notification tap tokens authorize only matching routes', () => {
	let nextToken = 1;
	const store = createAgentNotificationRouteTokenStore({
		storage: createMemoryStorage(),
		createToken: () => `token-${nextToken++}`,
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};
	const firstToken = store.create(identity);

	assert.equal(store.has({ ...identity, tapToken: firstToken }), true);
	assert.equal(store.has({ ...identity, tapToken: 'forged-token' }), false);
	assert.equal(
		store.has({
			...identity,
			eventId: 'main:@12:3000:done',
			tapToken: firstToken,
		}),
		false,
	);

	const replacementToken = store.create(identity);
	assert.equal(store.has({ ...identity, tapToken: firstToken }), true);
	assert.equal(store.has({ ...identity, tapToken: replacementToken }), true);

	store.delete({ ...identity, tapToken: replacementToken });
	assert.equal(store.has({ ...identity, tapToken: firstToken }), true);
	assert.equal(store.has({ ...identity, tapToken: replacementToken }), false);
});

void test('agent notification tap tokens clear all routes for an acknowledged window', () => {
	let nextToken = 1;
	const store = createAgentNotificationRouteTokenStore({
		storage: createMemoryStorage(),
		createToken: () => `token-${nextToken++}`,
	});
	const waiting = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};
	const done = {
		...waiting,
		eventId: 'main:@12:3000:done',
	};
	const otherWindow = {
		...waiting,
		windowId: '@13',
		eventId: 'main:@13:2000:waiting',
	};
	const waitingToken = store.create(waiting);
	const doneToken = store.create(done);
	const otherToken = store.create(otherWindow);

	store.deleteMatching({
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
	});

	assert.equal(store.has({ ...waiting, tapToken: waitingToken }), false);
	assert.equal(store.has({ ...done, tapToken: doneToken }), false);
	assert.equal(store.has({ ...otherWindow, tapToken: otherToken }), true);
});

void test('agent notification tap token creation rolls back partial route writes', () => {
	const storage = createMemoryStorage();
	const store = createAgentNotificationRouteTokenStore({
		storage: {
			...storage,
			set: (key, value) => {
				if (key.startsWith('token:')) {
					throw new Error('token write failed');
				}
				storage.set(key, value);
			},
		},
		createToken: () => 'token-1',
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};

	assert.throws(() => store.create(identity), /token write failed/);
	assert.deepEqual(storage.getAllKeys(), []);
	assert.equal(store.has({ ...identity, tapToken: 'token-1' }), false);
});

void test('agent notification tap token replacement preserves old token while deleting replacement', () => {
	const storage = createMemoryStorage();
	let nextToken = 1;
	const store = createAgentNotificationRouteTokenStore({
		storage,
		createToken: () => `token-${nextToken++}`,
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};
	const firstToken = store.create(identity);
	const secondToken = store.create(identity);

	store.delete({ ...identity, tapToken: secondToken });

	assert.equal(store.has({ ...identity, tapToken: firstToken }), true);
	assert.equal(store.has({ ...identity, tapToken: secondToken }), false);
});

void test('agent notification tap token replacement preserves old token when new token write fails', () => {
	const storage = createMemoryStorage();
	let nextToken = 1;
	const store = createAgentNotificationRouteTokenStore({
		storage: {
			...storage,
			set: (key, value) => {
				if (key === 'token:token-2') {
					throw new Error('token write failed');
				}
				storage.set(key, value);
			},
		},
		createToken: () => `token-${nextToken++}`,
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};
	const firstToken = store.create(identity);

	assert.throws(() => store.create(identity), /token write failed/);
	assert.equal(store.has({ ...identity, tapToken: firstToken }), true);
	assert.equal(store.has({ ...identity, tapToken: 'token-2' }), false);
});

void test('agent notification tap token store clears all route records', () => {
	let nextToken = 1;
	const storage = createMemoryStorage();
	const store = createAgentNotificationRouteTokenStore({
		storage,
		createToken: () => `token-${nextToken++}`,
	});
	const first = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};
	const second = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@13',
		eventId: 'main:@13:2000:waiting',
	};
	const firstToken = store.create(first);
	const secondToken = store.create(second);

	store.clear();

	assert.equal(store.has({ ...first, tapToken: firstToken }), false);
	assert.equal(store.has({ ...second, tapToken: secondToken }), false);
	assert.deepEqual(storage.getAllKeys(), []);
});

void test('agent notification tap token store ignores malformed persistent records', () => {
	const storage = createMemoryStorage();
	storage.set('token:bad-json', '{not json');
	storage.set(
		'token:wrong-shape',
		JSON.stringify({ connectionId: 'saved-host', tapToken: 'wrong-shape' }),
	);
	const store = createAgentNotificationRouteTokenStore({
		storage,
		createToken: () => 'token-1',
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};

	assert.equal(store.has({ ...identity, tapToken: 'bad-json' }), false);
	assert.equal(store.has({ ...identity, tapToken: 'wrong-shape' }), false);
	assert.doesNotThrow(() => {
		store.deleteMatching({
			connectionId: 'saved-host',
			session: 'main',
			windowId: '@12',
		});
	});
});
