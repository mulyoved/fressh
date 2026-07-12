import assert from 'node:assert/strict';
import test from 'node:test';

import { runAction, type ActionContext } from '../../src/lib/keyboard-actions';
import { createKeyboardClipboardAuthority } from '../../src/lib/shell-controllers/keyboard-hook-runtime';
import { createKeyboardInputHarness } from './shell-keyboard-input-controller-test-support';

void test('composed COPY_SELECTION awaits clipboard finalization and has one completion owner', async () => {
	for (const writeFails of [false, true]) {
		const harness = createKeyboardInputHarness();
		const authority = createKeyboardClipboardAuthority();
		const events: string[] = [];
		const context: ActionContext = {
			availableKeyboardIds: new Set(),
			selectKeyboard: () => {},
			rotateKeyboard: () => {},
			openConfigurator: () => {},
			sendBytes: () => {},
			pasteClipboard: async () => {},
			copySelection: () =>
				authority.copy({
					isAdmitted: () => true,
					getInstanceId: () => 'instance',
					getSelection: async () => 'selection',
					isCurrentInstance: () => true,
					writeClipboard: async () => {
						events.push('write');
						if (writeFails) throw new Error('write failed');
					},
					exitSelectionState: () => events.push('state'),
					exitSelectionView: () => events.push('view'),
					warn: () => events.push('warn'),
				}),
		};
		harness.setActionImplementation((actionId, options) =>
			runAction(actionId, context, options),
		);
		const result = await harness.core.handleSlotPress({
			type: 'action',
			actionId: 'COPY_SELECTION',
			label: 'Copy',
			icon: null,
		});
		assert.equal(result.status, writeFails ? 'failed' : 'completed');
		assert.deepEqual(
			events,
			writeFails ? ['write', 'warn'] : ['write', 'state', 'view'],
		);
		assert.equal(harness.completedSlots.length, writeFails ? 0 : 1);
	}
});

void test('composed overlapping identical COPY_SELECTION joins finalization and completes one-shot once', async () => {
	const harness = createKeyboardInputHarness();
	const authority = createKeyboardClipboardAuthority();
	const events: string[] = [];
	let release!: () => void;
	const write = new Promise<void>((resolve) => {
		release = resolve;
	});
	const context: ActionContext = {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () =>
			authority.copy({
				isAdmitted: () => true,
				getInstanceId: () => 'instance',
				getSelection: async () => 'selection',
				isCurrentInstance: () => true,
				writeClipboard: async () => {
					events.push('write');
					await write;
				},
				exitSelectionState: () => events.push('state'),
				exitSelectionView: () => events.push('view'),
				warn: () => events.push('warn'),
			}),
	};
	harness.setActionImplementation((actionId, options) =>
		runAction(actionId, context, options),
	);
	const slot = {
		type: 'action' as const,
		actionId: 'COPY_SELECTION',
		label: 'Copy',
		icon: null,
	};
	const first = harness.core.handleSlotPress(slot);
	await Promise.resolve();
	await Promise.resolve();
	const duplicate = harness.core.handleSlotPress(slot);
	await Promise.resolve();
	await Promise.resolve();
	assert.deepEqual(events, ['write']);
	release();
	assert.deepEqual(await Promise.all([first, duplicate]), [
		{ status: 'superseded' },
		{ status: 'completed' },
	]);
	assert.deepEqual(events, ['write', 'state', 'view']);
	assert.deepEqual(harness.completedSlots, ['complete']);
});

void test('slow overlapping identical COPY_SELECTION inherits completed cohort while sequential duplicate stays unavailable', async () => {
	const harness = createKeyboardInputHarness();
	const authority = createKeyboardClipboardAuthority();
	const events: string[] = [];
	let selectionRead = 0;
	let resolveSlowSelection!: (text: string) => void;
	const slowSelection = new Promise<string>((resolve) => {
		resolveSlowSelection = resolve;
	});
	let releaseWrite!: () => void;
	const write = new Promise<void>((resolve) => {
		releaseWrite = resolve;
	});
	const context: ActionContext = {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () =>
			authority.copy({
				isAdmitted: () => true,
				getInstanceId: () => 'instance',
				getSelection: async () => {
					selectionRead += 1;
					return selectionRead === 2 ? slowSelection : 'selection';
				},
				isCurrentInstance: () => true,
				writeClipboard: async () => {
					events.push('write');
					await write;
				},
				exitSelectionState: () => events.push('state'),
				exitSelectionView: () => events.push('view'),
				warn: () => events.push('warn'),
			}),
	};
	harness.setActionImplementation((actionId, options) =>
		runAction(actionId, context, options),
	);
	const slot = {
		type: 'action' as const,
		actionId: 'COPY_SELECTION',
		label: 'Copy',
		icon: null,
	};
	const first = harness.core.handleSlotPress(slot);
	await Promise.resolve();
	await Promise.resolve();
	const slowOverlap = harness.core.handleSlotPress(slot);
	await Promise.resolve();
	await Promise.resolve();
	releaseWrite();
	assert.deepEqual(await first, { status: 'superseded' });
	assert.deepEqual(events, ['write', 'state', 'view']);
	resolveSlowSelection('selection');
	assert.deepEqual(await slowOverlap, { status: 'completed' });
	assert.deepEqual(events, ['write', 'state', 'view']);
	assert.deepEqual(harness.completedSlots, ['complete']);

	assert.deepEqual(await harness.core.handleSlotPress(slot), {
		status: 'unavailable',
	});
	assert.deepEqual(events, ['write', 'state', 'view']);
	assert.deepEqual(harness.completedSlots, ['complete']);
});

