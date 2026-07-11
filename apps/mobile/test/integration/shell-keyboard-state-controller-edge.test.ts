import assert from 'node:assert/strict';
import test from 'node:test';

import { type ShellConfig } from '../../src/lib/shell-config';
import { type ShellConfigState } from '../../src/lib/shell-config-store';
import {
	createShellKeyboardStateCore,
	type ShellKeyboardHistoryStore,
} from '../../src/lib/shell-controllers/keyboard-state-core';
import {
	createEmptyTextEntryHistoryState,
	recordTextEntryPaste,
	type TextEntryHistoryState,
} from '../../src/lib/text-entry-history';

function config(): ShellConfig {
	return {
		version: '1',
		updatedAt: '2026-07-10T00:00:00.000Z',
		defaultKeyboardId: 'main',
		activeKeyboardIds: ['main', 'missing', 'advanced', 'one-shot'],
		keyboardRouting: {
			actionTargets: {},
			oneShotReturnByKeyboardId: { 'one-shot': 'main' },
		},
		keyboards: [
			{ id: 'main', name: 'Main', grid: [] },
			{ id: 'advanced', name: 'Advanced', grid: [] },
			{ id: 'one-shot', name: 'One shot', grid: [] },
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

function configState(value = config()): ShellConfigState {
	return {
		config: value,
		source: 'bundled',
		lastLoadedAt: null,
		lastError: null,
	};
}

function emptyStore(
	overrides: Partial<ShellKeyboardHistoryStore> = {},
): ShellKeyboardHistoryStore {
	const empty = () => createEmptyTextEntryHistoryState();
	return {
		load: empty,
		recordPaste: empty,
		pinText: empty,
		pinEntry: empty,
		unpinEntry: empty,
		deleteEntry: empty,
		clearRecent: empty,
		...overrides,
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

function history(text: string): TextEntryHistoryState {
	return recordTextEntryPaste(createEmptyTextEntryHistoryState(), text, {
		id: text,
		nowMs: 1,
	});
}

async function flush() {
	await Promise.resolve();
	await Promise.resolve();
}

void test('older pending history success survives a newer synchronous throw', async () => {
	const older = deferred<TextEntryHistoryState>();
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: emptyStore({
			recordPaste: (text) => {
				if (text === 'older') return older.promise;
				throw new Error('newer failed');
			},
		}),
	});
	core.recordAcceptedTextPaste('older');
	core.recordAcceptedTextPaste('newer');
	older.resolve(history('older'));
	await older.promise;
	await flush();
	assert.equal(core.getSnapshot().history.recent[0]?.text, 'older');
});

void test('older pending history success survives a newer asynchronous rejection', async () => {
	const older = deferred<TextEntryHistoryState>();
	const newer = deferred<TextEntryHistoryState>();
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: emptyStore({
			recordPaste: (text) => (text === 'older' ? older.promise : newer.promise),
		}),
	});
	core.recordAcceptedTextPaste('older');
	core.recordAcceptedTextPaste('newer');
	newer.reject(new Error('newer failed'));
	await assert.rejects(newer.promise);
	older.resolve(history('older'));
	await older.promise;
	await flush();
	assert.equal(core.getSnapshot().history.recent[0]?.text, 'older');
});

void test('newer successful history result wins over a later older completion', async () => {
	const older = deferred<TextEntryHistoryState>();
	const newer = deferred<TextEntryHistoryState>();
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: emptyStore({
			recordPaste: (text) => (text === 'older' ? older.promise : newer.promise),
		}),
	});
	core.recordAcceptedTextPaste('older');
	core.recordAcceptedTextPaste('newer');
	newer.resolve(history('newer'));
	await newer.promise;
	await flush();
	older.resolve(history('older'));
	await older.promise;
	await flush();
	assert.equal(core.getSnapshot().history.recent[0]?.text, 'newer');
});

void test('async initial load publishes after failed mutation but not after successful mutation', async () => {
	const loadAfterFailure = deferred<TextEntryHistoryState>();
	const failedCore = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: emptyStore({
			load: () => loadAfterFailure.promise,
			recordPaste: () => Promise.reject(new Error('failed')),
		}),
	});
	failedCore.recordAcceptedTextPaste('failed');
	loadAfterFailure.resolve(history('loaded'));
	await loadAfterFailure.promise;
	await flush();
	assert.equal(failedCore.getSnapshot().history.recent[0]?.text, 'loaded');

	const loadAfterSuccess = deferred<TextEntryHistoryState>();
	const successfulCore = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: emptyStore({
			load: () => loadAfterSuccess.promise,
			recordPaste: () => history('mutated'),
		}),
	});
	successfulCore.recordAcceptedTextPaste('mutated');
	loadAfterSuccess.resolve(history('stale-load'));
	await loadAfterSuccess.promise;
	await flush();
	assert.equal(successfulCore.getSnapshot().history.recent[0]?.text, 'mutated');
});

void test('async initial load rejection is contained and disposal blocks late load', async () => {
	const rejected = deferred<TextEntryHistoryState>();
	const warnings: unknown[] = [];
	createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: emptyStore({ load: () => rejected.promise }),
		logger: { warn: (_message, error) => warnings.push(error) },
	});
	rejected.reject(new Error('load failed'));
	await assert.rejects(rejected.promise);
	await flush();
	assert.equal(warnings.length, 1);

	const late = deferred<TextEntryHistoryState>();
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: emptyStore({ load: () => late.promise }),
	});
	core.dispose();
	late.resolve(history('late'));
	await late.promise;
	await flush();
	assert.deepEqual(core.getSnapshot().history.recent, []);
});

