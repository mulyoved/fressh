import assert from 'node:assert/strict';
import test from 'node:test';
import {
	connectAndRememberConnection,
	connectWithoutRemembering,
} from '../../src/lib/ssh-connect-flow';

const connectionDetails = {
	username: 'muly',
	host: 'dev.tailnet.ts.net',
	port: 22,
	useTmux: true,
	tmuxSessionName: 'main',
	autoConnect: true,
	security: { type: 'key' as const, keyId: 'key-1' },
};

void test('connectWithoutRemembering forwards SSH connect parameters', async () => {
	const progressEvents: unknown[] = [];

	const result = await connectWithoutRemembering({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		abortSignalTimeoutMs: 5_000,
		onConnectionProgress: (event) => {
			progressEvents.push(event);
		},
		connect: async (params) => {
			assert.equal(params.host, 'dev.tailnet.ts.net');
			assert.equal(params.port, 22);
			assert.equal(params.username, 'muly');
			assert.deepEqual(params.security, {
				type: 'key',
				privateKey: 'secret',
			});
			assert.equal(params.abortSignal.aborted, false);
			assert.equal(await params.onServerKey({ fingerprint: 'abc' }), true);
			params.onConnectionProgress?.({ phase: 'auth' });
			return { connectionId: 'conn-1' };
		},
	});

	assert.deepEqual(result, { connectionId: 'conn-1' });
	assert.deepEqual(progressEvents, [{ phase: 'auth' }]);
});

void test('connectAndRememberConnection saves after connecting', async () => {
	const calls: string[] = [];
	const saveCalls: unknown[] = [];

	const result = await connectAndRememberConnection({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		abortSignalTimeoutMs: 5_000,
		connect: async () => {
			calls.push('connect');
			return { connectionId: 'conn-1' };
		},
		saveConnection: async (params) => {
			calls.push('save');
			saveCalls.push(params);
		},
	});

	assert.deepEqual(calls, ['connect', 'save']);
	assert.deepEqual(result, {
		sshConnection: { connectionId: 'conn-1' },
		storedConnectionId: 'muly-dev_tailnet_ts_net-22',
	});
	assert.deepEqual(saveCalls, [
		{
			label: 'muly@dev.tailnet.ts.net:22',
			details: connectionDetails,
			priority: 0,
		},
	]);
});

void test('connectAndRememberConnection does not save after connect failure', async () => {
	let saveCalls = 0;

	await assert.rejects(
		connectAndRememberConnection({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			abortSignalTimeoutMs: 5_000,
			connect: async () => {
				throw new Error('network unreachable');
			},
			saveConnection: async () => {
				saveCalls += 1;
			},
		}),
		/network unreachable/,
	);

	assert.equal(saveCalls, 0);
});
