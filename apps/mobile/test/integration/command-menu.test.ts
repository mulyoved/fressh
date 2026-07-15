import assert from 'node:assert/strict';
import test from 'node:test';
import {
	type CommandMenuEntry,
	type CommandPreset,
	getBundledShellConfig,
} from '../../src/lib/shell-config';

type CommandTreeNode = {
	label: string;
	type: CommandMenuEntry['type'];
	children?: CommandTreeNode[];
};

function commandTree(entries: CommandMenuEntry[]): CommandTreeNode[] {
	return entries.map((entry) => {
		if (entry.type !== 'submenu') {
			return { label: entry.label, type: entry.type };
		}
		return {
			label: entry.label,
			type: entry.type,
			children: commandTree(entry.entries),
		};
	});
}

function findEntry(
	entries: CommandMenuEntry[],
	path: readonly string[],
): CommandMenuEntry {
	const [head, ...tail] = path;
	assert.ok(head);
	const entry = entries.find((candidate) => candidate.label === head);
	assert.ok(entry, `Missing command menu entry ${path.join(' > ')}`);
	if (tail.length === 0) {
		return entry;
	}
	assert.equal(entry.type, 'submenu');
	return findEntry(entry.entries, tail);
}

function findPreset(
	entries: CommandMenuEntry[],
	path: readonly string[],
): CommandPreset {
	const entry = findEntry(entries, path);
	assert.equal(entry.type, 'preset');
	return entry;
}

void test('bundled command menu exposes the approved Issue 91 tree', () => {
	assert.deepEqual(commandTree(getBundledShellConfig().commandMenus), [
		{ label: '/new', type: 'preset' },
		{ label: '/compact', type: 'preset' },
		{
			label: 'superpower',
			type: 'submenu',
			children: [
				{ label: '$test-driven-development', type: 'preset' },
				{ label: '$systematic-debugging', type: 'preset' },
				{ label: '$verification-before-completion', type: 'preset' },
				{ label: '$brainstorming', type: 'preset' },
				{ label: '$writing-plans', type: 'preset' },
				{ label: '$executing-plans', type: 'preset' },
				{ label: '$dispatching-parallel-agents', type: 'preset' },
				{ label: '$subagent-driven-development', type: 'preset' },
				{ label: '$subagent-driven-development-ce1', type: 'preset' },
				{ label: '$requesting-code-review', type: 'preset' },
				{ label: '$receiving-code-review', type: 'preset' },
				{ label: '$finishing-a-development-branch', type: 'preset' },
				{ label: '$writing-skills', type: 'preset' },
				{ label: '$using-superpowers', type: 'preset' },
			],
		},
		{
			label: 'features',
			type: 'submenu',
			children: [
				{ label: '$work-on-bug', type: 'preset' },
				{ label: '$work-on-bug-reflect', type: 'preset' },
				{ label: '$work-on-issue', type: 'preset' },
				{ label: '$dev-work-on-commission-bug', type: 'preset' },
				{ label: '$work-step-by-step', type: 'preset' },
				{ label: '$tldr', type: 'preset' },
				{ label: '/rloop-review', type: 'preset' },
				{ label: '$oracle-ask', type: 'preset' },
			],
		},
		{
			label: 'Git',
			type: 'submenu',
			children: [
				{ label: '$git-pr', type: 'preset' },
				{ label: 'dev pull status', type: 'preset' },
				{ label: 'git checkout dev', type: 'preset' },
				{ label: 'git pull', type: 'preset' },
				{ label: 'git status', type: 'preset' },
				{ label: 'clear', type: 'preset' },
			],
		},
		{
			label: 'mdev',
			type: 'submenu',
			children: [
				{ label: 'Fit terminal to device', type: 'action' },
				{ label: 'New Worktree Workspace', type: 'action' },
				{ label: 'Close Worktree Workspace', type: 'action' },
				{ label: 'restart codex', type: 'bridge' },
				{
					label: 'Advanced',
					type: 'submenu',
					children: [
						{ label: 'codex auth refresh', type: 'preset' },
						{ label: 'Debug connection in Codex', type: 'action' },
						{ label: 'Open Workspace', type: 'preset' },
						{ label: 'Rename Workspace', type: 'preset' },
						{ label: 'Close Workspace', type: 'preset' },
						{ label: 'Request a Feature', type: 'action' },
					],
				},
			],
		},
		{
			label: 'core8',
			type: 'submenu',
			children: [
				{ label: 'yarn cq', type: 'preset' },
				{ label: 'yarn test:ci', type: 'preset' },
				{ label: 'core8 env fix', type: 'preset' },
				{ label: 'core8 jobs switch T0', type: 'preset' },
				{ label: 'core8 env switch staging', type: 'preset' },
			],
		},
	]);
});

