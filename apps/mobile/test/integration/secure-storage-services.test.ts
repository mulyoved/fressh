import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { makeBetterSecureStore } from '../../src/lib/chunked-storage';
import {
	createSecureStorageServices,
	keyMetadataSchema,
} from '../../src/lib/secure-storage-services';
import { FaultInjectingStringStorage } from './helpers/fault-injecting-string-storage';

const noopLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

void test('initialization migrates a v1 private key without changing its entry data', async () => {
	const storage = new FaultInjectingStringStorage();
	const legacy = makeBetterSecureStore({
		storagePrefix: 'privateKey',
		extraManifestFieldsSchema: keyMetadataSchema,
		parseValue: (value) => value,
		storage,
		randomUUID: () => 'legacy-id',
		logger: noopLogger,
	});
	const expected = {
		id: 'key_existing',
		metadata: {
			priority: 7,
			createdAtMs: 1_712_345_678_901,
			label: 'Existing key',
			isDefault: true,
		},
		value: 'private-key-value',
	};
	await legacy.upsertEntry(expected);

	let nextId = 0;
	const services = createSecureStorageServices({
		storage,
		sha256: async (bytes) =>
			createHash('sha256').update(bytes).digest('hex'),
		randomUUID: () => `service-${++nextId}`,
		logger: noopLogger,
	});

	await services.initialize();

	assert.deepEqual(await services.privateKeys.getEntry(expected.id), expected);
});
