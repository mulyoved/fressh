import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AgentNotificationDedupe,
	buildAgentNotificationListenCommand,
	createAgentNotificationPendingKey,
	createStableNotificationId,
	parseAgentNotificationLine,
} from '../../src/lib/agent-notification-events';

void test('parseAgentNotificationLine accepts tmux status events and heartbeats', () => {
	assert.deepEqual(
		parseAgentNotificationLine(
			JSON.stringify({
				id: 'main:@12:1000:waiting',
				type: 'tmux_status',
				session: 'main',
				target: 'main:4',
				windowId: '@12',
				windowIndex: '4',
				windowName: 'fressh',
				status: 'waiting',
				icon: '💬',
				createdAtMs: 1000,
			}),
		),
		{
			id: 'main:@12:1000:waiting',
			type: 'tmux_status',
			session: 'main',
			target: 'main:4',
			windowId: '@12',
			windowIndex: '4',
			windowName: 'fressh',
			status: 'waiting',
			icon: '💬',
			createdAtMs: 1000,
		},
	);
	assert.deepEqual(
		parseAgentNotificationLine(
			'{"type":"heartbeat","session":"main","createdAtMs":2000}',
		),
		{ type: 'heartbeat', session: 'main', createdAtMs: 2000 },
	);
});

void test('parseAgentNotificationLine treats event ids as opaque strings', () => {
	assert.deepEqual(
		parseAgentNotificationLine(
			JSON.stringify({
				id: 'main:@12:1000:status:random-suffix',
				type: 'tmux_status',
				session: 'main',
				target: 'main:4',
				windowId: '@12',
				windowIndex: '4',
				windowName: 'fressh',
				status: 'done',
				icon: '✅',
				createdAtMs: 1000,
			}),
		),
		{
			id: 'main:@12:1000:status:random-suffix',
			type: 'tmux_status',
			session: 'main',
			target: 'main:4',
			windowId: '@12',
			windowIndex: '4',
			windowName: 'fressh',
			status: 'done',
			icon: '✅',
			createdAtMs: 1000,
		},
	);
});

void test('parseAgentNotificationLine rejects malformed lines', () => {
	assert.equal(parseAgentNotificationLine('not json'), null);
	assert.equal(parseAgentNotificationLine('{"type":"tmux_status"}'), null);
	assert.equal(
		parseAgentNotificationLine(
			'{"type":"tmux_status","status":"working","icon":"🤖"}',
		),
		null,
	);
});

void test('listen command quotes session and since id', () => {
	assert.equal(
		buildAgentNotificationListenCommand("main'quoted"),
		"mdev tmux notifications listen --session 'main'\\''quoted'",
	);
	assert.equal(
		buildAgentNotificationListenCommand('main', "main:@12:1:'bad"),
		"mdev tmux notifications listen --session 'main' --since-id 'main:@12:1:'\\''bad'",
	);
});

void test('pending keys and notification ids are stable', () => {
	const key = createAgentNotificationPendingKey({
		connectionId: 'conn-1',
		session: 'main',
		windowId: '@12',
	});
	assert.equal(key, 'conn-1|main|@12');
	assert.equal(
		createStableNotificationId(key),
		createStableNotificationId(key),
	);
	assert.notEqual(
		createStableNotificationId(key),
		createStableNotificationId('conn-1|main|@13'),
	);
});

void test('dedupe posts once until matching key is acknowledged', () => {
	const dedupe = new AgentNotificationDedupe();
	const key = 'conn-1|main|@12';

	assert.equal(dedupe.markPendingIfNew(key, 42), true);
	assert.equal(dedupe.markPendingIfNew(key, 42), false);
	assert.deepEqual(dedupe.acknowledge(key), [42]);
	assert.equal(dedupe.markPendingIfNew(key, 42), true);
});

void test('dedupe acknowledges matching pending keys', () => {
	const dedupe = new AgentNotificationDedupe();

	assert.equal(dedupe.markPendingIfNew('conn-1|main|@12', 42), true);
	assert.equal(dedupe.markPendingIfNew('conn-1|main|@13', 43), true);
	assert.equal(dedupe.markPendingIfNew('conn-2|main|@12', 44), true);

	assert.deepEqual(
		dedupe.acknowledgeMatching((key) => key.startsWith('conn-1|main|')),
		[42, 43],
	);
	assert.equal(dedupe.markPendingIfNew('conn-1|main|@12', 42), true);
	assert.equal(dedupe.markPendingIfNew('conn-2|main|@12', 44), false);
});
