import { z } from 'zod';
import {
	MAX_SECURE_STORE_VALUE_BYTES,
	canonicalJson,
	utf8ByteLength,
} from './codec';
import  {
	type CleanupPageV2,
	type EntryRevisionV2,
	type IntentPlanPageV2,
	type ManifestPageV2,
	type RootCommitV2,
	type Sha256,
	type TransactionIntentV2,
} from './contracts';

const textEncoder = new TextEncoder();
const keySafeString = z.string().min(1).regex(/^[A-Za-z0-9._-]+$/);
const storageKey = keySafeString;
const nonNegativeInteger = z.number().int().nonnegative();

export function buildV2Keys(namespace: string) {
	const prefix = `${namespace}-v2`;
	return {
		root: { a: `${prefix}-root-a`, b: `${prefix}-root-b` },
		intent: { a: `${prefix}-intent-a`, b: `${prefix}-intent-b` },
		intentPlan: (attemptId: string, pageIndex: number) =>
			`${prefix}-intent-plan-${attemptId}-${pageIndex}`,
		manifest: (attemptId: string, pageIndex: number) =>
			`${prefix}-manifest-${attemptId}-${pageIndex}`,
		entry: (attemptId: string, entryIndex: number) =>
			`${prefix}-entry-${attemptId}-${entryIndex}`,
		value: (valueRecordId: string, chunkIndex: number) =>
			`${prefix}-value-${valueRecordId}-${chunkIndex}`,
		cleanup: (attemptId: string, pageIndex: number) =>
			`${prefix}-cleanup-${attemptId}-${pageIndex}`,
	} as const;
}

function payloadBounded<T extends z.ZodTypeAny>(schema: T) {
	return schema.superRefine((value, context) => {
		if (utf8ByteLength(canonicalJson(value)) > MAX_SECURE_STORE_VALUE_BYTES) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Secure storage payload exceeds ${MAX_SECURE_STORE_VALUE_BYTES} UTF-8 bytes`,
			});
		}
	});
}

export function createRecordSchemas<Metadata extends object>(
	namespace: string,
	metadataSchema: z.ZodType<Metadata>,
) {
	const common = {
		formatVersion: z.literal(2),
		namespace: z.literal(namespace),
	} as const;
	const manifestEntryRef = z.strictObject({
		entryId: z.string(),
		revisionKey: storageKey,
		revisionSha256: z.string(),
	});
	const transactionIntent = payloadBounded(
		z
			.strictObject({
				...common,
				attemptId: keySafeString,
				targetRootSlots: z.array(z.enum(['a', 'b'])).min(1).max(2),
				firstCommitGeneration: nonNegativeInteger,
				snapshotId: keySafeString,
				planPageCount: nonNegativeInteger,
				planSha256: z.string(),
			})
			.superRefine((record, context) => {
				if (new Set(record.targetRootSlots).size !== record.targetRootSlots.length) {
					context.addIssue({
						code: z.ZodIssueCode.custom,
						path: ['targetRootSlots'],
						message: 'Root slots must be unique',
					});
				}
			}),
	);
	const intentPlanPage = payloadBounded(
		z.strictObject({
			...common,
			attemptId: keySafeString,
			pageIndex: nonNegativeInteger,
			plannedKey: storageKey,
			nextPageKey: storageKey.optional(),
			pageSha256: z.string(),
		}),
	);
	const rootCommit = payloadBounded(
		z.strictObject({
			...common,
			commitGeneration: nonNegativeInteger,
			snapshotId: keySafeString,
			manifestHeadKey: storageKey,
			manifestPageCount: nonNegativeInteger,
			entryCount: nonNegativeInteger,
			manifestSha256: z.string(),
			cleanupHeadKey: storageKey.optional(),
			legacyCleanupPageCount: nonNegativeInteger.optional(),
			legacyCleanupPending: z.literal(true).optional(),
			legacyCleanupSha256: z.string().optional(),
		}).superRefine((record, context) => {
			if ((record.legacyCleanupPageCount === undefined) !== (record.legacyCleanupSha256 === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Legacy cleanup anchor fields must appear together' });
		}),
	);
	const manifestPage = payloadBounded(
		z.strictObject({
			...common,
			snapshotId: keySafeString,
			pageIndex: nonNegativeInteger,
			entries: z.array(manifestEntryRef).max(1),
			nextPageKey: storageKey.optional(),
			pageSha256: z.string(),
		}),
	);
	const entryRevision = payloadBounded(
		z.strictObject({
			...common,
			entryId: z.string(),
			revisionId: keySafeString,
			metadata: metadataSchema,
			valueRecordId: keySafeString,
			valueChunkCount: nonNegativeInteger,
			valueByteLength: nonNegativeInteger,
			valueSha256: z.string(),
		}),
	);
	const cleanupPage = payloadBounded(
		z.strictObject({
			...common,
			attemptId: keySafeString,
			pageIndex: nonNegativeInteger,
			garbageKey: storageKey,
			nextPageKey: storageKey.optional(),
			pageSha256: z.string(),
		}),
	);

	return {
		transactionIntent: transactionIntent as z.ZodType<TransactionIntentV2>,
		intentPlanPage: intentPlanPage as z.ZodType<IntentPlanPageV2>,
		rootCommit: rootCommit as z.ZodType<RootCommitV2>,
		manifestPage: manifestPage as z.ZodType<ManifestPageV2>,
		entryRevision: entryRevision as z.ZodType<EntryRevisionV2<Metadata>>,
		cleanupPage: cleanupPage as z.ZodType<CleanupPageV2>,
	};
}

export async function hashCanonicalRecord(
	record: Readonly<Record<string, unknown>>,
	hashField: string | undefined,
	sha256: Sha256,
): Promise<string> {
	const hashInput = Object.fromEntries(
		Object.entries(record).filter(([key]) => key !== hashField),
	);
	return sha256(textEncoder.encode(canonicalJson(hashInput)));
}
