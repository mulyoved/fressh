import { parseShellConfigString, type ShellConfig } from '@/lib/shell-config';

export type ShellConfigSource = 'bundled' | 'cache' | 'remote';

export type ShellConfigState = {
	config: ShellConfig;
	source: ShellConfigSource;
	lastLoadedAt: string | null;
	lastError: string | null;
};

export type ShellConfigCacheStorage = {
	getString: (key: string) => string | undefined;
	set: (key: string, value: string) => void;
	delete: (key: string) => void;
};

const cacheKeys = {
	json: 'shellConfig.json',
	lastLoadedAt: 'shellConfig.lastLoadedAt',
	lastError: 'shellConfig.lastError',
	lastVersion: 'shellConfig.lastVersion',
} as const;

export const SHELL_CONFIG_RAW_URL =
	'https://raw.githubusercontent.com/mulyoved/fressh/dev/apps/mobile/config/shell-config.json';

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function parseUpdatedAtTime(config: ShellConfig): number | null {
	const time = Date.parse(config.updatedAt);
	return Number.isNaN(time) ? null : time;
}

function compareConfigVersions(left: string, right: string): number | null {
	if (!/^\d+(?:[-.]\d+)*$/.test(left) || !/^\d+(?:[-.]\d+)*$/.test(right)) {
		return null;
	}
	const leftParts = left.split(/[-.]/).map(Number);
	const rightParts = right.split(/[-.]/).map(Number);
	const maxLength = Math.max(leftParts.length, rightParts.length);
	for (let index = 0; index < maxLength; index += 1) {
		const leftPart = leftParts[index] ?? 0;
		const rightPart = rightParts[index] ?? 0;
		if (leftPart !== rightPart) return leftPart - rightPart;
	}
	return 0;
}

function isStaleComparedToBundled({
	cachedConfig,
	bundledConfig,
}: {
	cachedConfig: ShellConfig;
	bundledConfig: ShellConfig;
}): boolean {
	const cachedTime = parseUpdatedAtTime(cachedConfig);
	const bundledTime = parseUpdatedAtTime(bundledConfig);
	if (cachedTime === null || bundledTime === null) return false;
	if (cachedTime < bundledTime) return true;
	if (cachedTime > bundledTime) return false;
	const versionOrder = compareConfigVersions(
		cachedConfig.version,
		bundledConfig.version,
	);
	return versionOrder !== null && versionOrder < 0;
}

function clearCachedRuntimeMetadata(cache: ShellConfigCacheStorage) {
	cache.delete(cacheKeys.lastLoadedAt);
	cache.delete(cacheKeys.lastError);
	cache.delete(cacheKeys.lastVersion);
}

function isRuntimeMetadataStaleComparedToBundled({
	lastLoadedAt,
	lastVersion,
	bundledConfig,
}: {
	lastLoadedAt: string | null;
	lastVersion: string | null;
	bundledConfig: ShellConfig;
}): boolean {
	if (!lastLoadedAt && !lastVersion) return false;
	if (!lastVersion) return true;
	if (!lastLoadedAt) return true;
	const loadedTime = Date.parse(lastLoadedAt);
	const bundledTime = parseUpdatedAtTime(bundledConfig);
	if (Number.isNaN(loadedTime) || bundledTime === null) return false;
	const versionOrder = compareConfigVersions(
		lastVersion,
		bundledConfig.version,
	);
	if (versionOrder !== null && versionOrder < 0) return true;
	if (loadedTime < bundledTime) return true;
	if (loadedTime > bundledTime) return false;
	return false;
}

export function loadInitialShellConfigState({
	storage: cache,
	bundledConfig,
}: {
	storage: ShellConfigCacheStorage;
	bundledConfig: ShellConfig;
}): ShellConfigState {
	const cachedText = cache.getString(cacheKeys.json);
	const lastLoadedAt = cache.getString(cacheKeys.lastLoadedAt) ?? null;
	const lastError = cache.getString(cacheKeys.lastError) ?? null;
	const lastVersion = cache.getString(cacheKeys.lastVersion) ?? null;

	if (cachedText) {
		try {
			const cachedConfig = parseShellConfigString(cachedText);
			if (isStaleComparedToBundled({ cachedConfig, bundledConfig })) {
				cache.delete(cacheKeys.json);
				clearCachedRuntimeMetadata(cache);
				return {
					config: bundledConfig,
					source: 'bundled',
					lastLoadedAt: null,
					lastError: null,
				};
			}
			return {
				config: cachedConfig,
				source: 'cache',
				lastLoadedAt,
				lastError,
			};
		} catch (error) {
			cache.delete(cacheKeys.json);
			cache.delete(cacheKeys.lastLoadedAt);
			cache.delete(cacheKeys.lastVersion);
			const message = toErrorMessage(error);
			cache.set(cacheKeys.lastError, message);
			return {
				config: bundledConfig,
				source: 'bundled',
				lastLoadedAt: null,
				lastError: message,
			};
		}
	}

	if (
		isRuntimeMetadataStaleComparedToBundled({
			lastLoadedAt,
			lastVersion,
			bundledConfig,
		})
	) {
		clearCachedRuntimeMetadata(cache);
		return {
			config: bundledConfig,
			source: 'bundled',
			lastLoadedAt: null,
			lastError: null,
		};
	}

	return {
		config: bundledConfig,
		source: 'bundled',
		lastLoadedAt,
		lastError,
	};
}

export async function fetchRemoteShellConfigText({
	url = SHELL_CONFIG_RAW_URL,
	fetchImpl = fetch,
}: {
	url?: string;
	fetchImpl?: typeof fetch;
} = {}): Promise<string> {
	const response = await fetchImpl(`${url}?t=${Date.now().toString()}`, {
		headers: { Accept: 'application/json' },
	});
	if (!response.ok) {
		throw new Error(
			`Remote shell config request failed with ${response.status}`,
		);
	}
	return response.text();
}

export async function reloadShellConfigFromRemote({
	storage: cache,
	fetchText = () => fetchRemoteShellConfigText(),
	now = () => new Date().toISOString(),
}: {
	storage: ShellConfigCacheStorage;
	fetchText?: () => Promise<string>;
	now?: () => string;
}): Promise<ShellConfigState> {
	try {
		const text = await fetchText();
		const config = parseShellConfigString(text);
		const loadedAt = now();
		cache.set(cacheKeys.json, text);
		cache.set(cacheKeys.lastLoadedAt, loadedAt);
		cache.set(cacheKeys.lastVersion, config.version);
		cache.delete(cacheKeys.lastError);
		return {
			config,
			source: 'remote',
			lastLoadedAt: loadedAt,
			lastError: null,
		};
	} catch (error) {
		cache.set(cacheKeys.lastError, toErrorMessage(error));
		throw error;
	}
}
