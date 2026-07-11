import assert from 'node:assert/strict';
import test from 'node:test';

import { type ControllerOutcome } from '../../src/lib/shell-controllers/controller-core';
import { createKeyboardInputHarness } from './shell-keyboard-input-controller-test-support';

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

void test('reentrant WebView currentness cannot retarget stale input', async () => {
	const harness = createKeyboardInputHarness();
	harness.setCurrentnessImplementation(() => {
		harness.replaceRuntime();
		return true;
	});
	assert.deepEqual(
		await harness.core.onWebViewInput({ str: 'a', instanceId: 'instance-1' }),
		{ status: 'superseded' },
	);
	assert.deepEqual(harness.sent, []);
});

void test('throwing WebView currentness fails closed without payload', async () => {
	const harness = createKeyboardInputHarness();
	harness.setCurrentnessImplementation(() => {
		throw new Error('currentness failed');
	});
	assert.deepEqual(
		await harness.core.onWebViewInput({ str: 'a', instanceId: 'instance-1' }),
		{ status: 'superseded' },
	);
	assert.deepEqual(harness.sent, []);
	assert.deepEqual(harness.warnings, [
		'Failed to validate keyboard input authority',
	]);
});

void test('source runtime activity and config replacement supersede pending input', async () => {
	for (const replace of [
		(harness: ReturnType<typeof createKeyboardInputHarness>) =>
			harness.replaceSource(),
		(harness: ReturnType<typeof createKeyboardInputHarness>) =>
			harness.replaceRuntime(),
		(harness: ReturnType<typeof createKeyboardInputHarness>) =>
			harness.setInteractive(false),
		(harness: ReturnType<typeof createKeyboardInputHarness>) =>
			harness.replaceConfigState(),
	]) {
		const harness = createKeyboardInputHarness();
		const pendingSend = deferred<ControllerOutcome<{ message: string }>>();
		harness.setSendImplementation(() => pendingSend.promise);
		const pending = harness.core.sendTextRaw('a');
		replace(harness);
		pendingSend.resolve({ status: 'completed' });
		assert.deepEqual(await pending, { status: 'superseded' });
	}
});

void test('thrown and rejected scrollback sends fail once without escaping', async () => {
	const sync = createKeyboardInputHarness();
	sync.setSendImplementation(() => {
		throw new Error('sync');
	});
	assert.equal((await sync.core.sendTextRaw('a')).status, 'failed');
	assert.deepEqual(sync.warnings, ['Failed to send keyboard input']);

	const async = createKeyboardInputHarness();
	async.setSendImplementation(async () => {
		throw new Error('async');
	});
	assert.equal((await async.core.sendTextRaw('a')).status, 'failed');
	assert.deepEqual(async.warnings, ['Failed to send keyboard input']);
});

void test('history failure is contained after accepted text-entry input', async () => {
	const harness = createKeyboardInputHarness();
	harness.setThrowHistory(true);
	assert.deepEqual(await harness.core.pasteTextEntry('accepted'), {
		status: 'completed',
	});
	assert.deepEqual(harness.recordedHistory, []);
	assert.deepEqual(harness.warnings, [
		'Failed to record accepted text-entry paste',
	]);
});

void test('acceptance records history even when accepted transport later fails', async () => {
	const harness = createKeyboardInputHarness();
	harness.setSendImplementation((options) => {
		options?.onAccepted?.();
		return { status: 'failed', failure: { message: 'write failed' } };
	});
	assert.equal(
		(await harness.core.pasteTextEntry('accepted')).status,
		'failed',
	);
	assert.deepEqual(harness.recordedHistory, ['accepted']);
});

void test('late stale acceptance callback cannot record text history', async () => {
	const harness = createKeyboardInputHarness();
	const send = deferred<ControllerOutcome<{ message: string }>>();
	let accept: (() => void) | undefined;
	harness.setSendImplementation((options) => {
		accept = options?.onAccepted;
		return send.promise;
	});
	const pending = harness.core.pasteTextEntry('stale');
	harness.core.invalidate('source-change');
	accept?.();
	send.resolve({ status: 'superseded' });
	assert.deepEqual(await pending, { status: 'superseded' });
	assert.deepEqual(harness.recordedHistory, []);
});