void test('selection change during composed clipboard write supersedes without exits or one-shot', async () => {
	const harness = createKeyboardInputHarness();
	const authority = createKeyboardClipboardAuthority();
	const events: string[] = [];
	let releaseWrite!: () => void;
	const write = new Promise<void>((resolve) => {
		releaseWrite = resolve;
	});
	const context: ActionContext = {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () =>
			authority.copy({
				isAdmitted: () => true,
				getInstanceId: () => 'instance',
				getSelection: async () => 'old',
				isCurrentInstance: () => true,
				writeClipboard: async () => {
					events.push('write');
					await write;
				},
				exitSelectionState: () => events.push('state'),
				exitSelectionView: () => events.push('view'),
				warn: () => events.push('warn'),
			}),
	};
	harness.setActionImplementation((actionId, options) =>
		runAction(actionId, context, options),
	);
	const pending = harness.core.handleSlotPress({
		type: 'action',
		actionId: 'COPY_SELECTION',
		label: 'Copy',
		icon: null,
	});
	await Promise.resolve();
	await Promise.resolve();
	authority.noteSelection('new', 'instance');
	assert.deepEqual(await pending, { status: 'superseded' });
	assert.deepEqual(events, ['write']);
	assert.deepEqual(harness.completedSlots, []);
	releaseWrite();
	await Promise.resolve();
	assert.deepEqual(events, ['write']);
});

void test('composed invalidated slow copy cannot join newer active identical authority', async () => {
	const harness = createKeyboardInputHarness();
	const authority = createKeyboardClipboardAuthority();
	const events: string[] = [];
	let selectionRead = 0;
	let resolveOldSelection!: (text: string) => void;
	const oldSelection = new Promise<string>((resolve) => {
		resolveOldSelection = resolve;
	});
	let releaseNewWrite!: () => void;
	const newWrite = new Promise<void>((resolve) => {
		releaseNewWrite = resolve;
	});
	const context: ActionContext = {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () =>
			authority.copy({
				isAdmitted: () => true,
				getInstanceId: () => 'instance',
				getSelection: () => {
					selectionRead += 1;
					return selectionRead === 1 ? oldSelection : Promise.resolve('same');
				},
				isCurrentInstance: () => true,
				writeClipboard: async () => {
					events.push('write');
					await newWrite;
				},
				exitSelectionState: () => events.push('state'),
				exitSelectionView: () => events.push('view'),
				warn: () => events.push('warn'),
			}),
	};
	harness.setActionImplementation((actionId, options) =>
		runAction(actionId, context, options),
	);
	const slot = {
		type: 'action' as const,
		actionId: 'COPY_SELECTION',
		label: 'Copy',
		icon: null,
	};
	const old = harness.core.handleSlotPress(slot);
	await Promise.resolve();
	authority.invalidate();
	harness.core.invalidate('runtime-reset');
	const current = harness.core.handleSlotPress(slot);
	await Promise.resolve();
	await Promise.resolve();
	resolveOldSelection('same');
	assert.deepEqual(await old, { status: 'superseded' });
	assert.deepEqual(events, ['write']);
	releaseNewWrite();
	assert.deepEqual(await current, { status: 'completed' });
	assert.deepEqual(events, ['write', 'state', 'view']);
	assert.deepEqual(harness.completedSlots, ['complete']);
});

void test('controller-owned selection clear during finalization does not self-supersede', async () => {
	const harness = createKeyboardInputHarness();
	const authority = createKeyboardClipboardAuthority();
	const events: string[] = [];
	const context: ActionContext = {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () =>
			authority.copy({
				isAdmitted: () => true,
				getInstanceId: () => 'instance',
				getSelection: async () => 'selection',
				isCurrentInstance: () => true,
				writeClipboard: async () => {
					events.push('write');
				},
				exitSelectionState: () => {
					events.push('state');
					authority.noteSelection('', 'instance');
				},
				exitSelectionView: () => events.push('view'),
				warn: () => events.push('warn'),
			}),
	};
	harness.setActionImplementation((actionId, options) =>
		runAction(actionId, context, options),
	);
	assert.deepEqual(
		await harness.core.handleSlotPress({
			type: 'action',
			actionId: 'COPY_SELECTION',
			label: 'Copy',
			icon: null,
		}),
		{ status: 'completed' },
	);
	assert.deepEqual(events, ['write', 'state', 'view']);
	assert.deepEqual(harness.completedSlots, ['complete']);
});
