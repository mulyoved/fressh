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

void test('missing macro snapshot reentry returns superseded while a present macro remains current', async () => {
	const missing = createKeyboardInputHarness();
	let newer: Promise<ControllerOutcome<{ message: string }>> | null = null;
	missing.setStateSnapshotHook((call) => {
		if (call !== 5) return;
		missing.setStateSnapshotHook(null);
		newer = missing.core.sendTextRaw('new');
	});
	assert.deepEqual(
		await missing.core.handleSlotPress({
			type: 'macro',
			macroId: 'missing',
			label: 'Missing',
			icon: null,
		}),
		{ status: 'superseded' },
	);
	assert.deepEqual(await newer, { status: 'completed' });
	assert.deepEqual(missing.sent, [[[0x6e, 0x65, 0x77]]]);

	const present = createKeyboardInputHarness();
	present.setMacros([
		{
			id: 'present',
			name: 'Present',
			label: 'Present',
			category: 'test',
			script: '{"type":"text","value":"present"}',
		},
	]);
	assert.deepEqual(
		await present.core.handleSlotPress({
			type: 'macro',
			macroId: 'present',
			label: 'Present',
			icon: null,
		}),
		{ status: 'completed' },
	);
	assert.deepEqual(present.completedSlots, ['complete']);
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

void test('completion callback reentry supersedes the completed action after committing once', async () => {
	const harness = createKeyboardInputHarness();
	let newer: Promise<ControllerOutcome<{ message: string }>> | null = null;
	harness.setCompleteSlotImplementation(() => {
		harness.setCompleteSlotImplementation(null);
		newer = harness.core.sendTextRaw('new');
	});
	assert.deepEqual(
		await harness.core.handleSlotPress({
			type: 'action',
			actionId: 'OPEN_COMMANDER',
			label: 'Commander',
			icon: null,
		}),
		{ status: 'superseded' },
	);
	assert.deepEqual(await newer, { status: 'completed' });
	assert.deepEqual(harness.completedSlots, ['complete']);
	assert.deepEqual(harness.sent, [[[0x6e, 0x65, 0x77]]]);
});

void test('completion throw is failed when current and superseded when logger reenters', async () => {
	const current = createKeyboardInputHarness();
	current.setCompleteSlotImplementation(() => {
		throw new Error('complete failed');
	});
	assert.deepEqual(
		await current.core.handleSlotPress({
			type: 'action',
			actionId: 'OPEN_COMMANDER',
			label: 'Commander',
			icon: null,
		}),
		{ status: 'failed', failure: { message: 'Keyboard input failed.' } },
	);
	assert.deepEqual(current.completedSlots, ['complete']);

	const stale = createKeyboardInputHarness();
	stale.setCompleteSlotImplementation(() => {
		throw new Error('complete failed');
	});
	let newer: Promise<ControllerOutcome<{ message: string }>> | null = null;
	stale.setLoggerImplementation(() => {
		stale.setLoggerImplementation(null);
		stale.setCompleteSlotImplementation(null);
		newer = stale.core.sendTextRaw('new');
	});
	assert.deepEqual(
		await stale.core.handleSlotPress({
			type: 'action',
			actionId: 'OPEN_COMMANDER',
			label: 'Commander',
			icon: null,
		}),
		{ status: 'superseded' },
	);
	assert.deepEqual(await newer, { status: 'completed' });
	assert.deepEqual(stale.completedSlots, ['complete']);
});

for (const slot of [
	{ type: 'text', text: 'a', label: 'Text', icon: null },
	{ type: 'bytes', bytes: [0x61], label: 'Bytes', icon: null },
] as const) {
	void test(`${slot.type} slot modifier throw is failed only while current`, async () => {
		const current = createKeyboardInputHarness();
		current.setApplyModifiersImplementation(() => {
			throw new Error('modifier failed');
		});
		assert.deepEqual(await current.core.handleSlotPress(slot), {
			status: 'failed',
			failure: { message: 'Keyboard input failed.' },
		});
		assert.deepEqual(current.sent, []);

		const stale = createKeyboardInputHarness();
		let replacement: Promise<ControllerOutcome<{ message: string }>> | null =
			null;
		stale.setApplyModifiersImplementation(() => {
			stale.setApplyModifiersImplementation(null);
			replacement = stale.core.sendTextRaw('new');
			throw new Error('modifier failed');
		});
		assert.deepEqual(await stale.core.handleSlotPress(slot), {
			status: 'superseded',
		});
		assert.deepEqual(await replacement, { status: 'completed' });
		assert.deepEqual(stale.sent, [[[0x6e, 0x65, 0x77]]]);
		assert.deepEqual(stale.completedSlots, []);

		const loggerStale = createKeyboardInputHarness();
		loggerStale.setApplyModifiersImplementation(() => {
			throw new Error('modifier failed');
		});
		let loggerReplacement: Promise<
			ControllerOutcome<{ message: string }>
		> | null = null;
		loggerStale.setLoggerImplementation(() => {
			loggerStale.setLoggerImplementation(null);
			loggerStale.setApplyModifiersImplementation(null);
			loggerReplacement = loggerStale.core.sendTextRaw('new');
		});
		assert.deepEqual(await loggerStale.core.handleSlotPress(slot), {
			status: 'superseded',
		});
		assert.deepEqual(await loggerReplacement, { status: 'completed' });
		assert.deepEqual(loggerStale.sent, [[[0x6e, 0x65, 0x77]]]);
		assert.deepEqual(loggerStale.completedSlots, []);
	});
}

void test('initial authority getter reentry is superseded while plain absence and throw stay unavailable', async () => {
	const getterCases = [
		(
			harness: ReturnType<typeof createKeyboardInputHarness>,
			hook: () => void,
		) => harness.setActivityReadHook(hook),
		(
			harness: ReturnType<typeof createKeyboardInputHarness>,
			hook: () => void,
		) => harness.setRuntimeKeyReadHook(hook),
		(
			harness: ReturnType<typeof createKeyboardInputHarness>,
			hook: () => void,
		) => harness.setRuntimeInstanceReadHook(hook),
		(
			harness: ReturnType<typeof createKeyboardInputHarness>,
			hook: () => void,
		) => harness.setSourceReadHook(hook),
		(
			harness: ReturnType<typeof createKeyboardInputHarness>,
			hook: () => void,
		) =>
			harness.setStateSnapshotHook((call) => {
				if (call === 1) hook();
			}),
	];
	for (const setHook of getterCases) {
		const harness = createKeyboardInputHarness();
		let replacement: Promise<ControllerOutcome<{ message: string }>> | null =
			null;
		setHook(harness, () => {
			setHook(harness, () => undefined);
			replacement = harness.core.sendTextRaw('new');
			throw new Error('authority failed');
		});
		assert.deepEqual(await harness.core.sendTextRaw('old'), {
			status: 'superseded',
		});
		assert.deepEqual(await replacement, { status: 'completed' });
		assert.deepEqual(harness.sent, [[[0x6e, 0x65, 0x77]]]);
	}

	const missing = createKeyboardInputHarness();
	missing.setInteractive(false);
	assert.deepEqual(await missing.core.sendTextRaw('old'), {
		status: 'unavailable',
	});
	const throwing = createKeyboardInputHarness();
	throwing.setActivityReadHook(() => {
		throw new Error('authority failed');
	});
	assert.deepEqual(await throwing.core.sendTextRaw('old'), {
		status: 'unavailable',
	});
});

void test('initial authority logger reentry supersedes the failed snapshot', async () => {
	const harness = createKeyboardInputHarness();
	harness.setActivityReadHook(() => {
		throw new Error('authority failed');
	});
	let replacement: Promise<ControllerOutcome<{ message: string }>> | null =
		null;
	harness.setLoggerImplementation(() => {
		harness.setLoggerImplementation(null);
		harness.setActivityReadHook(null);
		replacement = harness.core.sendTextRaw('new');
	});
	assert.deepEqual(await harness.core.sendTextRaw('old'), {
		status: 'superseded',
	});
	assert.deepEqual(await replacement, { status: 'completed' });
	assert.deepEqual(harness.sent, [[[0x6e, 0x65, 0x77]]]);
});

void test('successful initial getter reentry stops before every later stale getter', async () => {
	const cases = [
		{
			setCurrent: (
				harness: ReturnType<typeof createKeyboardInputHarness>,
				hook: (() => void) | null,
			) => harness.setActivityReadHook(hook),
			setNext: (
				harness: ReturnType<typeof createKeyboardInputHarness>,
				hook: (() => void) | null,
			) => harness.setRuntimeKeyReadHook(hook),
		},
		{
			setCurrent: (
				harness: ReturnType<typeof createKeyboardInputHarness>,
				hook: (() => void) | null,
			) => harness.setRuntimeKeyReadHook(hook),
			setNext: (
				harness: ReturnType<typeof createKeyboardInputHarness>,
				hook: (() => void) | null,
			) => harness.setRuntimeInstanceReadHook(hook),
		},
		{
			setCurrent: (
				harness: ReturnType<typeof createKeyboardInputHarness>,
				hook: (() => void) | null,
			) => harness.setRuntimeInstanceReadHook(hook),
			setNext: (
				harness: ReturnType<typeof createKeyboardInputHarness>,
				hook: (() => void) | null,
			) => harness.setSourceReadHook(hook),
		},
		{
			setCurrent: (
				harness: ReturnType<typeof createKeyboardInputHarness>,
				hook: (() => void) | null,
			) => harness.setSourceReadHook(hook),
			setNext: (
				harness: ReturnType<typeof createKeyboardInputHarness>,
				hook: (() => void) | null,
			) => harness.setStateSnapshotHook(hook ? () => hook() : null),
		},
	];
	for (const boundary of cases) {
		const harness = createKeyboardInputHarness();
		let inReplacement = false;
		let staleGetterCalls = 0;
		let replacement: Promise<ControllerOutcome<{ message: string }>> | null =
			null;
		boundary.setNext(harness, () => {
			if (!inReplacement) staleGetterCalls += 1;
		});
		boundary.setCurrent(harness, () => {
			boundary.setCurrent(harness, null);
			inReplacement = true;
			replacement = harness.core.sendTextRaw('new');
			inReplacement = false;
		});
		const old = harness.core.sendTextRaw('old');
		boundary.setNext(harness, null);
		assert.deepEqual(await old, {
			status: 'superseded',
		});
		assert.deepEqual(await replacement, { status: 'completed' });
		assert.equal(staleGetterCalls, 0);
		assert.deepEqual(harness.sent, [[[0x6e, 0x65, 0x77]]]);
	}
});

void test('successful final config reentry supersedes even a mismatched WebView instance', async () => {
	const harness = createKeyboardInputHarness();
	let replacement: Promise<ControllerOutcome<{ message: string }>> | null =
		null;
	harness.setStateSnapshotHook((call) => {
		if (call !== 1) return;
		harness.setStateSnapshotHook(null);
		replacement = harness.core.sendTextRaw('new');
	});
	assert.deepEqual(
		await harness.core.onWebViewInput({ str: 'old', instanceId: 'wrong' }),
		{ status: 'superseded' },
	);
	assert.deepEqual(await replacement, { status: 'completed' });
	assert.deepEqual(harness.sent, [[[0x6e, 0x65, 0x77]]]);
});

void test('modifier toggle and macro collection failures revalidate after callbacks and logging', async () => {
	const modifierSlot = {
		type: 'modifier',
		modifier: 'CTRL',
		label: 'Ctrl',
		icon: null,
	} as const;
	const current = createKeyboardInputHarness();
	current.setToggleModifierImplementation(() => {
		throw new Error('toggle failed');
	});
	assert.equal(
		(await current.core.handleSlotPress(modifierSlot)).status,
		'failed',
	);

	for (const reenterFromLogger of [false, true]) {
		const harness = createKeyboardInputHarness();
		let replacement: Promise<ControllerOutcome<{ message: string }>> | null =
			null;
		harness.setToggleModifierImplementation(() => {
			if (!reenterFromLogger) {
				harness.setToggleModifierImplementation(null);
				replacement = harness.core.sendTextRaw('new');
			}
			throw new Error('toggle failed');
		});
		if (reenterFromLogger) {
			harness.setLoggerImplementation(() => {
				harness.setLoggerImplementation(null);
				harness.setToggleModifierImplementation(null);
				replacement = harness.core.sendTextRaw('new');
			});
		}
		assert.deepEqual(await harness.core.handleSlotPress(modifierSlot), {
			status: 'superseded',
		});
		assert.deepEqual(await replacement, { status: 'completed' });
		assert.deepEqual(harness.sent, [[[0x6e, 0x65, 0x77]]]);
	}

	const macroSlot = {
		type: 'macro',
		macroId: 'throwing',
		label: 'Macro',
		icon: null,
	} as const;
	const macroHarness = createKeyboardInputHarness();
	macroHarness.setMacros([
		{
			id: 'throwing',
			name: 'Throwing',
			label: 'Throwing',
			category: 'test',
			script: Symbol('bad') as unknown as string,
		},
	]);
	assert.equal(
		(await macroHarness.core.handleSlotPress(macroSlot)).status,
		'failed',
	);

	const macroReentrant = createKeyboardInputHarness();
	let macroReplacement: Promise<ControllerOutcome<{ message: string }>> | null =
		null;
	const reentrantMacro = {
		id: 'throwing',
		name: 'Throwing',
		label: 'Throwing',
		category: 'test',
		script: '',
	};
	Object.defineProperty(reentrantMacro, 'script', {
		enumerable: true,
		get: () => {
			macroReplacement = macroReentrant.core.sendTextRaw('new');
			throw new Error('macro failed');
		},
	});
	macroReentrant.setMacros([reentrantMacro]);
	assert.deepEqual(await macroReentrant.core.handleSlotPress(macroSlot), {
		status: 'superseded',
	});
	assert.deepEqual(await macroReplacement, { status: 'completed' });
	assert.deepEqual(macroReentrant.sent, [[[0x6e, 0x65, 0x77]]]);

	const loggerStale = createKeyboardInputHarness();
	loggerStale.setMacros([
		{
			id: 'throwing',
			name: 'Throwing',
			label: 'Throwing',
			category: 'test',
			script: Symbol('bad') as unknown as string,
		},
	]);
	let replacement: Promise<ControllerOutcome<{ message: string }>> | null =
		null;
	loggerStale.setLoggerImplementation(() => {
		loggerStale.setLoggerImplementation(null);
		replacement = loggerStale.core.sendTextRaw('new');
	});
	assert.deepEqual(await loggerStale.core.handleSlotPress(macroSlot), {
		status: 'superseded',
	});
	assert.deepEqual(await replacement, { status: 'completed' });
	assert.deepEqual(loggerStale.sent, [[[0x6e, 0x65, 0x77]]]);
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
