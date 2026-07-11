import assert from 'node:assert/strict';
import test from 'node:test';
import { createScrollbackLiveInputCoordinator } from '../../src/lib/shell-controllers/scrollback-live-input-coordinator';
import { createShellTargetKey } from '../../src/lib/shell-controllers/source-keys';
import {
	type TerminalInputLease,
	type TerminalRuntimeKey,
} from '../../src/lib/shell-controllers/terminal-transport';
import { createWorkmuxScrollbackLiveInputCleanupBarrier } from '../../src/lib/workmux-scrollback-live-input';
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
	let scrollbackPhase: 'dragging' | 'active' = 'active';
	let localModeRevision = 0;
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
	let currentCleanupGetter = () => currentCleanup;
	let startCleanup = () => startedCleanup;
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
			localModeRevision,
			remoteCopyModeActive: remoteActive,
			remoteCopyModeGeneration: remoteGeneration,
			runtimeInstanceId: instanceId,
			scrollbackActive,
			scrollbackPhase,
			targetOwnershipRevision: targetRevision,
		}),
		getCurrentCleanup: () => currentCleanupGetter(),
		startCleanup: () => startCleanup(),
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
		liveGeneration: () => generation,
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
		setCurrentCleanupGetter: (getter: () => Promise<boolean> | null) => {
			currentCleanupGetter = getter;
		},
		setStartCleanup: (start: () => Promise<boolean> | null) => {
			startCleanup = start;
		},
		setStartedCleanup: (value: Promise<boolean> | null) => {
			startedCleanup = value;
		},
		setSendError: (error: unknown) => (sendError = error),
		setScrollbackActive: (active: boolean) => {
			if (scrollbackActive !== active) localModeRevision += 1;
			scrollbackActive = active;
		},
		setScrollbackPhase: (phase: typeof scrollbackPhase) => {
			if (scrollbackPhase !== phase) localModeRevision += 1;
			scrollbackPhase = phase;
		},
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

void test('new cleanup waits for the post-registration composite in either settlement order', async () => {
	for (const outerFirst of [true, false]) {
		const fixture = createFixture();
		const barrier = createWorkmuxScrollbackLiveInputCleanupBarrier();
		const outer = createDeferred<boolean>();
		const inner = createDeferred<boolean>();
		fixture.remote(true);
		fixture.setCurrentCleanupGetter(barrier.current);
		fixture.setStartCleanup(() => {
			void barrier.track(inner.promise);
			void barrier.track(outer.promise);
			return outer.promise;
		});
		const outcome = fixture.coordinator.sendSegments([new Uint8Array([1])]);
		(outerFirst ? outer : inner).resolve(true);
		await Promise.resolve();
		assert.deepEqual(fixture.sent, []);
		(outerFirst ? inner : outer).resolve(false);
		assert.deepEqual(await outcome, { status: 'unavailable' });
		assert.deepEqual(fixture.sent, []);
	}
});

void test('new cleanup waits for a rejecting inner composite member in either settlement order', async () => {
	for (const outerFirst of [true, false]) {
		const fixture = createFixture();
		const barrier = createWorkmuxScrollbackLiveInputCleanupBarrier();
		const outer = createDeferred<boolean>();
		const inner = createDeferred<boolean>();
		fixture.remote(true);
		fixture.setCurrentCleanupGetter(barrier.current);
		fixture.setStartCleanup(() => {
			void barrier.track(outer.promise);
			void barrier.track(inner.promise);
			return outer.promise;
		});
		const outcome = fixture.coordinator.sendSegments([new Uint8Array([1])]);
		if (outerFirst) outer.resolve(true);
		else inner.reject(new Error('inner cleanup failed'));
		await Promise.resolve();
		assert.deepEqual(fixture.sent, []);
		if (outerFirst) inner.reject(new Error('inner cleanup failed'));
		else outer.resolve(true);
		assert.deepEqual(await outcome, { status: 'unavailable' });
		assert.deepEqual(fixture.sent, []);
	}
});

void test('mode activation during authenticated capture starts cleanup from the validated state', async () => {
	const fixture = createFixture();
	const cleanup = createDeferred<boolean>();
	fixture.setStartedCleanup(cleanup.promise);
	const getActivity = fixture.context.getActivitySnapshot;
	let activate = true;
	fixture.context.getActivitySnapshot = () => {
		if (activate) {
			activate = false;
			fixture.setScrollbackActive(true);
		}
		return getActivity();
	};
	const outcome = fixture.coordinator.sendSegments([new Uint8Array([1])]);
	assert.deepEqual(fixture.sent, []);
	cleanup.resolve(true);
	assert.deepEqual(await outcome, { status: 'completed' });
	assert.deepEqual(fixture.sent, [[[1]]]);
});