void test('clipboard commander and shortcut adapters preserve exact payload contracts', async () => {
	const harness = createKeyboardInputHarness();
	await harness.core.pasteClipboard('clip');
	await harness.core.executeCommanderCommand('  ls  ');
	await harness.core.pasteCommanderText(' raw ');
	await harness.core.sendShortcut('\x1b[A');
	assert.deepEqual(harness.sent, [
		[[0x63, 0x6c, 0x69, 0x70]],
		[[0x20, 0x20, 0x6c, 0x73, 0x20, 0x20], [0x0d]],
		[[0x20, 0x72, 0x61, 0x77, 0x20]],
		[[0x1b, 0x5b, 0x41]],
	]);
	assert.equal(harness.sendOptions[1]?.interSegmentDelayMs, 10);
	assert.deepEqual(await harness.core.executeCommanderCommand('   '), {
		status: 'unavailable',
	});
	assert.deepEqual(await harness.core.pasteCommanderText('   '), {
		status: 'unavailable',
	});
});

void test('latest command sequence replaces the prior sequence with one timer', async () => {
	const harness = createKeyboardInputHarness();
	const first = harness.core.runCommandSteps([
		{ type: 'text', data: 'old', delayMs: 100 },
	]);
	assert.equal(harness.clock.pendingCount(), 1);
	const second = harness.core.runCommandSteps([
		{ type: 'text', data: 'new', delayMs: 20 },
	]);
	assert.equal(harness.clock.pendingCount(), 1);
	assert.deepEqual(await first, { status: 'superseded' });
	harness.clock.advanceBy(20);
	await harness.clock.settled();
	assert.deepEqual(await second, { status: 'completed' });
	assert.deepEqual(harness.sent, [[[0x6e, 0x65, 0x77]]]);
	assert.equal(harness.clock.pendingCount(), 0);
});

void test('scheduler throw fails cleanly and timer reentry cannot cancel newer input', async () => {
	const failed = createKeyboardInputHarness();
	failed.clock.throwOnNextSchedule();
	assert.equal(
		(
			await failed.core.runCommandSteps([
				{ type: 'text', data: 'a', delayMs: 10 },
			])
		).status,
		'failed',
	);
	assert.deepEqual(failed.warnings, [
		'Failed to schedule keyboard command step',
	]);

	const reentrant = createKeyboardInputHarness();
	let newer: Promise<ControllerOutcome<{ message: string }>> | null = null;
	reentrant.clock.setScheduleHook(() => {
		reentrant.clock.setScheduleHook(null);
		newer = reentrant.core.sendTextRaw('new');
	});
	assert.deepEqual(
		await reentrant.core.runCommandSteps([
			{ type: 'text', data: 'old', delayMs: 10 },
		]),
		{ status: 'superseded' },
	);
	assert.deepEqual(await newer, { status: 'completed' });
	reentrant.clock.advanceBy(10);
	assert.deepEqual(reentrant.sent, [[[0x6e, 0x65, 0x77]]]);
});

void test('throwing timer cancellation is contained while invalidation settles sequence', async () => {
	const harness = createKeyboardInputHarness();
	const pending = harness.core.runCommandSteps([
		{ type: 'text', data: 'old', delayMs: 10 },
	]);
	harness.clock.throwOnNextClear();
	harness.core.invalidate('source-change');
	assert.deepEqual(await pending, { status: 'superseded' });
	assert.deepEqual(harness.warnings, [
		'Failed to cancel keyboard command timer',
	]);
});

