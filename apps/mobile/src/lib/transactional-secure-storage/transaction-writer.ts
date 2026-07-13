import { type ZodType } from 'zod';
import {
	createCleanupChain,
	type ValidatedCleanupPage,
} from './cleanup-chain';
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
	/** An explicit array replaces an unreadable or completed prior inventory. */
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
		let retiredCleanupPages!: readonly ValidatedCleanupPage[];
		try {
			attemptId = options.randomUUID();
			snapshotId = attemptId;
			const candidates = new Map<
				RootSlot,
				Awaited<ReturnType<typeof readRootCandidate<Metadata, Value>>>
			>();
			for (const slot of ['a', 'b'] as const) {
				candidates.set(slot, await readRootCandidate(options, slot));
			}
			const orderedEntries = [...nextEntries].sort((left, right) =>
				left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
			);
			staged = await stageSnapshot(base, orderedEntries, attemptId, snapshotId);
			if (staged.root.snapshotId !== attemptId) {
				snapshotId = staged.root.snapshotId;
			}
			const garbageKeys = new Set(cleanupKeys ?? []);
			const cleanupPages = new Map<RootSlot, readonly ValidatedCleanupPage[]>();
			for (const slot of ['a', 'b'] as const) {
				const candidate = candidates.get(slot)!;
				if (candidate.status !== 'valid') continue;
				const descriptor = candidate.snapshot.root.cleanup;
				if (descriptor === undefined) continue;
				const cleanup = await cleanupChain.read(descriptor);
				if (cleanup.status !== 'valid') continue;
				cleanupPages.set(slot, cleanup.pages);
				if (cleanupKeys === undefined) {
					for (const { garbageKey } of cleanup.pages) garbageKeys.add(garbageKey);
				}
			}
			for (const slot of targetSlots) {
				const candidate = candidates.get(slot)!;
				if (candidate.status !== 'valid') continue;
				for (const key of candidate.snapshot.reachableKeys) garbageKeys.add(key);
			}
			const protectedKeys = new Set<string>([
				keys.root.a,
				keys.root.b,
				keys.intent.a,
				keys.intent.b,
			]);
			for (const slot of ['a', 'b'] as const) {
				if (targetSlots.includes(slot)) {
					for (const key of staged.reachableKeys) protectedKeys.add(key);
					continue;
				}
				const candidate = candidates.get(slot)!;
				if (candidate.status !== 'valid') continue;
				for (const key of candidate.snapshot.reachableKeys) protectedKeys.add(key);
				for (const { key } of cleanupPages.get(slot) ?? []) protectedKeys.add(key);
			}
			staged.root.cleanup = await cleanupChain.stage(
				staged.records,
				attemptId,
				[...garbageKeys].filter((key) => !protectedKeys.has(key)),
			);
			const liveCleanupPageKeys = new Set<string>();
			for (const slot of ['a', 'b'] as const) {
				if (targetSlots.includes(slot)) continue;
				for (const { key } of cleanupPages.get(slot) ?? []) {
					liveCleanupPageKeys.add(key);
				}
			}
			const retirement = new Map<string, ValidatedCleanupPage>();
			for (const slot of targetSlots) {
				for (const page of cleanupPages.get(slot) ?? []) {
					if (!liveCleanupPageKeys.has(page.key)) retirement.set(page.key, page);
				}
			}
			retiredCleanupPages = [...retirement.values()];
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
			const expectedRoot = rootRecords.find(
				(rootRecord) => rootRecord.slot === slot,
			)!.raw;
			if (
				candidate.status !== 'valid' ||
				canonicalJson(candidate.snapshot.root) !== expectedRoot
			) {
				throw new WriteError(
					'Secure storage root did not reopen after publication',
				);
			}
			reopened = candidate.snapshot;
		}
		await intentJournal.complete(attemptId, planPageCount);
		await cleanupChain.deletePagesBestEffort(retiredCleanupPages);
		return reopened;
	}

	async function stageSnapshot(
		base: ValidatedSnapshot<Metadata, Value>,
		entries: readonly SecureEntry<Metadata, Value>[],
		attemptId: string,
		snapshotId: string,
	) {
		const baseEntries = [...base.entries.values()].sort((left, right) =>
			left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
		);
		if (
			entries.length === baseEntries.length &&
			entries.every(
				(entry, index) =>
					entry.id === baseEntries[index]!.id &&
					canonicalJson(entry.metadata) ===
						canonicalJson(baseEntries[index]!.metadata) &&
					options.serializeValue(entry.value) ===
						options.serializeValue(baseEntries[index]!.value),
			)
		) {
			return {
				records: new Map<string, string>(),
				reachableKeys: new Set(base.reachableKeys),
				root: {
					formatVersion: 2 as const,
					namespace: options.namespace,
					snapshotId: base.root.snapshotId,
					manifestHeadKey: base.root.manifestHeadKey,
					manifestPageCount: base.root.manifestPageCount,
					entryCount: base.root.entryCount,
					manifestSha256: base.root.manifestSha256,
					cleanup: base.root.cleanup,
				},
			};
		}
		const records = new Map<string, string>();
		const reachableKeys = new Set<string>();
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
					reachableKeys.add(keys.value(prior.valueRecordId, chunkIndex));
				}
			}
			const valueRecordId = reuseValue
				? prior.valueRecordId
				: `${attemptId}-${entryIndex}`;
			const chunks = reuseValue ? [] : encodeValueChunks(serializedValue);
			for (const [chunkIndex, chunk] of chunks.entries()) {
				const valueKey = keys.value(valueRecordId, chunkIndex);
				records.set(valueKey, chunk);
				reachableKeys.add(valueKey);
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
				reachableKeys.add(priorReference.key);
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
			reachableKeys.add(revisionKey);
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
			reachableKeys.add(keys.manifest(attemptId, pageIndex));
		}
		for (const reference of references) reachableKeys.add(reference.revisionKey);
		return {
			records,
			reachableKeys,
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