void test('sync initial load throw is contained', () => {
	const warnings: unknown[] = [];
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: emptyStore({
			load: () => {
				throw new Error('sync load failed');
			},
		}),
		logger: { warn: (_message, error) => warnings.push(error) },
	});
	assert.deepEqual(core.getSnapshot().history.recent, []);
	assert.equal(warnings.length, 1);
});

void test('reentrant history success commits the newest successful generation', () => {
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: emptyStore({ recordPaste: (text) => history(text) }),
	});
	let reentered = false;
	core.subscribe(() => {
		if (reentered) return;
		reentered = true;
		core.recordAcceptedTextPaste('reentrant');
	});
	core.recordAcceptedTextPaste('first');
	assert.equal(core.getSnapshot().history.recent[0]?.text, 'reentrant');
});

void test('temporary unavailability falls back without losing preferred keyboard', () => {
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: emptyStore(),
	});
	core.selectKeyboardIfExists('advanced');
	const removed = config();
	removed.activeKeyboardIds = ['main', 'one-shot'];
	core.setShellConfigState(configState(removed));
	assert.equal(core.getSnapshot().preferredKeyboardId, 'advanced');
	assert.equal(core.getSnapshot().selectedKeyboardId, 'main');
	core.setShellConfigState(configState(config()));
	assert.equal(core.getSnapshot().preferredKeyboardId, 'advanced');
	assert.equal(core.getSnapshot().selectedKeyboardId, 'advanced');
});

void test('one-shot completion updates preference using the latest routing config', () => {
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: emptyStore(),
	});
	core.selectKeyboardIfExists('one-shot');
	const updated = config();
	updated.keyboardRouting.oneShotReturnByKeyboardId = {
		'one-shot': 'advanced',
	};
	core.setShellConfigState(configState(updated));
	core.completeSlotPress();
	assert.equal(core.getSnapshot().preferredKeyboardId, 'advanced');
	assert.equal(core.getSnapshot().selectedKeyboardId, 'advanced');
});

void test('rotation skips unavailable definitions, wraps, and a single keyboard is a no-op', () => {
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: emptyStore(),
	});
	let publishes = 0;
	core.subscribe(() => {
		publishes += 1;
	});
	core.rotateKeyboard();
	assert.equal(core.getSnapshot().selectedKeyboardId, 'advanced');
	core.rotateKeyboard();
	assert.equal(core.getSnapshot().selectedKeyboardId, 'one-shot');
	core.rotateKeyboard();
	assert.equal(core.getSnapshot().selectedKeyboardId, 'main');
	core.selectKeyboardIfExists('main');
	core.selectKeyboardIfExists('absent');
	assert.equal(publishes, 3);

	const single = config();
	single.activeKeyboardIds = ['main', 'missing'];
	core.setShellConfigState(configState(single));
	const before = publishes;
	core.rotateKeyboard();
	assert.equal(publishes, before);
});

void test('unrelated snapshot updates preserve frozen structural references', () => {
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: emptyStore({ recordPaste: () => history('saved') }),
	});
	const initial = core.getSnapshot();
	core.setSystemKeyboardEnabled(true);
	const mode = core.getSnapshot();
	assert.equal(mode.systemKeyboardEnabled, true);
	assert.strictEqual(mode.shellConfigState, initial.shellConfigState);
	assert.strictEqual(mode.keyboard, initial.keyboard);
	assert.strictEqual(mode.macros, initial.macros);
	assert.strictEqual(mode.history, initial.history);
	core.toggleModifier('CTRL');
	const modifier = core.getSnapshot();
	assert.strictEqual(modifier.shellConfigState, initial.shellConfigState);
	assert.strictEqual(modifier.keyboard, initial.keyboard);
	assert.strictEqual(modifier.macros, initial.macros);
	assert.strictEqual(modifier.history, initial.history);

	core.selectKeyboardIfExists('advanced');
	const selected = core.getSnapshot();
	assert.strictEqual(selected.shellConfigState, initial.shellConfigState);
	assert.strictEqual(selected.history, initial.history);
	assert.notStrictEqual(selected.keyboard, initial.keyboard);

	core.recordAcceptedTextPaste('saved');
	const withHistory = core.getSnapshot();
	assert.strictEqual(withHistory.shellConfigState, initial.shellConfigState);
	assert.strictEqual(withHistory.keyboard, selected.keyboard);
	assert.equal(Object.isFrozen(withHistory.history.state.entries[0]), true);
});

void test('authoritative history results are cloned before publication', () => {
	const authoritative = history('saved');
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: emptyStore({ recordPaste: () => authoritative }),
	});
	core.recordAcceptedTextPaste('saved');
	authoritative.entries[0]!.text = 'mutated by caller';
	assert.equal(core.getSnapshot().history.recent[0]?.text, 'saved');
	assert.equal(Object.isFrozen(core.getSnapshot().history.recent), true);
});

void test('modifier edge cases retain canonical byte behavior', () => {
	const core = createShellKeyboardStateCore({
		initialShellConfigState: configState(),
		historyStore: emptyStore(),
	});
	core.toggleModifier('CTRL');
	assert.deepEqual(Array.from(core.applyModifiers(new Uint8Array([32]))), [0]);
	assert.deepEqual(Array.from(core.applyModifiers(new Uint8Array([63]))), [
		127,
	]);
	assert.deepEqual(Array.from(core.applyModifiers(new Uint8Array())), []);
	core.toggleModifier('CTRL');
	core.toggleModifier('SHIFT');
	assert.deepEqual(Array.from(core.applyModifiers(new Uint8Array([65]))), [65]);
	core.toggleModifier('SHIFT');
	core.toggleModifier('ALT');
	assert.deepEqual(
		Array.from(core.applyModifiers(new Uint8Array([27, 65]))),
		[27, 65],
	);
});
