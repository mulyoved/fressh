import {
	SecureStorageCorruptionError,
	type RootSlot,
	type SecureEntry,
	type TransactionalSecureStore,
	type TransactionalSecureStoreOptions,
} from './contracts';
import { selectSnapshot, type ValidatedSnapshot } from './snapshot-reader';
import { createTransactionWriter } from './transaction-writer';

export function createTransactionalSecureStore<Metadata extends object, Value>(
	options: TransactionalSecureStoreOptions<Metadata, Value>,
): TransactionalSecureStore<Metadata, Value> {
	let mutationTail: Promise<void> = Promise.resolve();
	const serializeMutation = <Result>(run: () => Promise<Result>) => {
		const result = mutationTail.then(run, run);
		mutationTail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	};
	const writer = createTransactionWriter(options);
	const openAfterMutations = () => mutationTail.then(open, open);

	async function open(): Promise<ValidatedSnapshot<Metadata, Value>> {
		await writer.recoverIntents();
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
		});
	}

	return {
		async ensureReady() {
			await openAfterMutations();
			return { status: 'current', cleanupPending: false };
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
		async deleteEntry() {
			throw new Error('deleteEntry is not implemented');
		},
		async retryCleanup() {},
	};
}
