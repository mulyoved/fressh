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
	const connectParams: unknown[] = [];
	const saveCalls: unknown[] = [];
	const startShellOptions: unknown[] = [];
	const progressEvents: unknown[] = [];

	const result = await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		connect: async (params) => {
			connectParams.push(params);
			params.onConnectionProgress?.({ phase: 'auth' } as never);
			assert.equal(await params.onServerKey({} as never), true);
			assert.equal(params.host, 'dev.tailnet.ts.net');
			assert.equal(params.port, 22);
			assert.equal(params.username, 'muly');
			assert.deepEqual(params.security, { type: 'key', privateKey: 'secret' });
			assert.ok(params.abortSignal);
			assert.equal(params.abortSignal.aborted, false);
			return {
				connectionId: 'conn-1',
				startShell: async (options: unknown) => {
					startShellOptions.push(options);
					return { channelId: 7 };
				},
			} as never;
		},
		onConnectionProgress: (event) => {
			progressEvents.push(event);
		},
		saveConnection: async (params) => {
			saveCalls.push(params);
		},
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
	assert.equal(connectParams.length, 1);
	assert.deepEqual(progressEvents, [{ phase: 'auth' }]);
	assert.deepEqual(saveCalls, [
		{
			label: 'muly@dev.tailnet.ts.net:22',
			details: connectionDetails,
			priority: 0,
		},
	]);
	assert.equal(
		(startShellOptions[0] as { registerInStore?: boolean }).registerInStore,
		undefined,
	);
	assert.deepEqual(navigations, [{ connectionId: 'conn-1', channelId: 7 }]);
	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		[
			'ssh.connect.started',
			'ssh.connect.progress',
			'ssh.connect.connected',
			'ssh.shell.started',
			'ssh.shell.connected',
		],
	);
	assert.doesNotMatch(JSON.stringify(events), /secret/);
});

void test('connectAndOpenShell navigates with tmux attach failure metadata', async () => {
	const navigatedWithError: unknown[] = [];
	const saveCalls: unknown[] = [];
	const startShellOptions: unknown[] = [];

	const result = await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		connect: async () =>
			({
				connectionId: 'conn-1',
				startShell: async (options: unknown) => {
					startShellOptions.push(options);
					throw {
						tag: 'TmuxAttachFailed',
						inner: ['missing session'],
					};
				},
			}) as never,
		saveConnection: async (params) => {
			saveCalls.push(params);
		},
		navigate: () => {
			throw new Error('success navigation should not run');
		},
		navigateWithError: (params) => {
			navigatedWithError.push(params);
		},
	});

	assert.equal(result.status, 'tmux_attach_failed');
	assert.equal(saveCalls.length, 1);
	assert.equal(
		(startShellOptions[0] as { registerInStore?: boolean }).registerInStore,
		undefined,
	);
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
	let saveCalls = 0;
	let navigations = 0;

	await assert.rejects(
		connectAndOpenShell({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			connect: async () => {
				throw new Error('network unreachable');
			},
			saveConnection: async () => {
				saveCalls += 1;
			},
			navigate: () => {
				navigations += 1;
			},
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
	assert.equal(saveCalls, 0);
	assert.equal(navigations, 0);
});

void test('connectAndOpenShell records shell failure without navigation', async () => {
	const events: unknown[] = [];
	const saveCalls: unknown[] = [];
	let navigations = 0;

	await assert.rejects(
		connectAndOpenShell({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			connect: async () =>
				({
					connectionId: 'conn-1',
					startShell: async () => {
						throw new Error('shell failed');
					},
				}) as never,
			saveConnection: async (params) => {
				saveCalls.push(params);
			},
			navigate: () => {
				navigations += 1;
			},
			trace: {
				event: (event) => {
					events.push(event);
				},
			},
		}),
		/shell failed/,
	);

	assert.equal(saveCalls.length, 1);
	assert.equal(navigations, 0);
	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		[
			'ssh.connect.started',
			'ssh.connect.connected',
			'ssh.shell.started',
			'ssh.shell.failed',
		],
	);
	assert.doesNotMatch(JSON.stringify(events), /secret/);
});
