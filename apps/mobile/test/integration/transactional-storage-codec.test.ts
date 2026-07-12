import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
	MAX_SECURE_STORE_VALUE_BYTES,
	assertPayloadFits,
	canonicalJson,
	decodeValueChunks,
	encodeValueChunks,
	utf8ByteLength,
} from '../../src/lib/transactional-secure-storage/codec';
import {
	buildV2Keys,
	createRecordSchemas,
	hashCanonicalRecord,
} from '../../src/lib/transactional-secure-storage/records';

void test('value chunks stay under 1800 UTF-8 bytes and preserve Unicode', () => {
	const value = `${'a'.repeat(1349)}🙂${'界'.repeat(900)}`;
	const chunks = encodeValueChunks(value);
	assert.ok(chunks.length > 1);
	assert.ok(
		chunks.every(
			(chunk) => utf8ByteLength(chunk) <= MAX_SECURE_STORE_VALUE_BYTES,
		),
	);
	assert.equal(decodeValueChunks(chunks), value);
});

void test('canonicalJson ignores object insertion order', () => {
	assert.equal(
		canonicalJson({ z: 1, nested: { b: true, a: 'x' } }),
		canonicalJson({ nested: { a: 'x', b: true }, z: 1 }),
	);
});

void test('canonicalJson uses locale-independent UTF-16 key order', () => {
	assert.equal(
		canonicalJson({ ä: 4, Á: 3, z: 2, a: 1 }),
		'{"a":1,"z":2,"Á":3,"ä":4}',
	);
});

void test('assertPayloadFits rejects 1801 UTF-8 bytes', () => {
	assert.throws(() => assertPayloadFits('x'.repeat(1801)), /1800 UTF-8 bytes/);
});

void test('buildV2Keys creates the exact deterministic storage keys', () => {
	const keys = buildV2Keys('privateKey');
	assert.equal(keys.root.a, 'privateKey-v2-root-a');
	assert.equal(keys.root.b, 'privateKey-v2-root-b');
	assert.equal(keys.intent.a, 'privateKey-v2-intent-a');
	assert.equal(keys.intent.b, 'privateKey-v2-intent-b');
	assert.equal(
		keys.intentPlan('attempt', 2),
		'privateKey-v2-intent-plan-attempt-2',
	);
	assert.equal(keys.manifest('attempt', 3), 'privateKey-v2-manifest-attempt-3');
	assert.equal(keys.entry('attempt', 4), 'privateKey-v2-entry-attempt-4');
	assert.equal(keys.value('attempt-4', 5), 'privateKey-v2-value-attempt-4-5');
	assert.equal(keys.cleanup('attempt', 6), 'privateKey-v2-cleanup-attempt-6');
});

const schemas = createRecordSchemas('privateKey', z.strictObject({ label: z.string() }));
const oversizedNamespace = 'x'.repeat(1801);
const oversizedSchemas = createRecordSchemas(
	oversizedNamespace,
	z.strictObject({ label: z.string() }),
);
const recordFixtures = {
	transactionIntent: {
		formatVersion: 2,
		namespace: 'privateKey',
		attemptId: 'attempt',
		targetRootSlots: ['a'],
		firstCommitGeneration: 0,
		snapshotId: 'snapshot',
		planPageCount: 1,
		planSha256: 'plan-hash',
	},
	intentPlanPage: {
		formatVersion: 2,
		namespace: 'privateKey',
		attemptId: 'attempt',
		pageIndex: 0,
		plannedKey: 'privateKey-v2-entry-attempt-0',
		pageSha256: 'page-hash',
	},
	rootCommit: {
		formatVersion: 2,
		namespace: 'privateKey',
		commitGeneration: 0,
		snapshotId: 'snapshot',
		manifestHeadKey: 'privateKey-v2-manifest-attempt-0',
		manifestPageCount: 1,
		entryCount: 0,
		manifestSha256: 'manifest-hash',
	},
	manifestPage: {
		formatVersion: 2,
		namespace: 'privateKey',
		snapshotId: 'snapshot',
		pageIndex: 0,
		entries: [],
		pageSha256: 'page-hash',
	},
	entryRevision: {
		formatVersion: 2,
		namespace: 'privateKey',
		entryId: 'entry',
		revisionId: 'attempt-0',
		metadata: { label: 'main' },
		valueRecordId: 'attempt-0',
		valueChunkCount: 1,
		valueByteLength: 5,
		valueSha256: 'value-hash',
	},
	cleanupPage: {
		formatVersion: 2,
		namespace: 'privateKey',
		attemptId: 'attempt',
		pageIndex: 0,
		garbageKey: 'privateKey-v2-entry-old-0',
		pageSha256: 'page-hash',
	},
} as const;

