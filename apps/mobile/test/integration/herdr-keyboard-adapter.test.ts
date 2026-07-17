import assert from 'node:assert/strict';
import test from 'node:test';
import {
	classifyHerdrKeyboardAction,
	createHerdrKeyboardAdapter,
	HERDR_KEYBOARD_UNSUPPORTED_MESSAGE,
} from '../../src/lib/herdr/keyboard-adapter';
import { KNOWN_ACTION_IDS } from '../../src/lib/keyboard-actions';
import {
	getBundledShellConfig,
	type MacroDef,
} from '../../src/lib/shell-config';
import { type ShellConfigState } from '../../src/lib/shell-config-store';

function createHarness(macros: MacroDef[] = []) {
	const config = getBundledShellConfig();
	const initialKeyboardId = config.defaultKeyboardId;
	const shellConfigState: ShellConfigState = {
		config: {
			...config,
			macrosByKeyboardId: {
				...config.macrosByKeyboardId,
				[initialKeyboardId]: macros,
			},
		},
		source: 'bundled',
		lastLoadedAt: null,
		lastError: null,
	};
	const terminalInput: number[][] = [];
	const clipboardWrites: string[] = [];
	const selectionModes: boolean[] = [];
	const feedback: string[] = [];
	let clipboardText = '';
	let selectionText = '';
	let fitCalls = 0;
	let previousCalls = 0;
	let nextCalls = 0;

	const adapter = createHerdrKeyboardAdapter({
		shellConfigState,
		terminalInput: {
			sendInput: (bytes) => {
				terminalInput.push([...bytes]);
				return true;
			},
		},
		clipboard: {
			readText: async () => clipboardText,
			writeText: async (text) => {
				clipboardWrites.push(text);
			},
		},
		terminalView: {
			getSelection: async () => selectionText,
			fit: () => {
				fitCalls += 1;
			},
			setSelectionModeEnabled: (enabled) => {
				selectionModes.push(enabled);
			},
		},
		agentNavigation: {
			previous: () => {
				previousCalls += 1;
			},
			next: () => {
				nextCalls += 1;
			},
		},
		showFeedback: (message) => {
			feedback.push(message);
		},
	});

	return {
		adapter,
		terminalInput,
		clipboardWrites,
		selectionModes,
		feedback,
		setClipboardText: (value: string) => {
			clipboardText = value;
		},
		setSelectionText: (value: string) => {
			selectionText = value;
		},
		getFitCalls: () => fitCalls,
		getPreviousCalls: () => previousCalls,
		getNextCalls: () => nextCalls,
	};
}

void test('text uses UTF-8 and byte slots preserve every byte', async () => {
	const harness = createHarness();

	await harness.adapter.onSlotPress({
		type: 'text',
		text: 'hé👋',
		label: 'text',
		icon: null,
	});
	await harness.adapter.onSlotPress({
		type: 'bytes',
		bytes: [0, 27, 128, 255],
		label: 'bytes',
		icon: null,
	});

	assert.deepEqual(harness.terminalInput, [
		[...new TextEncoder().encode('hé👋')],
		[0, 27, 128, 255],
	]);
});

void test('active modifiers use the provider-independent byte rules', async () => {
	const harness = createHarness();

	await harness.adapter.onSlotPress({
		type: 'modifier',
		modifier: 'SHIFT',
		label: 'Shift',
		icon: null,
	});
	await harness.adapter.onSlotPress({
		type: 'modifier',
		modifier: 'CTRL',
		label: 'Ctrl',
		icon: null,
	});
	await harness.adapter.onSlotPress({
		type: 'modifier',
		modifier: 'ALT',
		label: 'Alt',
		icon: null,
	});
	await harness.adapter.onSlotPress({
		type: 'text',
		text: 'a',
		label: 'A',
		icon: null,
	});
	await harness.adapter.onSlotPress({
		type: 'bytes',
		bytes: [98],
		label: 'B',
		icon: null,
	});

	assert.deepEqual(harness.adapter.getSnapshot().modifierKeysActive, [
		'SHIFT',
		'CTRL',
		'ALT',
	]);
	assert.deepEqual(harness.terminalInput, [
		[27, 1],
		[27, 2],
	]);
});

void test('macro command, text, sequence, and step bytes retain order', async () => {
	const macros: MacroDef[] = [
		{
			id: 'command',
			name: 'command',
			label: 'command',
			category: 'test',
			script: JSON.stringify({ type: 'command', value: 'go', enter: true }),
		},
		{
			id: 'text',
			name: 'text',
			label: 'text',
			category: 'test',
			script: JSON.stringify({ type: 'text', value: 'λ', enter: true }),
		},
		{
			id: 'sequence',
			name: 'sequence',
			label: 'sequence',
			category: 'test',
			script: JSON.stringify({ type: 'sequence', value: '\u001b[A' }),
		},
		{
			id: 'steps',
			name: 'steps',
			label: 'steps',
			category: 'test',
			script: JSON.stringify({
				type: 'steps',
				steps: [
					{ type: 'text', data: 'x', repeat: 2 },
					{ type: 'space' },
					{ type: 'tab' },
					{ type: 'arrowDown' },
					{ type: 'arrowUp' },
					{ type: 'esc' },
					{ type: 'enter' },
				],
			}),
		},
	];
	const harness = createHarness(macros);

	for (const macro of macros) {
		await harness.adapter.onSlotPress({
			type: 'macro',
			macroId: macro.id,
			label: macro.label,
			icon: null,
		});
	}

	assert.deepEqual(
		harness.terminalInput.map((bytes) =>
			new TextDecoder().decode(Uint8Array.from(bytes)),
		),
		[
			'go',
			'\r',
			'λ',
			'\r',
			'\u001b[A',
			'x',
			'x',
			' ',
			'\t',
			'\u001b[B',
			'\u001b[A',
			'\u001b',
			'\r',
		],
	);
});

