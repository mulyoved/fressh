import assert from 'node:assert/strict';
import test from 'node:test';
import {
	dispatchCommandMenuSelection,
	resolveCommandMenuSelection,
	type CommandMenuSelectionResult,
} from '../../src/lib/command-menu-selection';
import { type CommandPresetEntry } from '../../src/lib/shell-config';

void test('command menu selection resolves submenu entries', () => {
	const entry: CommandPresetEntry = {
		type: 'submenu',
		label: 'mdev',
		presets: [],
	};

	assert.deepEqual(resolveCommandMenuSelection(entry), {
		type: 'submenu',
		menu: entry,
	} satisfies CommandMenuSelectionResult);
});

void test('command menu selection resolves terminal preset entries', () => {
	const entry: CommandPresetEntry = {
		type: 'preset',
		label: '/new',
		steps: [{ type: 'text', data: '/new' }, { type: 'enter' }],
	};

	assert.deepEqual(resolveCommandMenuSelection(entry), {
		type: 'preset',
		preset: entry,
	} satisfies CommandMenuSelectionResult);
});

void test('command menu selection resolves native action entries', () => {
	const entry: CommandPresetEntry = {
		type: 'action',
		label: 'Request a Feature',
		actionId: 'OPEN_REPO_FEATURE_REQUEST',
	};

	assert.deepEqual(resolveCommandMenuSelection(entry), {
		type: 'action',
		actionId: 'OPEN_REPO_FEATURE_REQUEST',
	} satisfies CommandMenuSelectionResult);
});

void test('command menu selection dispatch opens submenu entries only', () => {
	const calls: string[] = [];
	const entry: CommandPresetEntry = {
		type: 'submenu',
		label: 'mdev',
		presets: [],
	};

	dispatchCommandMenuSelection(entry, {
		onSubmenu: (menu) => calls.push(`submenu:${menu.label}`),
		onPreset: (preset) => calls.push(`preset:${preset.label}`),
		onClose: () => calls.push('close'),
		onAction: (actionId) => calls.push(`action:${actionId}`),
	});

	assert.deepEqual(calls, ['submenu:mdev']);
});

void test('command menu selection dispatch selects preset entries only', () => {
	const calls: string[] = [];
	const entry: CommandPresetEntry = {
		type: 'preset',
		label: '/new',
		steps: [{ type: 'text', data: '/new' }, { type: 'enter' }],
	};

	dispatchCommandMenuSelection(entry, {
		onSubmenu: (menu) => calls.push(`submenu:${menu.label}`),
		onPreset: (preset) => calls.push(`preset:${preset.label}`),
		onClose: () => calls.push('close'),
		onAction: (actionId) => calls.push(`action:${actionId}`),
	});

	assert.deepEqual(calls, ['preset:/new']);
});

void test('command menu selection dispatch closes before native actions', () => {
	const calls: string[] = [];
	const entry: CommandPresetEntry = {
		type: 'action',
		label: 'Request a Feature',
		actionId: 'OPEN_REPO_FEATURE_REQUEST',
	};

	dispatchCommandMenuSelection(entry, {
		onSubmenu: (menu) => calls.push(`submenu:${menu.label}`),
		onPreset: (preset) => calls.push(`preset:${preset.label}`),
		onClose: () => calls.push('close'),
		onAction: (actionId) => calls.push(`action:${actionId}`),
	});

	assert.deepEqual(calls, ['close', 'action:OPEN_REPO_FEATURE_REQUEST']);
});
