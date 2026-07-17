import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { type StoredConnectionEntry } from '../../src/lib/connection-storage';
import {
	type HerdrHostState,
	type HerdrSnapshot,
} from '../../src/lib/herdr/contracts';
import {
	prepareHerdrHost,
	type PrepareHerdrHostPorts,
} from '../../src/lib/herdr/host-launcher';
import { useHerdrProviderStore } from '../../src/lib/herdr/provider-store';
import { type RegisteredSshConnection } from '../../src/lib/ssh-registry-store';

const requestedStoredConnectionId = 'muly-dev_tailnet_ts_net-22';
const privateKey = 'PRIVATE KEY MATERIAL';

function savedEntry(
	overrides: Partial<StoredConnectionEntry['value']> = {},
): StoredConnectionEntry {
	return {
		id: requestedStoredConnectionId,
		metadata: {
			priority: 0,
			createdAtMs: 1,
			modifiedAtMs: 1,
		},
		value: {
			host: 'dev.tailnet.ts.net',
			port: 22,
			username: 'muly',
			security: { type: 'key', keyId: 'key-1' },
			...overrides,
		},
	};
}

function snapshot(version = '0.7.2'): HerdrSnapshot {
	return { version, protocol: 1, agents: [] };
}

function registeredConnection(input: {
	connectionId: string;
	host: string;
	port?: number;
	username?: string;
	disconnect?: () => Promise<void>;
}): RegisteredSshConnection {
	return {
		connectionId: input.connectionId,
		connectionDetails: {
			host: input.host,
			port: input.port ?? 22,
			username: input.username ?? 'muly',
		},
		disconnect: input.disconnect ?? (async () => {}),
	} as unknown as RegisteredSshConnection;
}

function unexpected(name: string): never {
	throw new Error(`${name} must not be called`);
}

void test('reuses the matching registered connection without key lookup or connect', async () => {
	const other = registeredConnection({
		connectionId: 'connection-other',
		host: 'other.example.com',
	});
	const matching = registeredConnection({
		connectionId: 'connection-match',
		host: 'dev.tailnet.ts.net',
	});
	const loadedSnapshot = snapshot();
	const loadedConnections: RegisteredSshConnection[] = [];
	const ports: PrepareHerdrHostPorts = {
		getSavedConnection: async () => savedEntry(),
		getPrivateKey: async () => unexpected('getPrivateKey'),
		getConnections: () => ({
			[other.connectionId]: other,
			[matching.connectionId]: matching,
		}),
		connect: async () => unexpected('connect'),
		loadSnapshot: async (connection) => {
			loadedConnections.push(connection);
			return loadedSnapshot;
		},
	};

	const result = await prepareHerdrHost({
		storedConnectionId: requestedStoredConnectionId,
		ports,
	});

	assert.deepEqual(result, {
		storedConnectionId: requestedStoredConnectionId,
		connectionId: 'connection-match',
		snapshot: loadedSnapshot,
	});
	assert.deepEqual(loadedConnections, [matching]);
});

