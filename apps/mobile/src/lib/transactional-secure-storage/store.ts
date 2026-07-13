import { createCleanupChain } from './cleanup-chain';
import {
	SecureStorageCorruptionError,
	SecureStorageUnavailableError,
	type LegacySnapshot,
	type RootSlot,
	type SecureEntry,
	type TransactionalSecureStore,
	type TransactionalSecureStoreOptions,
} from './contracts';
import { createIntentJournal } from './intent-journal';
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
	const writer = createTransactionWriter(options);
	const startup = createStartupMigration(options);
	const cleanupChain = createCleanupChain(options);
	const intentJournal = createIntentJournal(options);
	let createdV2ThisInstance = false;
	let mutationTail: Promise<void> = Promise.resolve();
	let readyResult:
		| Promise<{
				status: 'initialized' | 'migrated' | 'current' | 'recovered';
				cleanupPending: boolean;
		  }>
		| undefined;

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

	async function recoverIntents() {
		const protectedKeys = new Set<string>();
		for (const slot of ['a', 'b'] as const) {
			const candidate = await readRootCandidate(options, slot);
			if (candidate.status !== 'valid') continue;
			for (const key of candidate.snapshot.reachableKeys) protectedKeys.add(key);
			const descriptor = candidate.snapshot.root.cleanup;
			if (descriptor === undefined) continue;
			const cleanup = await cleanupChain.read(descriptor);
			if (cleanup.status === 'valid') {
				for (const { key } of cleanup.pages) protectedKeys.add(key);
			}
		}
		await intentJournal.recover(protectedKeys);
	}

	async function classify(): Promise<StartupState<Metadata, Value>> {
		try {
			const before = await selectSnapshot(options);
			if (before.status === 'selected') {
				await recoverIntents();
				const after = await selectSnapshot(options);
				if (after.status !== 'selected') {
					return {
						type: 'corrupt',
						error: new SecureStorageCorruptionError(
							'Transactional secure storage has no valid root',
						),
					};
				}
				return {
					type:
						before.provenance === 'fallback' ||
						before.snapshot.root.snapshotId !== after.snapshot.root.snapshotId
							? 'recovered'
							: 'v2',
					snapshot: after.snapshot,
				};
			}
			await recoverIntents();
			const legacy = await options.legacy.read();
			if (legacy.status === 'present') return { type: 'legacy', snapshot: legacy };
			if (before.status === 'no-valid-state') {
				return {
					type: 'corrupt',
					error: new SecureStorageCorruptionError(
						'Transactional secure storage has no valid root',
					),
				};
			}
			return { type: 'fresh' };
		} catch (error) {
			if (error instanceof SecureStorageUnavailableError) {
				return { type: 'unavailable', error };
			}
			if (error instanceof SecureStorageCorruptionError) {
				return { type: 'corrupt', error };
			}
			throw error;
		}
	}

	async function ensureReady() {
		const state = await classify();
		if (state.type === 'unavailable' || state.type === 'corrupt') throw state.error;
		if (state.type === 'fresh' || state.type === 'legacy') {
			const legacy =
				state.type === 'legacy'
					? state.snapshot
					: { status: 'absent' as const, entries: [], recordKeys: [] };
			await startup.initialize(legacy);
			createdV2ThisInstance = true;
			return {
				status:
					state.type === 'fresh' ? ('initialized' as const) : ('migrated' as const),
				cleanupPending: state.type === 'legacy',
			};
		}

		let selected = state.snapshot;
		let legacy: LegacySnapshot<Metadata, Value> | undefined;
		if (!createdV2ThisInstance) {
			try {
				legacy = await options.legacy.read();
			} catch {
				legacy = undefined;
			}
		}
		if (selected.root.cleanup !== undefined) {
			const cleanup = await cleanupChain.read(selected.root.cleanup);
			if (cleanup.status === 'invalid') {
				if (legacy?.status !== 'present') {
					return {
						status:
							state.type === 'recovered'
								? ('recovered' as const)
								: ('current' as const),
						cleanupPending: true,
					};
				}
				selected = await replaceCleanup(selected, [
					...legacy.recordKeys.slice(1),
					legacy.recordKeys[0]!,
				]);
			}
		}
		const other = await readRootCandidate(options, olderSlot(selected));
		if (
			other.status !== 'valid' ||
			((legacy?.status === 'present' ||
				selected.root.cleanup !== undefined ||
				other.snapshot.root.cleanup !== undefined) &&
				!startup.sameSnapshot(selected, other.snapshot))
		) {
			selected = await writer.commitSnapshot({
				base: selected,
				nextEntries: [...selected.entries.values()],
				targetSlots: [olderSlot(selected)],
			});
		}
		const cleanupPending = createdV2ThisInstance
			? selected.root.cleanup !== undefined
			: await reconcileLegacyCleanup(selected, legacy);
		return {
			status:
				state.type === 'recovered' ? ('recovered' as const) : ('current' as const),
			cleanupPending,
		};
	}

	function olderSlot(base: ValidatedSnapshot<Metadata, Value>): RootSlot {
		return base.slot === 'a' ? 'b' : 'a';
	}

	async function replaceCleanup(
		base: ValidatedSnapshot<Metadata, Value>,
		cleanupKeys: readonly string[],
	) {
		return writer.commitSnapshot({
			base,
			nextEntries: [...base.entries.values()],
			targetSlots: [olderSlot(base), base.slot],
			cleanupKeys,
		});
	}

	async function finalizeCleanup(
		snapshot: ValidatedSnapshot<Metadata, Value>,
		allowedKeys: ReadonlySet<string>,
	): Promise<boolean> {
		const descriptor = snapshot.root.cleanup;
		if (descriptor === undefined) return true;
		const cleanup = await cleanupChain.read(descriptor);
		if (
			cleanup.status !== 'valid' ||
			!cleanupChain.exactlyMatches(cleanup.pages, allowedKeys)
		) {
			return false;
		}
		if (!(await cleanupChain.deleteGarbage(cleanup.pages, allowedKeys))) {
			return false;
		}
		const cleared = await replaceCleanup(snapshot, []);
		if (cleared.root.cleanup !== undefined) return false;
		await cleanupChain.deletePagesBestEffort(cleanup.pages);
		return true;
	}

	async function reconcileLegacyCleanup(
		snapshot: ValidatedSnapshot<Metadata, Value>,
		legacy: LegacySnapshot<Metadata, Value> | undefined,
	) {
		if (snapshot.root.cleanup === undefined) return false;
		if (legacy?.status !== 'present') {
			if (legacy === undefined) {
				const cleanup = await cleanupChain.read(snapshot.root.cleanup);
				if (
					cleanup.status === 'valid' &&
					(await cleanupChain.hasObservedDeletion(cleanup.pages))
				) {
					return !(await finalizeCleanup(
						snapshot,
						new Set(cleanup.pages.map(({ garbageKey }) => garbageKey)),
					));
				}
			}
			return true;
		}
		let cleanup = await cleanupChain.read(snapshot.root.cleanup);
		let anchoredGarbage =
			cleanup.status === 'valid'
				? new Set(cleanup.pages.map(({ garbageKey }) => garbageKey))
				: undefined;
		const currentGarbage = anchoredGarbage;
		if (
			currentGarbage === undefined ||
			!legacy.recordKeys.every((key) => currentGarbage.has(key))
		) {
			snapshot = await replaceCleanup(snapshot, [
				...legacy.recordKeys.slice(1),
				legacy.recordKeys[0]!,
			]);
			cleanup = await cleanupChain.read(snapshot.root.cleanup!);
			if (cleanup.status !== 'valid') return true;
			anchoredGarbage = new Set(
				cleanup.pages.map(({ garbageKey }) => garbageKey),
			);
		}
		if (anchoredGarbage === undefined) return true;
		return !(await finalizeCleanup(snapshot, anchoredGarbage));
	}

	async function mutate(
		nextEntries: (
			base: ValidatedSnapshot<Metadata, Value>,
		) => readonly SecureEntry<Metadata, Value>[],
	) {
		const base = await open();
		await writer.commitSnapshot({
			base,
			nextEntries: nextEntries(base),
			targetSlots: [olderSlot(base)],
		});
	}

	async function deleteEntry(id: string) {
		const base = await open();
		const entries = new Map(base.entries);
		entries.delete(id);
		const reopened = await writer.commitSnapshot({
			base,
			nextEntries: [...entries.values()],
			targetSlots: [olderSlot(base), base.slot],
		});
		if (!createdV2ThisInstance) {
			await (async () => {
				const descriptor = reopened.root.cleanup;
				if (descriptor !== undefined) {
					const cleanup = await cleanupChain.read(descriptor);
					if (cleanup.status === 'valid') {
						await finalizeCleanup(
							reopened,
							new Set(cleanup.pages.map(({ garbageKey }) => garbageKey)),
						);
					}
				}
			})().catch(() => false);
		}
	}

	async function retryCleanup() {
		if (createdV2ThisInstance) return;
		const base = await open();
		const descriptor = base.root.cleanup;
		if (descriptor === undefined) return;
		const cleanup = await cleanupChain.read(descriptor);
		if (cleanup.status !== 'valid') return;
		await finalizeCleanup(
			base,
			new Set(cleanup.pages.map(({ garbageKey }) => garbageKey)),
		);
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
			return serializeMutation(() => deleteEntry(id));
		},
		retryCleanup() {
			return serializeMutation(retryCleanup);
		},
	};
}
