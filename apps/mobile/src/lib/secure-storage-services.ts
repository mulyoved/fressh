import * as z from 'zod';
import { type RestoreJournalStorage } from './security-center-flow';
import {
	createTransactionalSecureStore,
	type AsyncStringStorage,
	type LoggerLike,
	type Sha256,
	type TransactionalSecureStore,
} from './transactional-secure-storage';
import { createLegacyChunkedStorageReader } from './transactional-secure-storage/legacy-reader';

export const keyMetadataSchema = z.object({
	priority: z.number(),
	createdAtMs: z.int(),
	label: z.string().optional(),
	isDefault: z.boolean().optional(),
});
export type KeyMetadata = z.infer<typeof keyMetadataSchema>;

const restoreJournalMetadataSchema = z.object({});

export function createSecureStorageServices(params: {
	storage: AsyncStringStorage;
	sha256: Sha256;
	randomUUID(): string;
	logger?: LoggerLike;
}): {
	initialize(): Promise<void>;
	privateKeys: TransactionalSecureStore<KeyMetadata, string>;
	restoreJournal: RestoreJournalStorage;
} {
	const privateKeys = createTransactionalSecureStore({
		namespace: 'privateKey',
		metadataSchema: keyMetadataSchema,
		serializeValue: (value) => value,
		parseValue: (value) => value,
		storage: params.storage,
		legacy: createLegacyChunkedStorageReader({
			storagePrefix: 'privateKey',
			metadataSchema: keyMetadataSchema,
			parseValue: (value) => value,
			storage: params.storage,
		}),
		randomUUID: params.randomUUID,
		sha256: params.sha256,
		logger: params.logger,
	});
	const restoreJournalStore = createTransactionalSecureStore({
		namespace: 'securityCenterRestoreJournal',
		metadataSchema: restoreJournalMetadataSchema,
		serializeValue: (value: string) => value,
		parseValue: (value) => value,
		storage: params.storage,
		legacy: createLegacyChunkedStorageReader({
			storagePrefix: 'securityCenterRestoreJournal',
			metadataSchema: restoreJournalMetadataSchema,
			parseValue: (value) => value,
			storage: params.storage,
		}),
		randomUUID: params.randomUUID,
		sha256: params.sha256,
		logger: params.logger,
	});
	const restoreJournal: RestoreJournalStorage = {
		async load() {
			const entry = await restoreJournalStore.getEntry('pending');
			if (entry === null) return null;
			try {
				return JSON.parse(entry.value) as unknown;
			} catch (error) {
				params.logger?.warn(
					'Discarding malformed restore journal entry',
					error,
				);
				await restoreJournalStore.deleteEntry('pending');
				return null;
			}
		},
		async save(state) {
			await restoreJournalStore.upsertEntry({
				id: 'pending',
				metadata: {},
				value: JSON.stringify(state),
			});
		},
		async clear() {
			await restoreJournalStore.deleteEntry('pending');
		},
	};

	return {
		async initialize() {
			await Promise.all([
				privateKeys.ensureReady(),
				restoreJournalStore.ensureReady(),
			]);
		},
		privateKeys,
		restoreJournal,
	};
}
