import assert from 'node:assert/strict';
import test from 'node:test';

import { type ControllerOutcome } from '../../src/lib/shell-controllers/controller-core';
import { createKeyboardInputHarness } from './shell-keyboard-input-controller-test-support';

void test('final authority getter reentry cannot let an older request send', async () => {
	const harness = createKeyboardInputHarness();
	let newer: Promise<ControllerOutcome<{ message: string }>> | null = null;
	harness.setStateSnapshotHook((call) => {
		if (call !== 5) return;
		harness.setStateSnapshotHook(null);
		newer = harness.core.sendTextRaw('new');
	});
	assert.deepEqual(await harness.core.sendTextRaw('old'), {
		status: 'superseded',
	});
	assert.deepEqual(await newer, { status: 'completed' });
	assert.deepEqual(harness.sent, [[[0x6e, 0x65, 0x77]]]);
});

void test('final authority getter reentry blocks stale accepted history', async () => {
	const harness = createKeyboardInputHarness();
	let newer: Promise<ControllerOutcome<{ message: string }>> | null = null;
	harness.setSendImplementation((options) => {
		harness.setStateSnapshotHook((call) => {
			if (call !== 1) return;
			harness.setStateSnapshotHook(null);
			harness.setSendImplementation(null);
			newer = harness.core.sendTextRaw('new');
		});
		options?.onAccepted?.();
		return { status: 'completed' };
	});
	assert.deepEqual(await harness.core.pasteTextEntry('old'), {
		status: 'superseded',
	});
	assert.deepEqual(await newer, { status: 'completed' });
	assert.deepEqual(harness.recordedHistory, []);
});

void test('final authority getter reentry blocks stale accepted one-shot', async () => {
	const harness = createKeyboardInputHarness();
	let newer: Promise<ControllerOutcome<{ message: string }>> | null = null;
	harness.setSendImplementation((options) => {
		harness.setStateSnapshotHook((call) => {
			if (call !== 2) return;
			harness.setStateSnapshotHook(null);
			harness.setSendImplementation(null);
			newer = harness.core.sendTextRaw('new');
		});
		options?.onAccepted?.();
		return { status: 'completed' };
	});
	assert.deepEqual(
		await harness.core.handleSlotPress({
			type: 'text',
			text: 'old',
			label: 'Old',
			icon: null,
		}),
		{ status: 'superseded' },
	);
	assert.deepEqual(await newer, { status: 'completed' });
	assert.deepEqual(harness.completedSlots, []);
});

void test('bytes and macro slot snapshot throws are contained as current failures', async () => {
	for (const slot of [
		{ type: 'bytes' as const, bytes: [0x1b], label: 'Esc', icon: null },
		{ type: 'macro' as const, macroId: 'missing', label: 'Macro', icon: null },
	]) {
		const harness = createKeyboardInputHarness();
		harness.throwOnStateSnapshotCall(5);
		assert.equal((await harness.core.handleSlotPress(slot)).status, 'failed');
		assert.deepEqual(harness.sent, []);
		assert.deepEqual(harness.completedSlots, []);
		assert.equal(harness.warnings.length, 1);
	}
});

void test('slot snapshot throw becomes superseded when the failure formatter reenters', async () => {
	const harness = createKeyboardInputHarness();
	harness.throwOnStateSnapshotCall(5);
	let newer: Promise<ControllerOutcome<{ message: string }>> | null = null;
	// Warning is the only callback after the throw and before final authority check.
	const warnings = harness.warnings;
	harness.setStateSnapshotHook((call) => {
		if (call !== 6) return;
		harness.setStateSnapshotHook(null);
		newer = harness.core.sendTextRaw('new');
	});
	assert.equal(
		(
			await harness.core.handleSlotPress({
				type: 'bytes',
				bytes: [0x1b],
				label: 'Esc',
				icon: null,
			})
		).status,
		'superseded',
	);
	assert.deepEqual(await newer, { status: 'completed' });
	assert.equal(warnings.length, 1);
});

void test('repeat zero macro step is a delayed no-op and later step completes one-shot', async () => {
	const harness = createKeyboardInputHarness();
	harness.setMacros([
		{
			id: 'zero',
			name: 'Zero',
			label: 'Zero',
			category: 'test',
			script:
				'{"type":"steps","steps":[{"type":"text","data":"skip","repeat":0,"delayMs":20},{"type":"enter"}]}',
		},
	]);
	const pending = harness.core.handleSlotPress({
		type: 'macro',
		macroId: 'zero',
		label: 'Zero',
		icon: null,
	});
	harness.clock.advanceBy(20);
	await harness.clock.settled();
	assert.deepEqual(harness.sent, []);
	assert.deepEqual(harness.completedSlots, []);
	harness.clock.advanceBy(49);
	await harness.clock.settled();
	assert.deepEqual(harness.sent, []);
	harness.clock.advanceBy(1);
	await harness.clock.settled();
	assert.deepEqual(await pending, { status: 'completed' });
	assert.deepEqual(harness.sent, [[[0x0d]]]);
	assert.deepEqual(harness.completedSlots, ['complete']);
});

