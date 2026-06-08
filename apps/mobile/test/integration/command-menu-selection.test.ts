import assert from 'node:assert/strict';
import test from 'node:test';
import {
	resolveCommandMenuSelection,
	type CommandMenuSelectionResult,
} from '../../src/lib/command-menu-selection';
import type { CommandPresetEntry } from '../../src/lib/shell-config';

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
