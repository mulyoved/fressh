import assert from 'node:assert/strict';
import test from 'node:test';

import { type ShellConfig } from '../../src/lib/shell-config';
import { type ShellConfigState } from '../../src/lib/shell-config-store';
import {
	createShellKeyboardStateCore,
	type ShellKeyboardHistoryStore,
} from '../../src/lib/shell-controllers/keyboard-state-core';
import {
	clearRecentTextEntryHistory,
	createEmptyTextEntryHistoryState,
	deleteTextEntryHistoryEntry,
	pinTextEntryHistoryEntry,
	pinTextEntryHistoryText,
	recordTextEntryPaste,
	unpinTextEntryHistoryEntry,
	type TextEntryHistoryState,
} from '../../src/lib/text-entry-history';

function configState(config = createConfig()): ShellConfigState {
	return {
		config,
		source: 'bundled',
		lastLoadedAt: null,
		lastError: null,
	};
}

function createConfig(): ShellConfig {
	return {
		version: '1',
		updatedAt: '2026-07-10T00:00:00.000Z',
		defaultKeyboardId: 'main',
		activeKeyboardIds: ['main', 'advanced', 'one-shot'],
		keyboardRouting: {
			actionTargets: {},
			oneShotReturnByKeyboardId: { 'one-shot': 'main' },
		},
		keyboards: [
			{
				id: 'main',
				name: 'Main',
				grid: [],
			},
			{
				id: 'advanced',
				name: 'Advanced',
				grid: [],
			},
			{
				id: 'one-shot',
				name: 'One shot',
				grid: [],
			},
		],
		macrosByKeyboardId: {
			main: [
				{
					id: 'main-macro',
					name: 'Main macro',
					label: 'main',
					category: 'test',
					script: '{}',
				},
			],
			advanced: [],
			'one-shot': [],
		},
		commandMenus: [],
	};
}

function createMemoryHistoryStore(
	initialState = createEmptyTextEntryHistoryState(),
): ShellKeyboardHistoryStore & { getState(): TextEntryHistoryState } {
	let state = initialState;
	let now = 0;
	let id = 0;
	return {
		getState: () => state,
		load: () => state,
		recordPaste: (text) =>
			(state = recordTextEntryPaste(state, text, {
				id: `entry-${++id}`,
				nowMs: ++now,
			})),
		pinText: (text) =>
			(state = pinTextEntryHistoryText(state, text, {
				id: `entry-${++id}`,
				nowMs: ++now,
			})),
		pinEntry: (entryId) =>
			(state = pinTextEntryHistoryEntry(state, entryId, { nowMs: ++now })),
		unpinEntry: (entryId) =>
			(state = unpinTextEntryHistoryEntry(state, entryId, {
				nowMs: ++now,
			})),
		deleteEntry: (entryId) =>
			(state = deleteTextEntryHistoryEntry(state, entryId)),
		clearRecent: () => (state = clearRecentTextEntryHistory(state)),
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function historyState(text: string, id = text): TextEntryHistoryState {
	return recordTextEntryPaste(createEmptyTextEntryHistoryState(), text, {
		id,
		nowMs: 1,
	});
}

void test('keyboard state rotates configured keyboards and explicit selection rejects absent ids', () => {
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: createMemoryHistoryStore(),
	});

	assert.equal(core.getSnapshot().selectedKeyboardId, 'main');
	core.rotateKeyboard();
	assert.equal(core.getSnapshot().selectedKeyboardId, 'advanced');
	core.selectKeyboardIfExists('missing');
	assert.equal(core.getSnapshot().selectedKeyboardId, 'advanced');
	core.selectKeyboardIfExists('one-shot');
	assert.equal(core.getSnapshot().keyboard?.name, 'One shot');
	core.completeSlotPress();
	assert.equal(core.getSnapshot().selectedKeyboardId, 'main');
});

void test('one-shot return follows the latest config and removed selection uses canonical fallback', () => {
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: createMemoryHistoryStore(),
	});
	core.selectKeyboardIfExists('one-shot');

	const replacement = createConfig();
	replacement.defaultKeyboardId = 'advanced';
	replacement.activeKeyboardIds = ['advanced', 'one-shot'];
	replacement.keyboardRouting.oneShotReturnByKeyboardId = {
		'one-shot': 'advanced',
	};
	core.setShellConfigState(configState(replacement));
	core.completeSlotPress();
	assert.equal(core.getSnapshot().selectedKeyboardId, 'advanced');

	replacement.activeKeyboardIds = ['one-shot'];
	replacement.defaultKeyboardId = 'one-shot';
	core.setShellConfigState(configState(replacement));
	assert.equal(core.getSnapshot().selectedKeyboardId, 'one-shot');
});

