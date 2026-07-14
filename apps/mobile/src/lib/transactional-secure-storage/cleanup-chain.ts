import { type ZodType } from 'zod';
import { canonicalJson } from './codec';
import {
	SecureStorageUnavailableError,
	type AsyncStringStorage,
	type CleanupDescriptorV2,
	type Sha256,
} from './contracts';
import {
	buildV2Keys,
	createRecordSchemas,
	hashCanonicalRecord as hash,
} from './records';

type CleanupChainOptions<Metadata extends object> = {
	namespace: string;
	metadataSchema: ZodType<Metadata>;
	storage: AsyncStringStorage;
	sha256: Sha256;
};

export type ValidatedCleanupPage = {
	key: string;
	garbageKey: string;
};

export function createCleanupChain<Metadata extends object>(
	options: CleanupChainOptions<Metadata>,
) {
	const keys = buildV2Keys(options.namespace);
	const schemas = createRecordSchemas(
		options.namespace,
		options.metadataSchema,
	);

	async function stage(
		records: Map<string, string>,
		attemptId: string,
		garbageKeys: readonly string[],
	): Promise<CleanupDescriptorV2 | undefined> {
		if (garbageKeys.length === 0) return undefined;
		const pageHashes = new Array<string>(garbageKeys.length);
		for (let pageIndex = garbageKeys.length - 1; pageIndex >= 0; pageIndex--) {
			const body = {
				formatVersion: 2 as const,
				namespace: options.namespace,
				attemptId,
				pageIndex,
				garbageKey: garbageKeys[pageIndex]!,
				...(pageIndex + 1 < garbageKeys.length
					? { nextPageKey: keys.cleanup(attemptId, pageIndex + 1) }
					: {}),
			};
			const pageSha256 = await hash(body, undefined, options.sha256);
			pageHashes[pageIndex] = pageSha256;
			records.set(
				keys.cleanup(attemptId, pageIndex),
				canonicalJson(schemas.cleanupPage.parse({ ...body, pageSha256 })),
			);
		}
		return {
			headKey: keys.cleanup(attemptId, 0),
			pageCount: garbageKeys.length,
			sha256: await hash({ pageHashes }, undefined, options.sha256),
		};
	}

	async function read(
		descriptor: CleanupDescriptorV2,
	): Promise<
		| { status: 'valid'; pages: readonly ValidatedCleanupPage[] }
		| { status: 'invalid' }
	> {
		const pages: ValidatedCleanupPage[] = [];
		const pageHashes: string[] = [];
		let attemptId: string | undefined;
		let pageKey: string | undefined = descriptor.headKey;
		for (let pageIndex = 0; pageIndex < descriptor.pageCount; pageIndex++) {
			if (pageKey === undefined) return { status: 'invalid' };
			let raw: string | null;
			try {
				raw = await options.storage.getItem(pageKey);
			} catch (error) {
				throw new SecureStorageUnavailableError(
					`Secure storage read failed for ${pageKey}: ${String(error)}`,
				);
			}
			if (raw === null) return { status: 'invalid' };
			let page;
			try {
				page = schemas.cleanupPage.parse(JSON.parse(raw));
			} catch {
				return { status: 'invalid' };
			}
			attemptId ??= page.attemptId;
			if (
				page.attemptId !== attemptId ||
				page.pageIndex !== pageIndex ||
				pageKey !== keys.cleanup(attemptId, pageIndex) ||
				page.nextPageKey !==
					(pageIndex + 1 < descriptor.pageCount
						? keys.cleanup(attemptId, pageIndex + 1)
						: undefined)
			) {
				return { status: 'invalid' };
			}
			const pageHash = await hash(
				page as unknown as Record<string, unknown>,
				'pageSha256',
				options.sha256,
			);
			if (pageHash !== page.pageSha256) return { status: 'invalid' };
			pages.push({ key: pageKey, garbageKey: page.garbageKey });
			pageHashes.push(pageHash);
			pageKey = page.nextPageKey;
		}
		if (
			(await hash({ pageHashes }, undefined, options.sha256)) !==
			descriptor.sha256
		) {
			return { status: 'invalid' };
		}
		return { status: 'valid', pages };
	}

	function exactlyMatches(
		pages: readonly ValidatedCleanupPage[],
		allowedKeys: ReadonlySet<string>,
	) {
		return (
			pages.length === allowedKeys.size &&
			new Set(pages.map(({ garbageKey }) => garbageKey)).size ===
				pages.length &&
			pages.every(({ garbageKey }) => allowedKeys.has(garbageKey))
		);
	}

	async function deleteGarbage(
		pages: readonly ValidatedCleanupPage[],
		allowedKeys: ReadonlySet<string>,
	): Promise<boolean> {
		if (!exactlyMatches(pages, allowedKeys)) return false;
		for (const { garbageKey } of pages) {
			try {
				await options.storage.deleteItem(garbageKey);
				if ((await options.storage.getItem(garbageKey)) !== null) return false;
			} catch {
				return false;
			}
		}
		return true;
	}

	async function hasObservedDeletion(
		pages: readonly ValidatedCleanupPage[],
	): Promise<boolean> {
		for (const { garbageKey } of pages) {
			try {
				if ((await options.storage.getItem(garbageKey)) === null) return true;
			} catch {
				return false;
			}
		}
		return false;
	}

	async function deletePagesBestEffort(
		pages: readonly ValidatedCleanupPage[],
	): Promise<void> {
		for (const { key } of pages) {
			await options.storage.deleteItem(key).catch(() => undefined);
		}
	}

	return {
		stage,
		read,
		exactlyMatches,
		deleteGarbage,
		hasObservedDeletion,
		deletePagesBestEffort,
	};
}
