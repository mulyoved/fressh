import * as z from 'zod';
import { buildChunkedStoreKeys } from '../chunked-storage';
import {
	type AsyncStringStorage,
	type LegacySnapshotReader,
	SecureStorageCorruptionError,
} from './contracts';

export function createLegacyChunkedStorageReader<
	Metadata extends object,
	Value,
>(options: {
	storagePrefix: string;
	metadataSchema: z.ZodType<Metadata>;
	parseValue(raw: string): Value;
	storage: AsyncStringStorage;
}): LegacySnapshotReader<Metadata, Value> {
	const keys = buildChunkedStoreKeys(options.storagePrefix);
	const rootManifestSchema = z.looseObject({
		manifestVersion: z.literal(1).default(1),
		manifestChunksIds: z.array(z.string()),
	});
	const manifestEntrySchema = z.object({
		id: z.string(),
		chunkCount: z.number().int().nonnegative().default(1),
		metadata: options.metadataSchema,
	});
	const manifestChunkSchema = z.object({
		manifestChunkVersion: z.literal(1).default(1),
		entries: z.array(manifestEntrySchema),
	});
	function parseLegacyRecord<T>(parse: () => T): T {
		try {
			return parse();
		} catch (error) {
			throw new SecureStorageCorruptionError(
				`Malformed legacy storage: ${String(error)}`,
			);
		}
	}

	return {
		async read() {
			const rawRoot = await options.storage.getItem(keys.rootManifestKey);
			if (rawRoot === null) {
				return {
					status: 'absent',
					entries: [],
					recordKeys: [keys.rootManifestKey],
				};
			}

			const root = parseLegacyRecord(() =>
				rootManifestSchema.parse(JSON.parse(rawRoot) as unknown),
			);
			const recordKeys = [keys.rootManifestKey];
			const manifestEntries: z.infer<typeof manifestEntrySchema>[] = [];

			for (const manifestChunkId of root.manifestChunksIds) {
				const manifestKey = keys.manifestChunkKey(manifestChunkId);
				recordKeys.push(manifestKey);
				const rawManifest = await options.storage.getItem(manifestKey);
				if (rawManifest === null) {
					throw new SecureStorageCorruptionError(
						`Missing legacy manifest chunk: ${manifestKey}`,
					);
				}
				const manifest = parseLegacyRecord(() =>
					manifestChunkSchema.parse(JSON.parse(rawManifest) as unknown),
				);
				manifestEntries.push(...manifest.entries);
			}

			const seenIds = new Set<string>();
			for (const entry of manifestEntries) {
				if (seenIds.has(entry.id)) {
					throw new SecureStorageCorruptionError(
						`Duplicate legacy entry ID: ${entry.id}`,
					);
				}
				seenIds.add(entry.id);
			}

			const entries = [];
			for (const entry of manifestEntries) {
				const valueChunks: string[] = [];
				for (let chunkIndex = 0; chunkIndex < entry.chunkCount; chunkIndex++) {
					const valueKey = keys.entryKey(entry.id, chunkIndex);
					recordKeys.push(valueKey);
					const rawValueChunk = await options.storage.getItem(valueKey);
					if (rawValueChunk === null) {
						throw new SecureStorageCorruptionError(
							`Missing legacy value chunk: ${valueKey}`,
						);
					}
					valueChunks.push(rawValueChunk);
				}
				entries.push({
					id: entry.id,
					metadata: entry.metadata,
					value: parseLegacyRecord(() =>
						options.parseValue(valueChunks.join('')),
					),
				});
			}

			return { status: 'present', entries, recordKeys };
		},
	};
}
