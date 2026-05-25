import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildShellLiveInputSendPlan,
	sendShellLiveInputSegments,
} from '../../src/lib/shell-live-input';

const bytes = (values: number[]) => new Uint8Array(values);
const segmentValues = (segments: readonly Uint8Array<ArrayBuffer>[]) =>
	segments.map((segment) => Array.from(segment));

void test('maps active multi-segment input to cancel key, payload, and exit delay', () => {
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

void test('implicitly detects exit-key payload when override is omitted', () => {
	const plan = buildShellLiveInputSendPlan({
		scrollbackActive: true,
		cancelKeyBytes: bytes([0x71]),
		exitKeyBytes: bytes([0x71]),
		payloadSegments: [bytes([0x71])],
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
	assert.equal(plan.clearScrollback, true);
	assert.equal(plan.interSegmentDelayMs, 10);
	assert.deepEqual(segmentValues(plan.segments), [[0x71]]);
});

void test('omitted override keeps a single non-exit payload', () => {
	const plan = buildShellLiveInputSendPlan({
		scrollbackActive: true,
		cancelKeyBytes: bytes([0x71]),
		exitKeyBytes: bytes([0x71]),
		payloadSegments: [bytes([0x70])],
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
	assert.equal(plan.clearScrollback, true);
	assert.equal(plan.interSegmentDelayMs, 10);
	assert.deepEqual(segmentValues(plan.segments), [[0x71], [0x70]]);
});

void test('explicit false override preserves literal text equal to the exit key', () => {
	const plan = buildShellLiveInputSendPlan({
		scrollbackActive: true,
		cancelKeyBytes: bytes([0x71]),
		exitKeyBytes: bytes([0x71]),
		payloadSegments: [bytes([0x71])],
		isCurrentPayloadExitKey: false,
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
	assert.equal(plan.clearScrollback, true);
	assert.equal(plan.interSegmentDelayMs, 10);
	assert.deepEqual(segmentValues(plan.segments), [[0x71], [0x71]]);
});

void test('passes invalid active cancel key through as a blocked plan', () => {
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

void test('send helper returns false when active scrollback blocks input', () => {
	const queued: Uint8Array<ArrayBuffer>[][] = [];
	const warnings: string[] = [];
	let clearCount = 0;

	const accepted = sendShellLiveInputSegments({
		scrollbackActive: true,
		cancelKeyBytes: bytes([0x1b]),
		exitKeyBytes: bytes([0x71]),
		payloadSegments: [bytes([0x70, 0x77, 0x64])],
		scrollbackExitDelayMs: 10,
		sendBytesQueued: (segments) => {
			queued.push(segments);
			return Promise.resolve();
		},
		clearScrollbackState: () => {
			clearCount += 1;
		},
		warn: (message) => {
			warnings.push(message);
		},
	});

	assert.equal(accepted, false);
	assert.deepEqual(queued, []);
	assert.equal(clearCount, 0);
	assert.deepEqual(warnings, [
		'cancelKey invalid; blocking input until Jump to live is used',
	]);
});

void test('send helper returns false when no input is queued', () => {
	let clearCount = 0;

	const accepted = sendShellLiveInputSegments({
		scrollbackActive: false,
		cancelKeyBytes: bytes([0x71]),
		exitKeyBytes: bytes([0x71]),
		payloadSegments: [bytes([0x70, 0x77, 0x64])],
		scrollbackExitDelayMs: 10,
		sendBytesQueued: () => undefined,
		clearScrollbackState: () => {
			clearCount += 1;
		},
		warn: () => {},
	});

	assert.equal(accepted, false);
	assert.equal(clearCount, 0);
});

void test('send helper returns true after queueing input segments', () => {
	const queued: {
		segments: Uint8Array<ArrayBuffer>[];
		interSegmentDelayMs?: number;
	}[] = [];
	let clearCount = 0;

	const accepted = sendShellLiveInputSegments({
		scrollbackActive: true,
		cancelKeyBytes: bytes([0x71]),
		exitKeyBytes: bytes([0x71]),
		payloadSegments: [bytes([0x70, 0x77, 0x64]), bytes([0x0d])],
		interSegmentDelayMs: 3,
		scrollbackExitDelayMs: 10,
		sendBytesQueued: (segments, opts) => {
			queued.push({
				segments,
				interSegmentDelayMs: opts?.interSegmentDelayMs,
			});
			return Promise.resolve();
		},
		clearScrollbackState: () => {
			clearCount += 1;
		},
		warn: () => {},
	});

	assert.equal(accepted, true);
	assert.equal(clearCount, 1);
	assert.deepEqual(
		queued.map((entry) => ({
			segments: segmentValues(entry.segments),
			interSegmentDelayMs: entry.interSegmentDelayMs,
		})),
		[
			{
				segments: [[0x71], [0x70, 0x77, 0x64], [0x0d]],
				interSegmentDelayMs: 10,
			},
		],
	);
});
