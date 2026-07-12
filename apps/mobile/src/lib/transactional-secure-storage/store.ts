import {
	SecureStorageCorruptionError,
	SecureStorageUnavailableError,
	type LegacySnapshot,
	type RootSlot,
	type SecureEntry,
	type TransactionalSecureStore,
	type TransactionalSecureStoreOptions,
} from './contracts';
import {
	readRootCandidate,
	selectSnapshot,
	type ValidatedSnapshot,
} from './snapshot-reader';
import { createStartupMigration } from './startup-migration';
import { createTransactionWriter } from './transaction-writer';

type StartupState<Metadata extends object, Value> =
	| { type: 'fresh' }
	| { type: 'legacy'; snapshot: LegacySnapshot<Metadata, Value> }
	| { type: 'v2'; snapshot: ValidatedSnapshot<Metadata, Value> }
	| { type: 'recovered'; snapshot: ValidatedSnapshot<Metadata, Value> }
	| { type: 'unavailable'; error: SecureStorageUnavailableError }
	| { type: 'corrupt'; error: SecureStorageCorruptionError };

export function createTransactionalSecureStore<Metadata extends object, Value>(
	options: TransactionalSecureStoreOptions<Metadata, Value>,
): TransactionalSecureStore<Metadata, Value> {
	let mutationTail: Promise<void> = Promise.resolve();
	const serializeMutation = <Result>(run: () => Promise<Result>) => {
		const result = mutationTail.then(run, run);
		mutationTail = result.then(
			() => {
				readyResult = undefined;
			},
			() => {
				readyResult = undefined;
			},
		);
		return result;
	};
	const writer = createTransactionWriter(options);
	const startup = createStartupMigration(options);
	let createdV2ThisInstance = false;
	let readyResult: Promise<{ status: 'initialized' | 'migrated' | 'current' | 'recovered'; cleanupPending: boolean }> | undefined;
	const openAfterMutations = () => mutationTail.then(open, open);

	async function open(): Promise<ValidatedSnapshot<Metadata, Value>> {
		readyResult ??= ensureReady();
		await readyResult;
		return openCurrent();
	}

	async function openCurrent(): Promise<ValidatedSnapshot<Metadata, Value>> {
		const selection = await selectSnapshot(options);
		if (selection.status !== 'selected') {
			throw new SecureStorageCorruptionError(
				selection.status === 'absent'
					? 'Transactional secure storage is not initialized'
					: 'Transactional secure storage has no valid root',
			);
		}
		return selection.snapshot;
	}

	async function classify(): Promise<StartupState<Metadata, Value>> {
		try {
			const before = await selectSnapshot(options);
			if (before.status === 'selected') {
				await writer.recoverIntents();
				const after = await selectSnapshot(options);
				if (after.status !== 'selected') return { type: 'corrupt', error: new SecureStorageCorruptionError('Transactional secure storage has no valid root') };
				return { type: before.snapshot.root.snapshotId === after.snapshot.root.snapshotId ? 'v2' : 'recovered', snapshot: after.snapshot };
			}
			await writer.recoverIntents();
			const legacy = await options.legacy.read();
			if (legacy.status === 'present') return { type: 'legacy', snapshot: legacy };
			if (before.status === 'no-valid-state') return { type: 'corrupt', error: new SecureStorageCorruptionError('Transactional secure storage has no valid root') };
			return { type: 'fresh' };
		} catch (error) {
			if (error instanceof SecureStorageUnavailableError) return { type: 'unavailable', error };
			if (error instanceof SecureStorageCorruptionError) return { type: 'corrupt', error };
			throw error;
		}
	}

	async function ensureReady() {
		const state = await classify();
		if (state.type === 'unavailable' || state.type === 'corrupt') throw state.error;
		if (state.type === 'fresh' || state.type === 'legacy') {
			const legacy = state.type === 'legacy' ? state.snapshot : { status: 'absent' as const, entries: [], recordKeys: [] };
			await startup.initialize(legacy);
			createdV2ThisInstance = true;
			return { status: state.type === 'fresh' ? 'initialized' as const : 'migrated' as const, cleanupPending: state.type === 'legacy' };
		}
		const selected = state.snapshot;
		let legacy: LegacySnapshot<Metadata, Value> | undefined;
		if (!createdV2ThisInstance) {
			try { legacy = await options.legacy.read(); } catch { legacy = undefined; }
		}
		const other = await readRootCandidate(options, selected.slot === 'a' ? 'b' : 'a');
		if (other.status !== 'valid' || ((legacy?.status === 'present' || selected.root.legacyCleanupPending === true) && !startup.sameSnapshot(selected, other.snapshot))) await startup.mirror(selected);
		const cleanupPending = createdV2ThisInstance ? selected.root.cleanupHeadKey !== undefined : await startup.cleanup(selected, legacy);
		return { status: state.type === 'recovered' ? 'recovered' as const : 'current' as const, cleanupPending };
	}

	function olderSlot(base: ValidatedSnapshot<Metadata, Value>): RootSlot {
		return base.slot === 'a' ? 'b' : 'a';
	}

	async function mutate(
		nextEntries: (
			base: ValidatedSnapshot<Metadata, Value>,
		) => readonly SecureEntry<Metadata, Value>[],
	): Promise<void> {
		const base = await open();
		await writer.commitSnapshot({
			base,
			nextEntries: nextEntries(base),
			targetSlots: [olderSlot(base)],
			cleanupKeys: [],
			deferCleanup: createdV2ThisInstance,
		});
	}

	async function deleteOrRetry(id?: string): Promise<void> {
		const base = await open();
		const entries = new Map(base.entries);
		if (id !== undefined) entries.delete(id);
		const cleanupKeys = new Set(base.reachableKeys);
		const older = await readRootCandidate(options, olderSlot(base));
		if (older.status === 'valid') {
			for (const key of older.snapshot.reachableKeys) cleanupKeys.add(key);
		}
		await writer.commitSnapshot({
			base,
			nextEntries: [...entries.values()],
			targetSlots: [olderSlot(base), base.slot],
			cleanupKeys: [...cleanupKeys],
			deferCleanup: createdV2ThisInstance,
		});
	}

	return {
		async ensureReady() {
			readyResult ??= mutationTail.then(ensureReady, ensureReady);
			return readyResult;
		},
		async getEntry(id) {
			return (await openAfterMutations()).entries.get(id) ?? null;
		},
		async listEntries() {
			return [...(await openAfterMutations()).entries.values()];
		},
		upsertEntry(entry) {
			return serializeMutation(() =>
				mutate((base) => {
					const entries = new Map(base.entries);
					entries.set(entry.id, entry);
					return [...entries.values()];
				}),
			);
		},
		replaceAllEntries(entries) {
			const ids = new Set<string>();
			for (const entry of entries) {
				if (ids.has(entry.id)) {
					return Promise.reject(new Error(`Duplicate entry ID: ${entry.id}`));
				}
				ids.add(entry.id);
			}
			return serializeMutation(() => mutate(() => entries));
		},
		deleteEntry(id) {
			return serializeMutation(() => deleteOrRetry(id));
		},
		retryCleanup() {
			return serializeMutation(() => deleteOrRetry());
		},
	};
}