void test('non-completed step outcomes stop all remaining scheduled work', async () => {
	for (const outcome of [
		{ status: 'unavailable' } as const,
		{ status: 'superseded' } as const,
		{ status: 'failed', failure: { message: 'no' } } as const,
	]) {
		const harness = createKeyboardInputHarness();
		harness.setOutcome(outcome);
		const pending = harness.core.runCommandSteps([
			{ type: 'text', data: 'a' },
			{ type: 'enter' },
		]);
		harness.clock.advanceBy(0);
		await harness.clock.settled();
		assert.deepEqual(await pending, outcome);
		assert.equal(harness.clock.pendingCount(), 0);
		assert.equal(harness.sent.length, 1);
	}
});

void test('every command step preserves canonical bytes and repeat order', async () => {
	const harness = createKeyboardInputHarness();
	const pending = harness.core.runCommandSteps([
		{ type: 'arrowDown', repeat: 2 },
		{ type: 'arrowUp', delayMs: 0 },
		{ type: 'esc', delayMs: 0 },
		{ type: 'space', delayMs: 0 },
		{ type: 'tab', delayMs: 0 },
	]);
	for (let index = 0; index < 5; index += 1) {
		harness.clock.advanceBy(0);
		await harness.clock.settled();
	}
	assert.deepEqual(await pending, { status: 'completed' });
	assert.deepEqual(harness.sent, [
		[
			[0x1b, 0x5b, 0x42],
			[0x1b, 0x5b, 0x42],
		],
		[[0x1b, 0x5b, 0x41]],
		[[0x1b]],
		[[0x20]],
		[[0x09]],
	]);
});

void test('preset snapshots all steps before scheduling', async () => {
	const harness = createKeyboardInputHarness();
	const preset = {
		type: 'preset' as const,
		label: 'Run',
		steps: [{ type: 'text' as const, data: 'before', delayMs: 10 }],
	};
	const pending = harness.core.runCommandPreset(preset);
	preset.steps[0]!.data = 'after';
	harness.clock.advanceBy(10);
	await harness.clock.settled();
	assert.deepEqual(await pending, { status: 'completed' });
	assert.deepEqual(harness.sent, [[[0x62, 0x65, 0x66, 0x6f, 0x72, 0x65]]]);
});

void test('runCommandSteps snapshots caller steps before external authority getters reenter', async () => {
	const harness = createKeyboardInputHarness();
	const steps = [
		{ type: 'text' as const, data: 'before', delayMs: 10 },
		{ type: 'enter' as const, delayMs: 0 },
	];
	harness.setActivityReadHook(() => {
		harness.setActivityReadHook(null);
		steps[0]!.data = 'after';
		steps.splice(1, 1, { type: 'text', data: 'injected', delayMs: 0 });
	});
	const pending = harness.core.runCommandSteps(steps);
	harness.clock.advanceBy(10);
	await harness.clock.settled();
	harness.clock.advanceBy(0);
	await harness.clock.settled();
	assert.deepEqual(await pending, { status: 'completed' });
	assert.deepEqual(harness.sent, [
		[[...new TextEncoder().encode('before')]],
		[[0x0d]],
	]);
});

void test('slot text bytes modifier and action complete one-shot after acceptance', async () => {
	const harness = createKeyboardInputHarness();
	await harness.core.handleSlotPress({
		type: 'text',
		text: 'a',
		label: 'A',
		icon: null,
	});
	await harness.core.handleSlotPress({
		type: 'bytes',
		bytes: [0x1b],
		label: 'Esc',
		icon: null,
	});
	await harness.core.handleSlotPress({
		type: 'modifier',
		modifier: 'CTRL',
		label: 'Ctrl',
		icon: null,
	});
	await harness.core.handleSlotPress({
		type: 'action',
		actionId: 'OPEN_COMMANDER',
		label: 'Commander',
		icon: null,
	});
	assert.deepEqual(harness.sent, [[[0x61]], [[0x1b]]]);
	assert.deepEqual(harness.modifierToggles, ['CTRL']);
	assert.deepEqual(
		harness.actions.map(({ actionId }) => actionId),
		['OPEN_COMMANDER'],
	);
	assert.equal(harness.completedSlots.length, 4);
});

