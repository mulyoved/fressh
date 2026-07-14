import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchCommandMenuSelection } from '../../src/lib/command-menu-selection';
import { type CommandMenuEntry } from '../../src/lib/shell-config';

void test('command menu selection dispatch opens submenu entries only', () => {
	const calls: string[] = [];
	const entry: CommandMenuEntry = {
		type: 'submenu',
		label: 'mdev',
		entries: [],
	};

	dispatchCommandMenuSelection(entry, {
		onSubmenu: (menu) => calls.push(`submenu:${menu.label}`),
		onPreset: (preset) => calls.push(`preset:${preset.label}`),
		onClose: () => calls.push('close'),
		onAction: (actionId) => calls.push(`action:${actionId}`),
		onBridge: (entry) => calls.push(`bridge:${entry.label}`),
	});

	assert.deepEqual(calls, ['submenu:mdev']);
});

void test('command menu selection dispatch selects preset entries only', () => {
	const calls: string[] = [];
	const entry: CommandMenuEntry = {
		type: 'preset',
		label: '/new',
		steps: [{ type: 'text', data: '/new' }, { type: 'enter' }],
	};

	dispatchCommandMenuSelection(entry, {
		onSubmenu: (menu) => calls.push(`submenu:${menu.label}`),
		onPreset: (preset) => calls.push(`preset:${preset.label}`),
		onClose: () => calls.push('close'),
		onAction: (actionId) => calls.push(`action:${actionId}`),
		onBridge: (entry) => calls.push(`bridge:${entry.label}`),
	});

	assert.deepEqual(calls, ['preset:/new']);
});

void test('command menu selection dispatch closes before native actions', () => {
	const calls: string[] = [];
	const entry: CommandMenuEntry = {
		type: 'action',
		label: 'Request a Feature',
		actionId: 'OPEN_REPO_FEATURE_REQUEST',
	};

	dispatchCommandMenuSelection(entry, {
		onSubmenu: (menu) => calls.push(`submenu:${menu.label}`),
		onPreset: (preset) => calls.push(`preset:${preset.label}`),
		onClose: () => calls.push('close'),
		onAction: (actionId) => calls.push(`action:${actionId}`),
		onBridge: (entry) => calls.push(`bridge:${entry.label}`),
	});

	assert.deepEqual(calls, ['close', 'action:OPEN_REPO_FEATURE_REQUEST']);
});

void test('command menu selection closes before each native worktree workspace action', () => {
	for (const actionId of [
		'OPEN_NEW_WORKTREE_WORKSPACE',
		'OPEN_CLOSE_WORKTREE_WORKSPACE',
	] as const) {
		const calls: string[] = [];
		dispatchCommandMenuSelection(
			{
				type: 'action',
				label:
					actionId === 'OPEN_NEW_WORKTREE_WORKSPACE'
						? 'New Worktree Workspace'
						: 'Close Worktree Workspace',
				actionId,
			},
			{
				onSubmenu: () => {},
				onPreset: () => {},
				onClose: () => calls.push('close'),
				onAction: (selectedActionId) => {
					if (selectedActionId === 'OPEN_NEW_WORKTREE_WORKSPACE') {
						calls.push('open-new');
					} else if (selectedActionId === 'OPEN_CLOSE_WORKTREE_WORKSPACE') {
						calls.push('open-close');
					}
				},
				onBridge: () => {},
			},
		);

		assert.deepEqual(calls, [
			'close',
			actionId === 'OPEN_NEW_WORKTREE_WORKSPACE' ? 'open-new' : 'open-close',
		]);
	}
});

void test('command menu selection dispatch closes before bridge entries', () => {
	const calls: string[] = [];
	const entry: CommandMenuEntry = {
		type: 'bridge',
		label: 'restart codex',
		operation: 'codex.restart',
		timeoutMs: 10_000,
	};

	dispatchCommandMenuSelection(entry, {
		onSubmenu: (menu) => calls.push(`submenu:${menu.label}`),
		onPreset: (preset) => calls.push(`preset:${preset.label}`),
		onClose: () => calls.push('close'),
		onAction: (actionId) => calls.push(`action:${actionId}`),
		onBridge: (bridgeEntry) =>
			calls.push(
				`bridge:${bridgeEntry.label}:${bridgeEntry.operation}:${bridgeEntry.timeoutMs}`,
			),
	});

	assert.deepEqual(calls, [
		'close',
		'bridge:restart codex:codex.restart:10000',
	]);
});
