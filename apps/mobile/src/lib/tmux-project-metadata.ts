import { quoteShell } from '@/lib/host-browser-actions';

export const TMUX_PROJECT_METADATA_CACHE_VERSION = 1;

export type TmuxProjectMetadata = {
	sessionName: string;
	windowId: string;
	windowIndex: number;
	windowName: string;
	paneId: string;
	panePath: string;
	projectRoot: string;
	projectName: string;
};

export type TmuxProjectMetadataCacheStorage = {
	getString: (key: string) => string | undefined;
	set: (key: string, value: string) => void;
	delete: (key: string) => void;
};

export type TmuxProjectMetadataSourceParts = {
	stableConnectionId: string;
	tmuxSessionName: string;
};

export type TmuxProjectMetadataWindowParts =
	TmuxProjectMetadataSourceParts & {
		windowId: string;
	};

export type TmuxProjectMetadataCacheRecord = TmuxProjectMetadataSourceParts & {
	version: typeof TMUX_PROJECT_METADATA_CACHE_VERSION;
	metadata: TmuxProjectMetadata;
	updatedAt: string;
};

export type TmuxProjectMetadataCache = {
	readActive: (
		parts: TmuxProjectMetadataSourceParts,
	) => TmuxProjectMetadataCacheRecord | null;
	readWindow: (
		parts: TmuxProjectMetadataWindowParts,
	) => TmuxProjectMetadataCacheRecord | null;
	writeActive: (
		input: TmuxProjectMetadataSourceParts & {
			metadata: TmuxProjectMetadata;
		},
	) => TmuxProjectMetadataCacheRecord;
	deleteActive: (parts: TmuxProjectMetadataSourceParts) => void;
};

export type TmuxNavProjectAction = 'next' | 'prev' | 'next-all' | 'prev-all';

export function buildTmuxPaneProjectCommand(tmuxSessionName: string): string {
	return `mdev tmux pane project ${quoteShell(`${tmuxSessionName}:`)}`;
}

export function buildTmuxNavProjectCommand(
	action: TmuxNavProjectAction,
): string {
	return `mdev tmux nav ${action}`;
}

export function parseTmuxProjectMetadataOutput(
	output: string,
): TmuxProjectMetadata | null {
	for (const line of output.split(/[\r\n]+/).reverse()) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
		const metadata = parseTmuxProjectMetadataJson(trimmed);
		if (metadata) return metadata;
	}
	return null;
}

export function buildTmuxProjectMetadataActiveCacheKey(
	parts: TmuxProjectMetadataSourceParts,
): string {
	return [
		'tmuxProjectMetadataActive',
		'v1',
		encodeTmuxProjectMetadataKeyPart(parts.stableConnectionId),
		encodeTmuxProjectMetadataKeyPart(parts.tmuxSessionName),
	].join('.');
}

export function buildTmuxProjectMetadataWindowCacheKey(
	parts: TmuxProjectMetadataWindowParts,
): string {
	return [
		'tmuxProjectMetadataWindow',
		'v1',
		encodeTmuxProjectMetadataKeyPart(parts.stableConnectionId),
		encodeTmuxProjectMetadataKeyPart(parts.tmuxSessionName),
		encodeTmuxProjectMetadataKeyPart(parts.windowId),
	].join('.');
}

export function createTmuxProjectMetadataCache({
	storage,
	now = () => new Date().toISOString(),
}: {
	storage: TmuxProjectMetadataCacheStorage;
	now?: () => string;
}): TmuxProjectMetadataCache {
	return {
		readActive: (parts) =>
			readTmuxProjectMetadataCacheRecord({
				storage,
				key: buildTmuxProjectMetadataActiveCacheKey(parts),
			}),
		readWindow: (parts) =>
			readTmuxProjectMetadataCacheRecord({
				storage,
				key: buildTmuxProjectMetadataWindowCacheKey(parts),
			}),
		writeActive: (input) => {
			const record: TmuxProjectMetadataCacheRecord = {
				version: TMUX_PROJECT_METADATA_CACHE_VERSION,
				stableConnectionId: input.stableConnectionId,
				tmuxSessionName: input.tmuxSessionName,
				metadata: input.metadata,
				updatedAt: now(),
			};
			const serialized = JSON.stringify(record);
			storage.set(
				buildTmuxProjectMetadataActiveCacheKey(input),
				serialized,
			);
			storage.set(
				buildTmuxProjectMetadataWindowCacheKey({
					...input,
					windowId: input.metadata.windowId,
				}),
				serialized,
			);
			return record;
		},
		deleteActive: (parts) => {
			storage.delete(buildTmuxProjectMetadataActiveCacheKey(parts));
		},
	};
}

function readTmuxProjectMetadataCacheRecord({
	storage,
	key,
}: {
	storage: TmuxProjectMetadataCacheStorage;
	key: string;
}): TmuxProjectMetadataCacheRecord | null {
	const serialized = storage.getString(key);
	if (serialized === undefined) return null;

	const record = parseTmuxProjectMetadataCacheRecord(serialized);
	if (!record) {
		storage.delete(key);
		return null;
	}

	return record;
}

function parseTmuxProjectMetadataCacheRecord(
	serialized: string,
): TmuxProjectMetadataCacheRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(serialized);
	} catch {
		return null;
	}

	if (!isPlainObject(parsed)) return null;
	if (
		parsed.version !== TMUX_PROJECT_METADATA_CACHE_VERSION ||
		typeof parsed.stableConnectionId !== 'string' ||
		typeof parsed.tmuxSessionName !== 'string' ||
		typeof parsed.updatedAt !== 'string'
	) {
		return null;
	}

	const metadata = parseTmuxProjectMetadataValue(parsed.metadata);
	if (!metadata) return null;

	return {
		version: TMUX_PROJECT_METADATA_CACHE_VERSION,
		stableConnectionId: parsed.stableConnectionId,
		tmuxSessionName: parsed.tmuxSessionName,
		metadata,
		updatedAt: parsed.updatedAt,
	};
}

function parseTmuxProjectMetadataJson(
	serialized: string,
): TmuxProjectMetadata | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(serialized);
	} catch {
		return null;
	}
	return parseTmuxProjectMetadataValue(parsed);
}

function parseTmuxProjectMetadataValue(
	value: unknown,
): TmuxProjectMetadata | null {
	if (!isPlainObject(value)) return null;
	if (
		typeof value.sessionName !== 'string' ||
		typeof value.windowId !== 'string' ||
		typeof value.windowIndex !== 'number' ||
		!Number.isSafeInteger(value.windowIndex) ||
		typeof value.windowName !== 'string' ||
		typeof value.paneId !== 'string' ||
		typeof value.panePath !== 'string' ||
		typeof value.projectRoot !== 'string' ||
		typeof value.projectName !== 'string'
	) {
		return null;
	}

	if (
		!value.sessionName ||
		!value.windowId ||
		!value.paneId ||
		!value.panePath ||
		!value.projectRoot ||
		!value.projectName
	) {
		return null;
	}

	return {
		sessionName: value.sessionName,
		windowId: value.windowId,
		windowIndex: value.windowIndex,
		windowName: value.windowName,
		paneId: value.paneId,
		panePath: value.panePath,
		projectRoot: value.projectRoot,
		projectName: value.projectName,
	};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function encodeTmuxProjectMetadataKeyPart(value: string): string {
	return encodeURIComponent(value).replaceAll('.', '%2E');
}
