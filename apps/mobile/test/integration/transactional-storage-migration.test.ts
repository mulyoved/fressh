import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { z } from 'zod';
import { buildChunkedStoreKeys, makeBetterSecureStore } from '../../src/lib/chunked-storage';
import { createTransactionalSecureStore, SecureStorageCorruptionError, type Sha256 } from '../../src/lib/transactional-secure-storage';
import { createLegacyChunkedStorageReader } from '../../src/lib/transactional-secure-storage/legacy-reader';
import { buildV2Keys } from '../../src/lib/transactional-secure-storage/records';
import { FaultInjectingStringStorage, type StorageFault } from './helpers/fault-injecting-string-storage';
import { writeTransactionalStorageFixture } from './helpers/transactional-storage-fixtures';

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

void test('reports recovered when opening falls back from a corrupt newer root', async () => {
	const storage = new FaultInjectingStringStorage();
	const lower = await writeTransactionalStorageFixture({
		namespace,
		metadataSchema,
		serializeValue: JSON.stringify,
		storage,
		sha256,
		slot: 'a',
		commitGeneration: 1,
		entries: [{ id: 'alpha', metadata: { label: 'Alpha' }, value: { privateKey: 'one' } }],
	});
	const higher = await writeTransactionalStorageFixture({
		namespace,
		metadataSchema,
		serializeValue: JSON.stringify,
		storage,
		sha256,
		slot: 'b',
		commitGeneration: 2,
		entries: [{ id: 'beta', metadata: { label: 'Beta' }, value: { privateKey: 'two' } }],
	});
	await storage.deleteItem(higher.manifestKeys[0]!);

	assert.equal((await createStore(storage).ensureReady()).status, 'recovered');
	assert.notEqual(await storage.getItem(lower.manifestKeys[0]!), null);
});

void test('rebuilds anchored cleanup through intents before writing replacement pages', async () => {
	const storage = await seedLegacy();
	await createStore(storage).ensureReady();
	storage.restart();
	const root = JSON.parse(
		(await storage.getItem(buildV2Keys(namespace).root.b))!,
	) as { cleanup: { headKey: string } };
	await storage.setItem(root.cleanup.headKey, '{');
	const brokenCleanup = storage.snapshotDurable();
	const originalCleanupKeys = new Set(
		Object.keys(brokenCleanup).filter((key) => key.includes('-v2-cleanup-')),
	);
	storage.operationLog.length = 0;

	await createStore(storage).ensureReady();

	const keys = buildV2Keys(namespace);
	const firstCleanupWrite = storage.operationLog.findIndex(
		({ type, key }) => type === 'set' && key.includes('-v2-cleanup-'),
	);
	const intentAWritten = storage.operationLog.findIndex(
		({ type, key }) => type === 'set' && key === keys.intent.a,
	);
	const intentBWritten = storage.operationLog.findIndex(
		({ type, key }) => type === 'set' && key === keys.intent.b,
	);
	assert.ok(firstCleanupWrite > 0);
	assert.ok(intentAWritten >= 0 && intentAWritten < firstCleanupWrite);
	assert.ok(intentBWritten >= 0 && intentBWritten < firstCleanupWrite);
	const publicationEnd = storage.operationLog
		.filter(({ type }) => type !== 'get')
		.map((operation, index) => ({ ...operation, boundary: index + 1 }))
		.filter(
			({ type, key }) =>
				type === 'set' && (key === keys.root.a || key === keys.root.b),
		)[1]!.boundary;

	for (const fault of [
		'throw-before',
		'throw-after-visible',
		'volatile-success',
	] as const satisfies readonly StorageFault[]) {
		for (let boundary = 1; boundary <= publicationEnd; boundary++) {
			const interrupted = new FaultInjectingStringStorage(brokenCleanup);
			interrupted.failOperation(boundary, fault);
			await createStore(interrupted).ensureReady().catch(() => undefined);
			interrupted.restart();

			const durable = interrupted.snapshotDurable();
			const discoverable = collectCleanupDiscoveryKeys(durable);
			for (const cleanupKey of Object.keys(durable).filter(
				(key) =>
					key.includes('-v2-cleanup-') && !originalCleanupKeys.has(key),
			)) {
				assert.ok(
					discoverable.has(cleanupKey),
					`${fault} boundary ${boundary} orphaned ${cleanupKey}`,
				);
			}
			assert.deepEqual(
				(await createStore(interrupted).listEntries()).map(({ id }) => id),
				['alpha', 'beta'],
			);
		}
	}
});

