import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { z } from 'zod';
import { canonicalJson } from '../../src/lib/transactional-secure-storage/codec';
import {
	SecureStorageUnavailableError,
	type Sha256,
} from '../../src/lib/transactional-secure-storage/contracts';
import { buildV2Keys, hashCanonicalRecord } from '../../src/lib/transactional-secure-storage/records';
import { selectSnapshot } from '../../src/lib/transactional-secure-storage/snapshot-reader';
import { FaultInjectingStringStorage } from './helpers/fault-injecting-string-storage';
import { writeTransactionalStorageFixture } from './helpers/transactional-storage-fixtures';

const namespace = 'recovery';
const metadataSchema = z.strictObject({ label: z.string() });
const sha256: Sha256 = async (bytes) =>
	createHash('sha256').update(bytes).digest('hex');
type Value = { secret: string };
const serializeValue = (value: Value) => JSON.stringify(value);
const parseValue = (raw: string): Value => JSON.parse(raw) as Value;

function readerOptions(storage: FaultInjectingStringStorage) {
	return { namespace, metadataSchema, parseValue, storage, sha256 };
}

function entry(id: string, secret: string) {
	return { id, metadata: { label: id }, value: { secret } };
}

void test('snapshot recovery rejects incomplete generic cleanup descriptors', async () => {
	for (const fields of [
		{ cleanup: { headKey: 'cleanup' } },
		{ cleanup: { pageCount: 1, sha256: 'cleanup-hash' } },
		{ cleanup: { headKey: 'cleanup', pageCount: 1 } },
		{ cleanup: { headKey: 'cleanup', sha256: 'cleanup-hash' } },
	]) {
		const storage = new FaultInjectingStringStorage();
		await writeTransactionalStorageFixture({ ...readerOptions(storage), serializeValue, slot: 'a', commitGeneration: 1, entries: [] });
		const rootKey = buildV2Keys(namespace).root.a;
		const root = JSON.parse((await storage.getItem(rootKey))!) as Record<string, unknown>;
		await storage.setItem(rootKey, JSON.stringify({ ...root, ...fields }));
		assert.equal((await selectSnapshot(readerOptions(storage))).status, 'no-valid-state');
	}
});

async function seedPair() {
	const storage = new FaultInjectingStringStorage();
	const lower = await writeTransactionalStorageFixture({
		...readerOptions(storage),
		serializeValue,
		slot: 'a' as const,
		commitGeneration: 1,
		entries: [entry('stable', 'old')],
	});
	const higher = await writeTransactionalStorageFixture({
		...readerOptions(storage),
		serializeValue,
		slot: 'b' as const,
		commitGeneration: 2,
		entries: [entry('new', 'new-value'), entry('second', 'two')],
	});
	return { storage, lower, higher };
}

function values(selection: Awaited<ReturnType<typeof selectSnapshot>>) {
	assert.equal(selection.status, 'selected');
	return [...selection.snapshot.entries.values()].map((item) => item.value);
}

async function mutateRecord(
	storage: FaultInjectingStringStorage,
	key: string,
	mutate: (record: Record<string, unknown>) => void,
) {
	const record = JSON.parse((await storage.getItem(key))!) as Record<
		string,
		unknown
	>;
	mutate(record);
	await storage.setItem(key, JSON.stringify(record));
}

async function refreshFixtureHashes(
	storage: FaultInjectingStringStorage,
	fixture: Awaited<ReturnType<typeof writeTransactionalStorageFixture>>,
) {
	const pageHashes: string[] = [];
	for (const [pageIndex, pageKey] of fixture.manifestKeys.entries()) {
		const page = JSON.parse((await storage.getItem(pageKey))!) as {
			entries: { revisionSha256: string }[];
			pageSha256: string;
		};
		const revisionKey = fixture.revisionKeys[pageIndex];
		if (revisionKey !== undefined && page.entries[0] !== undefined) {
			const revision = JSON.parse((await storage.getItem(revisionKey))!) as Record<
				string,
				unknown
			>;
			page.entries[0].revisionSha256 = await sha256(
				new TextEncoder().encode(canonicalJson(revision)),
			);
		}
		page.pageSha256 = await hashCanonicalRecord(page, 'pageSha256', sha256);
		pageHashes.push(page.pageSha256);
		await storage.setItem(pageKey, canonicalJson(page));
	}
	const root = JSON.parse((await storage.getItem(fixture.rootKey))!) as Record<
		string,
		unknown
	>;
	root.manifestSha256 = await hashCanonicalRecord(
		{ snapshotId: root.snapshotId, pageHashes },
		undefined,
		sha256,
	);
	await storage.setItem(fixture.rootKey, canonicalJson(root));
}

