import { fromByteArray, toByteArray } from 'base64-js';
import type * as z from 'zod';
import { canonicalJson } from './codec';
import {
	SecureStorageUnavailableError,
	type AsyncStringStorage,
	type EntryRevisionV2,
	type ManifestPageV2,
	type RootCommitV2,
	type RootSlot,
	type SecureEntry,
	type Sha256,
} from './contracts';
import {
	buildV2Keys,
	createRecordSchemas,
	hashCanonicalRecord,
} from './records';

const textEncoder = new TextEncoder();

export type ValidatedSnapshot<Metadata extends object, Value> = {
	slot: RootSlot;
	root: RootCommitV2;
	entries: ReadonlyMap<string, SecureEntry<Metadata, Value>>;
	revisions: ReadonlyMap<string, EntryRevisionV2<Metadata>>;
	reachableKeys: ReadonlySet<string>;
};

type ReaderOptions<Metadata extends object, Value> = {
	namespace: string;
	metadataSchema: z.ZodType<Metadata>;
	parseValue(raw: string): Value;
	storage: AsyncStringStorage;
	sha256: Sha256;
};

export type RootCandidate<Metadata extends object, Value> =
	| { status: 'absent' }
	| { status: 'invalid' }
	| { status: 'valid'; snapshot: ValidatedSnapshot<Metadata, Value> };

export type SnapshotSelection<Metadata extends object, Value> =
	| { status: 'absent' }
	| { status: 'no-valid-state' }
	| { status: 'selected'; snapshot: ValidatedSnapshot<Metadata, Value> };

class InvalidSnapshotError extends Error {}

async function readStorage(
	storage: AsyncStringStorage,
	key: string,
): Promise<string | null> {
	try {
		return await storage.getItem(key);
	} catch (error) {
		throw new SecureStorageUnavailableError(
			`Secure storage read failed for ${key}: ${String(error)}`,
		);
	}
}

function invalid(message: string): never {
	throw new InvalidSnapshotError(message);
}

function parseRecord<T>(raw: string, schema: z.ZodType<T>, key: string): T {
	try {
		return schema.parse(JSON.parse(raw) as unknown);
	} catch {
		return invalid(`Malformed snapshot record: ${key}`);
	}
}

function decodeChunk(raw: string, key: string): Uint8Array {
	try {
		const bytes = toByteArray(raw);
		if (fromByteArray(bytes) !== raw) invalid(`Malformed base64 value: ${key}`);
		return bytes;
	} catch (error) {
		if (error instanceof InvalidSnapshotError) throw error;
		return invalid(`Malformed base64 value: ${key}`);
	}
}

function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
	const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

export function collectReachableKeys<Metadata extends object, Value>(
	snapshot: ValidatedSnapshot<Metadata, Value>,
): ReadonlySet<string> {
	return new Set(snapshot.reachableKeys);
}