for (const name of Object.keys(recordFixtures) as Array<keyof typeof recordFixtures>) {
	void test(`${name} schema is strict, namespace-bound, and payload-bounded`, () => {
		const schema = schemas[name];
		const fixture = recordFixtures[name];
		assert.equal(schema.safeParse(fixture).success, true);
		assert.equal(
			schema.safeParse({ ...fixture, namespace: 'other' }).success,
			false,
		);
		assert.equal(schema.safeParse({ ...fixture, unknown: true }).success, false);
		assert.equal(
			oversizedSchemas[name].safeParse({
				...fixture,
				namespace: oversizedNamespace,
			}).success,
			false,
		);
	});
}

void test('record schemas reject negative counts and indexes', () => {
	assert.equal(
		schemas.transactionIntent.safeParse({
			...recordFixtures.transactionIntent,
			planPageCount: -1,
		}).success,
		false,
	);
	assert.equal(
		schemas.rootCommit.safeParse({
			...recordFixtures.rootCommit,
			entryCount: -1,
		}).success,
		false,
	);
	assert.equal(
		schemas.entryRevision.safeParse({
			...recordFixtures.entryRevision,
			valueChunkCount: -1,
		}).success,
		false,
	);
	assert.equal(
		schemas.cleanupPage.safeParse({
			...recordFixtures.cleanupPage,
			pageIndex: -1,
		}).success,
		false,
	);
});

void test('record schemas reject unsafe storage-key components and keys', () => {
	assert.equal(
		schemas.transactionIntent.safeParse({
			...recordFixtures.transactionIntent,
			attemptId: 'unsafe/key',
		}).success,
		false,
	);
	assert.equal(
		schemas.intentPlanPage.safeParse({
			...recordFixtures.intentPlanPage,
			plannedKey: 'unsafe key',
		}).success,
		false,
	);
	assert.equal(
		schemas.rootCommit.safeParse({
			...recordFixtures.rootCommit,
			manifestHeadKey: 'unsafe key',
		}).success,
		false,
	);
	assert.equal(
		schemas.manifestPage.safeParse({
			...recordFixtures.manifestPage,
			nextPageKey: 'unsafe key',
		}).success,
		false,
	);
	assert.equal(
		schemas.entryRevision.safeParse({
			...recordFixtures.entryRevision,
			valueRecordId: 'unsafe/key',
		}).success,
		false,
	);
	assert.equal(
		schemas.cleanupPage.safeParse({
			...recordFixtures.cleanupPage,
			garbageKey: 'unsafe key',
		}).success,
		false,
	);
});

void test('transaction intents reject duplicate root slots', () => {
	assert.equal(
		schemas.transactionIntent.safeParse({
			...recordFixtures.transactionIntent,
			targetRootSlots: ['a', 'a'],
		}).success,
		false,
	);
});

void test('manifest pages contain zero or one strict entry reference', () => {
	const entry = {
		entryId: 'entry',
		revisionKey: 'privateKey-v2-entry-attempt-0',
		revisionSha256: 'revision-hash',
	};
	assert.equal(
		schemas.manifestPage.safeParse({
			...recordFixtures.manifestPage,
			entries: [entry],
		}).success,
		true,
	);
	assert.equal(
		schemas.manifestPage.safeParse({
			...recordFixtures.manifestPage,
			entries: [entry, entry],
		}).success,
		false,
	);
	assert.equal(
		schemas.manifestPage.safeParse({
			...recordFixtures.manifestPage,
			entries: [{ ...entry, unknown: true }],
		}).success,
		false,
	);
});

void test('hashCanonicalRecord omits only the selected hash field', async () => {
	let input = '';
	const digest = await hashCanonicalRecord(
		{ pageSha256: 'ignored', z: 2, a: 1 },
		'pageSha256',
		async (bytes) => {
			input = new TextDecoder().decode(bytes);
			return 'digest';
		},
	);
	assert.equal(digest, 'digest');
	assert.equal(input, '{"a":1,"z":2}');
});

void test('manifest and plan aggregate hashes use their exact canonical inputs', async () => {
	const inputs: string[] = [];
	const sha256 = async (bytes: Uint8Array) => {
		inputs.push(new TextDecoder().decode(bytes));
		return 'digest';
	};
	await hashCanonicalRecord(
		{ snapshotId: 'snapshot', pageHashes: ['one', 'two'] },
		undefined,
		sha256,
	);
	await hashCanonicalRecord({ pageHashes: ['one', 'two'] }, undefined, sha256);
	assert.deepEqual(inputs, [
		'{"pageHashes":["one","two"],"snapshotId":"snapshot"}',
		'{"pageHashes":["one","two"]}',
	]);
});
