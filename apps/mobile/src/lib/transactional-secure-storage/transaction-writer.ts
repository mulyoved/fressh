import type * as z from 'zod';
import { canonicalJson, encodeValueChunks } from './codec';
import {
	SecureStorageWriteNotCommittedError,
	type AsyncStringStorage,
	type ManifestEntryRefV2,
	type RootSlot,
	type SecureEntry,
	type Sha256,
	type TransactionIntentV2,
} from './contracts';
import {
	buildV2Keys,
	createRecordSchemas,
	hashCanonicalRecord,
} from './records';
import { readRootCandidate, type ValidatedSnapshot } from './snapshot-reader';

const textEncoder = new TextEncoder();

type WriterOptions<Metadata extends object, Value> = {
	namespace: string;
	metadataSchema: z.ZodType<Metadata>;
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
	cleanupKeys: readonly string[];
};

function revisionKey(namespace: string, revisionId: string): string {
	return `${namespace}-v2-entry-${revisionId}`;
}

export function createTransactionWriter<Metadata extends object, Value>(
	options: WriterOptions<Metadata, Value>,
) {
	const keys = buildV2Keys(options.namespace);
	const schemas = createRecordSchemas(
		options.namespace,
		options.metadataSchema,
	);

	async function commitSnapshot({
		base,
		nextEntries,
		targetSlots,
	}: CommitOptions<Metadata, Value>): Promise<
		ValidatedSnapshot<Metadata, Value>
	> {
		let attemptId!: string;
		let snapshotId!: string;
		let staged!: Awaited<ReturnType<typeof stageRecords>>;
		let rootRecords!: readonly { slot: RootSlot; raw: string }[];
		try {
			attemptId = options.randomUUID();
			snapshotId = attemptId;
			const orderedEntries = [...nextEntries].sort((left, right) =>
				left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
			);
			staged = await stageRecords(base, orderedEntries, attemptId, snapshotId);
			const plannedKeys = [...staged.records.keys()];
			const planPages = await Promise.all(
				plannedKeys.map(async (plannedKey, pageIndex) => {
					const withoutHash = {
						formatVersion: 2 as const,
						namespace: options.namespace,
						attemptId,
						pageIndex,
						plannedKey,
						...(pageIndex + 1 < plannedKeys.length
							? { nextPageKey: keys.intentPlan(attemptId, pageIndex + 1) }
							: {}),
					};
					return schemas.intentPlanPage.parse({
						...withoutHash,
						pageSha256: await hashCanonicalRecord(
							withoutHash,
							undefined,
							options.sha256,
						),
					});
				}),
			);
			const intent = schemas.transactionIntent.parse({
				formatVersion: 2,
				namespace: options.namespace,
				attemptId,
				targetRootSlots: targetSlots,
				firstCommitGeneration: base.root.commitGeneration + 1,
				snapshotId,
				planPageCount: planPages.length,
				planSha256: await options.sha256(
					textEncoder.encode(canonicalJson(planPages)),
				),
			});
			rootRecords = targetSlots.map((slot, index) => ({
				slot,
				raw: canonicalJson(
					schemas.rootCommit.parse({
						...staged.root,
						commitGeneration: base.root.commitGeneration + 1 + index,
					}),
				),
			}));
			const rawIntent = canonicalJson(intent);
			await options.storage.setItem(keys.intent.a, rawIntent);
			await options.storage.setItem(keys.intent.b, rawIntent);
			for (const slot of ['a', 'b'] as const) {
				const raw = await options.storage.getItem(keys.intent[slot]);
				if (
					raw === null ||
					canonicalJson(schemas.transactionIntent.parse(JSON.parse(raw))) !==
						rawIntent
				) {
					throw new Error('Transaction intent validation failed');
				}
			}
			for (const [pageIndex, page] of planPages.entries()) {
				await options.storage.setItem(
					keys.intentPlan(attemptId, pageIndex),
					canonicalJson(page),
				);
			}
			await validatePlan(attemptId, planPages, intent.planSha256);
			for (const [key, raw] of staged.records) {
				await options.storage.setItem(key, raw);
			}
			await validateStaged(staged.records);
		} catch (error) {
			throw new SecureStorageWriteNotCommittedError(
				`Secure storage staging failed: ${String(error)}`,
			);
		}

		for (const { slot, raw } of rootRecords) {
			try {
				await options.storage.setItem(keys.root[slot], raw);
			} catch (error) {
				throw new SecureStorageWriteNotCommittedError(
					`Secure storage root publication failed: ${String(error)}`,
				);
			}
		}
		const reopened = await readRootCandidate(options, targetSlots.at(-1)!);
		if (
			reopened.status !== 'valid' ||
			reopened.snapshot.root.snapshotId !== snapshotId
		) {
			throw new SecureStorageWriteNotCommittedError(
				'Secure storage root did not reopen after publication',
			);
		}
		for (const key of [keys.intent.a, keys.intent.b]) {
			try {
				await options.storage.deleteItem(key);
			} catch {
				// A validated root makes a stale redundant intent harmless.
			}
		}
		return reopened.snapshot;
	}

	async function stageRecords(
		base: ValidatedSnapshot<Metadata, Value>,
		entries: readonly SecureEntry<Metadata, Value>[],
		attemptId: string,
		snapshotId: string,
	) {
		const records = new Map<string, string>();
		const references: ManifestEntryRefV2[] = [];
		for (const [entryIndex, entry] of entries.entries()) {
			const serializedValue = options.serializeValue(entry.value);
			const valueBytes = textEncoder.encode(serializedValue);
			const valueSha256 = await options.sha256(valueBytes);
			const prior = base.revisions.get(entry.id);
			const reuseValue =
				prior !== undefined &&
				prior.valueSha256 === valueSha256 &&
				prior.valueByteLength === valueBytes.byteLength;
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
			if (unchanged) {
				const key = revisionKey(options.namespace, prior.revisionId);
				const raw = await options.storage.getItem(key);
				if (raw === null) throw new Error(`Missing reusable revision: ${key}`);
				references.push({
					entryId: entry.id,
					revisionKey: key,
					revisionSha256: await options.sha256(textEncoder.encode(raw)),
				});
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
				valueChunkCount: reuseValue ? prior.valueChunkCount : chunks.length,
				valueByteLength: valueBytes.byteLength,
				valueSha256,
			});
			const key = keys.entry(attemptId, entryIndex);
			const raw = canonicalJson(revision);
			records.set(key, raw);
			references.push({
				entryId: entry.id,
				revisionKey: key,
				revisionSha256: await options.sha256(textEncoder.encode(raw)),
			});
		}

		const pageCount = Math.max(1, references.length);
		const pageHashes: string[] = new Array(pageCount);
		for (let pageIndex = pageCount - 1; pageIndex >= 0; pageIndex--) {
			const withoutHash = {
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
			const pageSha256 = await hashCanonicalRecord(
				withoutHash,
				undefined,
				options.sha256,
			);
			pageHashes[pageIndex] = pageSha256;
			records.set(
				keys.manifest(attemptId, pageIndex),
				canonicalJson(
					schemas.manifestPage.parse({ ...withoutHash, pageSha256 }),
				),
			);
		}
		return {
			records,
			root: {
				formatVersion: 2 as const,
				namespace: options.namespace,
				snapshotId,
				manifestHeadKey: keys.manifest(attemptId, 0),
				manifestPageCount: pageCount,
				entryCount: references.length,
				manifestSha256: await hashCanonicalRecord(
					{ snapshotId, pageHashes },
					undefined,
					options.sha256,
				),
			},
		};
	}

	async function validatePlan(
		attemptId: string,
		expected: readonly unknown[],
		expectedHash: string,
	) {
		const actual = [];
		for (let index = 0; index < expected.length; index++) {
			const raw = await options.storage.getItem(
				keys.intentPlan(attemptId, index),
			);
			if (raw === null) throw new Error('Missing intent plan page');
			const page = schemas.intentPlanPage.parse(JSON.parse(raw));
			if (
				page.attemptId !== attemptId ||
				page.pageIndex !== index ||
				page.nextPageKey !==
					(index + 1 < expected.length
						? keys.intentPlan(attemptId, index + 1)
						: undefined)
			) {
				throw new Error('Invalid intent plan chain');
			}
			if (
				(await hashCanonicalRecord(
					page as unknown as Record<string, unknown>,
					'pageSha256',
					options.sha256,
				)) !== page.pageSha256
			) {
				throw new Error('Invalid intent plan page hash');
			}
			actual.push(page);
		}
		if (
			(await options.sha256(textEncoder.encode(canonicalJson(actual)))) !==
			expectedHash
		) {
			throw new Error('Invalid intent plan hash');
		}
	}

	async function validateStaged(records: ReadonlyMap<string, string>) {
		for (const [key, expected] of records) {
			if ((await options.storage.getItem(key)) !== expected) {
				throw new Error(`Staged record validation failed: ${key}`);
			}
		}
	}

	async function recoverIntents(): Promise<void> {
		const reachable = new Set<string>();
		for (const slot of ['a', 'b'] as const) {
			const candidate = await readRootCandidate(options, slot);
			if (candidate.status === 'valid') {
				for (const key of candidate.snapshot.reachableKeys) reachable.add(key);
			}
		}
		const intents = new Map<string, TransactionIntentV2>();
		let hasIntentHeader = false;
		for (const slot of ['a', 'b'] as const) {
			const raw = await options.storage.getItem(keys.intent[slot]);
			if (raw === null) continue;
			hasIntentHeader = true;
			try {
				const intent = schemas.transactionIntent.parse(JSON.parse(raw));
				intents.set(intent.attemptId, intent);
			} catch {
				// A malformed fixed header cannot identify any immutable records.
			}
		}
		for (const intent of intents.values()) {
			const pages = [];
			for (let index = 0; index < intent.planPageCount; index++) {
				const planKey = keys.intentPlan(intent.attemptId, index);
				const raw = await options.storage.getItem(planKey);
				if (raw !== null) {
					try {
						const page = schemas.intentPlanPage.parse(JSON.parse(raw));
						const hash = await hashCanonicalRecord(
							page as unknown as Record<string, unknown>,
							'pageSha256',
							options.sha256,
						);
						if (
							page.attemptId === intent.attemptId &&
							page.pageIndex === index &&
							page.nextPageKey ===
								(index + 1 < intent.planPageCount
									? keys.intentPlan(intent.attemptId, index + 1)
									: undefined) &&
							hash === page.pageSha256
						) {
							pages.push(page);
						}
					} catch {
						// The deterministic plan key itself is still safe to discard.
					}
				}
				await deleteBestEffort(planKey);
			}
			const planHash = await options.sha256(
				textEncoder.encode(canonicalJson(pages)),
			);
			if (
				pages.length === intent.planPageCount &&
				planHash === intent.planSha256
			) {
				for (const { plannedKey } of pages) {
					if (!reachable.has(plannedKey)) await deleteBestEffort(plannedKey);
				}
			}
		}
		if (hasIntentHeader) {
			await deleteBestEffort(keys.intent.a);
			await deleteBestEffort(keys.intent.b);
		}
	}

	async function deleteBestEffort(key: string): Promise<void> {
		try {
			await options.storage.deleteItem(key);
		} catch {
			// Cleanup can be retried on the next open.
		}
	}

	return { commitSnapshot, recoverIntents };
}
