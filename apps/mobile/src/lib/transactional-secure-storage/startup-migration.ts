import { type ZodType } from 'zod';
import { createCleanupChain } from './cleanup-chain';
import { canonicalJson, encodeValueChunks } from './codec';
import {
	type AsyncStringStorage,
	type LegacySnapshot,
	type Sha256,
} from './contracts';
import { createIntentJournal } from './intent-journal';
import {
	buildV2Keys,
	createRecordSchemas,
	hashCanonicalRecord as hash,
} from './records';
import { readRootCandidate, type ValidatedSnapshot } from './snapshot-reader';

type Options<Metadata extends object, Value> = {
	namespace: string;
	metadataSchema: ZodType<Metadata>;
	serializeValue(value: Value): string;
	parseValue(raw: string): Value;
	storage: AsyncStringStorage;
	randomUUID(): string;
	sha256: Sha256;
};

export function createStartupMigration<Metadata extends object, Value>(
	options: Options<Metadata, Value>,
) {
	const keys = buildV2Keys(options.namespace);
	const schemas = createRecordSchemas(options.namespace, options.metadataSchema);
	const cleanupChain = createCleanupChain(options);
	const intentJournal = createIntentJournal(options);
	const encoder = new TextEncoder();

	async function initialize(snapshot: LegacySnapshot<Metadata, Value>) {
		const attemptId = options.randomUUID();
		const records = new Map<string, string>();
		const references = [];
		const entries = [...snapshot.entries].sort((left, right) =>
			left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
		);
		for (const [entryIndex, entry] of entries.entries()) {
			const serialized = options.serializeValue(entry.value);
			const bytes = encoder.encode(serialized);
			const chunks = encodeValueChunks(serialized);
			const revisionId = `${attemptId}-${entryIndex}`;
			for (const [chunkIndex, chunk] of chunks.entries()) {
				records.set(keys.value(revisionId, chunkIndex), chunk);
			}
			const revision = schemas.entryRevision.parse({
				formatVersion: 2,
				namespace: options.namespace,
				entryId: entry.id,
				revisionId,
				metadata: entry.metadata,
				valueRecordId: revisionId,
				valueChunkCount: chunks.length,
				valueByteLength: bytes.byteLength,
				valueSha256: await options.sha256(bytes),
			});
			const revisionKey = keys.entry(attemptId, entryIndex);
			const raw = canonicalJson(revision);
			records.set(revisionKey, raw);
			references.push({
				entryId: entry.id,
				revisionKey,
				revisionSha256: await options.sha256(encoder.encode(raw)),
			});
		}

		const pageCount = Math.max(1, references.length);
		const pageHashes = new Array<string>(pageCount);
		for (let pageIndex = pageCount - 1; pageIndex >= 0; pageIndex--) {
			const body = {
				formatVersion: 2 as const,
				namespace: options.namespace,
				snapshotId: attemptId,
				pageIndex,
				entries:
					references[pageIndex] === undefined ? [] : [references[pageIndex]],
				...(pageIndex + 1 < pageCount
					? { nextPageKey: keys.manifest(attemptId, pageIndex + 1) }
					: {}),
			};
			const pageSha256 = await hash(body, undefined, options.sha256);
			pageHashes[pageIndex] = pageSha256;
			records.set(
				keys.manifest(attemptId, pageIndex),
				canonicalJson(schemas.manifestPage.parse({ ...body, pageSha256 })),
			);
		}
		const cleanup =
			snapshot.status === 'present'
				? await cleanupChain.stage(
						records,
						attemptId,
						[...snapshot.recordKeys.slice(1), snapshot.recordKeys[0]!],
					)
				: undefined;
		const rootBase = {
			formatVersion: 2 as const,
			namespace: options.namespace,
			snapshotId: attemptId,
			manifestHeadKey: keys.manifest(attemptId, 0),
			manifestPageCount: pageCount,
			entryCount: references.length,
			manifestSha256: await hash(
				{ snapshotId: attemptId, pageHashes },
				undefined,
				options.sha256,
			),
			cleanup,
		};
		const journal = await intentJournal.write({
			attemptId,
			targetRootSlots: ['a', 'b'],
			firstCommitGeneration: 1,
			snapshotId: attemptId,
			plannedKeys: [...records.keys()],
		});
		for (const [key, raw] of records) await writeValidated(key, raw);
		for (const [slot, commitGeneration] of [
			['a', 1],
			['b', 2],
		] as const) {
			await writeValidated(
				keys.root[slot],
				canonicalJson(
					schemas.rootCommit.parse({ ...rootBase, commitGeneration }),
				),
			);
			if ((await readRootCandidate(options, slot)).status !== 'valid') {
				throw new Error(`Startup root validation failed: ${slot}`);
			}
		}
		await intentJournal.complete(attemptId, journal.pageCount);
	}

	function sameSnapshot(
		left: ValidatedSnapshot<Metadata, Value>,
		right: ValidatedSnapshot<Metadata, Value>,
	) {
		return (
			left.root.snapshotId === right.root.snapshotId &&
			left.root.manifestHeadKey === right.root.manifestHeadKey &&
			left.root.manifestSha256 === right.root.manifestSha256 &&
			canonicalJson(left.root.cleanup) === canonicalJson(right.root.cleanup)
		);
	}

	async function writeValidated(key: string, raw: string) {
		await options.storage.setItem(key, raw);
		if ((await options.storage.getItem(key)) !== raw) {
			throw new Error(`Startup record validation failed: ${key}`);
		}
	}

	return { initialize, sameSnapshot };
}