void test('missing macros show bounded local feedback and emit no input', async () => {
	const harness = createHarness();

	await harness.adapter.onSlotPress({
		type: 'macro',
		macroId: 'missing',
		label: 'Missing',
		icon: null,
	});

	assert.deepEqual(harness.terminalInput, []);
	assert.deepEqual(harness.feedback, ['Keyboard macro unavailable.']);
});

void test('keyboard targets and rotation select configured active keyboards', async () => {
	const harness = createHarness();
	const initial = harness.adapter.getSnapshot().selectedKeyboardId;

	await harness.adapter.onSlotPress({
		type: 'action',
		actionId: 'OPEN_ADVANCED_KEYBOARD',
		label: 'Advanced',
		icon: null,
	});
	assert.equal(
		harness.adapter.getSnapshot().selectedKeyboardId,
		getBundledShellConfig().keyboardRouting.actionTargets
			.OPEN_ADVANCED_KEYBOARD,
	);

	await harness.adapter.onSlotPress({
		type: 'action',
		actionId: 'ROTATE_KEYBOARD',
		label: 'Rotate',
		icon: null,
	});
	assert.notEqual(harness.adapter.getSnapshot().selectedKeyboardId, initial);
	assert.equal(harness.terminalInput.length, 0);
});

void test('paste, copy, fit, and selection presentation stay local', async () => {
	const harness = createHarness();
	harness.setClipboardText('paste ✓');
	harness.setSelectionText('selected');

	harness.adapter.setSelectionModeEnabled(true);
	await harness.adapter.onSlotPress({
		type: 'action',
		actionId: 'PASTE_CLIPBOARD',
		label: 'Paste',
		icon: null,
	});
	await harness.adapter.onSlotPress({
		type: 'action',
		actionId: 'COPY_SELECTION',
		label: 'Copy',
		icon: null,
	});
	await harness.adapter.onSlotPress({
		type: 'action',
		actionId: 'FIT_TERMINAL_TO_DEVICE',
		label: 'Fit',
		icon: null,
	});

	assert.deepEqual(harness.terminalInput, [
		[...new TextEncoder().encode('paste ✓')],
	]);
	assert.deepEqual(harness.clipboardWrites, ['selected']);
	assert.equal(harness.getFitCalls(), 1);
	assert.deepEqual(harness.selectionModes, [true, false]);
	assert.equal(harness.adapter.getSnapshot().selectionModeEnabled, false);
	assert.equal('resize' in harness.adapter, false);
	assert.equal('shellSession' in harness.adapter, false);
	assert.equal('runWorkmuxCommand' in harness.adapter, false);
});

void test('terminal keyboard props use configured Work options', () => {
	const harness = createHarness();
	const props = harness.adapter.getTerminalKeyboardProps();

	assert.equal(props.workKeyLongPressMode, 'configured');
	assert.equal(
		props.keyboard?.id,
		harness.adapter.getSnapshot().selectedKeyboardId,
	);
	assert.equal(props.onSlotPress, harness.adapter.onSlotPress);
	assert.equal(props.onCopySelection, harness.adapter.onCopySelection);
});

void test('only previous and next Work actions navigate agents', async () => {
	const harness = createHarness();

	await harness.adapter.onSlotPress({
		type: 'action',
		actionId: 'WORKMUX_NAV_PREV',
		label: 'Prev',
		icon: null,
	});
	await harness.adapter.onSlotPress({
		type: 'action',
		actionId: 'WORKMUX_NAV_NEXT',
		label: 'Work',
		icon: null,
	});

	assert.equal(harness.getPreviousCalls(), 1);
	assert.equal(harness.getNextCalls(), 1);
	assert.deepEqual(harness.feedback, []);
	assert.deepEqual(harness.terminalInput, []);
});

void test('shell-only and unknown actions show exact feedback without remote input', async () => {
	const harness = createHarness();
	const supported = new Set([
		'WORKMUX_NAV_PREV',
		'WORKMUX_NAV_NEXT',
		'FIT_TERMINAL_TO_DEVICE',
		'COPY_SELECTION',
		'PASTE_CLIPBOARD',
		'ROTATE_KEYBOARD',
		'OPEN_MAIN_MENU',
		'OPEN_ADVANCED_KEYBOARD',
		'OPEN_BROWSER_KEYBOARD',
	]);
	const unsupported = [
		...KNOWN_ACTION_IDS.filter((actionId) => !supported.has(actionId)),
		'UNKNOWN_HERDR_ACTION',
	];

	for (const actionId of unsupported) {
		assert.deepEqual(classifyHerdrKeyboardAction(actionId), {
			type: 'unsupported',
			message: HERDR_KEYBOARD_UNSUPPORTED_MESSAGE,
		});
		await harness.adapter.onSlotPress({
			type: 'action',
			actionId,
			label: actionId,
			icon: null,
		});
	}

	assert.deepEqual(
		harness.feedback,
		unsupported.map(() => 'TBD for Herdr'),
	);
	assert.deepEqual(harness.terminalInput, []);
	assert.equal(harness.getPreviousCalls(), 0);
	assert.equal(harness.getNextCalls(), 0);
});
