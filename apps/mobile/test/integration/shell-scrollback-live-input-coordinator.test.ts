import assert from 'node:assert/strict';
import test from 'node:test';
import { createScrollbackLiveInputCoordinator } from '../../src/lib/shell-controllers/scrollback-live-input-coordinator';
import { createShellTargetKey } from '../../src/lib/shell-controllers/source-keys';
import {
	type TerminalInputLease,
	type TerminalRuntimeKey,
} from '../../src/lib/shell-controllers/terminal-transport';
import {
	createDeferred,
	flushPromises,
} from './shell-scrollback-controller-test-support';

const targetKey = createShellTargetKey('transport' as never, 'main');

function createFixture() {
	const sent: number[][][] = [];
	const events: string[] = [];
	const warnings: string[] = [];
	let currentCleanup: Promise<boolean> | null = null;
	let startedCleanup: Promise<boolean> | null = null;
	let generation = 1;
	let remoteGeneration = 1;
	let remoteActive = false;
	let scrollbackActive = false;
	let targetRevision = 1;
	let disposed = false;
	let instanceId: string | null = 'instance-1';
	let runtimeKey: TerminalRuntimeKey | null = 'runtime-1' as TerminalRuntimeKey;
	let activity = {
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 3,
	};
	const lease = {
		runtimeKey: 'runtime-1',
		writerGeneration: 1,
	} as unknown as TerminalInputLease;
	let leaseCurrent = true;
	let sendError: unknown = null;
	let inactiveClearCount = 0;
	const context = {
		targetKey,
		targetName: 'main',
		getActivitySnapshot: () => activity,
		terminalTransport: {
			captureLease: () => lease,
			isLeaseCurrent: () => leaseCurrent,
			sendBatch: async (
				_lease: never,
				segments: readonly Uint8Array<ArrayBufferLike>[],
				options?: {
					interSegmentDelayMs?: number;
					isCurrent?: () => boolean;
				},
			) => {
				events.push('send');
				if (options?.isCurrent?.() === false) return;
				sent.push(segments.map((segment) => Array.from(segment)));
				if (sendError) throw sendError;
			},
		},
		terminalView: {
			getRuntimeKey: () => runtimeKey,
			getRuntimeInstanceId: () => instanceId,
		},
		logger: { warn: (message: string) => warnings.push(message) },
		getErrorMessage: (error: unknown) =>
			error instanceof Error ? error.message : String(error),
	};
	const coordinator = createScrollbackLiveInputCoordinator({
		advanceFreshness: () => {
			generation += 1;
		},
		clearInactive: () => {
			inactiveClearCount += 1;
			return startedCleanup ?? currentCleanup;
		},
		getCurrentState: () => ({
			context,
			disposed,
			liveInputGeneration: generation,
			remoteCopyModeActive: remoteActive,
			remoteCopyModeGeneration: remoteGeneration,
			runtimeInstanceId: instanceId,
			scrollbackActive,
			targetOwnershipRevision: targetRevision,
		}),
		getCurrentCleanup: () => currentCleanup,
		startCleanup: () => startedCleanup,
		scrollbackExitDelayMs: 10,
		scrollbackExitKeyPayload: new Uint8Array([0x71]),
	});
	return {
		activity: (next: Partial<typeof activity>) =>
			(activity = { ...activity, ...next }),
		context,
		coordinator,
		dispose: () => (disposed = true),
		events,
		invalidate: () => (generation += 1),
		inactiveClearCount: () => inactiveClearCount,
		lease: (current: boolean) => (leaseCurrent = current),
		remote: (active: boolean) => {
			remoteActive = active;
			remoteGeneration += 1;
		},
		replaceRuntime: (next: string) => {
			instanceId = next;
			runtimeKey = `runtime-${next}` as TerminalRuntimeKey;
			generation += 1;
		},
		replaceTarget: () => (targetRevision += 1),
		sent,
		setCleanup: (value: Promise<boolean> | null) => {
			currentCleanup = value;
		},
		setStartedCleanup: (value: Promise<boolean> | null) => {
			startedCleanup = value;
		},
		setSendError: (error: unknown) => (sendError = error),
		setScrollbackActive: (active: boolean) => (scrollbackActive = active),
		warnings,
	};
}

void test('live input snapshots bytes, accepts once, and completes only after the ordered send', async () => {
	const fixture = createFixture();
	const bytes = new Uint8Array([0x61]);
	const outcome = fixture.coordinator.sendSegments([bytes], {
		onAccepted: () => fixture.events.push('accepted'),
	});
	bytes[0] = 0x7a;

	assert.deepEqual(await outcome, { status: 'completed' });
	assert.deepEqual(fixture.sent, [[[0x61]]]);
	assert.deepEqual(fixture.events, ['accepted', 'send']);
});

void test('inactivity advances send freshness before one cleanup and resume cannot resurrect it', async () => {
	const fixture = createFixture();
	const pending = createDeferred<boolean>();
	fixture.setCleanup(pending.promise);
	fixture.coordinator.onActivityChanged();
	const outcome = fixture.coordinator.sendSegments([new Uint8Array([1])]);
	fixture.activity({
		appActive: false,
		focused: false,
		interactive: false,
		generation: 4,
	});
	fixture.coordinator.onActivityChanged();
	fixture.coordinator.onActivityChanged();
	assert.equal(fixture.inactiveClearCount(), 1);
	fixture.activity({
		appActive: true,
		focused: true,
		interactive: true,
		generation: 5,
	});
	fixture.coordinator.onActivityChanged();
	pending.resolve(true);
	assert.deepEqual(await outcome, { status: 'superseded' });
	assert.deepEqual(fixture.sent, []);
});