void test('failed slot input does not complete one-shot', async () => {
	const harness = createKeyboardInputHarness();
	harness.setOutcome({ status: 'unavailable' });
	assert.deepEqual(
		await harness.core.handleSlotPress({
			type: 'text',
			text: 'a',
			label: 'A',
			icon: null,
		}),
		{ status: 'unavailable' },
	);
	assert.deepEqual(harness.completedSlots, []);
});

void test('accepted slot completes one-shot even when transport later fails', async () => {
	const harness = createKeyboardInputHarness();
	harness.setSendImplementation((options) => {
		options?.onAccepted?.();
		return { status: 'failed', failure: { message: 'write failed' } };
	});
	assert.equal(
		(
			await harness.core.handleSlotPress({
				type: 'text',
				text: 'a',
				label: 'A',
				icon: null,
			})
		).status,
		'failed',
	);
	assert.deepEqual(harness.completedSlots, ['complete']);
});

void test('slot completes one-shot immediately at acceptance exactly once despite later invalidation', async () => {
	const harness = createKeyboardInputHarness();
	const send = deferred<ControllerOutcome<{ message: string }>>();
	harness.setSendImplementation((options) => {
		options?.onAccepted?.();
		options?.onAccepted?.();
		return send.promise;
	});
	const pending = harness.core.handleSlotPress({
		type: 'text',
		text: 'a',
		label: 'A',
		icon: null,
	});
	assert.deepEqual(harness.completedSlots, ['complete']);
	harness.core.invalidate('source-change');
	send.resolve({ status: 'failed', failure: { message: 'late failure' } });
	assert.deepEqual(await pending, { status: 'superseded' });
	assert.deepEqual(harness.completedSlots, ['complete']);
});

void test('stale acceptance and pre-accept rejection never complete one-shot', async () => {
	const stale = createKeyboardInputHarness();
	const staleSend = deferred<ControllerOutcome<{ message: string }>>();
	let accept: (() => void) | undefined;
	stale.setSendImplementation((options) => {
		accept = options?.onAccepted;
		return staleSend.promise;
	});
	const stalePending = stale.core.handleSlotPress({
		type: 'text',
		text: 'a',
		label: 'A',
		icon: null,
	});
	stale.core.invalidate('source-change');
	accept?.();
	staleSend.resolve({ status: 'failed', failure: { message: 'late failure' } });
	assert.deepEqual(await stalePending, { status: 'superseded' });
	assert.deepEqual(stale.completedSlots, []);

	const rejected = createKeyboardInputHarness();
	rejected.setSendImplementation(async () => {
		throw new Error('rejected before acceptance');
	});
	assert.equal(
		(
			await rejected.core.handleSlotPress({
				type: 'bytes',
				bytes: [0x1b],
				label: 'Esc',
				icon: null,
			})
		).status,
		'failed',
	);
	assert.deepEqual(rejected.completedSlots, []);
});

void test('detected-open bytes route through canonical action planning', async () => {
	const harness = createKeyboardInputHarness();
	harness.setKeyboardId('browser_keyboard');
	await harness.core.handleSlotPress({
		type: 'bytes',
		bytes: [27, 97],
		label: 'Open',
		icon: null,
	});
	assert.deepEqual(harness.sent, []);
	assert.deepEqual(
		harness.actions.map(({ actionId }) => actionId),
		['OPEN_HOST_DETECTED_AUTO'],
	);
});

void test('long-press action metadata is forwarded through canonical routing', async () => {
	const harness = createKeyboardInputHarness();
	await harness.core.handleSlotPress({
		type: 'action',
		actionId: 'WORKMUX_NAV_PREV',
		label: 'Prev',
		icon: null,
		workmuxNavScopeOverride: 'all',
	} as never);
	assert.deepEqual(harness.actions, [
		{
			actionId: 'WORKMUX_NAV_PREV',
			options: { workmuxNavScopeOverride: 'all' },
		},
	]);
});

