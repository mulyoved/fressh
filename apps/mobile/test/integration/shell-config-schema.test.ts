import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
	parseShellConfigData,
	parseShellConfigString,
	resolveSelectedKeyboardId,
} from '../../src/lib/shell-config';

const bundledConfigText = readFileSync(
	path.resolve(import.meta.dirname, '../../config/shell-config.json'),
	'utf8',
);

void test('bundled runtime shell config parses with keyboards and command menus', () => {
	const config = parseShellConfigString(bundledConfigText);
	const rawConfig = JSON.parse(bundledConfigText) as Record<string, unknown>;

	assert.ok(config.version);
	assert.ok(config.updatedAt);
	assert.ok(config.keyboards.length > 0);
	assert.ok(config.commandMenus.length > 0);
	assert.equal(config.version, '2026-07-14.2');
	assert.equal(config.updatedAt, '2026-07-14T15:00:00.000Z');
	assert.ok(rawConfig.keyboardRouting);
	assert.deepEqual(
		(
			rawConfig.keyboardRouting as {
				oneShotReturnByKeyboardId?: Record<string, string>;
			}
		).oneShotReturnByKeyboardId,
		{},
	);
	assert.equal(
		resolveSelectedKeyboardId(config, 'missing-keyboard'),
		config.defaultKeyboardId,
	);
});

void test('runtime shell config falls back to default when selected keyboard is inactive', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	config.activeKeyboardIds = ['phone_base'];
	config.keyboardRouting = {
		actionTargets: {},
		oneShotReturnByKeyboardId: {},
	};

	const parsed = parseShellConfigData(config);

	assert.equal(
		resolveSelectedKeyboardId(parsed, 'advanced_keyboard'),
		'phone_base',
	);
});

void test('selected keyboard resolver honors effective available definitions', () => {
	const config = parseShellConfigString(bundledConfigText);
	const effective = new Set(['advanced_keyboard', 'tmux_keyboard']);

	assert.equal(
		resolveSelectedKeyboardId(config, 'phone_base', effective),
		'advanced_keyboard',
	);
	assert.equal(
		resolveSelectedKeyboardId(config, 'tmux_keyboard', effective),
		'tmux_keyboard',
	);
	assert.equal(resolveSelectedKeyboardId(config, null, new Set()), '');
});

void test('runtime shell config rejects duplicate active keyboard ids', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	config.activeKeyboardIds = ['phone_base', 'phone_base'];
	config.keyboardRouting = {
		actionTargets: {},
		oneShotReturnByKeyboardId: {},
	};

	assert.throws(
		() => parseShellConfigData(config),
		/Duplicate active keyboard id phone_base/,
	);
});

void test('runtime shell config rejects missing macro references', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	const keyboards = structuredClone(config.keyboards) as Record<
		string,
		unknown
	>[];
	const firstKeyboard = keyboards[0];
	assert.ok(firstKeyboard);
	const grid = structuredClone(firstKeyboard.grid) as unknown[][];
	grid[0]![0] = {
		type: 'macro',
		macroId: 'missing_macro',
		label: 'Missing',
		icon: null,
	};
	firstKeyboard.grid = grid;
	config.keyboards = keyboards;

	assert.throws(() => parseShellConfigData(config), /missing_macro/);
});

void test('runtime shell config rejects unknown action ids', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	const keyboards = structuredClone(config.keyboards) as Record<
		string,
		unknown
	>[];
	const firstKeyboard = keyboards[0];
	assert.ok(firstKeyboard);
	const grid = structuredClone(firstKeyboard.grid) as unknown[][];
	grid[0]![0] = {
		type: 'action',
		actionId: 'NOT_A_REAL_ACTION',
		label: 'Broken',
		icon: null,
	};
	firstKeyboard.grid = grid;
	config.keyboards = keyboards;

	assert.throws(() => parseShellConfigData(config), /NOT_A_REAL_ACTION/);
});

void test('runtime shell config accepts open skill selector action ids', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	const keyboards = structuredClone(config.keyboards) as Record<
		string,
		unknown
	>[];
	const firstKeyboard = keyboards[0];
	assert.ok(firstKeyboard);
	const grid = structuredClone(firstKeyboard.grid) as unknown[][];
	grid[0]![0] = {
		type: 'action',
		actionId: 'OPEN_SKILL_SELECTOR',
		label: '$',
		icon: null,
	};
	firstKeyboard.grid = grid;
	config.keyboards = keyboards;

	const parsed = parseShellConfigData(config);
	assert.equal(parsed.keyboards[0]?.grid[0]?.[0]?.type, 'action');
});

void test('runtime shell config accepts long-press macro options on a key', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	const keyboards = structuredClone(config.keyboards) as Record<
		string,
		unknown
	>[];
	const firstKeyboard = keyboards[0];
	assert.ok(firstKeyboard);
	const grid = structuredClone(firstKeyboard.grid) as unknown[][];
	grid[0]![0] = {
		type: 'macro',
		macroId: 'cmd_fix',
		label: 'Fix',
		icon: null,
		longPress: {
			options: [
				{
					type: 'macro',
					macroId: 'cmd_fix',
					label: 'fix',
					icon: null,
				},
				{
					type: 'macro',
					macroId: 'cmd_yes',
					label: 'yes',
					icon: null,
				},
			],
		},
	};
	firstKeyboard.grid = grid;
	config.keyboards = keyboards;

	const parsed = parseShellConfigData(config);
	const slot = parsed.keyboards[0]?.grid[0]?.[0];
	assert.equal(slot?.type, 'macro');
	assert.deepEqual(slot?.longPress, {
		options: [
			{ type: 'macro', macroId: 'cmd_fix', label: 'fix', icon: null },
			{ type: 'macro', macroId: 'cmd_yes', label: 'yes', icon: null },
		],
	});
});

