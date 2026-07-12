import type * as z from 'zod';
import { canonicalJson, encodeValueChunks } from './codec';
import  { type LegacySnapshot, type RootSlot, type Sha256 } from './contracts';
import { buildV2Keys, createRecordSchemas, hashCanonicalRecord as hash } from './records';
import { readRootCandidate, type ValidatedSnapshot } from './snapshot-reader';

type Options<Metadata extends object, Value> = {
	namespace: string;
	metadataSchema: z.ZodType<Metadata>;
	serializeValue(value: Value): string;
	parseValue(raw: string): Value;
	storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; deleteItem(key: string): Promise<void> };
	randomUUID(): string;
	sha256: Sha256;
};

export function createStartupMigration<Metadata extends object, Value>(options: Options<Metadata, Value>) {
	const keys = buildV2Keys(options.namespace);
	const schemas = createRecordSchemas(options.namespace, options.metadataSchema);
	const encoder = new TextEncoder();
	async function writeValidated(key: string, raw: string) {
		await options.storage.setItem(key, raw);
		if ((await options.storage.getItem(key)) !== raw)
			throw new Error(`Startup record validation failed: ${key}`);
	}

	async function initialize(snapshot: LegacySnapshot<Metadata, Value>) {
		const attemptId = options.randomUUID();
		const records = new Map<string, string>();
		const references = [];
		const entries = [...snapshot.entries].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
		for (const [index, entry] of entries.entries()) {
			const serialized = options.serializeValue(entry.value);
			const bytes = encoder.encode(serialized);
			const chunks = encodeValueChunks(serialized);
			for (const [chunkIndex, chunk] of chunks.entries()) records.set(keys.value(`${attemptId}-${index}`, chunkIndex), chunk);
			const revision = schemas.entryRevision.parse({
				formatVersion: 2, namespace: options.namespace, entryId: entry.id,
				revisionId: `${attemptId}-${index}`, metadata: entry.metadata,
				valueRecordId: `${attemptId}-${index}`, valueChunkCount: chunks.length,
				valueByteLength: bytes.byteLength, valueSha256: await options.sha256(bytes),
			});
			const revisionKey = keys.entry(attemptId, index);
			const raw = canonicalJson(revision);
			records.set(revisionKey, raw);
			references.push({ entryId: entry.id, revisionKey, revisionSha256: await options.sha256(encoder.encode(raw)) });
		}
		const pageCount = Math.max(1, references.length);
		const pageHashes = new Array<string>(pageCount);
		for (let index = pageCount - 1; index >= 0; index--) {
			const body = { formatVersion: 2 as const, namespace: options.namespace, snapshotId: attemptId, pageIndex: index,
				entries: references[index] === undefined ? [] : [references[index]],
				...(index + 1 < pageCount ? { nextPageKey: keys.manifest(attemptId, index + 1) } : {}) };
			const pageSha256 = await hash(body, undefined, options.sha256);
			pageHashes[index] = pageSha256;
			records.set(keys.manifest(attemptId, index), canonicalJson(schemas.manifestPage.parse({ ...body, pageSha256 })));
		}
		const cleanupKeys: string[] = [];
		if (snapshot.status === 'present') {
			for (let index = snapshot.recordKeys.length - 1; index >= 0; index--) {
				const body = { formatVersion: 2 as const, namespace: options.namespace, attemptId, pageIndex: index,
					garbageKey: snapshot.recordKeys[index]!,
					...(index + 1 < snapshot.recordKeys.length ? { nextPageKey: keys.cleanup(attemptId, index + 1) } : {}) };
				const pageSha256 = await hash(body, undefined, options.sha256);
				const key = keys.cleanup(attemptId, index);
				cleanupKeys[index] = key;
				records.set(key, canonicalJson(schemas.cleanupPage.parse({ ...body, pageSha256 })));
			}
		}
		const rootBase = {
			formatVersion: 2 as const, namespace: options.namespace, snapshotId: attemptId,
			manifestHeadKey: keys.manifest(attemptId, 0), manifestPageCount: pageCount,
			entryCount: references.length,
			manifestSha256: await hash({ snapshotId: attemptId, pageHashes }, undefined, options.sha256),
			...(cleanupKeys[0] === undefined ? {} : { cleanupHeadKey: cleanupKeys[0] }),
		};
		const plannedKeys = [...records.keys()];
		const planPages = [];
		for (const [index, plannedKey] of plannedKeys.entries()) {
			const body = { formatVersion: 2 as const, namespace: options.namespace, attemptId, pageIndex: index, plannedKey,
				...(index + 1 < plannedKeys.length ? { nextPageKey: keys.intentPlan(attemptId, index + 1) } : {}) };
			planPages.push(schemas.intentPlanPage.parse({ ...body, pageSha256: await hash(body, undefined, options.sha256) }));
		}
		const intent = schemas.transactionIntent.parse({ formatVersion: 2, namespace: options.namespace, attemptId,
			targetRootSlots: ['a', 'b'], firstCommitGeneration: 1, snapshotId: attemptId,
			planPageCount: planPages.length, planSha256: await options.sha256(encoder.encode(canonicalJson(planPages))) });
		const rawIntent = canonicalJson(intent);
		await writeValidated(keys.intent.a, rawIntent);
		await writeValidated(keys.intent.b, rawIntent);
		for (const [index, page] of planPages.entries()) await writeValidated(keys.intentPlan(attemptId, index), canonicalJson(page));
		for (const [key, raw] of records) await writeValidated(key, raw);
		for (const [slot, generation] of [['a', 1], ['b', 2]] as const) {
			await writeValidated(keys.root[slot], canonicalJson(schemas.rootCommit.parse({ ...rootBase, commitGeneration: generation })));
			if ((await readRootCandidate(options, slot)).status !== 'valid') throw new Error(`Startup root validation failed: ${slot}`);
		}
	}

	async function mirror(snapshot: ValidatedSnapshot<Metadata, Value>) {
		const other: RootSlot = snapshot.slot === 'a' ? 'b' : 'a';
		const raw = await options.storage.getItem(keys.root[snapshot.slot]);
		if (raw === null) throw new Error('Selected root disappeared');
		await writeValidated(keys.root[other], raw);
		const candidate = await readRootCandidate(options, other);
		if (candidate.status !== 'valid' || candidate.snapshot.root.snapshotId !== snapshot.root.snapshotId) throw new Error('Mirrored root validation failed');
	}

	function sameSnapshot(left: ValidatedSnapshot<Metadata, Value>, right: ValidatedSnapshot<Metadata, Value>) {
		return left.root.snapshotId === right.root.snapshotId && left.root.manifestHeadKey === right.root.manifestHeadKey && left.root.manifestSha256 === right.root.manifestSha256 && left.root.cleanupHeadKey === right.root.cleanupHeadKey;
	}

	async function publishCleanup(snapshot: ValidatedSnapshot<Metadata, Value>, inventory: readonly string[]) {
		const attemptId = options.randomUUID();
		const ordered = [...inventory.slice(1), inventory[0]!];
		for (let index = ordered.length - 1; index >= 0; index--) {
			const body = { formatVersion: 2 as const, namespace: options.namespace, attemptId, pageIndex: index, garbageKey: ordered[index]!, ...(index + 1 < ordered.length ? { nextPageKey: keys.cleanup(attemptId, index + 1) } : {}) };
			await writeValidated(keys.cleanup(attemptId, index), canonicalJson(schemas.cleanupPage.parse({ ...body, pageSha256: await hash(body, undefined, options.sha256) })));
		}
		for (const [slot, generation] of [['a', snapshot.root.commitGeneration + 1], ['b', snapshot.root.commitGeneration + 2]] as const) {
			const raw = canonicalJson(schemas.rootCommit.parse({ ...snapshot.root, commitGeneration: generation, cleanupHeadKey: keys.cleanup(attemptId, 0) }));
			await writeValidated(keys.root[slot], raw);
			if ((await readRootCandidate(options, slot)).status !== 'valid') throw new Error('Cleanup root validation failed');
		}
		const selected = await readRootCandidate(options, 'b');
		if (selected.status !== 'valid') throw new Error('Cleanup snapshot unavailable');
		return selected.snapshot;
	}

	async function cleanup(snapshot: ValidatedSnapshot<Metadata, Value>, legacy: LegacySnapshot<Metadata, Value> | undefined) {
		if (snapshot.root.cleanupHeadKey === undefined) return false;
		const inventory = legacy?.status === 'present' ? legacy.recordKeys : undefined;
		const allowed = inventory === undefined ? undefined : new Set(inventory);
		const escaped = options.namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const legacyKey = new RegExp(`^(?:${escaped}-rootManifest|${escaped}-manifestChunk-.+|${escaped}-entry-.+-chunk-[0-9]+)$`);
		let key: string | undefined = snapshot.root.cleanupHeadKey;
		const pages: { key: string; garbageKey: string }[] = [];
		try {
			while (key !== undefined) {
				const raw = await options.storage.getItem(key);
				if (raw === null) throw new Error('Missing cleanup page');
				const page = schemas.cleanupPage.parse(JSON.parse(raw));
				if (key !== keys.cleanup(page.attemptId, page.pageIndex) || page.pageIndex !== pages.length || await hash(page as unknown as Record<string, unknown>, 'pageSha256', options.sha256) !== page.pageSha256) throw new Error('Invalid cleanup page');
				pages.push({ key, garbageKey: page.garbageKey });
				key = page.nextPageKey;
			}
		} catch { pages.length = 0; }
		if (allowed === undefined && (pages.length === 0 || pages.some(({ garbageKey }) => !legacyKey.test(garbageKey)))) return (await options.storage.getItem(snapshot.root.cleanupHeadKey)) !== null;
		if (allowed !== undefined && (pages.length !== allowed.size || pages.some(({ garbageKey }) => !allowed.has(garbageKey)) || new Set(pages.map(({ garbageKey }) => garbageKey)).size !== allowed.size)) {
			snapshot = await publishCleanup(snapshot, inventory!);
			return cleanup(snapshot, legacy);
		}
		let complete = true;
		for (const page of pages) {
			try { await options.storage.deleteItem(page.garbageKey); } catch { complete = false; }
			if (await options.storage.getItem(page.garbageKey) !== null) complete = false;
		}
		if (complete) for (const page of pages) await options.storage.deleteItem(page.key).catch(() => undefined);
		return !complete;
	}

	return { initialize, mirror, sameSnapshot, cleanup };
}
