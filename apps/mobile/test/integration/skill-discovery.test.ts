import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
	buildSkillDiscoveryCommand,
	buildSkillProjectCommand,
	filterDiscoveredSkills,
	getSkillProjectName,
	parseSkillDiscoveryOutput,
	parseSkillDiscoveryResult,
	parseSkillProjectOutput,
} from '../../src/lib/skill-discovery';

const execFileAsync = promisify(execFile);

const discoveryPayload = JSON.stringify([
	{
		path: '/repo/.codex/skills/brainstorming/SKILL.md',
		content:
			'---\nname: brainstorming\ndescription: Explore requirements before implementation.\n---\n\n# Brainstorming\n',
	},
	{
		path: '/repo/.codex/skills/expo-deployment/SKILL.md',
		content:
			'---\ndescription: Deploy Expo apps to stores and web.\n---\n\n# Deployment\n',
	},
	{
		path: '/repo/.codex/skills/quoted/SKILL.md',
		content:
			'---\nname: "quoted-skill"\ndescription: "Quoted description"\n---\n',
	},
	{
		path: '/repo/.codex/skills/broken/SKILL.md',
		content: 'not frontmatter',
	},
	{
		path: '/repo/.agents/skills/ignored/SKILL.md',
		content: '---\nname: ignored\n---\n',
	},
]);

void test('parseSkillDiscoveryOutput reads skill frontmatter and falls back to directory names', () => {
	assert.deepEqual(parseSkillDiscoveryOutput(discoveryPayload), [
		{
			name: 'brainstorming',
			directoryName: 'brainstorming',
			path: '/repo/.codex/skills/brainstorming/SKILL.md',
			description: 'Explore requirements before implementation.',
		},
		{
			name: 'broken',
			directoryName: 'broken',
			path: '/repo/.codex/skills/broken/SKILL.md',
			description: null,
		},
		{
			name: 'expo-deployment',
			directoryName: 'expo-deployment',
			path: '/repo/.codex/skills/expo-deployment/SKILL.md',
			description: 'Deploy Expo apps to stores and web.',
		},
		{
			name: 'ignored',
			directoryName: 'ignored',
			path: '/repo/.agents/skills/ignored/SKILL.md',
			description: null,
		},
		{
			name: 'quoted-skill',
			directoryName: 'quoted',
			path: '/repo/.codex/skills/quoted/SKILL.md',
			description: 'Quoted description',
		},
	]);
});

void test('parseSkillDiscoveryOutput treats empty and malformed command output as no skills', () => {
	assert.deepEqual(parseSkillDiscoveryOutput(''), []);
	assert.deepEqual(parseSkillDiscoveryOutput('not json'), []);
	assert.deepEqual(
		parseSkillDiscoveryOutput(JSON.stringify({ path: 'nope' })),
		[],
	);
});

void test('parseSkillDiscoveryOutput tolerates leading terminal control output', () => {
	const output = `\u001b[?2004h${discoveryPayload}`;

	assert.deepEqual(parseSkillDiscoveryOutput(output), [
		{
			name: 'brainstorming',
			directoryName: 'brainstorming',
			path: '/repo/.codex/skills/brainstorming/SKILL.md',
			description: 'Explore requirements before implementation.',
		},
		{
			name: 'broken',
			directoryName: 'broken',
			path: '/repo/.codex/skills/broken/SKILL.md',
			description: null,
		},
		{
			name: 'expo-deployment',
			directoryName: 'expo-deployment',
			path: '/repo/.codex/skills/expo-deployment/SKILL.md',
			description: 'Deploy Expo apps to stores and web.',
		},
		{
			name: 'ignored',
			directoryName: 'ignored',
			path: '/repo/.agents/skills/ignored/SKILL.md',
			description: null,
		},
		{
			name: 'quoted-skill',
			directoryName: 'quoted',
			path: '/repo/.codex/skills/quoted/SKILL.md',
			description: 'Quoted description',
		},
	]);
});

void test('parseSkillDiscoveryResult reads project metadata and skills', () => {
	const output = JSON.stringify({
		projectRoot: '/repo',
		records: [
			{
				path: '/repo/.codex/skills/cache/SKILL.md',
				content:
					'---\nname: cache-skill\ndescription: Cached skill.\n---\n\n# Cache\n',
			},
		],
	});

	assert.deepEqual(parseSkillDiscoveryResult(output), {
		projectRoot: '/repo',
		projectName: 'repo',
		skills: [
			{
				name: 'cache-skill',
				directoryName: 'cache',
				path: '/repo/.codex/skills/cache/SKILL.md',
				description: 'Cached skill.',
			},
		],
	});
});