function collectCleanupDiscoveryKeys(records: Record<string, string>) {
	const keys = buildV2Keys(namespace);
	const discovered = new Set<string>();
	for (const rootKey of [keys.root.a, keys.root.b]) {
		try {
			let pageKey = (
				JSON.parse(records[rootKey]!) as { cleanup?: { headKey: string } }
			).cleanup?.headKey;
			while (pageKey !== undefined && !discovered.has(pageKey)) {
				discovered.add(pageKey);
				pageKey = (JSON.parse(records[pageKey]!) as { nextPageKey?: string })
					.nextPageKey;
			}
		} catch {
			// Invalid roots/pages do not make records reachable.
		}
	}
	for (const intentKey of [keys.intent.a, keys.intent.b]) {
		try {
			const intent = JSON.parse(records[intentKey]!) as {
				attemptId: string;
				planPageCount: number;
			};
			for (let pageIndex = 0; pageIndex < intent.planPageCount; pageIndex++) {
				const plan = JSON.parse(
					records[keys.intentPlan(intent.attemptId, pageIndex)]!,
				) as { plannedKey: string };
				discovered.add(plan.plannedKey);
			}
		} catch {
			// An incomplete plan cannot authorize deletion, but no staged page may exist yet.
		}
	}
	return discovered;
}

void test('stale and disagreeing intent headers are removed before a new migration attempt', async () => {
	const storage = await seedLegacy();
	const keys = buildV2Keys(namespace);
	await storage.setItem(keys.intent.a, '{');
	await storage.setItem(keys.intent.b, JSON.stringify({ unrelated: true }));
	await createStore(storage).ensureReady();
	assert.equal(await storage.getItem(keys.intent.a), null);
	assert.equal(await storage.getItem(keys.intent.b), null);
});

void test('every first-instance mutation path preserves all durable v1 records', async () => {
	for (const run of [
		(store: ReturnType<typeof createStore>) => store.upsertEntry({ id: 'gamma', metadata: { label: 'Gamma' }, value: { privateKey: 'three' } }),
		(store: ReturnType<typeof createStore>) => store.replaceAllEntries([]),
		(store: ReturnType<typeof createStore>) => store.deleteEntry('alpha'),
		(store: ReturnType<typeof createStore>) => store.retryCleanup(),
	] as const) {
		const storage = await seedLegacy();
		const before = legacyKeys(storage);
		const store = createStore(storage);
		await store.ensureReady();
		await run(store);
		await store.ensureReady();
		assert.deepEqual(legacyKeys(storage), before);
	}
});

void test('missing or malformed legacy cleanup pages are rebuilt from readable v1 and eventually cleaned', async () => {
	for (const replacement of [null, '{'] as const) {
		const storage = await seedLegacy();
		await createStore(storage).ensureReady();
		storage.restart();
		const root = JSON.parse((await storage.getItem(buildV2Keys(namespace).root.b))!) as { cleanup: { headKey: string } };
		if (replacement === null) await storage.deleteItem(root.cleanup.headKey);
		else await storage.setItem(root.cleanup.headKey, replacement);
		await createStore(storage).ensureReady();
		assert.deepEqual(legacyKeys(storage), []);
	}
});

void test('a stale valid peer root is mirrored to the selected snapshot before legacy cleanup', async () => {
	const storage = await seedLegacy();
	await createStore(storage).ensureReady();
	await writeTransactionalStorageFixture({ namespace, metadataSchema, serializeValue: JSON.stringify, storage, sha256, slot: 'a', commitGeneration: 0, entries: [] });
	const rootKeys = buildV2Keys(namespace);
	storage.restart();
	await createStore(storage).ensureReady();
	const a = JSON.parse((await storage.getItem(rootKeys.root.a))!) as { snapshotId: string };
	const b = JSON.parse((await storage.getItem(rootKeys.root.b))!) as { snapshotId: string };
	assert.equal(a.snapshotId, b.snapshotId);
	assert.deepEqual(legacyKeys(storage), []);
});