void test('macro config snapshot reentry cannot run or complete the stale macro', async () => {
	const harness = createKeyboardInputHarness();
	harness.setMacros([
		{
			id: 'old',
			name: 'Old',
			label: 'Old',
			category: 'test',
			script: '{"type":"text","value":"old"}',
		},
	]);
	let newer: Promise<ControllerOutcome<{ message: string }>> | null = null;
	harness.setStateSnapshotHook((call) => {
		if (call !== 5) return;
		harness.setStateSnapshotHook(null);
		newer = harness.core.sendTextRaw('new');
	});
	assert.deepEqual(
		await harness.core.handleSlotPress({
			type: 'macro',
			macroId: 'old',
			label: 'Old',
			icon: null,
		}),
		{ status: 'superseded' },
	);
	assert.deepEqual(await newer, { status: 'completed' });
	assert.deepEqual(harness.sent, [[[0x6e, 0x65, 0x77]]]);
	assert.deepEqual(harness.completedSlots, []);
});

void test('current selection exit throw returns failed while reentry stays superseded', async () => {
	const failed = createKeyboardInputHarness();
	failed.setSelectionModeEnabled(true);
	failed.setTerminalSelectionImplementation(() => {
		throw new Error('selection failed');
	});
	assert.equal((await failed.core.sendTextRaw('blocked')).status, 'failed');
	assert.deepEqual(failed.sent, []);

	const stale = createKeyboardInputHarness();
	stale.setSelectionModeEnabled(true);
	let newer: Promise<ControllerOutcome<{ message: string }>> | null = null;
	stale.setTerminalSelectionImplementation(() => {
		stale.setTerminalSelectionImplementation(null);
		newer = stale.core.sendTextRaw('new');
	});
	assert.deepEqual(await stale.core.sendTextRaw('old'), {
		status: 'superseded',
	});
	assert.deepEqual(await newer, { status: 'completed' });
	assert.deepEqual(stale.sent, [[[0x6e, 0x65, 0x77]]]);
});

void test('action outcomes propagate exactly and only completed actions finish one-shot', async () => {
	const cases = [
		{ outcome: { status: 'completed' } as const, completes: true },
		{ outcome: { status: 'unavailable' } as const, completes: false },
		{ outcome: { status: 'superseded' } as const, completes: false },
		{
			outcome: {
				status: 'failed',
				failure: { message: 'action failed' },
			} as const,
			completes: false,
		},
	];
	for (const { outcome, completes } of cases) {
		const harness = createKeyboardInputHarness();
		harness.setActionImplementation(() => outcome);
		assert.deepEqual(
			await harness.core.handleSlotPress({
				type: 'action',
				actionId: 'OPEN_COMMANDER',
				label: 'Commander',
				icon: null,
			}),
			outcome,
		);
		assert.equal(harness.completedSlots.length, completes ? 1 : 0);
	}

	const rejected = createKeyboardInputHarness();
	rejected.setActionImplementation(() => Promise.reject(new Error('rejected')));
	assert.deepEqual(
		await rejected.core.handleSlotPress({
			type: 'action',
			actionId: 'OPEN_COMMANDER',
			label: 'Commander',
			icon: null,
		}),
		{ status: 'failed', failure: { message: 'Keyboard action failed.' } },
	);
	assert.deepEqual(rejected.completedSlots, []);
});

void test('duplicate acceptance records text history exactly once', async () => {
	const harness = createKeyboardInputHarness();
	harness.setSendImplementation((options) => {
		options?.onAccepted?.();
		options?.onAccepted?.();
		return { status: 'completed' };
	});
	assert.deepEqual(await harness.core.pasteTextEntry('once'), {
		status: 'completed',
	});
	assert.deepEqual(harness.recordedHistory, ['once']);
});

void test('close-command-menu throw is contained and reentry supersedes only old steps', async () => {
	const throwing = createKeyboardInputHarness();
	throwing.setCloseCommandMenuImplementation(() => {
		throw new Error('close failed');
	});
	const continued = throwing.core.runCommandSteps([
		{ type: 'text', data: 'continued' },
	]);
	throwing.clock.advanceBy(0);
	await throwing.clock.settled();
	assert.deepEqual(await continued, { status: 'completed' });
	assert.deepEqual(throwing.warnings, ['Failed to close command menu']);

	const reentrant = createKeyboardInputHarness();
	let newer: Promise<ControllerOutcome<{ message: string }>> | null = null;
	reentrant.setCloseCommandMenuImplementation(() => {
		reentrant.setCloseCommandMenuImplementation(null);
		newer = reentrant.core.sendTextRaw('new');
	});
	assert.deepEqual(
		await reentrant.core.runCommandSteps([{ type: 'text', data: 'old' }]),
		{ status: 'superseded' },
	);
	assert.deepEqual(await newer, { status: 'completed' });
	reentrant.clock.advanceBy(0);
	assert.deepEqual(reentrant.sent, [[[0x6e, 0x65, 0x77]]]);
});

void test('dispose closes admission before reentrant timer cancellation', async () => {
	const harness = createKeyboardInputHarness();
	const pending = harness.core.runCommandSteps([
		{ type: 'text', data: 'old', delayMs: 10 },
	]);
	let reentrantInput: Promise<ControllerOutcome<{ message: string }>> | null =
		null;
	let reentrantSteps: Promise<ControllerOutcome<{ message: string }>> | null =
		null;
	harness.clock.setClearHook(() => {
		harness.clock.setClearHook(null);
		reentrantInput = harness.core.sendTextRaw('new');
		reentrantSteps = harness.core.runCommandSteps([
			{ type: 'text', data: 'newer' },
		]);
	});
	harness.core.dispose();
	assert.deepEqual(await pending, { status: 'superseded' });
	assert.deepEqual(await reentrantInput, { status: 'unavailable' });
	assert.deepEqual(await reentrantSteps, { status: 'unavailable' });
	assert.deepEqual(harness.sent, []);
	assert.equal(harness.clock.pendingCount(), 0);
});
