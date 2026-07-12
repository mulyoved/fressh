import assert from 'node:assert/strict';
import test from 'node:test';
import * as z from 'zod';
import {
	buildChunkedStoreKeys,
	makeBetterSecureStore,
} from '../../src/lib/chunked-storage';
import {
	type AsyncStringStorage,
	SecureStorageCorruptionError,
} from '../../src/lib/transactional-secure-storage/contracts';
import { createLegacyChunkedStorageReader } from '../../src/lib/transactional-secure-storage/legacy-reader';

const metadataSchema = z.object({
	position: z.number(),
	padding: z.string(),
});

type Metadata = z.infer<typeof metadataSchema>;

function createMemoryStorage() {
	const records = new Map<string, string>();
	const storage: AsyncStringStorage = {
		getItem: async (key) => records.get(key) ?? null,
		setItem: async (key, value) => {
			records.set(key, value);
		},
		deleteItem: async (key) => {
			records.delete(key);
		},
	};
	return { records, storage };
}

async function seedLegacyStorage() {
	const memory = createMemoryStorage();
	let nextManifestId = 0;
	const writer = makeBetterSecureStore<Metadata>({
		storagePrefix: 'legacy',
		extraManifestFieldsSchema: metadataSchema,
		parseValue: (value) => value,
		storage: memory.storage,
		randomUUID: () => `manifest-${++nextManifestId}`,
	});
	const entries = [
		{
			id: 'first',
			metadata: { position: 1, padding: 'a'.repeat(800) },
			value: 'one',
		},
		{
			id: 'second',
			metadata: { position: 2, padding: 'b'.repeat(800) },
			value: 'two',
		},
		{
			id: 'third',
			metadata: { position: 3, padding: 'c'.repeat(800) },
			value: 'three'.repeat(500),
		},
	];
	for (const entry of entries) await writer.upsertEntry(entry);
	assert.equal(
		(await writer.getManifest()).rootManifest.manifestChunksIds.length,
		2,
	);
	return { ...memory, entries };
}

function readOnlyStorage(storage: AsyncStringStorage) {
	let writes = 0;
	return {
		storage: {
			getItem: storage.getItem,
			setItem: async () => {
				writes++;
				throw new Error('legacy reader attempted a write');
			},
			deleteItem: async () => {
				writes++;
				throw new Error('legacy reader attempted a delete');
			},
		} satisfies AsyncStringStorage,
		writeCount: () => writes,
	};
}

function createReader(storage: AsyncStringStorage) {
	return createLegacyChunkedStorageReader({
		storagePrefix: 'legacy',
		metadataSchema,
		parseValue: (raw) => raw,
		storage,
	});
}

void test('reads all v1 entries in manifest order and inventories every record without writes', async () => {
	const seeded = await seedLegacyStorage();
	const guarded = readOnlyStorage(seeded.storage);
	const snapshot = await createReader(guarded.storage).read();
	const keys = buildChunkedStoreKeys('legacy');

	assert.equal(snapshot.status, 'present');
	assert.deepEqual(snapshot.entries, seeded.entries);
	assert.deepEqual(snapshot.recordKeys, [
		keys.rootManifestKey,
		keys.manifestChunkKey('manifest-1'),
		keys.manifestChunkKey('manifest-2'),
		keys.entryKey('first', 0),
		keys.entryKey('second', 0),
		keys.entryKey('third', 0),
		keys.entryKey('third', 1),
	]);
	assert.equal(guarded.writeCount(), 0);
});

void test('rejects a missing referenced manifest chunk as corruption without writes', async () => {
	const seeded = await seedLegacyStorage();
	seeded.records.delete(
		buildChunkedStoreKeys('legacy').manifestChunkKey('manifest-2'),
	);
	const guarded = readOnlyStorage(seeded.storage);

	await assert.rejects(
		createReader(guarded.storage).read(),
		SecureStorageCorruptionError,
	);
	assert.equal(guarded.writeCount(), 0);
});

void test('rejects a missing referenced value chunk as corruption without writes', async () => {
	const seeded = await seedLegacyStorage();
	seeded.records.delete(buildChunkedStoreKeys('legacy').entryKey('third', 1));
	const guarded = readOnlyStorage(seeded.storage);

	await assert.rejects(
		createReader(guarded.storage).read(),
		SecureStorageCorruptionError,
	);
	assert.equal(guarded.writeCount(), 0);
});

