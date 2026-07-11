import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellTerminalLiveInputRequest } from '../../src/lib/shell-controllers/shell-terminal-live-input';
import {
	type ShellTerminalTransportPort,
	type TerminalInputLease,
	type TerminalRuntimeKey,
} from '../../src/lib/shell-controllers/terminal-transport';

function createFixture(
	options: { sendError?: Error; hasLease?: boolean } = {},
) {
	const lease: TerminalInputLease = {
		runtimeKey: 'runtime-1' as TerminalRuntimeKey,
		writerGeneration: 1,
	};
	let leaseCurrent = true;
	let currentInstanceId: string | null = 'instance-1';
	let currentGeneration = 4;
	let activity = { focused: true, appActive: true };
	let captureCount = 0;
	const sends: {
		lease: TerminalInputLease;
		segments: readonly Uint8Array<ArrayBufferLike>[];
		options?: { interSegmentDelayMs?: number; isCurrent?: () => boolean };
	}[] = [];
	const transport: ShellTerminalTransportPort = {
		captureLease: () => {
			captureCount += 1;
			return options.hasLease === false ? null : lease;
		},
		isLeaseCurrent: (candidate) => candidate === lease && leaseCurrent,
		sendBatch: async (candidate, segments, sendOptions) => {
			sends.push({ lease: candidate, segments, options: sendOptions });
			if (options.sendError) throw options.sendError;
		},
	};
	const request = createShellTerminalLiveInputRequest({
		transport,
		requestInstanceId: 'instance-1',
		getCurrentInstanceId: () => currentInstanceId,
		requestGeneration: 4,
		getCurrentGeneration: () => currentGeneration,
		getActivitySnapshot: () => activity,
	});
	return {
		lease,
		request,
		sends,
		getCaptureCount: () => captureCount,
		setLeaseCurrent: (current: boolean) => {
			leaseCurrent = current;
		},
		setCurrentInstanceId: (instanceId: string | null) => {
			currentInstanceId = instanceId;
		},
		setCurrentGeneration: (generation: number) => {
			currentGeneration = generation;
		},
		setActivity: (next: { focused: boolean; appActive: boolean }) => {
			activity = next;
		},
	};
}

void test('live-input adapter captures one lease and shares its freshness predicate with transport', async () => {
	const fixture = createFixture();
	assert.equal(fixture.getCaptureCount(), 1);
	assert.equal(fixture.request.isCurrent(), true);
	const segments = [new Uint8Array([1]), new Uint8Array([2])];
	await fixture.request.sendSegments(segments, { interSegmentDelayMs: 7 });
	assert.equal(fixture.sends.length, 1);
	assert.equal(fixture.sends[0]?.lease, fixture.lease);
	assert.equal(fixture.sends[0]?.segments, segments);
	assert.equal(fixture.sends[0]?.options?.interSegmentDelayMs, 7);
	assert.equal(fixture.sends[0]?.options?.isCurrent, fixture.request.isCurrent);
});

void test('live-input adapter suppresses stale activity, instance, generation, and runtime', () => {
	const focus = createFixture();
	focus.setActivity({ focused: false, appActive: true });
	assert.equal(focus.request.isCurrent(), false);

	const app = createFixture();
	app.setActivity({ focused: true, appActive: false });
	assert.equal(app.request.isCurrent(), false);

	const instance = createFixture();
	instance.setCurrentInstanceId('instance-2');
	assert.equal(instance.request.isCurrent(), false);

	const generation = createFixture();
	generation.setCurrentGeneration(5);
	assert.equal(generation.request.isCurrent(), false);

	const runtime = createFixture();
	runtime.setLeaseCurrent(false);
	assert.equal(runtime.request.isCurrent(), false);
});

void test('live-input adapter propagates transport failure and remains inert without a lease', async () => {
	const error = new Error('send failed');
	const failing = createFixture({ sendError: error });
	const failedSend = failing.request.sendSegments([new Uint8Array([1])]);
	assert.ok(failedSend);
	await assert.rejects(failedSend, error);

	const unavailable = createFixture({ hasLease: false });
	assert.equal(unavailable.request.isCurrent(), false);
	assert.equal(
		unavailable.request.sendSegments([new Uint8Array([1])]),
		undefined,
	);
	assert.deepEqual(unavailable.sends, []);
});
