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

void test('connectAndOpenShell disconnects diagnostic connections after success', async () => {
	let disconnected = 0;
	let saveCalls = 0;
	const startShellOptions: unknown[] = [];

	await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		diagnosticMode: true,
		connect: async () =>
			({
				connectionId: 'conn-1',
				disconnect: () => {
					disconnected += 1;
				},
				startShell: async (options: unknown) => {
					startShellOptions.push(options);
					return { channelId: 7 };
				},
			}) as never,
		saveConnection: async () => {
			saveCalls += 1;
			throw new Error('diagnostic mode must not save connection metadata');
		},
		navigate: () => {
			throw new Error('diagnostic mode must not navigate');
		},
	});

	assert.equal(disconnected, 1);
	assert.equal(saveCalls, 0);
	assert.equal(
		(startShellOptions[0] as { registerInStore?: boolean }).registerInStore,
		false,
	);
});

void test('connectAndOpenShell disconnects diagnostic connections after tmux attach failure without navigating', async () => {
	let disconnected = 0;
	let navigatedWithError = 0;

	const result = await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		diagnosticMode: true,
		connect: async () =>
			({
				connectionId: 'conn-1',
				disconnect: () => {
					disconnected += 1;
				},
				startShell: async () => {
					throw {
						tag: 'TmuxAttachFailed',
						inner: ['missing session'],
					};
				},
			}) as never,
		saveConnection: async () => {},
		navigate: () => {
			throw new Error('diagnostic mode must not navigate');
		},
		navigateWithError: () => {
			navigatedWithError += 1;
		},
	});

	assert.equal(result.status, 'tmux_attach_failed');
	assert.equal(disconnected, 1);
	assert.equal(navigatedWithError, 0);
});

void test('connectAndOpenShell disconnects diagnostic connections after shell failure', async () => {
	let disconnected = 0;

	await assert.rejects(
		connectAndOpenShell({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			diagnosticMode: true,
			connect: async () =>
				({
					connectionId: 'conn-1',
					disconnect: () => {
						disconnected += 1;
					},
					startShell: async () => {
						throw new Error('shell failed');
					},
				}) as never,
			saveConnection: async () => {},
			navigate: () => {
				throw new Error('diagnostic mode must not navigate');
			},
		}),
		/shell failed/,
	);

	assert.equal(disconnected, 1);
});

void test('connectAndOpenShell preserves shell failure when diagnostic disconnect times out', async () => {
	const events: unknown[] = [];

	await assert.rejects(
		connectAndOpenShell({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			diagnosticMode: true,
			abortSignalTimeoutMs: 5,
			connect: async () =>
				({
					connectionId: 'conn-1',
					disconnect: async () => {
						await new Promise(() => {});
					},
					startShell: async () => {
						throw new Error('shell failed');
					},
				}) as never,
			saveConnection: async () => {},
			navigate: () => {
				throw new Error('diagnostic mode must not navigate');
			},
			trace: {
				event: (event) => {
					events.push(event);
				},
			},
		}),
		/shell failed/,
	);

	const eventTypes = events.map((event) => (event as { type: string }).type);
	assert.deepEqual(eventTypes, [
		'ssh.connect.started',
		'ssh.connect.connected',
		'ssh.shell.started',
		'ssh.shell.failed',
		'ssh.diagnostic.disconnect-failed',
	]);
	assert.match(JSON.stringify(events.at(-1)), /disconnect timed out/i);
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
