import assert from 'node:assert/strict';
import test from 'node:test';
import { connectAndOpenShell } from '../../src/lib/connect-and-open-shell';

const connectionDetails = {
	username: 'muly',
	host: 'dev.tailnet.ts.net',
	port: 22,
	useTmux: true,
	tmuxSessionName: 'main',
	autoConnect: true,
	security: { type: 'key' as const, keyId: 'key-1' },
};

void test('connectAndOpenShell records connect and shell success events', async () => {
	const events: unknown[] = [];
	const navigations: unknown[] = [];

	const result = await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		connect: async () =>
			({
				connectionId: 'conn-1',
				startShell: async () => ({ channelId: 7 }),
			}) as never,
		saveConnection: async () => {},
		navigate: (params) => {
			navigations.push(params);
		},
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.equal(result.status, 'connected');
	assert.deepEqual(navigations, [{ connectionId: 'conn-1', channelId: 7 }]);
	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		[
			'ssh.connect.started',
			'ssh.connect.connected',
			'ssh.shell.started',
			'ssh.shell.connected',
		],
	);
	assert.doesNotMatch(JSON.stringify(events), /secret/);
});

void test('connectAndOpenShell navigates with tmux attach failure metadata', async () => {
	const navigatedWithError: unknown[] = [];

	const result = await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		connect: async () =>
			({
				connectionId: 'conn-1',
				startShell: async () => {
					throw {
						tag: 'TmuxAttachFailed',
						inner: ['missing session'],
					};
				},
			}) as never,
		saveConnection: async () => {},
		navigate: () => {
			throw new Error('success navigation should not run');
		},
		navigateWithError: (params) => {
			navigatedWithError.push(params);
		},
	});

	assert.equal(result.status, 'tmux_attach_failed');
	assert.deepEqual(navigatedWithError, [
		{
			connectionId: 'conn-1',
			tmuxAttachFailureReason: 'missing session',
			tmuxSessionName: 'main',
			storedConnectionId: 'muly-dev_tailnet_ts_net-22',
		},
	]);
});

void test('connectAndOpenShell records connect failure', async () => {
	const events: unknown[] = [];

	await assert.rejects(
		connectAndOpenShell({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			connect: async () => {
				throw new Error('network unreachable');
			},
			saveConnection: async () => {},
			navigate: () => {},
			trace: {
				event: (event) => {
					events.push(event);
				},
			},
		}),
		/network unreachable/,
	);

	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		['ssh.connect.started', 'ssh.connect.failed'],
	);
});