void test('selects the higher complete root', async () => {
	const { storage } = await seedPair();
	assert.deepEqual(values(await selectSnapshot(readerOptions(storage))), [
		{ secret: 'new-value' },
		{ secret: 'two' },
	]);
});

void test('falls back when the higher root references a missing manifest page', async () => {
	const { storage, higher } = await seedPair();
	await storage.deleteItem(higher.manifestKeys[1]!);
	assert.deepEqual(values(await selectSnapshot(readerOptions(storage))), [
		{ secret: 'old' },
	]);
});

void test('falls back when a value disappears after restart', async () => {
	const { storage, higher } = await seedPair();
	await storage.deleteItem(higher.valueKeys[0]![0]!);
	storage.restart();
	assert.deepEqual(values(await selectSnapshot(readerOptions(storage))), [
		{ secret: 'old' },
	]);
});

async function assertHigherRootFallsBack(
	corrupt: (
		storage: FaultInjectingStringStorage,
		higher: Awaited<ReturnType<typeof writeTransactionalStorageFixture>>,
	) => Promise<void>,
) {
	const { storage, higher } = await seedPair();
	await corrupt(storage, higher);
	assert.deepEqual(values(await selectSnapshot(readerOptions(storage))), [
		{ secret: 'old' },
	]);
}

void test('falls back after malformed manifest JSON', async () => {
	await assertHigherRootFallsBack(async (storage, higher) => {
		await storage.setItem(higher.manifestKeys[0]!, '{');
	});
});

void test('falls back after malformed revision JSON', async () => {
	await assertHigherRootFallsBack(async (storage, higher) => {
		await storage.setItem(higher.revisionKeys[0]!, '{');
	});
});

void test('falls back after a manifest page-count mismatch', async () => {
	await assertHigherRootFallsBack(async (storage, higher) => {
		await mutateRecord(storage, higher.rootKey, (root) => {
			root.manifestPageCount = 1;
		});
	});
});

void test('falls back after a manifest page contains two entries', async () => {
	await assertHigherRootFallsBack(async (storage, higher) => {
		const secondPage = JSON.parse(
			(await storage.getItem(higher.manifestKeys[1]!))!,
		) as { entries: unknown[] };
		await mutateRecord(storage, higher.manifestKeys[0]!, (page) => {
			(page.entries as unknown[]).push(secondPage.entries[0]);
		});
	});
});

void test('falls back after manifest entry IDs are reordered', async () => {
	await assertHigherRootFallsBack(async (storage, higher) => {
		await mutateRecord(storage, higher.manifestKeys[0]!, (page) => {
			(page.entries as { entryId: string }[])[0]!.entryId = 'z-last';
		});
		await refreshFixtureHashes(storage, higher);
	});
});

void test('falls back after a manifest page hash mismatch', async () => {
	await assertHigherRootFallsBack(async (storage, higher) => {
		await mutateRecord(storage, higher.manifestKeys[0]!, (page) => {
			page.pageSha256 = 'wrong';
		});
	});
});

void test('falls back after a missing entry revision', async () => {
	await assertHigherRootFallsBack(async (storage, higher) => {
		await storage.deleteItem(higher.revisionKeys[0]!);
	});
});

void test('falls back after a revision entry-ID mismatch', async () => {
	await assertHigherRootFallsBack(async (storage, higher) => {
		await mutateRecord(storage, higher.revisionKeys[0]!, (revision) => {
			revision.entryId = 'different';
		});
		await refreshFixtureHashes(storage, higher);
	});
});

