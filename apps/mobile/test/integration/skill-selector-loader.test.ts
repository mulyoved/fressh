import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildSkillDiscoveryCommand,
	buildSkillProjectCommand,
	type DiscoveredSkill,
} from '../../src/lib/skill-discovery';
import {
	createSkillDiscoveryCache,
	type SkillDiscoveryCacheStorage,
} from '../../src/lib/skill-discovery-cache';
import { loadSkillSelectorProject } from '../../src/lib/skill-selector-loader';

const stableConnectionId = 'connection-1';
const tmuxTarget = 'session:1.2';
const panePath = '/repo/apps/mobile';
const projectRoot = '/repo';
const projectName = 'repo';
const projectCommand = buildSkillProjectCommand(panePath);
const discoveryCommand = buildSkillDiscoveryCommand(panePath);

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

void test('loadSkillSelectorProject returns cached skills without running discovery when cache exists and forceRefresh is false', async () => {
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

	assert.equal(commands.length, 1);
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
