import assert from 'node:assert/strict';
import test from 'node:test';

import { createKeyboardInputHarness } from './shell-keyboard-input-controller-test-support';

void test('routes bytes text WebView and text-entry paste only through scrollback', async () => {
	const harness = createKeyboardInputHarness();
	await harness.core.sendBytes(new Uint8Array([0x1b]));
	await harness.core.sendTextRaw('a');
	await harness.core.onWebViewInput({ str: 'b', instanceId: 'instance-1' });
	await harness.core.pasteTextEntry('hello');
	assert.deepEqual(harness.sent, [
		[[0x1b]],
		[[0x61]],
		[[0x62]],
		[[0x68, 0x65, 0x6c, 0x6c, 0x6f], [0x0d]],
	]);
	assert.equal(harness.sendOptions.at(-1)?.interSegmentDelayMs, 10);
});

void test('snapshots caller bytes and text before asynchronous input', async () => {
	const harness = createKeyboardInputHarness();
	const bytes = new Uint8Array([0x61]);
	const first = harness.core.sendBytes(bytes);
	bytes[0] = 0x7a;
	const text = 'fixed';
	await first;
	await harness.core.sendTextRaw(text);
	assert.deepEqual(harness.sent, [
		[[0x61]],
		[[...new TextEncoder().encode(text)]],
	]);
});

void test('applies modifiers to byte and text sends without mutating input', async () => {
	const harness = createKeyboardInputHarness();
	harness.setModifiersActive(true);
	const bytes = new Uint8Array([0x61]);
	await harness.core.sendBytesWithModifiers(bytes);
	await harness.core.sendTextWithModifiers('a');
	assert.deepEqual(harness.sent, [[[0x01]], [[0x01]]]);
	assert.deepEqual(Array.from(bytes), [0x61]);
});

void test('records text history once only after completed current acceptance', async () => {
	const harness = createKeyboardInputHarness();
	harness.setOutcome({ status: 'unavailable' });
	await harness.core.pasteTextEntry('blocked');
	harness.setOutcome({ status: 'failed', failure: { message: 'failed' } });
	await harness.core.pasteTextEntry('failed');
	harness.setOutcome({ status: 'completed' });
	await harness.core.pasteTextEntry('accepted');
	await harness.core.pasteTextEntry('');
	assert.deepEqual(harness.recordedHistory, ['accepted']);
});

void test('rejects null stale and throwing WebView currentness before payload', async () => {
	const harness = createKeyboardInputHarness();
	harness.setInstanceId(null);
	assert.deepEqual(
		await harness.core.onWebViewInput({ str: 'a', instanceId: 'instance-1' }),
		{ status: 'unavailable' },
	);
	harness.setInstanceId('instance-2');
	await harness.core.onWebViewInput({ str: 'b', instanceId: 'instance-1' });
	assert.deepEqual(harness.sent, []);
});

void test('exits selection mode before user input but not explicit copy action', async () => {
	const harness = createKeyboardInputHarness();
	harness.setSelectionModeEnabled(true);
	await harness.core.sendTextRaw('a');
	await harness.core.handleSlotPress({
		type: 'action',
		actionId: 'COPY_SELECTION',
		label: 'Copy',
		icon: null,
	});
	assert.deepEqual(harness.selectionCommands, [false, false]);
});

void test('runs command steps in order with exact default and explicit delays', async () => {
	const harness = createKeyboardInputHarness();
	const pending = harness.core.runCommandSteps([
		{ type: 'text', data: 'a' },
		{ type: 'enter' },
		{ type: 'tab', delayMs: 20, repeat: 2 },
	]);
	harness.clock.advanceBy(0);
	await harness.clock.settled();
	assert.deepEqual(harness.sent, [[[0x61]]]);
	harness.clock.advanceBy(49);
	await harness.clock.settled();
	assert.equal(harness.sent.length, 1);
	harness.clock.advanceBy(1);
	await harness.clock.settled();
	harness.clock.advanceBy(20);
	await harness.clock.settled();
	assert.deepEqual(harness.sent, [[[0x61]], [[0x0d]], [[0x09], [0x09]]]);
	assert.deepEqual(await pending, { status: 'completed' });
});

void test('invalidation cancels steps and remains reusable while dispose is inert', async () => {
	const harness = createKeyboardInputHarness();
	const old = harness.core.runCommandSteps([
		{ type: 'text', data: 'a' },
		{ type: 'enter', delayMs: 50 },
	]);
	harness.clock.advanceBy(0);
	await harness.clock.settled();
	harness.core.invalidate('focus-lost');
	harness.clock.advanceBy(50);
	assert.deepEqual(await old, { status: 'superseded' });
	assert.deepEqual(harness.sent, [[[0x61]]]);
	harness.setInteractive(true);
	await harness.core.sendTextRaw('b');
	harness.core.dispose();
	harness.core.dispose();
	assert.deepEqual(await harness.core.sendTextRaw('c'), {
		status: 'unavailable',
	});
	assert.deepEqual(harness.sent, [[[0x61]], [[0x62]]]);
});
