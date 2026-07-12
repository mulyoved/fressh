import assert from 'node:assert/strict';
import test from 'node:test';
import * as z from 'zod';
import {
	makeBetterSecureStore,
	type AsyncStringStorage,
} from '../../src/lib/chunked-storage';

const noopLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

const testKeyMetadataSchema = z.object({
	priority: z.number(),
	createdAtMs: z.int(),
	label: z.string(),
	isDefault: z.boolean(),
	testPadding: z.string(),
});

function createMemoryStorage(): AsyncStringStorage {
	const entries = new Map<string, string>();
	return {
		getItem: async (key) => entries.get(key) ?? null,
		setItem: async (key, value) => {
			entries.set(key, value);
		},
		deleteItem: async (key) => {
			entries.delete(key);
		},
	};
}

void test('getEntry reads private-key values from every manifest chunk', async () => {
	let nextManifestId = 0;
	const storage = makeBetterSecureStore({
		storagePrefix: 'privateKey',
		extraManifestFieldsSchema: testKeyMetadataSchema,
		parseValue: (value) => value,
		storage: createMemoryStorage(),
		randomUUID: () => `manifest-${++nextManifestId}`,
		logger: noopLogger,
	});
	const privateKeys = [
		{ id: 'key_oldest', createdAtMs: 1, value: 'private-key-value-oldest' },
		{ id: 'key_middle', createdAtMs: 2, value: 'private-key-value-middle' },
		{ id: 'key_newest', createdAtMs: 3, value: 'private-key-value-newest' },
	] as const;

	for (const [priority, privateKey] of privateKeys.entries()) {
		await storage.upsertEntry({
			id: privateKey.id,
			metadata: {
				priority,
				createdAtMs: privateKey.createdAtMs,
				label: privateKey.id,
				isDefault: priority === 0,
				testPadding: 'x'.repeat(800),
			},
			value: privateKey.value,
		});
	}

	const manifest = await storage.getManifest();
	assert.equal(manifest.rootManifest.manifestChunksIds.length, 2);

	for (const privateKey of privateKeys) {
		const stored = await storage.getEntry(privateKey.id);
		assert.equal(stored.value, privateKey.value);
		assert.equal(
			stored.manifestEntry.metadata.createdAtMs,
			privateKey.createdAtMs,
		);
	}
});
