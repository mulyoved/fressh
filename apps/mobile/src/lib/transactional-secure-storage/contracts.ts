import type * as z from 'zod';

export type AsyncStringStorage = {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
	deleteItem(key: string): Promise<void>;
};

export type LoggerLike = Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;

export type SecureEntry<Metadata extends object, Value> = {
	id: string;
	metadata: Metadata;
	value: Value;
};

export type StorageOpenStatus =
	| 'initialized'
	| 'migrated'
	| 'current'
	| 'recovered';

export type StorageOpenResult = {
	status: StorageOpenStatus;
	cleanupPending: boolean;
};

export type LegacySnapshot<Metadata extends object, Value> = {
	status: 'absent' | 'present';
	entries: SecureEntry<Metadata, Value>[];
	recordKeys: string[];
};

export type LegacySnapshotReader<Metadata extends object, Value> = {
	read(): Promise<LegacySnapshot<Metadata, Value>>;
};

export type Sha256 = (bytes: Uint8Array) => Promise<string>;

export type TransactionalSecureStore<Metadata extends object, Value> = {
	ensureReady(): Promise<StorageOpenResult>;
	getEntry(id: string): Promise<SecureEntry<Metadata, Value> | null>;
	listEntries(): Promise<SecureEntry<Metadata, Value>[]>;
	upsertEntry(entry: SecureEntry<Metadata, Value>): Promise<void>;
	replaceAllEntries(entries: SecureEntry<Metadata, Value>[]): Promise<void>;
	deleteEntry(id: string): Promise<void>;
	retryCleanup(): Promise<void>;
};

export class SecureStorageUnavailableError extends Error {}
export class SecureStorageCorruptionError extends Error {}
export class SecureStorageWriteNotCommittedError extends Error {}

export type TransactionalSecureStoreOptions<
	Metadata extends object,
	Value,
> = {
	namespace: string;
	metadataSchema: z.ZodType<Metadata>;
	serializeValue(value: Value): string;
	parseValue(raw: string): Value;
	storage: AsyncStringStorage;
	legacy: LegacySnapshotReader<Metadata, Value>;
	randomUUID(): string;
	sha256: Sha256;
	logger?: LoggerLike;
};
