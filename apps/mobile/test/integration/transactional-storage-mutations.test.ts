import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { z } from 'zod';
import {
	createTransactionalSecureStore,
	SecureStorageWriteNotCommittedError,
	type LegacySnapshotReader,
	type SecureEntry,
	type Sha256,
} from '../../src/lib/transactional-secure-storage';
import { buildV2Keys } from '../../src/lib/transactional-secure-storage/records';
import {
	FaultInjectingStringStorage,
	type StorageFault,
} from './helpers/fault-injecting-string-storage';
import { writeTransactionalStorageFixture } from './helpers/transactional-storage-fixtures';

const namespace = 'mutation';
const metadataSchema = z.strictObject({
	label: z.string(),
	priority: z.number().optional(),
});
type Metadata = z.infer<typeof metadataSchema>;
type Value = { secret: string };
type Entry = SecureEntry<Metadata, Value>;
const sha256: Sha256 = async (bytes) =>
	createHash('sha256').update(bytes).digest('hex');
const serializeValue = (value: Value) => JSON.stringify(value);
const parseValue = (raw: string): Value => JSON.parse(raw) as Value;
const legacy: LegacySnapshotReader<Metadata, Value> = {
	read: async () => ({ status: 'absent', entries: [], recordKeys: [] }),
};

const first: Entry = {
	id: 'alpha',
	metadata: { label: 'Alpha', priority: 9 },
	value: { secret: 'one' },
};
const second: Entry = {
	id: 'beta',
	metadata: { label: 'Beta', priority: 1 },
	value: { secret: 'two' },
};

let nextId = 0;

function createStore(storage: FaultInjectingStringStorage) {
	return createTransactionalSecureStore({
		namespace,
		metadataSchema,
		serializeValue,
		parseValue,
		storage,
		legacy,
		randomUUID: () => `uuid-${++nextId}`,
		sha256,
	});
}

async function seedEmptyPair() {
	const storage = new FaultInjectingStringStorage();
	for (const [slot, commitGeneration] of [
		['a', 1],
		['b', 2],
	] as const) {
		await writeTransactionalStorageFixture({
			namespace,
			metadataSchema,
			serializeValue,
			storage,
			sha256,
			slot,
			commitGeneration,
			entries: [],
		});
	}
	return storage;
}

async function seedOldState() {
	const storage = await seedEmptyPair();
	await createStore(storage).replaceAllEntries([first]);
	return storage.snapshotDurable();
}

function valueKeys(storage: FaultInjectingStringStorage) {
	return Object.keys(storage.snapshotDurable())
		.filter((key) => key.includes('-v2-value-'))
		.sort();
}

void test('replace-all and upsert publish a canonical snapshot and reuse an unchanged value', async () => {
	const storage = await seedEmptyPair();
	const store = createStore(storage);

	await store.replaceAllEntries([second, first]);
	const valuesBeforeRename = valueKeys(storage);
	const revisionsBeforeRename = Object.keys(storage.snapshotDurable()).filter(
		(key) => key.includes('-v2-entry-'),
	).length;
	await store.upsertEntry({
		...first,
		metadata: { ...first.metadata, label: 'Renamed' },
	});

	assert.deepEqual(await store.listEntries(), [
		{ ...first, metadata: { ...first.metadata, label: 'Renamed' } },
		second,
	]);
	assert.deepEqual(valueKeys(storage), valuesBeforeRename);
	assert.equal(
		Object.keys(storage.snapshotDurable()).filter((key) =>
			key.includes('-v2-entry-'),
		).length,
		revisionsBeforeRename + 1,
	);
});

void test('serializes concurrent upserts without losing either change', async () => {
	const storage = await seedEmptyPair();
	const store = createStore(storage);

	await Promise.all([store.upsertEntry(second), store.upsertEntry(first)]);

	assert.deepEqual(await store.listEntries(), [first, second]);
});

void test('rejects duplicate replace-all IDs before any storage write', async () => {
	const storage = await seedEmptyPair();
	const store = createStore(storage);
	storage.operationLog.length = 0;

	await assert.rejects(store.replaceAllEntries([first, first]), /duplicate/i);

	assert.equal(
		storage.operationLog.some(({ type }) => type !== 'get'),
		false,
	);
});

void test('recovers from either surviving redundant intent on reopen', async () => {
	const storage = new FaultInjectingStringStorage(await seedOldState());
	storage.failOperation(2, 'throw-before');
	await assert.rejects(createStore(storage).upsertEntry(second));
	storage.restart();
	const keys = buildV2Keys(namespace);
	assert.notEqual(await storage.getItem(keys.intent.a), null);

	assert.deepEqual(await createStore(storage).listEntries(), [first]);
	assert.equal(await storage.getItem(keys.intent.a), null);
	assert.equal(await storage.getItem(keys.intent.b), null);
});

void test('normalizes pre-root derivation failures without changing either root', async () => {
	const storage = await seedEmptyPair();
	const keys = buildV2Keys(namespace);
	const rootsBefore = {
		a: await storage.getItem(keys.root.a),
		b: await storage.getItem(keys.root.b),
	};
	const store = createTransactionalSecureStore({
		namespace,
		metadataSchema,
		serializeValue: () => {
			throw new Error('serializer failed');
		},
		parseValue,
		storage,
		legacy,
		randomUUID: () => `uuid-${++nextId}`,
		sha256,
	});

	await assert.rejects(
		store.upsertEntry(first),
		SecureStorageWriteNotCommittedError,
	);
	assert.deepEqual(
		{
			a: await storage.getItem(keys.root.a),
			b: await storage.getItem(keys.root.b),
		},
		rootsBefore,
	);
});

for (const fault of [
	'throw-before',
	'throw-after-visible',
	'volatile-success',
] as const satisfies readonly StorageFault[]) {
	void test(`keeps a complete snapshot across every ${fault} write boundary`, async () => {
		const durableOld = await seedOldState();
		const successfulStorage = new FaultInjectingStringStorage(durableOld);
		await createStore(successfulStorage).upsertEntry(second);
		const operationCount = successfulStorage.operationLog.filter(
			({ type }) => type !== 'get',
		).length;

		for (let operation = 1; operation <= operationCount; operation++) {
			const storage = new FaultInjectingStringStorage(durableOld);
			storage.failOperation(operation, fault);
			try {
				await createStore(storage).upsertEntry(second);
			} catch {
				// The restart result, rather than the call outcome, is authoritative.
			}
			storage.restart();
			const entries = await createStore(storage).listEntries();
			assert.ok(
				[JSON.stringify([first]), JSON.stringify([first, second])].includes(
					JSON.stringify(entries),
				),
				`${fault} operation ${operation} reopened a mixed snapshot`,
			);
		}
	});
}
