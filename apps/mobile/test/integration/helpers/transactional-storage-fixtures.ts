import type * as z from 'zod';
import {
	canonicalJson,
	encodeValueChunks,
} from '../../../src/lib/transactional-secure-storage/codec';
import {
	type AsyncStringStorage,
	type RootSlot,
	type SecureEntry,
	type Sha256,
} from '../../../src/lib/transactional-secure-storage/contracts';
import {
	buildV2Keys,
	createRecordSchemas,
	hashCanonicalRecord,
} from '../../../src/lib/transactional-secure-storage/records';

const textEncoder = new TextEncoder();

export async function writeTransactionalStorageFixture<
	Metadata extends object,
	Value,
>(options: {
	namespace: string;
	metadataSchema: z.ZodType<Metadata>;
	serializeValue(value: Value): string;
	storage: AsyncStringStorage;
	sha256: Sha256;
	slot: RootSlot;
	commitGeneration: number;
	entries: readonly SecureEntry<Metadata, Value>[];
}) {
	const keys = buildV2Keys(options.namespace);
	const schemas = createRecordSchemas(
		options.namespace,
		options.metadataSchema,
	);
	const attemptId = `attempt-${options.slot}-${options.commitGeneration}`;
	const snapshotId = `snapshot-${options.slot}-${options.commitGeneration}`;
	const pageHashes: string[] = [];
	const manifestKeys: string[] = [];
	const revisionKeys: string[] = [];
	const valueKeys: string[][] = [];

	for (const [entryIndex, entry] of options.entries.entries()) {
		const valueRecordId = `${attemptId}-${entryIndex}`;
		const serializedValue = options.serializeValue(entry.value);
		const chunks = encodeValueChunks(serializedValue);
		const valueBytes = textEncoder.encode(serializedValue);
		const entryValueKeys: string[] = [];
		for (const [chunkIndex, chunk] of chunks.entries()) {
			const valueKey = keys.value(valueRecordId, chunkIndex);
			await options.storage.setItem(valueKey, chunk);
			entryValueKeys.push(valueKey);
		}
		valueKeys.push(entryValueKeys);

		const revision = schemas.entryRevision.parse({
			formatVersion: 2,
			namespace: options.namespace,
			entryId: entry.id,
			revisionId: `${attemptId}-${entryIndex}`,
			metadata: entry.metadata,
			valueRecordId,
			valueChunkCount: chunks.length,
			valueByteLength: valueBytes.byteLength,
			valueSha256: await options.sha256(valueBytes),
		});
		const revisionKey = keys.entry(attemptId, entryIndex);
		const rawRevision = canonicalJson(revision);
		await options.storage.setItem(revisionKey, rawRevision);
		revisionKeys.push(revisionKey);

		const manifestKey = keys.manifest(attemptId, entryIndex);
		manifestKeys.push(manifestKey);
		const pageWithoutHash = {
			formatVersion: 2 as const,
			namespace: options.namespace,
			snapshotId,
			pageIndex: entryIndex,
			entries: [
				{
					entryId: entry.id,
					revisionKey,
					revisionSha256: await options.sha256(textEncoder.encode(rawRevision)),
				},
			],
			...(entryIndex + 1 < options.entries.length
				? { nextPageKey: keys.manifest(attemptId, entryIndex + 1) }
				: {}),
		};
		const pageSha256 = await hashCanonicalRecord(
			pageWithoutHash,
			undefined,
			options.sha256,
		);
		pageHashes.push(pageSha256);
		await options.storage.setItem(
			manifestKey,
			canonicalJson(
				schemas.manifestPage.parse({ ...pageWithoutHash, pageSha256 }),
			),
		);
	}

	if (options.entries.length === 0) {
		const manifestKey = keys.manifest(attemptId, 0);
		manifestKeys.push(manifestKey);
		const pageWithoutHash = {
			formatVersion: 2 as const,
			namespace: options.namespace,
			snapshotId,
			pageIndex: 0,
			entries: [],
		};
		const pageSha256 = await hashCanonicalRecord(
			pageWithoutHash,
			undefined,
			options.sha256,
		);
		pageHashes.push(pageSha256);
		await options.storage.setItem(
			manifestKey,
			canonicalJson(
				schemas.manifestPage.parse({ ...pageWithoutHash, pageSha256 }),
			),
		);
	}

	const root = schemas.rootCommit.parse({
		formatVersion: 2,
		namespace: options.namespace,
		commitGeneration: options.commitGeneration,
		snapshotId,
		manifestHeadKey: manifestKeys[0],
		manifestPageCount: manifestKeys.length,
		entryCount: options.entries.length,
		manifestSha256: await hashCanonicalRecord(
			{ snapshotId, pageHashes },
			undefined,
			options.sha256,
		),
	});
	await options.storage.setItem(keys.root[options.slot], canonicalJson(root));
	return {
		rootKey: keys.root[options.slot],
		manifestKeys,
		revisionKeys,
		valueKeys,
	};
}
