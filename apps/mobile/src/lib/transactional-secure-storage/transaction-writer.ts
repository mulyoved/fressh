import { type ZodType } from 'zod';
import { createCleanupChain } from './cleanup-chain';
import { canonicalJson, encodeValueChunks } from './codec';
import {
	SecureStorageWriteNotCommittedError as WriteError,
	type AsyncStringStorage,
	type ManifestEntryRefV2,
	type RootSlot,
	type SecureEntry,
	type Sha256,
} from './contracts';
import { createIntentJournal } from './intent-journal';
import {
	buildV2Keys,
	createRecordSchemas,
	hashCanonicalRecord as hash,
} from './records';
import { readRootCandidate, type ValidatedSnapshot } from './snapshot-reader';

type WriterOptions<Metadata extends object, Value> = {
	namespace: string;
	metadataSchema: ZodType<Metadata>;
	serializeValue(value: Value): string;
	parseValue(raw: string): Value;
	storage: AsyncStringStorage;
	randomUUID(): string;
	sha256: Sha256;
};

type CommitOptions<Metadata extends object, Value> = {
	base: ValidatedSnapshot<Metadata, Value>;
	nextEntries: readonly SecureEntry<Metadata, Value>[];
	targetSlots: readonly RootSlot[];
	/** Undefined preserves the current descriptor; an array replaces it. */
	cleanupKeys?: readonly string[];
};