void test('recomputed cleanup pages cannot delete keys outside the exact readable v1 inventory', async () => {
	const storage = await seedLegacy();
	await storage.setItem('unrelated-app-secret', 'keep');
	await createStore(storage).ensureReady();
	storage.restart();
	const root = JSON.parse((await storage.getItem(buildV2Keys(namespace).root.b))!) as { cleanup: { headKey: string } };
	const page = JSON.parse((await storage.getItem(root.cleanup.headKey))!) as Record<string, unknown>;
	page.garbageKey = 'unrelated-app-secret';
	page.pageSha256 = await sha256(new TextEncoder().encode(JSON.stringify(Object.fromEntries(Object.entries(page).filter(([key]) => key !== 'pageSha256')))));
	await storage.setItem(root.cleanup.headKey, JSON.stringify(page));
	await createStore(storage).ensureReady();
	assert.equal(await storage.getItem('unrelated-app-secret'), 'keep');
	assert.deepEqual(legacyKeys(storage), ['unrelated-app-secret']);
});

void test('silent no-op at every migration publication boundary is detected before success', async () => {
	const probe = await seedLegacy();
	const offset = probe.operationLog.filter(({ type }) => type === 'set' || type === 'delete').length;
	await createStore(probe).ensureReady();
	const boundaries = probe.operationLog.filter(({ type }) => type === 'set').length - offset;
	for (let boundary = 1; boundary <= boundaries; boundary++) {
		const storage = await seedLegacy();
		const start = storage.operationLog.filter(({ type }) => type === 'set' || type === 'delete').length;
		storage.failOperation(start + boundary, 'delete-noop');
		await assert.rejects(createStore(storage).ensureReady(), `boundary ${boundary}`);
		storage.restart();
		assert.equal(legacyKeys(storage).length, 4);
	}
});

void test('cleanup verification read failure is best effort and retries on a later launch', async () => {
	const storage = await seedLegacy();
	await createStore(storage).ensureReady();
	storage.restart();
	const target = legacyKeys(storage).find((key) => key.includes('-entry-'))!;
	storage.failMatchingRead(target, 2);
	const operationsBeforeCleanup = storage.operationLog.length;
	const reopened = createStore(storage);
	assert.equal((await reopened.ensureReady()).cleanupPending, true);
	assert.deepEqual((await reopened.listEntries()).map(({ id }) => id), ['alpha', 'beta']);
	assert.equal(storage.operationLog.slice(operationsBeforeCleanup).some(({ type, key }) => type === 'set' && !key.includes('-v2-')), false);
	storage.restart();
	await createStore(storage).ensureReady();
	assert.deepEqual(legacyKeys(storage), []);
});

void test('unavailable exact inventory performs no cleanup-page reads or legacy deletes', async () => {
	const seeded = await seedLegacy();
	await createStore(seeded).ensureReady();
	seeded.restart();
	const keys = buildV2Keys(namespace);
	for (const slot of ['a', 'b'] as const) {
		const root = JSON.parse((await seeded.getItem(keys.root[slot]))!) as Record<string, unknown>;
		delete root.cleanup;
		await seeded.setItem(keys.root[slot], JSON.stringify(root));
	}
	const legacy = new Set(legacyKeys(seeded));
	const observed: { type: 'get'; key: string }[] = [];
	const storage = {
		operationLog: seeded.operationLog,
		getItem: async (key: string) => {
			observed.push({ type: 'get', key });
			if (legacy.has(key)) throw new Error('persistent legacy read failure');
			return seeded.getItem(key);
		},
		setItem: seeded.setItem.bind(seeded),
		deleteItem: seeded.deleteItem.bind(seeded),
	};
	const store = createTransactionalSecureStore({
		namespace, metadataSchema, serializeValue: JSON.stringify,
		parseValue: (raw) => JSON.parse(raw) as Value, storage,
		legacy: createLegacyChunkedStorageReader({ storagePrefix: namespace, metadataSchema, parseValue: (raw) => JSON.parse(raw) as Value, storage }),
		randomUUID: () => `migration-${++nextId}`, sha256,
	});
	assert.equal((await store.ensureReady()).cleanupPending, false);
	assert.deepEqual((await store.listEntries()).map(({ id }) => id), ['alpha', 'beta']);
	const unavailableAt = observed.findIndex(({ key }) => legacy.has(key));
	const cleanupOperations = observed.slice(unavailableAt + 1).filter(({ key }) => key.includes('-v2-cleanup-'));
	assert.deepEqual(cleanupOperations, []);
});

