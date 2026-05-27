import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildSkillDiscoveryCommand,
	buildSkillProjectCommand,
	type DiscoveredSkill,
} from '../../src/lib/skill-discovery';
import {
	SKILL_DISCOVERY_CACHE_VERSION,
	createSkillDiscoveryCache,
	type SkillDiscoveryCacheStorage,
} from '../../src/lib/skill-discovery-cache';
import { loadSkillSelectorProject } from '../../src/lib/skill-selector-loader';
import {
	buildTmuxPaneProjectCommand,
	parseTmuxProjectMetadataOutput,
	type TmuxProjectMetadata,
} from '../../src/lib/tmux-project-metadata';

const stableConnectionId = 'connection-1';
const tmuxTarget = 'session:1.2';
const panePath = '/repo/apps/mobile';
const resolvedPanePath = '/repo/apps/mobile-from-resolver';
const projectRoot = '/repo';
const projectName = 'repo';
const staleProjectRoot = '/repo-stale';
const currentProjectRoot = '/repo-current';
const currentProjectName = 'repo-current';
const projectCommand = buildSkillProjectCommand(panePath);
const resolvedProjectCommand = buildSkillProjectCommand(resolvedPanePath);
const discoveryCommand = buildSkillDiscoveryCommand(panePath);
const resolvedDiscoveryCommand = buildSkillDiscoveryCommand(resolvedPanePath);
const tmuxProjectCommand = buildTmuxPaneProjectCommand(tmuxTarget);

const cachedSkills: DiscoveredSkill[] = [
	{
		name: 'cached-skill',
		path: '/repo/.codex/skills/cached-skill/SKILL.md',
		description: 'Cached skill.',
	},
];

const discoveredSkills: DiscoveredSkill[] = [
	{
		name: 'remote-skill',
		path: '/repo/.codex/skills/remote-skill/SKILL.md',
		description: 'Remote skill.',
	},
];

const currentProjectSkills: DiscoveredSkill[] = [
	{
		name: 'current-skill',
		path: '/repo-current/.codex/skills/current-skill/SKILL.md',
		description: 'Current project skill.',
	},
];

const tmuxProjectMetadata: TmuxProjectMetadata = {
	sessionName: 'session',
	windowId: '@3',
	windowIndex: 3,
	windowName: 'mobile',
	paneId: '%12',
	panePath,
	projectRoot,
	projectName,
};

function createMemoryStorage(initialEntries?: Record<string, string>) {
	const entries = new Map(Object.entries(initialEntries ?? {}));
	const storage: SkillDiscoveryCacheStorage = {
		getString: (key) => entries.get(key),
		set: (key, value) => {
			entries.set(key, value);
		},
		delete: (key) => {
			entries.delete(key);
		},
	};
	return { entries, storage };
}

function createCommandRunner(outputs: Record<string, string>) {
	const commands: string[] = [];
	return {
		commands,
		runCommand: async (command: string) => {
			commands.push(command);
			const output = outputs[command];
			if (output === undefined) {
				throw new Error(`Unexpected command: ${command}`);
			}
			return output;
		},
	};
}

function createDiscoveryOutput(skills: DiscoveredSkill[]) {
	return JSON.stringify({
		projectRoot,
		records: skills.map((skill) => ({
			path: skill.path,
			content: [
				'---',
				`name: ${skill.name}`,
				skill.description === null
					? undefined
					: `description: ${skill.description}`,
				'---',
				'',
				`# ${skill.name}`,
			]
				.filter((line): line is string => line !== undefined)
				.join('\n'),
		})),
	});
}

void test('loadSkillSelectorProject returns cached skills after resolving the current project when forceRefresh is false', async () => {
	const { storage } = createMemoryStorage();
	const cache = createSkillDiscoveryCache({
		storage,
		now: () => '2026-05-26T12:00:00.000Z',
	});
	const cachedRecord = cache.write({
		stableConnectionId,
		tmuxTarget,
		projectRoot,
		projectName,
		skills: cachedSkills,
	});
	const { commands, runCommand } = createCommandRunner({
		[projectCommand]: JSON.stringify({ projectRoot }),
	});

	const result = await loadSkillSelectorProject({
		cache,
		stableConnectionId,
		tmuxTarget,
		panePath,
		runCommand,
		forceRefresh: false,
	});

	assert.deepEqual(commands, [projectCommand]);
	assert.deepEqual(result, {
		source: 'cache',
		projectRoot,
		projectName,
		skills: cachedSkills,
		updatedAt: cachedRecord.updatedAt,
		cacheRecord: cachedRecord,
	});
});