void test('falls back when a revision record does not own its manifest key', async () => {
	await assertHigherRootFallsBack(async (storage, higher) => {
		await mutateRecord(storage, higher.revisionKeys[0]!, (revision) => {
			revision.revisionId = 'different-revision-owner';
		});
		await refreshFixtureHashes(storage, higher);
	});
});

void test('falls back after invalid base64 in a value chunk', async () => {
	await assertHigherRootFallsBack(async (storage, higher) => {
		await storage.setItem(higher.valueKeys[0]![0]!, '%%%not-base64%%%');
	});
});

void test('falls back when a changed value-record ID has no derived chunk', async () => {
	await assertHigherRootFallsBack(async (storage, higher) => {
		await mutateRecord(storage, higher.revisionKeys[0]!, (revision) => {
			revision.valueRecordId = 'missing-value-record';
		});
		await refreshFixtureHashes(storage, higher);
	});
});

for (const [name, corrupt] of [
	[
		'duplicate entry IDs',
		async (storage: FaultInjectingStringStorage, higher: Awaited<ReturnType<typeof writeTransactionalStorageFixture>>) =>
			mutateRecord(storage, higher.manifestKeys[1]!, (page) => {
				(page.entries as { entryId: string }[])[0]!.entryId = 'new';
			}),
	],
	[
		'manifest loops',
		async (storage: FaultInjectingStringStorage, higher: Awaited<ReturnType<typeof writeTransactionalStorageFixture>>) =>
			mutateRecord(storage, higher.manifestKeys[1]!, (page) => {
				page.nextPageKey = higher.manifestKeys[0];
			}),
	],
	[
		'wrong hashes',
		async (storage: FaultInjectingStringStorage, higher: Awaited<ReturnType<typeof writeTransactionalStorageFixture>>) =>
			mutateRecord(storage, higher.revisionKeys[0]!, (revision) => {
				revision.valueSha256 = 'wrong';
			}),
	],
	[
		'byte mismatches',
		async (storage: FaultInjectingStringStorage, higher: Awaited<ReturnType<typeof writeTransactionalStorageFixture>>) =>
			mutateRecord(storage, higher.revisionKeys[0]!, (revision) => {
				revision.valueByteLength = (revision.valueByteLength as number) + 1;
			}),
	],
] as const) {
	void test(`falls back after ${name}`, async () => {
		const { storage, higher } = await seedPair();
		await corrupt(storage, higher);
		await refreshFixtureHashes(storage, higher);
		assert.deepEqual(values(await selectSnapshot(readerOptions(storage))), [
			{ secret: 'old' },
		]);
	});
}

void test('returns no-valid-state when both present roots are invalid', async () => {
	const { storage, lower, higher } = await seedPair();
	await storage.deleteItem(lower.manifestKeys[0]!);
	await storage.deleteItem(higher.manifestKeys[0]!);
	assert.deepEqual(await selectSnapshot(readerOptions(storage)), {
		status: 'no-valid-state',
	});
});

void test('returns absent when both root keys are missing', async () => {
	const storage = new FaultInjectingStringStorage();
	assert.deepEqual(await selectSnapshot(readerOptions(storage)), {
		status: 'absent',
	});
});

void test('does not call setItem or deleteItem while opening', async () => {
	const { storage } = await seedPair();
	storage.operationLog.length = 0;
	await selectSnapshot(readerOptions(storage));
	assert.equal(
		storage.operationLog.some(({ type }) => type !== 'get'),
		false,
	);
});

void test('propagates SecureStorageUnavailableError without marking a root corrupt', async () => {
	const { storage, higher } = await seedPair();
	const unavailable = new FaultInjectingStringStorage(
		storage.snapshotDurable(),
	);
	const getItem = unavailable.getItem.bind(unavailable);
	unavailable.getItem = async (key) => {
		if (key === higher.manifestKeys[0]) throw new Error('adapter unavailable');
		return getItem(key);
	};
	await assert.rejects(
		selectSnapshot(readerOptions(unavailable)),
		SecureStorageUnavailableError,
	);
});
