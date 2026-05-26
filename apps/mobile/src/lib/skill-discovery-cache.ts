import { type DiscoveredSkill } from '@/lib/skill-discovery';

export const SKILL_DISCOVERY_CACHE_VERSION = 1;

export type SkillDiscoveryCacheStorage = {
	getString: (key: string) => string | undefined;
	set: (key: string, value: string) => void;
	delete: (key: string) => void;
};

export type SkillDiscoveryCacheKeyParts = {
	stableConnectionId: string;
	tmuxTarget: string;
	projectRoot: string;
};

export type SkillDiscoveryCacheSourceParts = {
	stableConnectionId: string;
	tmuxTarget: string;
};

export type SkillDiscoveryCacheRecord = SkillDiscoveryCacheKeyParts & {
	version: typeof SKILL_DISCOVERY_CACHE_VERSION;
	projectName: string;
	skills: DiscoveredSkill[];
	updatedAt: string;
};

export type SkillDiscoveryCacheLastProject = SkillDiscoveryCacheSourceParts & {
	version: typeof SKILL_DISCOVERY_CACHE_VERSION;
	projectRoot: string;
	projectName: string;
	updatedAt: string;
};

export type SkillDiscoveryCacheWriteInput = SkillDiscoveryCacheKeyParts & {
	projectName: string;
	skills: DiscoveredSkill[];
};

export type SkillDiscoveryCache = {
	read: (
		parts: SkillDiscoveryCacheKeyParts,
	) => SkillDiscoveryCacheRecord | null;
	readLastProject: (
		parts: SkillDiscoveryCacheSourceParts,
	) => SkillDiscoveryCacheLastProject | null;
	writeLastProject: (
		input: SkillDiscoveryCacheLastProject,
	) => SkillDiscoveryCacheLastProject;
	write: (input: SkillDiscoveryCacheWriteInput) => SkillDiscoveryCacheRecord;
	delete: (parts: SkillDiscoveryCacheKeyParts) => void;
};

export function buildSkillDiscoveryCacheKey(
	parts: SkillDiscoveryCacheKeyParts,
): string {
	return [
		'skillDiscoveryCache',
		'v1',
		encodeSkillDiscoveryCacheKeyPart(parts.stableConnectionId),
		encodeSkillDiscoveryCacheKeyPart(parts.tmuxTarget),
		encodeSkillDiscoveryCacheKeyPart(parts.projectRoot),
	].join('.');
}

export function buildSkillDiscoveryLastProjectCacheKey(
	parts: SkillDiscoveryCacheSourceParts,
): string {
	return [
		'skillDiscoveryLastProject',
		'v1',
		encodeSkillDiscoveryCacheKeyPart(parts.stableConnectionId),
		encodeSkillDiscoveryCacheKeyPart(parts.tmuxTarget),
	].join('.');
}

export function createSkillDiscoveryCache({
	storage,
	now = () => new Date().toISOString(),
}: {
	storage: SkillDiscoveryCacheStorage;
	now?: () => string;
}): SkillDiscoveryCache {
	const writeLastProject = (
		input: SkillDiscoveryCacheLastProject,
	): SkillDiscoveryCacheLastProject => {
		const record: SkillDiscoveryCacheLastProject = {
			version: SKILL_DISCOVERY_CACHE_VERSION,
			stableConnectionId: input.stableConnectionId,
			tmuxTarget: input.tmuxTarget,
			projectRoot: input.projectRoot,
			projectName: input.projectName,
			updatedAt: input.updatedAt,
		};
		storage.set(
			buildSkillDiscoveryLastProjectCacheKey(input),
			JSON.stringify(record),
		);
		return record;
	};

	return {
		read: (parts) => {
			const key = buildSkillDiscoveryCacheKey(parts);
			const serialized = storage.getString(key);
			if (serialized === undefined) return null;

			const record = parseSkillDiscoveryCacheRecord(serialized);
			if (!record) {
				storage.delete(key);
				return null;
			}

			return record;
		},
		readLastProject: (parts) => {
			const key = buildSkillDiscoveryLastProjectCacheKey(parts);
			const serialized = storage.getString(key);
			if (serialized === undefined) return null;

			const record = parseSkillDiscoveryCacheLastProject(serialized);
			if (!record) {
				storage.delete(key);
				return null;
			}

			return record;
		},
		writeLastProject,
		write: (input) => {
			const updatedAt = now();
			const record: SkillDiscoveryCacheRecord = {
				version: SKILL_DISCOVERY_CACHE_VERSION,
				stableConnectionId: input.stableConnectionId,
				tmuxTarget: input.tmuxTarget,
				projectRoot: input.projectRoot,
				projectName: input.projectName,
				skills: input.skills.map((skill) => ({ ...skill })),
				updatedAt,
			};
			storage.set(buildSkillDiscoveryCacheKey(input), JSON.stringify(record));
			writeLastProject(record);
			return record;
		},
		delete: (parts) => {
			storage.delete(buildSkillDiscoveryCacheKey(parts));
		},
	};
}

function parseSkillDiscoveryCacheLastProject(
	serialized: string,
): SkillDiscoveryCacheLastProject | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(serialized);
	} catch {
		return null;
	}

	if (!isPlainObject(parsed)) return null;

	if (
		parsed.version !== SKILL_DISCOVERY_CACHE_VERSION ||
		typeof parsed.stableConnectionId !== 'string' ||
		typeof parsed.tmuxTarget !== 'string' ||
		typeof parsed.projectRoot !== 'string' ||
		typeof parsed.projectName !== 'string' ||
		typeof parsed.updatedAt !== 'string'
	) {
		return null;
	}

	return {
		version: SKILL_DISCOVERY_CACHE_VERSION,
		stableConnectionId: parsed.stableConnectionId,
		tmuxTarget: parsed.tmuxTarget,
		projectRoot: parsed.projectRoot,
		projectName: parsed.projectName,
		updatedAt: parsed.updatedAt,
	};
}

function parseSkillDiscoveryCacheRecord(
	serialized: string,
): SkillDiscoveryCacheRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(serialized);
	} catch {
		return null;
	}

	if (!isPlainObject(parsed)) return null;

	if (
		parsed.version !== SKILL_DISCOVERY_CACHE_VERSION ||
		typeof parsed.stableConnectionId !== 'string' ||
		typeof parsed.tmuxTarget !== 'string' ||
		typeof parsed.projectRoot !== 'string' ||
		typeof parsed.projectName !== 'string' ||
		typeof parsed.updatedAt !== 'string' ||
		!Array.isArray(parsed.skills) ||
		!parsed.skills.every(isDiscoveredSkillLike)
	) {
		return null;
	}

	return {
		version: SKILL_DISCOVERY_CACHE_VERSION,
		stableConnectionId: parsed.stableConnectionId,
		tmuxTarget: parsed.tmuxTarget,
		projectRoot: parsed.projectRoot,
		projectName: parsed.projectName,
		skills: parsed.skills,
		updatedAt: parsed.updatedAt,
	};
}

function isDiscoveredSkillLike(value: unknown): value is DiscoveredSkill {
	return (
		isPlainObject(value) &&
		typeof value.name === 'string' &&
		typeof value.path === 'string' &&
		(typeof value.description === 'string' || value.description === null)
	);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function encodeSkillDiscoveryCacheKeyPart(value: string): string {
	return encodeURIComponent(value).replaceAll('.', '%2E');
}