void test('same-namespace v1-shaped keys outside exact inventory are never cleanup-authorized', async () => {
	const storage = await seedLegacy();
	const unrelated = `${namespace}-entry-never-migrated-chunk-0`;
	await storage.setItem(unrelated, 'keep');
	await createStore(storage).ensureReady();
	storage.restart();
	const root = JSON.parse((await storage.getItem(buildV2Keys(namespace).root.b))!) as { cleanup: { headKey: string } };
	const page = JSON.parse((await storage.getItem(root.cleanup.headKey))!) as Record<string, unknown>;
	page.garbageKey = unrelated;
	page.pageSha256 = await sha256(new TextEncoder().encode(JSON.stringify(Object.fromEntries(Object.entries(page).filter(([key]) => key !== 'pageSha256')))));
	await storage.setItem(root.cleanup.headKey, JSON.stringify(page));
	const legacyValue = legacyKeys(storage).find((key) => key.includes('-entry-') && key !== unrelated)!;
	storage.failMatchingRead(legacyValue, 1);
	await createStore(storage).ensureReady();
	assert.equal(await storage.getItem(unrelated), 'keep');
});

void test('stale peer with unreadable legacy is mirrored but no cleanup is attempted', async () => {
	const storage = await seedLegacy();
	await createStore(storage).ensureReady();
	await writeTransactionalStorageFixture({ namespace, metadataSchema, serializeValue: JSON.stringify, storage, sha256, slot: 'a', commitGeneration: 0, entries: [] });
	const rootKeys = buildV2Keys(namespace);
	storage.restart();
	const legacyValue = legacyKeys(storage).find((key) => key.includes('-entry-'))!;
	storage.failMatchingRead(legacyValue, 1);
	const beforeLegacy = legacyKeys(storage);
	await createStore(storage).ensureReady();
	const a = JSON.parse((await storage.getItem(rootKeys.root.a))!) as { snapshotId: string };
	const b = JSON.parse((await storage.getItem(rootKeys.root.b))!) as { snapshotId: string };
	assert.equal(a.snapshotId, b.snapshotId);
	assert.deepEqual(legacyKeys(storage), beforeLegacy);
});

void test('anchored partial legacy cleanup survives every later mutation and retry path', async () => {
	for (const run of [
		(store: ReturnType<typeof createStore>) => store.upsertEntry({ id: 'gamma', metadata: { label: 'Gamma' }, value: { privateKey: 'three' } }),
		(store: ReturnType<typeof createStore>) => store.replaceAllEntries([{ id: 'alpha', metadata: { label: 'Alpha 2' }, value: { privateKey: 'one' } }]),
		(store: ReturnType<typeof createStore>) => store.deleteEntry('beta'),
		(store: ReturnType<typeof createStore>) => store.retryCleanup(),
	] as const) {
		const storage = await seedLegacy();
		const unrelated = `${namespace}-entry-unrelated-chunk-0`;
		await storage.setItem(unrelated, 'keep');
		await createStore(storage).ensureReady();
		storage.restart();
		const target = legacyKeys(storage).find((key) => key.includes('-entry-alpha-'))!;
		storage.failMatchingRead(target, 2);
		const reopened = createStore(storage);
		assert.equal((await reopened.ensureReady()).cleanupPending, true);
		const roots = buildV2Keys(namespace).root;
		const anchoredBefore = JSON.parse((await storage.getItem(roots.b))!) as { cleanup: { headKey: string; pageCount: number; sha256: string } };
		const legacyBeforeMutation = legacyKeys(storage);
		await run(reopened);
		const rootA = JSON.parse((await storage.getItem(roots.a))!) as typeof anchoredBefore;
		const rootB = JSON.parse((await storage.getItem(roots.b))!) as typeof anchoredBefore;
		const current = rootA.cleanup !== undefined ? rootA : rootB;
		if (current.cleanup !== undefined) {
			assert.deepEqual(current.cleanup, anchoredBefore.cleanup);
			assert.deepEqual(legacyKeys(storage), legacyBeforeMutation);
		} else {
			assert.deepEqual(legacyKeys(storage), [unrelated]);
		}
		storage.restart();
		await createStore(storage).ensureReady();
		assert.equal(await storage.getItem(unrelated), 'keep');
		assert.deepEqual(legacyKeys(storage), [unrelated]);
	}
});