export async function readRootCandidate<Metadata extends object, Value>(
	options: ReaderOptions<Metadata, Value>,
	slot: RootSlot,
): Promise<RootCandidate<Metadata, Value>> {
	const keys = buildV2Keys(options.namespace);
	const schemas = createRecordSchemas(options.namespace, options.metadataSchema);
	const rootKey = keys.root[slot];
	const rawRoot = await readStorage(options.storage, rootKey);
	if (rawRoot === null) return { status: 'absent' };

	try {
		const root = parseRecord(rawRoot, schemas.rootCommit, rootKey);
		const reachableKeys = new Set<string>([rootKey]);
		const visitedManifestKeys = new Set<string>();
		const pageHashes: string[] = [];
		const references: { entryId: string; revisionKey: string; revisionSha256: string }[] = [];
		let manifestKey: string | undefined = root.manifestHeadKey;

		for (let pageIndex = 0; pageIndex < root.manifestPageCount; pageIndex++) {
			if (manifestKey === undefined || visitedManifestKeys.has(manifestKey)) {
				invalid('Manifest page count or chain is invalid');
			}
			visitedManifestKeys.add(manifestKey);
			reachableKeys.add(manifestKey);
			const rawPage = await readStorage(options.storage, manifestKey);
			if (rawPage === null) invalid(`Missing manifest page: ${manifestKey}`);
			const page: ManifestPageV2 = parseRecord(
				rawPage,
				schemas.manifestPage,
				manifestKey,
			);
			if (page.snapshotId !== root.snapshotId || page.pageIndex !== pageIndex) {
				invalid('Manifest page identity is invalid');
			}
			const pageHash = await hashCanonicalRecord(
				page as unknown as Record<string, unknown>,
				'pageSha256',
				options.sha256,
			);
			if (pageHash !== page.pageSha256) invalid('Manifest page hash mismatch');
			pageHashes.push(pageHash);
			references.push(...page.entries);
			manifestKey = page.nextPageKey;
		}
		if (manifestKey !== undefined) invalid('Manifest contains excess pages');
		if (references.length !== root.entryCount) invalid('Entry count mismatch');
		const aggregateHash = await hashCanonicalRecord(
			{ snapshotId: root.snapshotId, pageHashes },
			undefined,
			options.sha256,
		);
		if (aggregateHash !== root.manifestSha256) invalid('Manifest hash mismatch');

		const entries = new Map<string, SecureEntry<Metadata, Value>>();
		const revisions = new Map<string, EntryRevisionV2<Metadata>>();
		let previousId: string | undefined;
		for (const reference of references) {
			if (previousId !== undefined && reference.entryId <= previousId) {
				invalid('Entry IDs must be ordered and unique');
			}
			previousId = reference.entryId;
			reachableKeys.add(reference.revisionKey);
			const rawRevision = await readStorage(options.storage, reference.revisionKey);
			if (rawRevision === null) invalid(`Missing revision: ${reference.revisionKey}`);
			const revision = parseRecord(
				rawRevision,
				schemas.entryRevision,
				reference.revisionKey,
			);
			const revisionHash = await options.sha256(
				textEncoder.encode(canonicalJson(revision)),
			);
			if (revisionHash !== reference.revisionSha256) invalid('Revision hash mismatch');
			if (revision.entryId !== reference.entryId) invalid('Revision entry ID mismatch');

			const chunks: Uint8Array[] = [];
			for (
				let chunkIndex = 0;
				chunkIndex < revision.valueChunkCount;
				chunkIndex++
			) {
				const valueKey = keys.value(revision.valueRecordId, chunkIndex);
				reachableKeys.add(valueKey);
				const rawChunk = await readStorage(options.storage, valueKey);
				if (rawChunk === null) invalid(`Missing value chunk: ${valueKey}`);
				chunks.push(decodeChunk(rawChunk, valueKey));
			}
			const valueBytes = joinBytes(chunks);
			if (valueBytes.byteLength !== revision.valueByteLength) {
				invalid('Value byte length mismatch');
			}
			if ((await options.sha256(valueBytes)) !== revision.valueSha256) {
				invalid('Value hash mismatch');
			}
			let value: Value;
			try {
				value = options.parseValue(
					new TextDecoder('utf-8', { fatal: true }).decode(valueBytes),
				);
			} catch {
				return invalid('Malformed entry value');
			}
			entries.set(reference.entryId, {
				id: reference.entryId,
				metadata: revision.metadata,
				value,
			});
			revisions.set(reference.entryId, revision);
		}

		return {
			status: 'valid',
			snapshot: { slot, root, entries, revisions, reachableKeys },
		};
	} catch (error) {
		if (error instanceof SecureStorageUnavailableError) throw error;
		if (error instanceof InvalidSnapshotError) return { status: 'invalid' };
		throw error;
	}
}

export async function selectSnapshot<Metadata extends object, Value>(
	options: ReaderOptions<Metadata, Value>,
): Promise<SnapshotSelection<Metadata, Value>> {
	const candidates = [
		await readRootCandidate(options, 'a'),
		await readRootCandidate(options, 'b'),
	];
	const valid = candidates
		.filter(
			(candidate): candidate is Extract<typeof candidate, { status: 'valid' }> =>
				candidate.status === 'valid',
		)
		.sort(
			(left, right) =>
				right.snapshot.root.commitGeneration -
				left.snapshot.root.commitGeneration,
		);
	if (valid[0] !== undefined) {
		return { status: 'selected', snapshot: valid[0].snapshot };
	}
	return candidates.every(({ status }) => status === 'absent')
		? { status: 'absent' }
		: { status: 'no-valid-state' };
}
