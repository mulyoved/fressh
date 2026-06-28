import assert from 'node:assert/strict';
import test from 'node:test';
import { runDiagnosticShellProbe } from '../../src/lib/diagnostic-shell-probe';

const connectionDetails = {
	username: 'muly',
	host: 'dev.tailnet.ts.net',
	port: 22,
	useTmux: true,
	tmuxSessionName: 'main',
	autoConnect: true,
	security: { type: 'key' as const, keyId: 'key-1' },
};

void test('diagnostic probe disconnects after success and never navigates or saves', async () => {
	let disconnected = 0;
	const startShellOptions: unknown[] = [];
	const events: unknown[] = [];

	const result = await runDiagnosticShellProbe({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
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
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.equal(result.status, 'connected');
	assert.equal(disconnected, 1);
	assert.equal(
		(startShellOptions[0] as { registerInStore?: boolean }).registerInStore,
		false,
	);
	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		[
			'ssh.connect.started',
			'ssh.connect.connected',
			'ssh.shell.started',
			'ssh.shell.connected',
			'ssh.diagnostic.disconnected',
		],
	);
	assert.doesNotMatch(JSON.stringify(events), /secret/);
});

void test('diagnostic probe fails successful probes when disconnect fails', async () => {
	const events: unknown[] = [];

	await assert.rejects(
		runDiagnosticShellProbe({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			connect: async () =>
				({
					connectionId: 'conn-1',
					disconnect: () => {
						throw new Error('disconnect failed');
					},
					startShell: async () => ({ channelId: 7 }),
				}) as never,
			trace: {
				event: (event) => {
					events.push(event);
				},
			},
		}),
		/disconnect failed/,
	);

	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		[
			'ssh.connect.started',
			'ssh.connect.connected',
			'ssh.shell.started',
			'ssh.shell.connected',
			'ssh.diagnostic.disconnect-failed',
		],
	);
});

void test('diagnostic probe disconnects after tmux attach failure without throwing', async () => {
	let disconnected = 0;
	const events: unknown[] = [];

	const result = await runDiagnosticShellProbe({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
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
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.equal(result.status, 'tmux_attach_failed');
	assert.equal(result.connectionId, 'conn-1');
	assert.equal(result.tmuxAttachFailureReason, 'missing session');
	assert.equal(result.tmuxSessionName, 'main');
	assert.equal(result.storedConnectionId, 'muly-dev_tailnet_ts_net-22');
	assert.equal(disconnected, 1);
	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		[
			'ssh.connect.started',
			'ssh.connect.connected',
			'ssh.shell.started',
			'ssh.shell.tmux-attach-failed',
			'ssh.diagnostic.disconnected',
		],
	);
});

void test('diagnostic probe preserves tmux result when disconnect fails', async () => {
	const events: unknown[] = [];

	const result = await runDiagnosticShellProbe({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		connect: async () =>
			({
				connectionId: 'conn-1',
				disconnect: () => {
					throw new Error('disconnect failed');
				},
				startShell: async () => {
					throw {
						tag: 'TmuxAttachFailed',
						inner: ['missing session'],
					};
				},
			}) as never,
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.equal(result.status, 'tmux_attach_failed');
	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		[
			'ssh.connect.started',
			'ssh.connect.connected',
			'ssh.shell.started',
			'ssh.shell.tmux-attach-failed',
			'ssh.diagnostic.disconnect-failed',
		],
	);
});

void test('diagnostic probe disconnects after shell failure and preserves shell error', async () => {
	let disconnected = 0;

	await assert.rejects(
		runDiagnosticShellProbe({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
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
		}),
		/shell failed/,
	);

	assert.equal(disconnected, 1);
});

void test('diagnostic probe records disconnect timeout without replacing shell failure', async () => {
	const events: unknown[] = [];

	await assert.rejects(
		runDiagnosticShellProbe({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
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
			trace: {
				event: (event) => {
					events.push(event);
				},
			},
		}),
		/shell failed/,
	);

	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		[
			'ssh.connect.started',
			'ssh.connect.connected',
			'ssh.shell.started',
			'ssh.shell.failed',
			'ssh.diagnostic.disconnect-failed',
		],
	);
});

void test('diagnostic probe records connect failure', async () => {
	const events: unknown[] = [];

	await assert.rejects(
		runDiagnosticShellProbe({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			connect: async () => {
				throw new Error('network unreachable');
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
});