void test('rejects duplicate entry IDs across manifest chunks', async () => {
	const seeded = await seedLegacyStorage();
	const key = buildChunkedStoreKeys('legacy').manifestChunkKey('manifest-2');
	const manifest = JSON.parse(seeded.records.get(key)!) as {
		entries: { id: string }[];
	};
	manifest.entries[0]!.id = 'first';
	seeded.records.set(key, JSON.stringify(manifest));
	const guarded = readOnlyStorage(seeded.storage);

	await assert.rejects(
		createReader(guarded.storage).read(),
		SecureStorageCorruptionError,
	);
	assert.equal(guarded.writeCount(), 0);
});

void test('returns absent only when the v1 root does not exist', async () => {
	const memory = createMemoryStorage();
	const guarded = readOnlyStorage(memory.storage);
	const rootKey = buildChunkedStoreKeys('legacy').rootManifestKey;

	assert.deepEqual(await createReader(guarded.storage).read(), {
		status: 'absent',
		entries: [],
		recordKeys: [rootKey],
	});
	assert.equal(guarded.writeCount(), 0);

	await memory.storage.setItem(rootKey, '{');
	await assert.rejects(
		createReader(guarded.storage).read(),
		SecureStorageCorruptionError,
	);
	assert.equal(guarded.writeCount(), 0);
});

void test('propagates manifest storage read failures unchanged', async () => {
	const seeded = await seedLegacyStorage();
	const sentinel = new Error('manifest adapter unavailable');
	const manifestKey =
		buildChunkedStoreKeys('legacy').manifestChunkKey('manifest-1');
	const guarded = readOnlyStorage({
		...seeded.storage,
		getItem: async (key) => {
			if (key === manifestKey) throw sentinel;
			return seeded.storage.getItem(key);
		},
	});

	await assert.rejects(createReader(guarded.storage).read(), (error) => {
		assert.equal(error, sentinel);
		return true;
	});
	assert.equal(guarded.writeCount(), 0);
});

void test('propagates value storage read failures unchanged', async () => {
	const seeded = await seedLegacyStorage();
	const sentinel = new Error('value adapter unavailable');
	const valueKey = buildChunkedStoreKeys('legacy').entryKey('second', 0);
	const guarded = readOnlyStorage({
		...seeded.storage,
		getItem: async (key) => {
			if (key === valueKey) throw sentinel;
			return seeded.storage.getItem(key);
		},
	});

	await assert.rejects(createReader(guarded.storage).read(), (error) => {
		assert.equal(error, sentinel);
		return true;
	});
	assert.equal(guarded.writeCount(), 0);
});

void test('rejects a present root manifest version other than 1', async () => {
	const seeded = await seedLegacyStorage();
	const rootKey = buildChunkedStoreKeys('legacy').rootManifestKey;
	const root = JSON.parse(seeded.records.get(rootKey)!) as {
		manifestVersion: number;
	};
	root.manifestVersion = 2;
	seeded.records.set(rootKey, JSON.stringify(root));

	await assert.rejects(
		createReader(readOnlyStorage(seeded.storage).storage).read(),
		SecureStorageCorruptionError,
	);
});

void test('rejects a present manifest chunk version other than 1', async () => {
	const seeded = await seedLegacyStorage();
	const manifestKey =
		buildChunkedStoreKeys('legacy').manifestChunkKey('manifest-1');
	const manifest = JSON.parse(seeded.records.get(manifestKey)!) as {
		manifestChunkVersion: number;
	};
	manifest.manifestChunkVersion = 2;
	seeded.records.set(manifestKey, JSON.stringify(manifest));

	await assert.rejects(
		createReader(readOnlyStorage(seeded.storage).storage).read(),
		SecureStorageCorruptionError,
	);
});

void test('reads a schema-valid zero-chunk entry as an empty string without a value read', async () => {
	const memory = createMemoryStorage();
	const keys = buildChunkedStoreKeys('legacy');
	await memory.storage.setItem(
		keys.rootManifestKey,
		JSON.stringify({ manifestChunksIds: ['empty'] }),
	);
	await memory.storage.setItem(
		keys.manifestChunkKey('empty'),
		JSON.stringify({
			entries: [
				{
					id: 'empty',
					chunkCount: 0,
					metadata: { position: 1, padding: '' },
				},
			],
		}),
	);
	const readKeys: string[] = [];
	const guarded = readOnlyStorage({
		...memory.storage,
		getItem: async (key) => {
			readKeys.push(key);
			return memory.storage.getItem(key);
		},
	});

	assert.deepEqual(await createReader(guarded.storage).read(), {
		status: 'present',
		entries: [
			{
				id: 'empty',
				metadata: { position: 1, padding: '' },
				value: '',
			},
		],
		recordKeys: [keys.rootManifestKey, keys.manifestChunkKey('empty')],
	});
	assert.deepEqual(readKeys, [
		keys.rootManifestKey,
		keys.manifestChunkKey('empty'),
	]);
	assert.equal(guarded.writeCount(), 0);
});