void test('macros use canonical raw text bytes steps and action routes', async () => {
	const cases = [
		['text', '{"type":"text","value":"hi","enter":true}'],
		['sequence', '{"type":"sequence","value":"\\u001b[A"}'],
		['action', '{"type":"action","actionId":"OPEN_COMMANDER"}'],
	] as const;
	for (const [id, script] of cases) {
		const harness = createKeyboardInputHarness();
		harness.setMacros([{ id, name: id, label: id, category: 'test', script }]);
		const pending = harness.core.handleSlotPress({
			type: 'macro',
			macroId: id,
			label: id,
			icon: null,
		});
		await harness.clock.settled();
		assert.equal((await pending).status, 'completed');
		if (id === 'text') assert.deepEqual(harness.sent, [[[104, 105]], [[13]]]);
		if (id === 'sequence') assert.deepEqual(harness.sent, [[[27, 91, 65]]]);
		if (id === 'action') {
			assert.deepEqual(
				harness.actions.map(({ actionId }) => actionId),
				['OPEN_COMMANDER'],
			);
		}
		assert.deepEqual(harness.completedSlots, ['complete']);
	}
});

void test('unparsed macro script uses canonical literal-text fallback', async () => {
	const harness = createKeyboardInputHarness();
	harness.setMacros([
		{
			id: 'literal',
			name: 'Literal',
			label: 'Literal',
			category: 'test',
			script: 'echo literal',
		},
	]);
	assert.deepEqual(
		await harness.core.handleSlotPress({
			type: 'macro',
			macroId: 'literal',
			label: 'Literal',
			icon: null,
		}),
		{ status: 'completed' },
	);
	assert.deepEqual(harness.sent, [
		[[...new TextEncoder().encode('echo literal')]],
	]);
});

void test('macro steps use bounded scheduling and complete after final step', async () => {
	const harness = createKeyboardInputHarness();
	harness.setMacros([
		{
			id: 'steps',
			name: 'Steps',
			label: 'Steps',
			category: 'test',
			script:
				'{"type":"steps","steps":[{"type":"text","data":"a"},{"type":"enter"}]}',
		},
	]);
	const pending = harness.core.handleSlotPress({
		type: 'macro',
		macroId: 'steps',
		label: 'Steps',
		icon: null,
	});
	assert.equal(harness.clock.pendingCount(), 1);
	harness.clock.advanceBy(0);
	await harness.clock.settled();
	harness.clock.advanceBy(50);
	await harness.clock.settled();
	assert.deepEqual(await pending, { status: 'completed' });
	assert.deepEqual(harness.sent, [[[0x61]], [[0x0d]]]);
	assert.deepEqual(harness.completedSlots, ['complete']);
});

void test('reentrant action invalidation prevents stale one-shot completion', async () => {
	const harness = createKeyboardInputHarness();
	harness.setActionImplementation(() => {
		harness.core.invalidate('source-change');
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
	assert.deepEqual(harness.completedSlots, []);
});

void test('throwing action is contained and does not complete one-shot', async () => {
	const harness = createKeyboardInputHarness();
	harness.setActionImplementation(() => {
		throw new Error('action failed');
	});
	assert.equal(
		(
			await harness.core.handleSlotPress({
				type: 'action',
				actionId: 'OPEN_COMMANDER',
				label: 'Commander',
				icon: null,
			})
		).status,
		'failed',
	);
	assert.deepEqual(harness.completedSlots, []);
	assert.deepEqual(harness.warnings, ['Keyboard action failed']);
});

void test('dispose supersedes an in-flight send and blocks late completion', async () => {
	const harness = createKeyboardInputHarness();
	const send = deferred<ControllerOutcome<{ message: string }>>();
	harness.setSendImplementation(() => send.promise);
	const pending = harness.core.sendTextRaw('old');
	harness.core.dispose();
	send.resolve({ status: 'completed' });
	assert.deepEqual(await pending, { status: 'superseded' });
	assert.deepEqual(await harness.core.sendTextRaw('new'), {
		status: 'unavailable',
	});
});
