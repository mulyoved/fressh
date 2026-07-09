import assert from 'node:assert/strict';
import test from 'node:test';
import { createSshRegistryStore } from '../../src/lib/ssh-registry-store';

void test('ssh registry invalidates unhealthy shell transport immediately', async () => {
	const calls: string[] = [];
	const store = createSshRegistryStore(
		async () =>
			({
				connectionId: 'conn-1',
				connectionDetails: {
					username: 'muly',
					host: 'host',
					port: 22,
				},
				disconnect: async () => {
					calls.push('disconnect');
				},
				startShell: async () => ({
					channelId: 7,
					createdAtMs: 10,
					sendData: async () => {},
					close: async () => {
						calls.push('close');
					},
				}),
			}) as never,
	);

	const connection = await store.getState().connect({} as never);
	await connection.startShell({} as never);
	assert.deepEqual(Object.keys(store.getState().connections), ['conn-1']);
	assert.deepEqual(Object.keys(store.getState().shells), ['conn-1-7']);

	const invalidated = store
		.getState()
		.invalidateShellTransport('conn-1', 7);

	assert.equal(invalidated, true);
	assert.deepEqual(Object.keys(store.getState().connections), ['conn-1']);
	assert.deepEqual(store.getState().shells, {});
	assert.deepEqual(calls, ['close', 'disconnect']);
});