void test('config replacement snapshots caller data and equivalent state does not publish', () => {
	const state = configState();
	const core = createShellKeyboardStateCore({
		initialShellConfigState: state,
		historyStore: createMemoryHistoryStore(),
	});
	let publishes = 0;
	core.subscribe(() => {
		publishes += 1;
	});

	core.setShellConfigState(structuredClone(state));
	assert.equal(publishes, 0);
	state.config.activeKeyboardIds.splice(0, 1, 'mutated');
	state.config.keyboards[0]!.name = 'Mutated';
	assert.deepEqual(core.getSnapshot().activeKeyboardIds, [
		'main',
		'advanced',
		'one-shot',
	]);
	assert.equal(core.getSnapshot().keyboard?.name, 'Main');
	assert.equal(Object.isFrozen(core.getSnapshot()), true);
	assert.equal(
		Object.isFrozen(core.getSnapshot().shellConfigState.config),
		true,
	);
	assert.equal(Object.isFrozen(core.getSnapshot().macros), true);
});

void test('modifier order matches existing SHIFT CTRL ALT CMD byte semantics without mutating input', () => {
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: createMemoryHistoryStore(),
	});
	const input = new Uint8Array([0x61, 0x62]);
	core.toggleModifier('ALT');
	core.toggleModifier('CTRL');
	core.toggleModifier('SHIFT');
	core.toggleModifier('CMD');

	assert.deepEqual(Array.from(core.applyModifiers(input)), [0x1b, 0x01]);
	assert.deepEqual(Array.from(input), [0x61, 0x62]);
	assert.deepEqual(core.getSnapshot().modifierKeysActive, [
		'ALT',
		'CTRL',
		'SHIFT',
		'CMD',
	]);
	assert.equal(Object.isFrozen(core.getSnapshot().modifierKeysActive), true);

	core.toggleModifier('CTRL');
	assert.deepEqual(
		Array.from(core.applyModifiers(new Uint8Array([0x3f]))),
		[0x1b, 0x3f],
	);
	core.toggleModifier('SHIFT');
	core.toggleModifier('ALT');
	assert.notEqual(core.applyModifiers(input), input);
});

void test('modifier application preserves every supported combination', () => {
	const cases: [readonly ('SHIFT' | 'CTRL' | 'ALT' | 'CMD')[], number[]][] = [
		[[], [0x61, 0x62]],
		[['SHIFT'], [0x41, 0x42]],
		[['CTRL'], [0x01]],
		[['ALT'], [0x1b, 0x61, 0x62]],
		[['CMD'], [0x61, 0x62]],
		[['SHIFT', 'CTRL'], [0x01]],
		[
			['SHIFT', 'ALT'],
			[0x1b, 0x41, 0x42],
		],
		[
			['SHIFT', 'CMD'],
			[0x41, 0x42],
		],
		[
			['CTRL', 'ALT'],
			[0x1b, 0x01],
		],
		[['CTRL', 'CMD'], [0x01]],
		[
			['ALT', 'CMD'],
			[0x1b, 0x61, 0x62],
		],
		[
			['SHIFT', 'CTRL', 'ALT'],
			[0x1b, 0x01],
		],
		[['SHIFT', 'CTRL', 'CMD'], [0x01]],
		[
			['SHIFT', 'ALT', 'CMD'],
			[0x1b, 0x41, 0x42],
		],
		[
			['CTRL', 'ALT', 'CMD'],
			[0x1b, 0x01],
		],
		[
			['SHIFT', 'CTRL', 'ALT', 'CMD'],
			[0x1b, 0x01],
		],
	];

	for (const [modifiers, expected] of cases) {
		const core = createShellKeyboardStateCore({
			initialShellConfigState: configState(),
			historyStore: createMemoryHistoryStore(),
		});
		for (const modifier of [...modifiers].reverse()) {
			core.toggleModifier(modifier);
		}
		assert.deepEqual(
			Array.from(core.applyModifiers(new Uint8Array([0x61, 0x62]))),
			expected,
			modifiers.join('+') || 'none',
		);
	}
});

void test('system keyboard and selection modes publish only semantic changes', () => {
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: createMemoryHistoryStore(),
		initialSystemKeyboardEnabled: true,
	});
	let publishes = 0;
	core.subscribe(() => {
		publishes += 1;
	});

	core.setSystemKeyboardEnabled(true);
	core.setSelectionModeEnabled(false);
	assert.equal(publishes, 0);
	core.setSystemKeyboardEnabled(false);
	core.setSelectionModeEnabled(true);
	assert.equal(publishes, 2);
});