void test('parseSkillDiscoveryOutput deduplicates skills by command name and keeps the preferred source', () => {
	const output = JSON.stringify([
		{
			path: '/repo/.claude/skills/duplicate/SKILL.md',
			content:
				'---\nname: shared-skill\ndescription: Claude copy.\n---\n\n# Shared\n',
		},
		{
			path: '/repo/.codex/skills/duplicate-file/SKILL.md',
			content:
				'---\nname: shared-skill\ndescription: Codex copy.\n---\n\n# Shared\n',
		},
		{
			path: '/repo/.agents/skills/duplicate-agent/SKILL.md',
			content:
				'---\nname: shared-skill\ndescription: Agent copy.\n---\n\n# Shared\n',
		},
		{
			path: '/repo/.codex/skills/unique-folder/SKILL.md',
			content:
				'---\nname: unique-skill\ndescription: Unique skill.\n---\n\n# Unique\n',
		},
	]);

	assert.deepEqual(parseSkillDiscoveryOutput(output), [
		{
			name: 'shared-skill',
			directoryName: 'duplicate-agent',
			path: '/repo/.agents/skills/duplicate-agent/SKILL.md',
			description: 'Agent copy.',
		},
		{
			name: 'unique-skill',
			directoryName: 'unique-folder',
			path: '/repo/.codex/skills/unique-folder/SKILL.md',
			description: 'Unique skill.',
		},
	]);
});

void test('parseSkillProjectOutput tolerates leading terminal control output', () => {
	const output = `\u001b[?2004h${JSON.stringify({ projectRoot: '/repo' })}`;

	assert.deepEqual(parseSkillProjectOutput(output), {
		projectRoot: '/repo',
		projectName: 'repo',
	});
});

void test('getSkillProjectName handles root and normal paths', () => {
	assert.equal(getSkillProjectName('/home/muly/fressh'), 'fressh');
	assert.equal(getSkillProjectName('/'), '/');
});

void test('filterDiscoveredSkills matches names and descriptions', () => {
	const skills = parseSkillDiscoveryOutput(discoveryPayload);

	assert.deepEqual(
		filterDiscoveredSkills(skills, 'expo').map((skill) => skill.name),
		['expo-deployment'],
	);
	assert.deepEqual(
		filterDiscoveredSkills(skills, 'requirements').map((skill) => skill.name),
		['brainstorming'],
	);
	assert.deepEqual(
		filterDiscoveredSkills(skills, 'quoted').map((skill) => skill.name),
		['quoted-skill'],
	);
	assert.deepEqual(
		filterDiscoveredSkills(skills, '').map((skill) => skill.name),
		['brainstorming', 'broken', 'expo-deployment', 'ignored', 'quoted-skill'],
	);
});

void test('filterDiscoveredSkills ranks skill name matches before description matches', () => {
	const skills = [
		{
			name: 'aaa',
			path: '/repo/.codex/skills/aaa/SKILL.md',
			description: 'git helper',
		},
		{
			name: 'git-alias',
			path: '/repo/.codex/skills/git-alias/SKILL.md',
			description: 'Alias helper',
		},
		{
			name: 'parse-git',
			path: '/repo/.codex/skills/parse-git/SKILL.md',
			description: 'Parser helper',
		},
		{
			name: 'description-prefix',
			path: '/repo/.codex/skills/description-prefix/SKILL.md',
			description: 'git prefix helper',
		},
		{
			name: 'description-substring',
			path: '/repo/.codex/skills/description-substring/SKILL.md',
			description: 'helper for git',
		},
		{
			name: 'git',
			path: '/repo/.codex/skills/git/SKILL.md',
			description: 'Version control helper',
		},
		{
			name: 'aardvark-git',
			path: '/repo/.codex/skills/aardvark-git/SKILL.md',
			description: 'Name substring tie-breaker',
		},
	];

	assert.deepEqual(
		filterDiscoveredSkills(skills, 'git').map((skill) => skill.name),
		[
			'git',
			'git-alias',
			'aardvark-git',
			'parse-git',
			'aaa',
			'description-prefix',
			'description-substring',
		],
	);
});

