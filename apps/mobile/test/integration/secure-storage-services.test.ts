import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { makeBetterSecureStore } from '../../src/lib/chunked-storage';
import {
	createSecureStorageServices,
	keyMetadataSchema,
} from '../../src/lib/secure-storage-services';
import {
	FaultInjectingStringStorage,
	type StorageFault,
} from './helpers/fault-injecting-string-storage';

const noopLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

const pendingRestore = {
	phase: 'pending' as const,
	recoveryTarget: 'target' as const,
	previous: {
		version: 1 as const,
		createdAt: '2026-07-12T23:58:00.000Z',
		keys: [],
		connections: [],
	},
	target: {
		version: 1 as const,
		createdAt: '2026-07-13T00:00:00.000Z',
		keys: [
			{
				id: 'key_restored',
				metadata: {
					priority: 0,
					createdAtMs: 1_752_364_800_000,
					label: 'Restored key',
					isDefault: true,
				},
				value: 'RESTORED PRIVATE KEY',
			},
		],
		connections: [],
	},
};

const sha256 = async (bytes: Uint8Array) =>
	createHash('sha256').update(bytes).digest('hex');

let nextServiceId = 0;

function createServices(storage: FaultInjectingStringStorage) {
	return createSecureStorageServices({
		storage,
		sha256,
		randomUUID: () => `restore-journal-service-${++nextServiceId}`,
		logger: noopLogger,
	});
}

async function seedLegacyRestoreJournal(
	storage = new FaultInjectingStringStorage(),
) {
	const legacy = makeBetterSecureStore({
		storagePrefix: 'securityCenterRestoreJournal',
		extraManifestFieldsSchema: undefined,
		parseValue: (value) => value,
		storage,
		randomUUID: () => 'legacy-restore-journal',
		logger: noopLogger,
	});
	await legacy.upsertEntry({
		id: 'pending',
		metadata: {},
		value: JSON.stringify(pendingRestore),
	});
	return { legacy, storage };
}

function mutationCount(storage: FaultInjectingStringStorage) {
	return storage.operationLog.filter(
		({ type }) => type === 'set' || type === 'delete',
	).length;
}

void test('initialization migrates a v1 private key without changing its entry data', async () => {
	const storage = new FaultInjectingStringStorage();
	const legacy = makeBetterSecureStore({
		storagePrefix: 'privateKey',
		extraManifestFieldsSchema: keyMetadataSchema,
		parseValue: (value) => value,
		storage,
		randomUUID: () => 'legacy-id',
		logger: noopLogger,
	});
	const expected = {
		id: 'key_existing',
		metadata: {
			priority: 7,
			createdAtMs: 1_712_345_678_901,
			label: 'Existing key',
			isDefault: true,
		},
		value: 'private-key-value',
	};
	await legacy.upsertEntry(expected);

	let nextId = 0;
	const services = createSecureStorageServices({
		storage,
		sha256: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
		randomUUID: () => `service-${++nextId}`,
		logger: noopLogger,
	});

	await services.initialize();

	assert.deepEqual(await services.privateKeys.getEntry(expected.id), expected);

	storage.restart();
	const reopened = createSecureStorageServices({
		storage,
		sha256: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
		randomUUID: () => `service-${++nextId}`,
		logger: noopLogger,
	});
	await reopened.initialize();
	assert.deepEqual(await reopened.privateKeys.getEntry(expected.id), expected);
});

void test('restore journal migration preserves pending state across the first two instances', async () => {
	const { storage } = await seedLegacyRestoreJournal();
	const durableV1 = storage.snapshotDurable();
	const first = createServices(storage);

	await first.initialize();

	assert.deepEqual(await first.restoreJournal.load(), pendingRestore);
	for (const [key, value] of Object.entries(durableV1)) {
		assert.equal(storage.snapshotDurable()[key], value);
	}

	storage.restart();
	const second = createServices(storage);
	await second.initialize();
	assert.deepEqual(await second.restoreJournal.load(), pendingRestore);

	await second.restoreJournal.clear();
	assert.equal(await second.restoreJournal.load(), null);
});

void test('every restore journal migration write interruption leaves the pending state loadable', async () => {
	const probe = await seedLegacyRestoreJournal();
	const offset = mutationCount(probe.storage);
	await createServices(probe.storage).restoreJournal.load();
	const migrationWrites = mutationCount(probe.storage) - offset;
	assert.ok(migrationWrites > 0, 'migration fault matrix requires write boundaries');

	for (let boundary = 1; boundary <= migrationWrites; boundary += 1) {
		for (const fault of [
			'throw-before',
			'throw-after-visible',
			'volatile-success',
		] as StorageFault[]) {
			const { legacy, storage } = await seedLegacyRestoreJournal();
			storage.failOperation(mutationCount(storage) + boundary, fault);
			await createServices(storage)
				.restoreJournal.load()
				.catch(() => undefined);
			storage.restart();

			assert.deepEqual(
				JSON.parse((await legacy.getEntry('pending')).value) as unknown,
				pendingRestore,
				`${fault} at migration write ${boundary} must preserve v1`,
			);

			const reopened = createServices(storage);
			assert.deepEqual(
				await reopened.restoreJournal.load(),
				pendingRestore,
				`${fault} at migration write ${boundary} must reopen`,
			);
		}
	}
});