void test('launcher boundary has no shell lifecycle or native runtime dependency', async () => {
	const source = await readFile(
		new URL('../../src/lib/herdr/host-launcher.ts', import.meta.url),
		'utf8',
	);

	assert.doesNotMatch(source, /\bstartShell\b/);
	assert.doesNotMatch(source, /\bsecretsManager\b/);
	assert.doesNotMatch(
		source,
		/^import\s+(?!type\b).*['"]@fressh\/react-native-uniffi-russh['"]/m,
	);
});

void test('normalizes a saved entry and connects with key security and bounded abort', async () => {
	const calls: string[] = [];
	const entry = savedEntry({
		useTmux: undefined,
		tmuxSessionName: undefined,
		autoConnect: undefined,
	});
	const connection = registeredConnection({
		connectionId: 'connection-new',
		host: entry.value.host,
	});
	const connectCalls: Parameters<PrepareHerdrHostPorts['connect']>[0][] = [];
	const loadedConnections: RegisteredSshConnection[] = [];
	const loadedSnapshot = snapshot('0.8.0');

	const result = await prepareHerdrHost({
		storedConnectionId: requestedStoredConnectionId,
		ports: {
			getSavedConnection: async (storedConnectionId) => {
				calls.push(`saved:${storedConnectionId}`);
				return entry;
			},
			getPrivateKey: async (keyId) => {
				calls.push(`key:${keyId}`);
				return privateKey;
			},
			getConnections: () => ({}),
			connect: async (params) => {
				calls.push('connect');
				connectCalls.push(params);
				return connection;
			},
			loadSnapshot: async (connected) => {
				calls.push('snapshot');
				loadedConnections.push(connected);
				return loadedSnapshot;
			},
		},
	});

	assert.deepEqual(calls, [
		`saved:${requestedStoredConnectionId}`,
		'key:key-1',
		'connect',
		'snapshot',
	]);
	const connectParams = connectCalls[0];
	assert.ok(connectParams);
	assert.deepEqual(
		{
			host: connectParams.host,
			port: connectParams.port,
			username: connectParams.username,
			security: connectParams.security,
		},
		{
			host: 'dev.tailnet.ts.net',
			port: 22,
			username: 'muly',
			security: { type: 'key', privateKey },
		},
	);
	assert.equal(connectParams.abortSignal instanceof AbortSignal, true);
	assert.equal(await connectParams.onServerKey({} as never), true);
	assert.deepEqual(loadedConnections, [connection]);
	assert.deepEqual(result, {
		storedConnectionId: requestedStoredConnectionId,
		connectionId: 'connection-new',
		snapshot: loadedSnapshot,
	});
});

void test('forwards caller abort through the bounded connect signal', async () => {
	const abortController = new AbortController();
	const abortReason = new Error('route left');
	const connectSignals: (AbortSignal | undefined)[] = [];

	await prepareHerdrHost({
		storedConnectionId: requestedStoredConnectionId,
		abortSignal: abortController.signal,
		ports: {
			getSavedConnection: async () => savedEntry(),
			getPrivateKey: async () => privateKey,
			getConnections: () => ({}),
			connect: async (params) => {
				connectSignals.push(params.abortSignal);
				abortController.abort(abortReason);
				return registeredConnection({
					connectionId: 'connection-new',
					host: 'dev.tailnet.ts.net',
				});
			},
			loadSnapshot: async () => snapshot(),
		},
	});

	const connectSignal = connectSignals[0];
	assert.ok(connectSignal);
	assert.equal(connectSignal.aborted, true);
});

void test('failures neither publish partial host state nor disconnect registry connections', async (t) => {
	const previousHost: HerdrHostState = {
		storedConnectionId: 'previous-host-22',
		connectionId: 'previous-connection',
		snapshot: snapshot('previous'),
	};

	for (const scenario of [
		{
			name: 'missing saved entry',
			expected: /Saved SSH connection not found/i,
			getSavedConnection: async () => null,
		},
		{
			name: 'private key lookup failure',
			expected: /key missing/i,
			getPrivateKey: async () => {
				throw new Error('key missing');
			},
		},
		{
			name: 'connection failure',
			expected: /connect failed/i,
			connect: async () => {
				throw new Error('connect failed');
			},
		},
		{
			name: 'Herdr snapshot failure',
			expected: /Herdr unavailable/i,
			loadSnapshot: async () => {
				throw new Error('Herdr unavailable');
			},
		},
	] as const) {
		await t.test(scenario.name, async () => {
			useHerdrProviderStore.getState().setHost(previousHost);
			let disconnectCalls = 0;
			const existingConnection = registeredConnection({
				connectionId: 'connection-existing',
				host: 'other.example.com',
				disconnect: async () => {
					disconnectCalls += 1;
				},
			});
			const connection = registeredConnection({
				connectionId: 'connection-new',
				host: 'dev.tailnet.ts.net',
				disconnect: async () => {
					disconnectCalls += 1;
				},
			});
			const ports: PrepareHerdrHostPorts = {
				getSavedConnection:
					scenario.getSavedConnection ?? (async () => savedEntry()),
				getPrivateKey: scenario.getPrivateKey ?? (async () => privateKey),
				getConnections: () => ({
					[existingConnection.connectionId]: existingConnection,
				}),
				connect: scenario.connect ?? (async () => connection),
				loadSnapshot: scenario.loadSnapshot ?? (async () => snapshot()),
			};

			await assert.rejects(
				prepareHerdrHost({
					storedConnectionId: requestedStoredConnectionId,
					ports,
				}),
				scenario.expected,
			);
			assert.equal(useHerdrProviderStore.getState().host, previousHost);
			assert.equal(disconnectCalls, 0);
		});
	}
});