void test('live input waits for composite cleanup and fails closed on false or rejection', async () => {
	for (const settlement of ['false', 'rejection'] as const) {
		const fixture = createFixture();
		const pending = createDeferred<boolean>();
		fixture.setCleanup(pending.promise);
		const outcome = fixture.coordinator.sendSegments([new Uint8Array([0x61])]);
		assert.deepEqual(fixture.sent, []);
		if (settlement === 'false') pending.resolve(false);
		else pending.reject(new Error('cleanup failed'));
		assert.deepEqual(await outcome, { status: 'unavailable' });
		assert.deepEqual(fixture.sent, []);
	}
});

void test('remote copy mode starts cleanup, uses the exit delay, and fails closed without a barrier', async () => {
	const fixture = createFixture();
	const pending = createDeferred<boolean>();
	fixture.remote(true);
	fixture.setStartedCleanup(pending.promise);
	const outcome = fixture.coordinator.sendSegments([new Uint8Array([0x61])]);
	assert.deepEqual(fixture.sent, []);
	pending.resolve(true);
	assert.deepEqual(await outcome, { status: 'completed' });
	assert.deepEqual(fixture.sent, [[[0x61]]]);

	const blocked = createFixture();
	blocked.remote(true);
	assert.deepEqual(
		await blocked.coordinator.sendSegments([new Uint8Array([0x61])]),
		{ status: 'unavailable' },
	);
});

void test('onAccepted reentry advances freshness before transport invocation', async () => {
	const fixture = createFixture();
	const outcome = fixture.coordinator.sendSegments([new Uint8Array([1])], {
		onAccepted: fixture.invalidate,
	});
	assert.deepEqual(await outcome, { status: 'superseded' });
	assert.deepEqual(fixture.sent, []);
});

void test('live input becomes superseded across runtime, activity, target, lease, and disposal replacement', async () => {
	for (const invalidate of [
		(fixture: ReturnType<typeof createFixture>) => fixture.replaceRuntime('2'),
		(fixture: ReturnType<typeof createFixture>) =>
			fixture.activity({ interactive: false, focused: false, generation: 4 }),
		(fixture: ReturnType<typeof createFixture>) => fixture.replaceTarget(),
		(fixture: ReturnType<typeof createFixture>) => fixture.lease(false),
		(fixture: ReturnType<typeof createFixture>) => fixture.dispose(),
	]) {
		const fixture = createFixture();
		const pending = createDeferred<boolean>();
		fixture.setCleanup(pending.promise);
		const outcome = fixture.coordinator.sendSegments([new Uint8Array([0x61])]);
		invalidate(fixture);
		pending.resolve(true);
		assert.deepEqual(await outcome, { status: 'superseded' });
		assert.deepEqual(fixture.sent, []);
	}
});

void test('missing lease is unavailable and a current send failure uses the current formatter', async () => {
	const absent = createFixture();
	absent.context.terminalTransport.captureLease = () => null as never;
	assert.deepEqual(
		await absent.coordinator.sendSegments([new Uint8Array([1])]),
		{ status: 'unavailable' },
	);

	const failed = createFixture();
	failed.setSendError(new Error('write failed'));
	assert.deepEqual(
		await failed.coordinator.sendSegments([new Uint8Array([1])]),
		{ status: 'failed', failure: { message: 'write failed' } },
	);
});

void test('send rejection after invalidation is superseded and throwing callbacks stay contained', async () => {
	const fixture = createFixture();
	const sendFailure = createDeferred<void>();
	fixture.context.terminalTransport.sendBatch = async () => {
		fixture.events.push('send');
		await sendFailure.promise;
	};
	fixture.context.getErrorMessage = () => {
		throw new Error('formatter failed');
	};
	fixture.context.logger.warn = () => {
		throw new Error('logger failed');
	};
	const outcome = fixture.coordinator.sendSegments([new Uint8Array([1])], {
		onAccepted: () => {
			fixture.events.push('accepted');
			throw new Error('accepted failed');
		},
	});
	fixture.invalidate();
	sendFailure.reject(new Error('late failure'));
	assert.deepEqual(await outcome, { status: 'superseded' });
	assert.deepEqual(fixture.events, ['accepted', 'send']);
});

void test('concurrent live input delegates ordering and requested delays to one terminal transport', async () => {
	const fixture = createFixture();
	const delays: (number | undefined)[] = [];
	fixture.context.terminalTransport.sendBatch = async (
		_lease,
		segments,
		options,
	) => {
		delays.push(options?.interSegmentDelayMs);
		fixture.sent.push(segments.map((segment) => Array.from(segment)));
	};
	const first = fixture.coordinator.sendSegments([new Uint8Array([1])], {
		interSegmentDelayMs: 7,
	});
	const second = fixture.coordinator.sendSegments([new Uint8Array([2])]);
	assert.deepEqual(await Promise.all([first, second]), [
		{ status: 'completed' },
		{ status: 'completed' },
	]);
	assert.deepEqual(fixture.sent, [[[1]], [[2]]]);
	assert.deepEqual(delays, [7, undefined]);
	await flushPromises();
});
