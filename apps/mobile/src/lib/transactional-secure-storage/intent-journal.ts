import { type ZodType } from 'zod';
import { canonicalJson } from './codec';
import {
	type AsyncStringStorage,
	type RootSlot,
	type Sha256,
	type TransactionIntentV2,
} from './contracts';
import {
	buildV2Keys,
	createRecordSchemas,
	hashCanonicalRecord as hash,
} from './records';

type IntentJournalOptions<Metadata extends object> = {
	namespace: string;
	metadataSchema: ZodType<Metadata>;
	storage: AsyncStringStorage;
	sha256: Sha256;
};

export function createIntentJournal<Metadata extends object>(
	options: IntentJournalOptions<Metadata>,
) {
	const keys = buildV2Keys(options.namespace);
	const schemas = createRecordSchemas(options.namespace, options.metadataSchema);
	const encoder = new TextEncoder();

	async function write(params: {
		attemptId: string;
		targetRootSlots: readonly RootSlot[];
		firstCommitGeneration: number;
		snapshotId: string;
		plannedKeys: readonly string[];
	}) {
		const pages = [];
		for (const [pageIndex, plannedKey] of params.plannedKeys.entries()) {
			const body = {
				formatVersion: 2 as const,
				namespace: options.namespace,
				attemptId: params.attemptId,
				pageIndex,
				plannedKey,
				...(pageIndex + 1 < params.plannedKeys.length
					? {
							nextPageKey: keys.intentPlan(params.attemptId, pageIndex + 1),
						}
					: {}),
			};
			pages.push(
				schemas.intentPlanPage.parse({
					...body,
					pageSha256: await hash(body, undefined, options.sha256),
				}),
			);
		}
		const intent = schemas.transactionIntent.parse({
			formatVersion: 2,
			namespace: options.namespace,
			attemptId: params.attemptId,
			targetRootSlots: params.targetRootSlots,
			firstCommitGeneration: params.firstCommitGeneration,
			snapshotId: params.snapshotId,
			planPageCount: pages.length,
			planSha256: await options.sha256(
				encoder.encode(canonicalJson(pages)),
			),
		});
		const rawIntent = canonicalJson(intent);
		await options.storage.setItem(keys.intent.a, rawIntent);
		await options.storage.setItem(keys.intent.b, rawIntent);
		for (const slot of ['a', 'b'] as const) {
			const raw = await options.storage.getItem(keys.intent[slot]);
			if (
				raw === null ||
				canonicalJson(schemas.transactionIntent.parse(JSON.parse(raw))) !== rawIntent
			) {
				throw new Error('Transaction intent validation failed');
			}
		}
		for (const [pageIndex, page] of pages.entries()) {
			await options.storage.setItem(
				keys.intentPlan(params.attemptId, pageIndex),
				canonicalJson(page),
			);
		}
		await validatePages(intent, pages);
		return { pageCount: pages.length };
	}

	async function validatePages(
		intent: TransactionIntentV2,
		expected: readonly unknown[],
	) {
		const actual = [];
		for (let pageIndex = 0; pageIndex < intent.planPageCount; pageIndex++) {
			const raw = await options.storage.getItem(
				keys.intentPlan(intent.attemptId, pageIndex),
			);
			if (raw === null) throw new Error('Missing intent plan page');
			const page = schemas.intentPlanPage.parse(JSON.parse(raw));
			if (
				page.attemptId !== intent.attemptId ||
				page.pageIndex !== pageIndex ||
				page.nextPageKey !==
					(pageIndex + 1 < intent.planPageCount
						? keys.intentPlan(intent.attemptId, pageIndex + 1)
						: undefined) ||
				(await hash(
					page as unknown as Record<string, unknown>,
					'pageSha256',
					options.sha256,
				)) !== page.pageSha256
			) {
				throw new Error('Invalid intent plan chain');
			}
			actual.push(page);
		}
		if (
			canonicalJson(actual) !== canonicalJson(expected) ||
			(await options.sha256(encoder.encode(canonicalJson(actual)))) !==
				intent.planSha256
		) {
			throw new Error('Invalid intent plan hash');
		}
	}

	async function complete(attemptId: string, pageCount: number) {
		let plansDeleted = true;
		for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
			if (!(await deleteBestEffort(keys.intentPlan(attemptId, pageIndex)))) {
				plansDeleted = false;
			}
		}
		if (plansDeleted) {
			await deleteBestEffort(keys.intent.a);
			await deleteBestEffort(keys.intent.b);
		}
	}

	async function recover(protectedKeys: ReadonlySet<string>) {
		const intents = new Map<string, TransactionIntentV2>();
		let hasHeader = false;
		for (const slot of ['a', 'b'] as const) {
			const raw = await options.storage.getItem(keys.intent[slot]);
			if (raw === null) continue;
			hasHeader = true;
			try {
				const intent = schemas.transactionIntent.parse(JSON.parse(raw));
				intents.set(intent.attemptId, intent);
			} catch {
				// A malformed header cannot identify immutable attempt records.
			}
		}
		for (const intent of intents.values()) {
			const pages = [];
			for (let pageIndex = 0; pageIndex < intent.planPageCount; pageIndex++) {
				const planKey = keys.intentPlan(intent.attemptId, pageIndex);
				const raw = await options.storage.getItem(planKey);
				if (raw !== null) {
					try {
						const page = schemas.intentPlanPage.parse(JSON.parse(raw));
						if (
							page.attemptId === intent.attemptId &&
							page.pageIndex === pageIndex &&
							page.nextPageKey ===
								(pageIndex + 1 < intent.planPageCount
									? keys.intentPlan(intent.attemptId, pageIndex + 1)
									: undefined) &&
							(await hash(
								page as unknown as Record<string, unknown>,
								'pageSha256',
								options.sha256,
							)) === page.pageSha256
						) {
							pages.push(page);
						}
					} catch {
						// Deterministic plan keys remain safe to discard.
					}
				}
				await deleteBestEffort(planKey);
			}
			if (
				pages.length === intent.planPageCount &&
				(await options.sha256(encoder.encode(canonicalJson(pages)))) ===
					intent.planSha256
			) {
				for (const { plannedKey } of pages) {
					if (!protectedKeys.has(plannedKey)) {
						await deleteBestEffort(plannedKey);
					}
				}
			}
		}
		if (hasHeader) {
			await deleteBestEffort(keys.intent.a);
			await deleteBestEffort(keys.intent.b);
		}
	}

	async function deleteBestEffort(key: string): Promise<boolean> {
		try {
			await options.storage.deleteItem(key);
			return (await options.storage.getItem(key)) === null;
		} catch {
			return false;
		}
	}

	return { write, complete, recover };
}