export function createTransactionWriter<Metadata extends object, Value>(
	options: WriterOptions<Metadata, Value>,
) {
	const keys = buildV2Keys(options.namespace);
	const schemas = createRecordSchemas(options.namespace, options.metadataSchema);
	const cleanupChain = createCleanupChain(options);
	const intentJournal = createIntentJournal(options);
	const encoder = new TextEncoder();

	async function commitSnapshot({
		base,
		nextEntries,
		targetSlots,
		cleanupKeys,
	}: CommitOptions<Metadata, Value>) {
		let attemptId!: string;
		let snapshotId!: string;
		let staged!: Awaited<ReturnType<typeof stageSnapshot>>;
		let rootRecords!: readonly { slot: RootSlot; raw: string }[];
		let planPageCount!: number;
		try {
			attemptId = options.randomUUID();
			snapshotId = attemptId;
			const orderedEntries = [...nextEntries].sort((left, right) =>
				left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
			);
			staged = await stageSnapshot(base, orderedEntries, attemptId, snapshotId);
			if (cleanupKeys === undefined) {
				staged.root.cleanup = base.root.cleanup;
			} else {
				const garbageKeys = [...new Set(cleanupKeys)].filter(
					(key) =>
						!staged.protectedKeys.has(key) &&
						key !== keys.root.a &&
						key !== keys.root.b &&
						key !== keys.intent.a &&
						key !== keys.intent.b,
				);
				staged.root.cleanup = await cleanupChain.stage(
					staged.records,
					attemptId,
					garbageKeys,
				);
			}
			const journal = await intentJournal.write({
				attemptId,
				targetRootSlots: targetSlots,
				firstCommitGeneration: base.root.commitGeneration + 1,
				snapshotId,
				plannedKeys: [...staged.records.keys()],
			});
			planPageCount = journal.pageCount;
			for (const [key, raw] of staged.records) {
				await options.storage.setItem(key, raw);
			}
			await validateStaged(staged.records);
			rootRecords = targetSlots.map((slot, index) => ({
				slot,
				raw: canonicalJson(
					schemas.rootCommit.parse({
						...staged.root,
						commitGeneration: base.root.commitGeneration + 1 + index,
					}),
				),
			}));
		} catch (error) {
			throw new WriteError(`Secure storage staging failed: ${String(error)}`);
		}

		for (const { slot, raw } of rootRecords) {
			try {
				await options.storage.setItem(keys.root[slot], raw);
			} catch (error) {
				throw new WriteError(
					`Secure storage root publication failed: ${String(error)}`,
				);
			}
		}
		let reopened!: ValidatedSnapshot<Metadata, Value>;
		for (const slot of targetSlots) {
			const candidate = await readRootCandidate(options, slot);
			if (
				candidate.status !== 'valid' ||
				candidate.snapshot.root.snapshotId !== snapshotId
			) {
				throw new WriteError(
					'Secure storage root did not reopen after publication',
				);
			}
			reopened = candidate.snapshot;
		}
		await intentJournal.complete(attemptId, planPageCount);
		return reopened;
	}

	async function stageSnapshot(
		base: ValidatedSnapshot<Metadata, Value>,
		entries: readonly SecureEntry<Metadata, Value>[],
		attemptId: string,
		snapshotId: string,
	) {
		const records = new Map<string, string>();
		const protectedKeys = new Set<string>();
		const references: ManifestEntryRefV2[] = [];
		for (const [entryIndex, entry] of entries.entries()) {
			const serializedValue = options.serializeValue(entry.value);
			const valueBytes = encoder.encode(serializedValue);
			const valueSha256 = await options.sha256(valueBytes);
			const priorReference = base.revisions.get(entry.id);
			const prior = priorReference?.record;
			const reuseValue =
				prior !== undefined &&
				prior.valueSha256 === valueSha256 &&
				prior.valueByteLength === valueBytes.byteLength;
			if (reuseValue) {
				for (let chunkIndex = 0; chunkIndex < prior.valueChunkCount; chunkIndex++) {
					protectedKeys.add(keys.value(prior.valueRecordId, chunkIndex));
				}
			}
			const valueRecordId = reuseValue
				? prior.valueRecordId
				: `${attemptId}-${entryIndex}`;
			const chunks = reuseValue ? [] : encodeValueChunks(serializedValue);
			for (const [chunkIndex, chunk] of chunks.entries()) {
				records.set(keys.value(valueRecordId, chunkIndex), chunk);
			}
			const unchanged =
				reuseValue &&
				canonicalJson(prior.metadata) === canonicalJson(entry.metadata);
			if (unchanged && priorReference !== undefined) {
				const raw = await options.storage.getItem(priorReference.key);
				if (raw === null) {
					throw new Error(`Missing reusable revision: ${priorReference.key}`);
				}
				if ((await options.sha256(encoder.encode(raw))) !== priorReference.sha256) {
					throw new Error(`Changed reusable revision: ${priorReference.key}`);
				}
				references.push({
					entryId: entry.id,
					revisionKey: priorReference.key,
					revisionSha256: priorReference.sha256,
				});
				protectedKeys.add(priorReference.key);
				continue;
			}
			const revisionId = `${attemptId}-${entryIndex}`;
			const revision = schemas.entryRevision.parse({
				formatVersion: 2,
				namespace: options.namespace,
				entryId: entry.id,
				revisionId,
				metadata: entry.metadata,
				valueRecordId,
				valueChunkCount: reuseValue ? prior!.valueChunkCount : chunks.length,
				valueByteLength: valueBytes.byteLength,
				valueSha256,
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
				snapshotId,
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
		for (const reference of references) protectedKeys.add(reference.revisionKey);
		return {
			records,
			protectedKeys,
			root: {
				formatVersion: 2 as const,
				namespace: options.namespace,
				snapshotId,
				manifestHeadKey: keys.manifest(attemptId, 0),
				manifestPageCount: pageCount,
				entryCount: references.length,
				manifestSha256: await hash(
					{ snapshotId, pageHashes },
					undefined,
					options.sha256,
				),
				cleanup: base.root.cleanup,
			},
		};
	}

	async function validateStaged(records: ReadonlyMap<string, string>) {
		for (const [key, expected] of records) {
			if ((await options.storage.getItem(key)) !== expected) {
				throw new Error(`Staged record validation failed: ${key}`);
			}
		}
	}

	return { commitSnapshot };
}
