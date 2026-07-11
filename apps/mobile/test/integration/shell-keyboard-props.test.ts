import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellKeyboardPropBundles } from '../../src/lib/shell-controllers/keyboard-props';

void test('keyboard prop factory preserves every mapped callback and snapshots mutable arrays', () => {
	const callback = () => {};
	const modifiers = ['CTRL' as const];
	const entries: never[] = [];
	const bundles = createShellKeyboardPropBundles({
		terminal: {
			keyboard: null,
			modifierKeysActive: modifiers,
			onSlotPress: callback,
			selectionModeEnabled: true,
			onCopySelection: callback,
			navScope: 'visible',
		},
		commandMenu: {
			entries,
			onSelect: callback,
			onAction: callback,
			onBridge: callback,
		},
		commander: {
			onExecuteCommand: callback,
			onPasteText: callback,
			onSendShortcut: callback,
		},
	});
	assert.notEqual(bundles.terminal.modifierKeysActive, modifiers);
	assert.notEqual(bundles.commandMenu.entries, entries);
	assert.equal(bundles.terminal.onSlotPress, callback);
	assert.equal(bundles.commander.onSendShortcut, callback);
	assert.equal(bundles.terminal.navScope, 'visible');
});
