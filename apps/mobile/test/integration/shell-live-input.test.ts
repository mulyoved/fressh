import assert from 'node:assert/strict';
import test from 'node:test';
import { buildShellLiveInputSendPlan } from '../../src/lib/shell-live-input';

const bytes = (values: number[]) => new Uint8Array(values);
const segmentValues = (segments: ReadonlyArray<Uint8Array<ArrayBuffer>>) =>
	segments.map((segment) => Array.from(segment));

void test('active scrollback multi-segment payload exits before sending payload', () => {
	const plan = buildShellLiveInputSendPlan({
		scrollbackActive: true,
		cancelKeyBytes: bytes([0x71]),
		exitKeyBytes: bytes([0x71]),
		payloadSegments: [bytes([0x70, 0x77, 0x64]), bytes([0x0d])],
		interSegmentDelayMs: 3,
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
	assert.equal(plan.clearScrollback, true);
	assert.equal(plan.interSegmentDelayMs, 10);
	assert.deepEqual(segmentValues(plan.segments), [
		[0x71],
		[0x70, 0x77, 0x64],
		[0x0d],
	]);
});

void test('inactive input sends payload with normal inter-segment delay', () => {
	const plan = buildShellLiveInputSendPlan({
		scrollbackActive: false,
		cancelKeyBytes: bytes([0x71]),
		exitKeyBytes: bytes([0x71]),
		payloadSegments: [bytes([0x70, 0x77, 0x64]), bytes([0x0d])],
		interSegmentDelayMs: 3,
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
	assert.equal(plan.clearScrollback, false);
	assert.equal(plan.interSegmentDelayMs, 3);
	assert.deepEqual(segmentValues(plan.segments), [
		[0x70, 0x77, 0x64],
		[0x0d],
	]);
});

void test('active scrollback exit-key input sends only cancel key and clears scrollback', () => {
	const plan = buildShellLiveInputSendPlan({
		scrollbackActive: true,
		cancelKeyBytes: bytes([0x71]),
		exitKeyBytes: bytes([0x71]),
		payloadSegments: [bytes([0x71])],
		isCurrentPayloadExitKey: true,
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
	assert.equal(plan.clearScrollback, true);
	assert.equal(plan.interSegmentDelayMs, 10);
	assert.deepEqual(segmentValues(plan.segments), [[0x71]]);
});

void test('active scrollback with invalid cancel key blocks without payload segments', () => {
	const plan = buildShellLiveInputSendPlan({
		scrollbackActive: true,
		cancelKeyBytes: bytes([0x1b]),
		exitKeyBytes: bytes([0x71]),
		payloadSegments: [bytes([0x70, 0x77, 0x64])],
		scrollbackExitDelayMs: 10,
	});

	assert.deepEqual(plan, {
		type: 'block',
		reason: 'invalid-cancel-key',
	});
});