void test('loadSkillSelectorProject returns cached skills without remote commands when trusted metadata and cache exist', async () => {
	const { storage } = createMemoryStorage();
	const cache = createSkillDiscoveryCache({
		storage,
		now: () => '2026-05-26T12:05:00.000Z',
	});
	const cachedRecord = cache.write({
		stableConnectionId,
		tmuxTarget,
		projectRoot,
		projectName,
		skills: cachedSkills,
	});
	const { commands, runCommand } = createCommandRunner({});

	const result = await loadSkillSelectorProject({
		cache,
		stableConnectionId,
		tmuxTarget,
		projectMetadata: tmuxProjectMetadata,
		runCommand,
		forceRefresh: false,
	});

	assert.deepEqual(commands, []);
	assert.deepEqual(result, {
		source: 'cache',
		projectRoot,
		projectName,
		skills: cachedSkills,
		updatedAt: cachedRecord.updatedAt,
		cacheRecord: cachedRecord,
	});
});

void test('loadSkillSelectorProject resolves mdev metadata before reading cache when trusted metadata is missing', async () => {
	const { storage } = createMemoryStorage();
	const cache = createSkillDiscoveryCache({
		storage,
		now: () => '2026-05-26T12:10:00.000Z',
	});
	const cachedRecord = cache.write({
		stableConnectionId,
		tmuxTarget,
		projectRoot,
		projectName,
		skills: cachedSkills,
	});
	const { commands, runCommand } = createCommandRunner({
		[tmuxProjectCommand]: JSON.stringify(tmuxProjectMetadata),
	});

	const result = await loadSkillSelectorProject({
		cache,
		stableConnectionId,
		tmuxTarget,
		resolveProjectMetadata: async () => {
			const metadata = parseTmuxProjectMetadataOutput(
				await runCommand(tmuxProjectCommand),
			);
			if (!metadata) throw new Error('Invalid mdev metadata');
			return metadata;
		},
		runCommand,
		forceRefresh: false,
	});

	assert.deepEqual(commands, [tmuxProjectCommand]);
	assert.deepEqual(result, {
		source: 'cache',
		projectRoot,
		projectName,
		skills: cachedSkills,
		updatedAt: cachedRecord.updatedAt,
		cacheRecord: cachedRecord,
	});
});

void test('loadSkillSelectorProject runs discovery from trusted metadata when cache is missing', async () => {
	const { storage } = createMemoryStorage();
	const cache = createSkillDiscoveryCache({
		storage,
		now: () => '2026-05-26T12:12:00.000Z',
	});
	const { commands, runCommand } = createCommandRunner({
		[discoveryCommand]: createDiscoveryOutput(discoveredSkills),
	});

	const result = await loadSkillSelectorProject({
		cache,
		stableConnectionId,
		tmuxTarget,
		projectMetadata: tmuxProjectMetadata,
		runCommand,
		forceRefresh: false,
	});

	assert.deepEqual(commands, [discoveryCommand]);
	assert.equal(result.source, 'remote');
	assert.equal(result.projectRoot, projectRoot);
	assert.equal(result.projectName, projectName);
	assert.deepEqual(result.skills, discoveredSkills);
});

void test('loadSkillSelectorProject checks the current project before reading cached skills', async () => {
	const { storage } = createMemoryStorage();
	const cache = createSkillDiscoveryCache({
		storage,
		now: () => '2026-05-26T12:15:00.000Z',
	});
	cache.write({
		stableConnectionId,
		tmuxTarget,
		projectRoot: currentProjectRoot,
		projectName: currentProjectName,
		skills: currentProjectSkills,
	});
	cache.write({
		stableConnectionId,
		tmuxTarget,
		projectRoot: staleProjectRoot,
		projectName: 'repo-stale',
		skills: cachedSkills,
	});
	const { commands, runCommand } = createCommandRunner({
		[projectCommand]: JSON.stringify({ projectRoot: currentProjectRoot }),
	});

	const result = await loadSkillSelectorProject({
		cache,
		stableConnectionId,
		tmuxTarget,
		panePath,
		runCommand,
		forceRefresh: false,
	});

	assert.deepEqual(commands, [projectCommand]);
	assert.deepEqual(result, {
		source: 'cache',
		projectRoot: currentProjectRoot,
		projectName: currentProjectName,
		skills: currentProjectSkills,
		updatedAt: '2026-05-26T12:15:00.000Z',
		cacheRecord: {
			version: SKILL_DISCOVERY_CACHE_VERSION,
			stableConnectionId,
			tmuxTarget,
			projectRoot: currentProjectRoot,
			projectName: currentProjectName,
			skills: currentProjectSkills,
			updatedAt: '2026-05-26T12:15:00.000Z',
		},
	});
});

