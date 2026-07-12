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

function mutationOperations(storage: FaultInjectingStringStorage) {
	return storage.operationLog.filter(({ type }) => type !== 'get');
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
	const durableKeys = Object.keys(storage.snapshotDurable());
	assert.equal(
		durableKeys.some(
			(key) =>
				key.includes('-v2-intent-plan-') ||
				key === buildV2Keys(namespace).intent.a ||
				key === buildV2Keys(namespace).intent.b,
		),
		false,
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

void test('retains an intent header when committed plan cleanup fails', async () => {
	const durable = (await seedEmptyPair()).snapshotDurable();
	const successful = new FaultInjectingStringStorage(durable);
	await createStore(successful).upsertEntry(first);
	const firstPlanDelete = successful.operationLog
		.filter(({ type }) => type !== 'get')
		.findIndex(
			({ type, key }) => type === 'delete' && key.includes('-v2-intent-plan-'),
		);
	assert.notEqual(firstPlanDelete, -1);

	const storage = new FaultInjectingStringStorage(durable);
	storage.failOperation(firstPlanDelete + 1, 'throw-before');
	await createStore(storage).upsertEntry(first);
	const durableKeys = Object.keys(storage.snapshotDurable());
	const keys = buildV2Keys(namespace);
	assert.equal(
		durableKeys.some((key) => key.includes('-v2-intent-plan-')),
		true,
	);
	assert.equal(
		durableKeys.includes(keys.intent.a) || durableKeys.includes(keys.intent.b),
		true,
	);
});

void test('delete publishes both roots before deleting unreachable value records', async () => {
	const storage = new FaultInjectingStringStorage(await seedOldState());
	const keys = buildV2Keys(namespace);
	storage.operationLog.length = 0;

	await createStore(storage).deleteEntry(first.id);

	const operations = mutationOperations(storage);
	const rootWrites = operations
		.map((operation, index) => ({ ...operation, index }))
		.filter(
			({ type, key }) =>
				type === 'set' && (key === keys.root.a || key === keys.root.b),
		);
	assert.equal(rootWrites.length, 2);
	assert.deepEqual(
		rootWrites.map(({ key }) => key),
		[keys.root.b, keys.root.a],
	);
	assert.ok(rootWrites[0]!.index < rootWrites[1]!.index);
	const firstGarbageDelete = operations.findIndex(
		({ type, key }) =>
			type === 'delete' &&
			(key.includes('-v2-entry-') || key.includes('-v2-value-')),
	);
	assert.ok(firstGarbageDelete > rootWrites[1]!.index);

	const roots = await Promise.all([
		storage.getItem(keys.root.a),
		storage.getItem(keys.root.b),
	]);
	const parsedRoots = roots.map(
		(raw) =>
			JSON.parse(raw!) as {
				commitGeneration: number;
				snapshotId: string;
			},
	);
	assert.equal(parsedRoots[0]!.snapshotId, parsedRoots[1]!.snapshotId);
	assert.equal(
		Math.abs(
			parsedRoots[0]!.commitGeneration - parsedRoots[1]!.commitGeneration,
		),
		1,
	);
	assert.deepEqual(await createStore(storage).listEntries(), []);
});

for (const rootWrite of [1, 2] as const) {
	void test(`reopens a complete state when delete root write ${rootWrite} fails`, async () => {
		const durableOld = await seedOldState();
		const successful = new FaultInjectingStringStorage(durableOld);
		await createStore(successful).deleteEntry(first.id);
		const keys = buildV2Keys(namespace);
		const rootOperation = mutationOperations(successful)
			.map((operation, index) => ({ ...operation, operation: index + 1 }))
			.filter(
				({ type, key }) =>
					type === 'set' && (key === keys.root.a || key === keys.root.b),
			)[rootWrite - 1]!.operation;

		const storage = new FaultInjectingStringStorage(durableOld);
		storage.failOperation(rootOperation, 'throw-before');
		await assert.rejects(createStore(storage).deleteEntry(first.id));
		storage.restart();
		const entries = await createStore(storage).listEntries();
		assert.ok(
			[JSON.stringify([first]), JSON.stringify([])].includes(
				JSON.stringify(entries),
			),
		);
	});
}

void test('keeps delete logically committed when cleanup is a no-op and retries it', async () => {
	const durableOld = await seedOldState();
	const successful = new FaultInjectingStringStorage(durableOld);
	await createStore(successful).deleteEntry(first.id);
	const garbageDelete = mutationOperations(successful).findIndex(
		({ type, key }) =>
			type === 'delete' &&
			(key.includes('-v2-entry-') || key.includes('-v2-value-')),
	);
	assert.notEqual(garbageDelete, -1);

	const storage = new FaultInjectingStringStorage(durableOld);
	storage.failOperation(garbageDelete + 1, 'delete-noop');
	const store = createStore(storage);
	await store.deleteEntry(first.id);
	assert.equal(await store.getEntry(first.id), null);
	assert.equal((await store.ensureReady()).cleanupPending, true);
	const garbageBeforeRetry = Object.keys(storage.snapshotDurable()).filter(
		(key) => key.includes('-v2-entry-') || key.includes('-v2-value-'),
	);
	assert.ok(garbageBeforeRetry.length > 0);

	await store.retryCleanup();

	assert.equal(await store.getEntry(first.id), null);
	assert.equal((await store.ensureReady()).cleanupPending, false);
	assert.deepEqual(
		Object.keys(storage.snapshotDurable()).filter(
			(key) => key.includes('-v2-entry-') || key.includes('-v2-value-'),
		),
		[],
	);
});

void test('intent recovery preserves pending cleanup pages for retry', async () => {
	const durableOld = await seedOldState();
	const successful = new FaultInjectingStringStorage(durableOld);
	await createStore(successful).deleteEntry(first.id);
	const operations = mutationOperations(successful);
	const garbageDelete = operations.findIndex(
		({ type, key }) =>
			type === 'delete' &&
			(key.includes('-v2-entry-') || key.includes('-v2-value-')),
	);
	const pendingTemplate = new FaultInjectingStringStorage(durableOld);
	pendingTemplate.failOperation(garbageDelete + 1, 'delete-noop');
	await createStore(pendingTemplate).deleteEntry(first.id);
	const planDeletes = mutationOperations(pendingTemplate)
		.map((operation, index) => ({ ...operation, operation: index + 1 }))
		.filter(
			({ type, key }) => type === 'delete' && key.includes('-v2-intent-plan-'),
		);
	assert.notEqual(garbageDelete, -1);
	assert.ok(planDeletes.length > 0);

	const storage = new FaultInjectingStringStorage(durableOld);
	storage.failOperation(garbageDelete + 1, 'delete-noop');
	for (const { operation } of planDeletes) {
		storage.failOperation(operation, 'delete-noop');
	}
	await createStore(storage).deleteEntry(first.id);
	const keys = buildV2Keys(namespace);
	const root = JSON.parse((await storage.getItem(keys.root.a))!) as {
		cleanupHeadKey?: string;
	};
	assert.notEqual(root.cleanupHeadKey, undefined);
	assert.notEqual(await storage.getItem(root.cleanupHeadKey!), null);

	storage.restart();
	const reopened = createStore(storage);
	assert.equal(await reopened.getEntry(first.id), null);
	assert.notEqual(await storage.getItem(root.cleanupHeadKey!), null);
	assert.equal((await reopened.ensureReady()).cleanupPending, true);

	await reopened.retryCleanup();

	assert.equal((await reopened.ensureReady()).cleanupPending, false);
	assert.deepEqual(
		Object.keys(storage.snapshotDurable()).filter(
			(key) => key.includes('-v2-entry-') || key.includes('-v2-value-'),
		),
		[],
	);
});

void test('does not fail a durable delete when cleanup-head reading fails', async () => {
	const durableOld = await seedOldState();
	const successful = new FaultInjectingStringStorage(durableOld);
	await createStore(successful).deleteEntry(first.id);
	const keys = buildV2Keys(namespace);
	const lastRootWrite = successful.operationLog.findLastIndex(
		({ type, key }) =>
			type === 'set' && (key === keys.root.a || key === keys.root.b),
	);
	const postRootCleanupRead = successful.operationLog.findIndex(
		({ type, key }, index) =>
			index > lastRootWrite && type === 'get' && key.includes('-v2-cleanup-'),
	);
	assert.notEqual(postRootCleanupRead, -1);
	const cleanupReadOccurrence = successful.operationLog
		.slice(0, postRootCleanupRead + 1)
		.filter(
			({ type, key }) => type === 'get' && key.includes('-v2-cleanup-'),
		).length;

	const storage = new FaultInjectingStringStorage(durableOld);
	storage.failMatchingRead('-v2-cleanup-', cleanupReadOccurrence);
	const store = createStore(storage);

	await store.deleteEntry(first.id);

	assert.equal(await store.getEntry(first.id), null);
	assert.equal((await store.ensureReady()).cleanupPending, true);
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