void test('mdev Advanced submenu routes feature request through a native app action', () => {
	const commandMenus = getBundledShellConfig().commandMenus;

	assert.deepEqual(
		findEntry(commandMenus, ['mdev', 'Advanced', 'Request a Feature']),
		{
			type: 'action',
			label: 'Request a Feature',
			actionId: 'OPEN_REPO_FEATURE_REQUEST',
		},
	);
});

void test('mdev submenu exposes connection diagnostic action', () => {
	const commandMenus = getBundledShellConfig().commandMenus;

	assert.deepEqual(
		findEntry(commandMenus, ['mdev', 'Advanced', 'Debug connection in Codex']),
		{
			type: 'action',
			label: 'Debug connection in Codex',
			actionId: 'DEBUG_CONNECTION_IN_CODEX',
		},
	);
});

void test('mdev workspace presets run existing tmux workspace commands', () => {
	const commandMenus = getBundledShellConfig().commandMenus;

	assert.deepEqual(
		findPreset(commandMenus, ['mdev', 'Advanced', 'Open Workspace']),
		{
			type: 'preset',
			label: 'Open Workspace',
			steps: [
				{ type: 'text', data: 'mdev tmux open-workspace' },
				{ type: 'enter' },
			],
		},
	);
	assert.deepEqual(
		findPreset(commandMenus, ['mdev', 'Advanced', 'Close Workspace']),
		{
			type: 'preset',
			label: 'Close Workspace',
			steps: [
				{ type: 'text', data: 'mdev tmux workspace close' },
				{ type: 'enter' },
			],
		},
	);
	assert.deepEqual(
		findPreset(commandMenus, ['mdev', 'Advanced', 'Rename Workspace']),
		{
			type: 'preset',
			label: 'Rename Workspace',
			steps: [
				{ type: 'text', data: 'mdev tmux workspace prompt-rename' },
				{ type: 'enter' },
			],
		},
	);
});

void test('mdev keeps terminal fit and native worktree workspace actions first', () => {
	const commandMenus = getBundledShellConfig().commandMenus;
	const mdev = findEntry(commandMenus, ['mdev']);
	assert.equal(mdev.type, 'submenu');
	if (mdev.type !== 'submenu') return;

	assert.deepEqual(mdev.entries.slice(0, 3), [
		{
			type: 'action',
			label: 'Fit terminal to device',
			actionId: 'FIT_TERMINAL_TO_DEVICE',
		},
		{
			type: 'action',
			label: 'New Worktree Workspace',
			actionId: 'OPEN_NEW_WORKTREE_WORKSPACE',
		},
		{
			type: 'action',
			label: 'Close Worktree Workspace',
			actionId: 'OPEN_CLOSE_WORKTREE_WORKSPACE',
		},
	]);
});

void test('mdev codex entries expose auth refresh preset and bridge-backed restart', () => {
	const commandMenus = getBundledShellConfig().commandMenus;
	const mdev = commandMenus.find(
		(entry) => entry.type === 'submenu' && entry.label === 'mdev',
	);
	assert.ok(mdev);
	assert.equal(mdev.type, 'submenu');
	assert.equal(
		mdev.entries.some((entry) => entry.label === 'codex auth refresh new'),
		false,
	);

	assert.equal(
		mdev.entries.some((entry) => entry.label === 'codex auth refresh'),
		false,
	);
	assert.deepEqual(
		findPreset(commandMenus, ['mdev', 'Advanced', 'codex auth refresh']),
		{
			type: 'preset',
			label: 'codex auth refresh',
			steps: [
				{ type: 'text', data: 'mdev codex auth refresh' },
				{ type: 'enter' },
			],
		},
	);
	assert.deepEqual(findEntry(commandMenus, ['mdev', 'restart codex']), {
		type: 'bridge',
		label: 'restart codex',
		operation: 'codex.restart',
		timeoutMs: 60_000,
	});
});

void test('core8 submenu owns repo quality commands', () => {
	const commandMenus = getBundledShellConfig().commandMenus;

	assert.deepEqual(findPreset(commandMenus, ['core8', 'yarn cq']), {
		type: 'preset',
		label: 'yarn cq',
		steps: [{ type: 'text', data: 'yarn cq' }, { type: 'enter' }],
	});
	assert.deepEqual(findPreset(commandMenus, ['core8', 'yarn test:ci']), {
		type: 'preset',
		label: 'yarn test:ci',
		steps: [{ type: 'text', data: 'yarn test:ci' }, { type: 'enter' }],
	});
	assert.deepEqual(
		findPreset(commandMenus, ['core8', 'core8 jobs switch T0']),
		{
			type: 'preset',
			label: 'core8 jobs switch T0',
			steps: [{ type: 'text', data: './bin/core8 jobs switch T0' }],
		},
	);
});