void test('mode activation or deactivation during cleanup supersedes captured input', async () => {
	for (const initialActive of [false, true]) {
		const fixture = createFixture();
		const cleanup = createDeferred<boolean>();
		fixture.setScrollbackActive(initialActive);
		fixture.setCleanup(cleanup.promise);
		const outcome = fixture.coordinator.sendSegments([new Uint8Array([1])]);
		fixture.setScrollbackActive(!initialActive);
		cleanup.resolve(true);
		assert.deepEqual(await outcome, { status: 'superseded' });
		assert.deepEqual(fixture.sent, []);
	}
});

void test('phase change during cleanup supersedes captured input', async () => {
	const fixture = createFixture();
	const cleanup = createDeferred<boolean>();
	fixture.setCleanup(cleanup.promise);
	const outcome = fixture.coordinator.sendSegments([new Uint8Array([1])]);
	fixture.setScrollbackPhase('dragging');
	cleanup.resolve(true);
	assert.deepEqual(await outcome, { status: 'superseded' });
	assert.deepEqual(fixture.sent, []);
});

void test('the cleanup-owned local exit advances the captured mode revision without superseding input', async () => {
	const fixture = createFixture();
	fixture.setScrollbackActive(true);
	fixture.setStartCleanup(() => {
		fixture.setScrollbackActive(false);
		return null;
	});
	assert.deepEqual(
		await fixture.coordinator.sendSegments([new Uint8Array([1])]),
		{ status: 'completed' },
	);
	assert.deepEqual(fixture.sent, [[[1]]]);
});

void test('remote cleanup adopts its owned inactive dragging normalization before sending', async () => {
	const fixture = createFixture();
	const cleanup = createDeferred<boolean>();
	fixture.remote(true);
	fixture.setScrollbackPhase('dragging');
	fixture.setStartCleanup(() => {
		fixture.setScrollbackPhase('active');
		return cleanup.promise;
	});
	const outcome = fixture.coordinator.sendSegments([new Uint8Array([1])]);
	assert.deepEqual(fixture.sent, []);
	cleanup.resolve(true);
	assert.deepEqual(await outcome, { status: 'completed' });
	assert.deepEqual(fixture.sent, [[[1]]]);
});

void test('inactive active-phase input requires no owned local revision adoption', async () => {
	const fixture = createFixture();
	assert.deepEqual(
		await fixture.coordinator.sendSegments([new Uint8Array([1])]),
		{ status: 'completed' },
	);
	assert.deepEqual(fixture.sent, [[[1]]]);
});

void test('onAccepted reentry advances freshness before transport invocation', async () => {
	const fixture = createFixture();
	const outcome = fixture.coordinator.sendSegments([new Uint8Array([1])], {
		onAccepted: fixture.invalidate,
	});
	assert.deepEqual(await outcome, { status: 'superseded' });
	assert.deepEqual(fixture.sent, []);
});

void test('stale outer inactivity notification cannot override reentrant newer activity', () => {
	const fixture = createFixture();
	fixture.coordinator.onActivityChanged();
	const readActivity = fixture.context.getActivitySnapshot;
	let reenter = true;
	fixture.context.getActivitySnapshot = () => {
		if (!reenter) return readActivity();
		reenter = false;
		const staleInactive = {
			...readActivity(),
			appActive: false,
			focused: false,
			interactive: false,
			generation: 4,
		};
		fixture.activity({ generation: 5 });
		fixture.coordinator.onActivityChanged();
		return staleInactive;
	};
	fixture.coordinator.onActivityChanged();
	assert.equal(fixture.inactiveClearCount(), 0);
	assert.equal(fixture.liveGeneration(), 1);
});

void test('reentrant newer inactivity wins over a stale outer interactive notification once', () => {
	const fixture = createFixture();
	fixture.coordinator.onActivityChanged();
	const readActivity = fixture.context.getActivitySnapshot;
	let reenter = true;
	fixture.context.getActivitySnapshot = () => {
		if (!reenter) return readActivity();
		reenter = false;
		const staleInteractive = { ...readActivity(), generation: 4 };
		fixture.activity({
			appActive: false,
			focused: false,
			interactive: false,
			generation: 5,
		});
		fixture.coordinator.onActivityChanged();
		return staleInteractive;
	};
	fixture.coordinator.onActivityChanged();
	fixture.coordinator.onActivityChanged();
	assert.equal(fixture.inactiveClearCount(), 1);
	assert.equal(fixture.liveGeneration(), 2);
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