void test('buildSkillDiscoveryCommand scopes discovery to repo-local skill roots', () => {
	const command = buildSkillDiscoveryCommand("/tmp/repo with ' quote");

	assert.match(command, /python3 -c/);
	assert.match(command, /\.codex/);
	assert.match(command, /\.agents/);
	assert.match(command, /\.claude/);
	assert.match(command, /skills/);
	assert.match(command, /SKILL\.md/);
	assert.match(command, /errors='\\''replace'\\''/);
	assert.doesNotMatch(command, /plugins/);
	assert.doesNotMatch(command, /<<'PY'/);
	assert.doesNotMatch(command, /\r?\n/);
	assert.match(command, /'\/tmp\/repo with '\\'' quote'/);
});

void test('buildSkillProjectCommand resolves the git root and project name', async () => {
	const tempRepo = await mkdtemp(join(tmpdir(), 'skill-project-'));
	try {
		await execFileAsync('git', ['init'], { cwd: tempRepo });
		const nestedCwd = join(tempRepo, 'apps', 'mobile');
		await mkdir(nestedCwd, { recursive: true });

		const { stdout } = await execFileAsync('sh', [
			'-lc',
			buildSkillProjectCommand(nestedCwd),
		]);
		const expectedProjectName = tempRepo.split('/').at(-1) || tempRepo;

		assert.deepEqual(parseSkillProjectOutput(stdout), {
			projectRoot: tempRepo,
			projectName: expectedProjectName,
		});
	} finally {
		await rm(tempRepo, { recursive: true, force: true });
	}
});

void test('buildSkillDiscoveryCommand executes and discovers repo-local skill roots', async () => {
	const tempRepo = await mkdtemp(join(tmpdir(), 'skill-discovery-'));
	try {
		const codexSkill = join(tempRepo, '.codex', 'skills', 'codex', 'SKILL.md');
		const agentSkill = join(tempRepo, '.agents', 'skills', 'agent', 'SKILL.md');
		const claudeSkill = join(
			tempRepo,
			'.claude',
			'skills',
			'claude',
			'SKILL.md',
		);
		const ignoredNestedSkill = join(
			tempRepo,
			'.codex',
			'skills',
			'nested',
			'deeper',
			'SKILL.md',
		);

		await mkdir(join(tempRepo, '.codex', 'skills', 'codex'), {
			recursive: true,
		});
		await mkdir(join(tempRepo, '.agents', 'skills', 'agent'), {
			recursive: true,
		});
		await mkdir(join(tempRepo, '.claude', 'skills', 'claude'), {
			recursive: true,
		});
		await mkdir(join(tempRepo, '.codex', 'skills', 'nested', 'deeper'), {
			recursive: true,
		});
		await writeFile(
			codexSkill,
			Buffer.concat([
				Buffer.from('---\nname: codex\ndescription: codex '),
				Buffer.from([0xff]),
				Buffer.from('\n---\n# Demo\n'),
			]),
		);
		await writeFile(
			agentSkill,
			'---\nname: agent\ndescription: agent skill\n---\n',
		);
		await writeFile(
			claudeSkill,
			'---\nname: claude\ndescription: claude skill\n---\n',
		);
		await writeFile(
			ignoredNestedSkill,
			'---\nname: ignored-nested\ndescription: ignored\n---\n',
		);

		const { stdout } = await execFileAsync(
			'bash',
			['-lc', buildSkillDiscoveryCommand(tempRepo)],
			{ cwd: tempRepo },
		);

		const skills = parseSkillDiscoveryOutput(stdout);
		assert.deepEqual(skills, [
			{
				name: 'agent',
				directoryName: 'agent',
				path: agentSkill,
				description: 'agent skill',
			},
			{
				name: 'claude',
				directoryName: 'claude',
				path: claudeSkill,
				description: 'claude skill',
			},
			{
				name: 'codex',
				directoryName: 'codex',
				path: codexSkill,
				description: 'codex \ufffd',
			},
		]);
	} finally {
		await rm(tempRepo, { recursive: true, force: true });
	}
});

void test('buildSkillDiscoveryCommand resolves skills from a git repo root', async () => {
	const tempRepo = await mkdtemp(join(tmpdir(), 'skill-discovery-git-root-'));
	try {
		const nestedCwd = join(tempRepo, 'apps', 'mobile');
		const demoSkill = join(tempRepo, '.codex', 'skills', 'demo', 'SKILL.md');
		await mkdir(nestedCwd, { recursive: true });
		await mkdir(join(tempRepo, '.codex', 'skills', 'demo'), {
			recursive: true,
		});
		await execFileAsync('git', ['init'], { cwd: tempRepo });
		await writeFile(
			demoSkill,
			'---\nname: demo\ndescription: repo root\n---\n# Demo\n',
		);

		const { stdout } = await execFileAsync(
			'bash',
			['-lc', buildSkillDiscoveryCommand(nestedCwd)],
			{ cwd: nestedCwd },
		);

		assert.deepEqual(parseSkillDiscoveryOutput(stdout), [
			{
				name: 'demo',
				directoryName: 'demo',
				path: demoSkill,
				description: 'repo root',
			},
		]);
	} finally {
		await rm(tempRepo, { recursive: true, force: true });
	}
});

void test('buildSkillDiscoveryCommand falls back to cwd when git is unavailable', async () => {
	const tempRepo = await mkdtemp(join(tmpdir(), 'skill-discovery-no-git-'));
	const tempBin = await mkdtemp(join(tmpdir(), 'skill-discovery-bin-'));
	try {
		const demoSkill = join(tempRepo, '.codex', 'skills', 'demo', 'SKILL.md');
		await mkdir(join(tempRepo, '.codex', 'skills', 'demo'), {
			recursive: true,
		});
		await writeFile(
			demoSkill,
			'---\nname: demo\ndescription: no git\n---\n# Demo\n',
		);

		await writeFile(
			join(tempBin, 'python3'),
			'#!/bin/sh\nexec /usr/bin/python3 "$@"\n',
			{
				mode: 0o755,
			},
		);

		await execFileAsync('/bin/bash', ['-c', '! command -v git'], {
			env: { ...process.env, PATH: tempBin },
		});

		const { stdout } = await execFileAsync(
			'/bin/bash',
			['-c', buildSkillDiscoveryCommand(tempRepo)],
			{ cwd: tempRepo, env: { ...process.env, PATH: tempBin } },
		);

		assert.deepEqual(parseSkillDiscoveryOutput(stdout), [
			{
				name: 'demo',
				directoryName: 'demo',
				path: demoSkill,
				description: 'no git',
			},
		]);
	} finally {
		await rm(tempRepo, { recursive: true, force: true });
		await rm(tempBin, { recursive: true, force: true });
	}
});

void test('buildSkillDiscoveryCommand discovers direct child repos from a home pane', async () => {
	const tempHome = await mkdtemp(join(tmpdir(), 'skill-discovery-home-'));
	try {
		const childRepo = join(tempHome, 'fressh');
		const demoSkill = join(
			childRepo,
			'.agents',
			'skills',
			'home-child',
			'SKILL.md',
		);
		await mkdir(join(childRepo, '.agents', 'skills', 'home-child'), {
			recursive: true,
		});
		await execFileAsync('git', ['init'], { cwd: childRepo });
		await writeFile(
			demoSkill,
			'---\nname: home-child\ndescription: child repo skill\n---\n# Demo\n',
		);

		const { stdout } = await execFileAsync(
			'bash',
			['-lc', buildSkillDiscoveryCommand(tempHome)],
			{ cwd: tempHome, env: { ...process.env, HOME: tempHome } },
		);

		assert.deepEqual(parseSkillDiscoveryOutput(stdout), [
			{
				name: 'home-child',
				directoryName: 'home-child',
				path: demoSkill,
				description: 'child repo skill',
			},
		]);
	} finally {
		await rm(tempHome, { recursive: true, force: true });
	}
});

void test('buildSkillDiscoveryCommand works with side-channel completion suffix', async () => {
	const tempRepo = await mkdtemp(
		join(tmpdir(), 'skill-discovery-side-channel-'),
	);
	try {
		const demoSkill = join(tempRepo, '.codex', 'skills', 'demo', 'SKILL.md');
		await mkdir(join(tempRepo, '.codex', 'skills', 'demo'), {
			recursive: true,
		});
		await writeFile(
			demoSkill,
			'---\nname: demo\ndescription: side channel\n---\n# Demo\n',
		);

		const marker = '__SIDE_CHANNEL_TEST_DONE__';
		const command = `${buildSkillDiscoveryCommand(tempRepo)}; __EC__=$?; echo "${marker}"; echo "EXIT_CODE:$__EC__"`;
		const { stdout } = await execFileAsync('bash', ['-lc', command], {
			cwd: tempRepo,
		});
		const sideChannelOutput = `${command}\n${stdout}`;
		const sideChannelLines = sideChannelOutput.trim().split(/\r?\n/);
		const markerLineIndex = sideChannelLines.findIndex(
			(line) => line.trim() === marker,
		);
		const cleanOutput = sideChannelLines
			.slice(1, markerLineIndex)
			.join('\n')
			.trim();
		const exitCode = sideChannelOutput.match(/EXIT_CODE:(\d+)/)?.[0];

		assert.ok(markerLineIndex > 0);
		assert.equal(exitCode, 'EXIT_CODE:0');
		assert.deepEqual(parseSkillDiscoveryOutput(cleanOutput), [
			{
				name: 'demo',
				directoryName: 'demo',
				path: demoSkill,
				description: 'side channel',
			},
		]);
	} finally {
		await rm(tempRepo, { recursive: true, force: true });
	}
});