void test('loadSkillSelectorProject resolves pane path before loading project cache', async () => {
	const { storage } = createMemoryStorage();
	const cache = createSkillDiscoveryCache({
		storage,
		now: () => '2026-05-26T12:30:00.000Z',
	});
	const { commands, runCommand } = createCommandRunner({
		[resolvedProjectCommand]: JSON.stringify({ projectRoot }),
		[resolvedDiscoveryCommand]: createDiscoveryOutput(discoveredSkills),
	});

	const result = await loadSkillSelectorProject({
		cache,
		stableConnectionId,
		tmuxTarget,
		runCommand,
		forceRefresh: false,
		resolvePanePath: async () => resolvedPanePath,
	});

	assert.deepEqual(commands, [
		resolvedProjectCommand,
		resolvedDiscoveryCommand,
	]);
	assert.equal(result.source, 'remote');
	assert.deepEqual(result.skills, discoveredSkills);
});

void test('loadSkillSelectorProject runs project resolution then discovery and writes cache on cache miss', async () => {
	const { storage } = createMemoryStorage();
	const cache = createSkillDiscoveryCache({
		storage,
		now: () => '2026-05-26T13:00:00.000Z',
	});
	const { commands, runCommand } = createCommandRunner({
		[projectCommand]: JSON.stringify({ projectRoot }),
		[discoveryCommand]: createDiscoveryOutput(discoveredSkills),
	});

	const result = await loadSkillSelectorProject({
		cache,
		stableConnectionId,
		tmuxTarget,
		panePath,
		runCommand,
		forceRefresh: false,
	});

	assert.deepEqual(commands, [projectCommand, discoveryCommand]);
	assert.equal(result.source, 'remote');
	assert.equal(result.projectRoot, projectRoot);
	assert.equal(result.projectName, projectName);
	assert.deepEqual(result.skills, discoveredSkills);
	assert.equal(result.updatedAt, '2026-05-26T13:00:00.000Z');
	assert.deepEqual(result.cacheRecord, {
		version: 1,
		stableConnectionId,
		tmuxTarget,
		projectRoot,
		projectName,
		skills: discoveredSkills,
		updatedAt: '2026-05-26T13:00:00.000Z',
	});
	assert.deepEqual(
		cache.read({ stableConnectionId, tmuxTarget, projectRoot }),
		result.cacheRecord,
	);
});

void test('loadSkillSelectorProject ignores existing cache and replaces it when forceRefresh is true', async () => {
	const { storage } = createMemoryStorage();
	const cache = createSkillDiscoveryCache({
		storage,
		now: () => '2026-05-26T14:00:00.000Z',
	});
	cache.write({
		stableConnectionId,
		tmuxTarget,
		projectRoot,
		projectName,
		skills: cachedSkills,
	});
	const { commands, runCommand } = createCommandRunner({
		[projectCommand]: JSON.stringify({ projectRoot }),
		[discoveryCommand]: createDiscoveryOutput(discoveredSkills),
	});

	const result = await loadSkillSelectorProject({
		cache,
		stableConnectionId,
		tmuxTarget,
		panePath,
		runCommand,
		forceRefresh: true,
	});

	assert.deepEqual(commands, [projectCommand, discoveryCommand]);
	assert.equal(result.source, 'remote');
	assert.deepEqual(result.skills, discoveredSkills);
	assert.equal(result.updatedAt, '2026-05-26T14:00:00.000Z');
	assert.deepEqual(
		cache.read({ stableConnectionId, tmuxTarget, projectRoot }),
		result.cacheRecord,
	);
	assert.notDeepEqual(result.cacheRecord?.skills, cachedSkills);
});

void test('loadSkillSelectorProject preserves existing cache when forced refresh discovery fails', async () => {
	const { storage } = createMemoryStorage();
	const cache = createSkillDiscoveryCache({
		storage,
		now: () => '2026-05-26T15:00:00.000Z',
	});
	const cachedRecord = cache.write({
		stableConnectionId,
		tmuxTarget,
		projectRoot,
		projectName,
		skills: cachedSkills,
	});
	const { commands, runCommand } = createCommandRunner({
		[projectCommand]: JSON.stringify({ projectRoot }),
	});

	await assert.rejects(
		loadSkillSelectorProject({
			cache,
			stableConnectionId,
			tmuxTarget,
			panePath,
			runCommand,
			forceRefresh: true,
		}),
		/Unexpected command/,
	);

	assert.deepEqual(commands, [projectCommand, discoveryCommand]);
	assert.deepEqual(
		cache.read({ stableConnectionId, tmuxTarget, projectRoot }),
		cachedRecord,
	);
});
