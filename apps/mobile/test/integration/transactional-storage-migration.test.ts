import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { z } from 'zod';
import { buildChunkedStoreKeys, makeBetterSecureStore } from '../../src/lib/chunked-storage';
import { createTransactionalSecureStore, SecureStorageCorruptionError, type Sha256 } from '../../src/lib/transactional-secure-storage';
import { createLegacyChunkedStorageReader } from '../../src/lib/transactional-secure-storage/legacy-reader';
import { buildV2Keys } from '../../src/lib/transactional-secure-storage/records';
import { FaultInjectingStringStorage, type StorageFault } from './helpers/fault-injecting-string-storage';

const namespace = 'migration';
const metadataSchema = z.strictObject({ label: z.string() });
type Metadata = z.infer<typeof metadataSchema>;
type Value = { privateKey: string };
const sha256: Sha256 = async (bytes) => createHash('sha256').update(bytes).digest('hex');
let nextId = 0;

function createStore(storage: FaultInjectingStringStorage) {
	return createTransactionalSecureStore({
		namespace,
		metadataSchema,
		serializeValue: JSON.stringify,
		parseValue: (raw) => JSON.parse(raw) as Value,
		storage,
		legacy: createLegacyChunkedStorageReader({
			storagePrefix: namespace,
			metadataSchema,
			parseValue: (raw) => JSON.parse(raw) as Value,
			storage,
		}),
		randomUUID: () => `migration-${++nextId}`,
		sha256,
	});
}

async function seedLegacy(storage = new FaultInjectingStringStorage()) {
	const writer = makeBetterSecureStore<Metadata, Value>({
		storagePrefix: namespace,
		extraManifestFieldsSchema: metadataSchema,
		parseValue: (raw) => JSON.parse(raw) as Value,
		storage,
		randomUUID: () => `legacy-${++nextId}`,
	});
	await writer.upsertEntry({ id: 'alpha', metadata: { label: 'Alpha' }, value: JSON.stringify({ privateKey: 'one' }) });
	await writer.upsertEntry({ id: 'beta', metadata: { label: 'Beta' }, value: JSON.stringify({ privateKey: 'two' }) });
	return storage;
}

function legacyKeys(storage: FaultInjectingStringStorage) {
	return Object.keys(storage.snapshotDurable()).filter((key) => !key.includes('-v2-')).sort();
}

void test('fresh storage initializes two roots and an empty present v1 manifest migrates', async () => {
	const fresh = new FaultInjectingStringStorage();
	assert.equal((await createStore(fresh).ensureReady()).status, 'initialized');
	assert.ok(await fresh.getItem(buildV2Keys(namespace).root.a));
	assert.ok(await fresh.getItem(buildV2Keys(namespace).root.b));

	const empty = new FaultInjectingStringStorage();
	await empty.setItem(buildChunkedStoreKeys(namespace).rootManifestKey, JSON.stringify({ manifestVersion: 1, manifestChunksIds: [] }));
	assert.equal((await createStore(empty).ensureReady()).status, 'migrated');
	assert.ok(await empty.getItem(buildChunkedStoreKeys(namespace).rootManifestKey));
});

void test('first instance migrates readable entries but only a fresh reopen cleans every v1 key', async () => {
	const storage = await seedLegacy();
	const before = legacyKeys(storage);
	const first = createStore(storage);
	assert.equal((await first.ensureReady()).status, 'migrated');
	assert.deepEqual((await first.listEntries()).map(({ id }) => id), ['alpha', 'beta']);
	assert.deepEqual(legacyKeys(storage), before);
	storage.restart();
	assert.equal((await createStore(storage).ensureReady()).status, 'current');
	assert.deepEqual(legacyKeys(storage), []);
});

void test('every migration write interruption preserves durable v1 and can retry after restart', async () => {
	const probe = await seedLegacy();
	const baseline = legacyKeys(probe);
	await createStore(probe).ensureReady();
	const writes = probe.operationLog.filter(({ type }) => type === 'set').length - baseline.length;
	for (let boundary = 1; boundary <= writes; boundary++) {
		for (const fault of ['throw-before', 'throw-after-visible', 'volatile-success'] as StorageFault[]) {
			const storage = await seedLegacy();
			const offset = storage.operationLog.filter(({ type }) => type === 'set' || type === 'delete').length;
			storage.failOperation(offset + boundary, fault);
			await createStore(storage).ensureReady().catch(() => undefined);
			storage.restart();
			assert.equal(legacyKeys(storage).length, baseline.length, `${fault} at ${boundary}`);
			assert.deepEqual((await createStore(storage).listEntries()).map(({ id }) => id), ['alpha', 'beta']);
		}
	}
});

void test('volatile v2 loss retries migration and one surviving root is mirrored before cleanup', async () => {
	const storage = await seedLegacy();
	await createStore(storage).ensureReady();
	await storage.deleteItem(buildV2Keys(namespace).root.a);
	await storage.deleteItem(buildV2Keys(namespace).root.b);
	storage.restart();
	assert.equal((await createStore(storage).ensureReady()).status, 'migrated');
	storage.restart();
	await storage.deleteItem(buildV2Keys(namespace).root.b);
	await createStore(storage).ensureReady();
	assert.ok(await storage.getItem(buildV2Keys(namespace).root.a));
	assert.ok(await storage.getItem(buildV2Keys(namespace).root.b));
	assert.deepEqual(legacyKeys(storage), []);
});

void test('cleanup failures leave v2 readable and carry all legacy keys until retry', async () => {
	const storage = await seedLegacy();
	const expected = legacyKeys(storage);
	await createStore(storage).ensureReady();
	storage.restart();
	const planCount = Object.keys(storage.snapshotDurable()).filter((key) => key.includes('-v2-intent-plan-')).length;
	const offset = storage.operationLog.filter(({ type }) => type === 'set' || type === 'delete').length;
	storage.failOperation(offset + planCount + 3, 'delete-noop');
	const reopened = createStore(storage);
	await reopened.ensureReady();
	assert.deepEqual((await reopened.listEntries()).map(({ id }) => id), ['alpha', 'beta']);
	assert.ok(expected.some((key) => legacyKeys(storage).includes(key)));
	storage.restart();
	await createStore(storage).ensureReady();
	assert.deepEqual(legacyKeys(storage), []);
});

void test('malformed present v1 never becomes empty v2 and invalid v2 falls back only to readable legacy', async () => {
	const storage = new FaultInjectingStringStorage();
	await storage.setItem(buildChunkedStoreKeys(namespace).rootManifestKey, '{');
	await assert.rejects(createStore(storage).ensureReady(), SecureStorageCorruptionError);
	assert.equal(await storage.getItem(buildV2Keys(namespace).root.a), null);
	await storage.setItem(buildV2Keys(namespace).root.a, '{');
	await assert.rejects(createStore(storage).ensureReady(), SecureStorageCorruptionError);
});

void test('stale and disagreeing intent headers are removed before a new migration attempt', async () => {
	const storage = await seedLegacy();
	const keys = buildV2Keys(namespace);
	await storage.setItem(keys.intent.a, '{');
	await storage.setItem(keys.intent.b, JSON.stringify({ unrelated: true }));
	await createStore(storage).ensureReady();
	assert.doesNotThrow(() => JSON.parse(storage.snapshotDurable()[keys.intent.a]!));
	assert.equal(await storage.getItem(keys.intent.a), await storage.getItem(keys.intent.b));
});