void test('accepted paste and history mutations refresh authoritative sections and cycle order', async () => {
	const store = createMemoryHistoryStore();
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: store,
	});

	core.recordAcceptedTextPaste('');
	core.recordAcceptedTextPaste('first');
	core.recordAcceptedTextPaste('second');
	await Promise.resolve();
	assert.deepEqual(
		core.getSnapshot().history.recent.map((entry) => entry.text),
		['second', 'first'],
	);
	const firstId = store
		.getState()
		.entries.find((entry) => entry.text === 'first')!.id;
	core.pinHistoryEntry(firstId);
	await Promise.resolve();
	assert.deepEqual(
		core.getSnapshot().history.cycleEntries.map((entry) => entry.text),
		['first', 'second'],
	);
	core.unpinHistoryEntry(firstId);
	core.pinHistoryText('pinned');
	await Promise.resolve();
	const secondId = store
		.getState()
		.entries.find((entry) => entry.text === 'second')!.id;
	core.deleteHistoryEntry(secondId);
	core.clearRecentHistory();
	await Promise.resolve();
	assert.deepEqual(
		core.getSnapshot().history.pinned.map((entry) => entry.text),
		['pinned'],
	);
	assert.deepEqual(core.getSnapshot().history.recent, []);
});

void test('history persistence failure does not optimistically diverge and throwing logger is contained', async () => {
	const warnings: unknown[] = [];
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: {
			load: () => createEmptyTextEntryHistoryState(),
			recordPaste: () => Promise.reject(new Error('persist failed')),
			pinText: () => {
				throw new Error('pin failed');
			},
			pinEntry: () => createEmptyTextEntryHistoryState(),
			unpinEntry: () => createEmptyTextEntryHistoryState(),
			deleteEntry: () => createEmptyTextEntryHistoryState(),
			clearRecent: () => createEmptyTextEntryHistoryState(),
		},
		logger: {
			warn: (_message, error) => {
				warnings.push(error);
				throw new Error('logger failed');
			},
		},
	});

	assert.doesNotThrow(() => core.recordAcceptedTextPaste('blocked'));
	assert.doesNotThrow(() => core.pinHistoryText('blocked'));
	await Promise.resolve();
	await Promise.resolve();
	assert.deepEqual(core.getSnapshot().history.recent, []);
	assert.equal(warnings.length, 2);
});

void test('stale async history completion cannot overwrite a newer mutation', async () => {
	const old = deferred<TextEntryHistoryState>();
	const latest = deferred<TextEntryHistoryState>();
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: {
			load: () => createEmptyTextEntryHistoryState(),
			recordPaste: (text) => (text === 'old' ? old.promise : latest.promise),
			pinText: () => createEmptyTextEntryHistoryState(),
			pinEntry: () => createEmptyTextEntryHistoryState(),
			unpinEntry: () => createEmptyTextEntryHistoryState(),
			deleteEntry: () => createEmptyTextEntryHistoryState(),
			clearRecent: () => createEmptyTextEntryHistoryState(),
		},
	});

	core.recordAcceptedTextPaste('old');
	core.recordAcceptedTextPaste('latest');
	latest.resolve(historyState('latest'));
	await latest.promise;
	await Promise.resolve();
	old.resolve(historyState('old'));
	await old.promise;
	await Promise.resolve();
	assert.equal(core.getSnapshot().history.recent[0]?.text, 'latest');
});

void test('subscriber reentry commits complete snapshots and throwing subscriber cannot corrupt state', () => {
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: createMemoryHistoryStore(),
	});
	let reentered = false;
	core.subscribe(() => {
		if (reentered) return;
		reentered = true;
		core.setSelectionModeEnabled(true);
	});
	core.subscribe(() => {
		throw new Error('subscriber failed');
	});
	let laterSubscriberCalls = 0;
	core.subscribe(() => {
		laterSubscriberCalls += 1;
	});

	assert.doesNotThrow(() => core.setSystemKeyboardEnabled(true));
	assert.equal(core.getSnapshot().systemKeyboardEnabled, true);
	assert.equal(core.getSnapshot().selectionModeEnabled, true);
	assert.equal(laterSubscriberCalls, 2);
});

void test('dispose is idempotent and prevents late store publication', async () => {
	const pending = deferred<TextEntryHistoryState>();
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: {
			load: () => createEmptyTextEntryHistoryState(),
			recordPaste: () => pending.promise,
			pinText: () => createEmptyTextEntryHistoryState(),
			pinEntry: () => createEmptyTextEntryHistoryState(),
			unpinEntry: () => createEmptyTextEntryHistoryState(),
			deleteEntry: () => createEmptyTextEntryHistoryState(),
			clearRecent: () => createEmptyTextEntryHistoryState(),
		},
	});
	let publishes = 0;
	core.subscribe(() => {
		publishes += 1;
	});
	core.recordAcceptedTextPaste('late');
	core.dispose();
	core.dispose();
	pending.resolve(historyState('late'));
	await pending.promise;
	await Promise.resolve();
	core.setSelectionModeEnabled(true);
	assert.equal(publishes, 0);
	assert.deepEqual(core.getSnapshot().history.recent, []);
});