void test('runtime shell config rejects missing macro references in long-press options', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	const keyboards = structuredClone(config.keyboards) as Record<
		string,
		unknown
	>[];
	const firstKeyboard = keyboards[0];
	assert.ok(firstKeyboard);
	const grid = structuredClone(firstKeyboard.grid) as unknown[][];
	grid[0]![0] = {
		type: 'macro',
		macroId: 'cmd_fix',
		label: 'Fix',
		icon: null,
		longPress: {
			options: [
				{
					type: 'macro',
					macroId: 'missing_long_press_macro',
					label: 'Missing',
					icon: null,
				},
			],
		},
	};
	firstKeyboard.grid = grid;
	config.keyboards = keyboards;

	assert.throws(() => parseShellConfigData(config), /missing_long_press_macro/);
});

void test('runtime shell config rejects unknown action ids in long-press options', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	const keyboards = structuredClone(config.keyboards) as Record<
		string,
		unknown
	>[];
	const firstKeyboard = keyboards[0];
	assert.ok(firstKeyboard);
	const grid = structuredClone(firstKeyboard.grid) as unknown[][];
	grid[0]![0] = {
		type: 'action',
		actionId: 'PASTE_CLIPBOARD',
		label: 'Paste',
		icon: null,
		longPress: {
			options: [
				{
					type: 'action',
					actionId: 'NOT_A_REAL_ACTION',
					label: 'Broken',
					icon: null,
				},
			],
		},
	};
	firstKeyboard.grid = grid;
	config.keyboards = keyboards;

	assert.throws(() => parseShellConfigData(config), /NOT_A_REAL_ACTION/);
});

void test('runtime shell config accepts command menu action entries', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	config.commandMenus = [
		{
			type: 'action',
			label: 'Request a Feature',
			actionId: 'OPEN_REPO_FEATURE_REQUEST',
		},
		{
			type: 'action',
			label: 'Fit terminal to device',
			actionId: 'FIT_TERMINAL_TO_DEVICE',
		},
		{
			type: 'action',
			label: 'Debug connection in Codex',
			actionId: 'DEBUG_CONNECTION_IN_CODEX',
		},
	];

	const parsed = parseShellConfigData(config);

	assert.deepEqual(parsed.commandMenus, [
		{
			type: 'action',
			label: 'Request a Feature',
			actionId: 'OPEN_REPO_FEATURE_REQUEST',
		},
		{
			type: 'action',
			label: 'Fit terminal to device',
			actionId: 'FIT_TERMINAL_TO_DEVICE',
		},
		{
			type: 'action',
			label: 'Debug connection in Codex',
			actionId: 'DEBUG_CONNECTION_IN_CODEX',
		},
	]);
});

void test('runtime shell config accepts native worktree workspace action ids', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	config.commandMenus = [
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
	];

	const parsed = parseShellConfigData(config);
	assert.deepEqual(parsed.commandMenus, config.commandMenus);
});

void test('runtime shell config rejects unsupported command menu action ids', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	config.commandMenus = [
		{
			type: 'submenu',
			label: 'mdev',
			entries: [
				{
					type: 'action',
					label: 'Broken',
					actionId: 'NOT_A_REAL_ACTION',
				},
			],
		},
	];

	assert.throws(() => parseShellConfigData(config), /NOT_A_REAL_ACTION/);
});

void test('runtime shell config accepts command menu bridge entries', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	config.commandMenus = [
		{
			type: 'bridge',
			label: 'restart codex',
			operation: 'codex.restart',
			timeoutMs: 10_000,
		},
	];

	const parsed = parseShellConfigData(config);

	assert.deepEqual(parsed.commandMenus, [
		{
			type: 'bridge',
			label: 'restart codex',
			operation: 'codex.restart',
			timeoutMs: 10_000,
		},
	]);
});

void test('runtime shell config rejects unsupported command menu bridge operations', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	config.commandMenus = [
		{
			type: 'submenu',
			label: 'mdev',
			entries: [
				{
					type: 'bridge',
					label: 'Broken',
					operation: 'host.shell',
				},
			],
		},
	];

	assert.throws(
		() => parseShellConfigData(config),
		/Unsupported command menu bridge operation host\.shell/,
	);
});

void test('runtime shell config rejects invalid command menu bridge timeouts', () => {
	for (const timeoutMs of [0, -1, 1.5, '1000']) {
		const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
		config.commandMenus = [
			{
				type: 'bridge',
				label: 'restart codex',
				operation: 'codex.restart',
				timeoutMs,
			},
		];

		assert.throws(() => parseShellConfigData(config), /timeoutMs/);
	}
});
