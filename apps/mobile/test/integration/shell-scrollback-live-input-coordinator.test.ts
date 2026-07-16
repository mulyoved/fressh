import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkmuxScrollbackLiveInputCleanupBarrier } from '../../src/lib/workmux-scrollback-live-input';
import {
	createDeferred,
	flushPromises,
} from './shell-scrollback-controller-test-support';
import { createLiveInputFixture as createFixture } from './shell-scrollback-live-input-test-support';
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
	let cleanupOnlyAccepted = 0;
	assert.deepEqual(
		await blocked.coordinator.sendSegments([new Uint8Array([])], {
			onAccepted: () => {
				cleanupOnlyAccepted += 1;
			},
		}),
		{ status: 'unavailable' },
	);
	assert.equal(cleanupOnlyAccepted, 0);
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
void test('reentrant nested cleanup with newer authority supersedes the owned cleanup transition', async () => {
	const fixture = createFixture();
	const barrier = createWorkmuxScrollbackLiveInputCleanupBarrier();
	const outer = createDeferred<boolean>();
	const inner = createDeferred<boolean>();
	fixture.remote(true);
	fixture.freezeStartAuthority();
	fixture.setCurrentCleanupGetter(barrier.current);
	fixture.setStartCleanup(() => {
		void barrier.track(outer.promise);
		fixture.setScrollbackActive(false);
		fixture.setScrollbackActive(true);
		fixture.remote(true);
		void barrier.track(inner.promise);
		return outer.promise;
	});
	const outcome = fixture.coordinator.sendSegments([new Uint8Array([1])]);
	outer.resolve(true);
	await Promise.resolve();
	assert.deepEqual(fixture.sent, []);
	fixture.settleRemoteCleanup();
	inner.resolve(true);
	assert.deepEqual(await outcome, { status: 'superseded' });
	assert.deepEqual(fixture.sent, []);
});
void test('mode activation during authenticated capture starts cleanup from the validated state', async () => {
	const fixture = createFixture();
	const cleanup = createDeferred<boolean>();
	fixture.setStartedCleanup(cleanup.promise);
	const getActivity = fixture.context.activity.getSnapshot;
	let activate = true;
	fixture.context.activity.getSnapshot = () => {
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

void test('inactive all-empty input is unavailable without acceptance or transport', async () => {
	const fixture = createFixture();
	let accepted = 0;
	assert.deepEqual(
		await fixture.coordinator.sendSegments([new Uint8Array([])], {
			onAccepted: () => {
				accepted += 1;
			},
		}),
		{ status: 'unavailable' },
	);
	assert.equal(accepted, 0);
	assert.deepEqual(fixture.sent, []);
});

void test('active cleanup-only input accepts once only after current successful cleanup', async () => {
	for (const settlement of ['true', 'false', 'reject', 'stale'] as const) {
		const fixture = createFixture();
		const cleanup = createDeferred<boolean>();
		let accepted = 0;
		fixture.setScrollbackActive(true);
		fixture.setStartCleanup(() => {
			fixture.setScrollbackActive(false);
			return cleanup.promise;
		});
		const outcome = fixture.coordinator.sendSegments([new Uint8Array([])], {
			onAccepted: () => {
				accepted += 1;
			},
		});
		if (settlement === 'stale') fixture.invalidate();
		if (settlement === 'reject') cleanup.reject(new Error('cleanup failed'));
		else cleanup.resolve(settlement !== 'false');
		assert.deepEqual(await outcome, {
			status:
				settlement === 'true'
					? 'completed'
					: settlement === 'stale'
						? 'superseded'
						: 'unavailable',
		});
		assert.equal(accepted, settlement === 'true' ? 1 : 0);
		assert.deepEqual(fixture.sent, []);
	}
});

void test('active exit-key-only input completes cleanup without terminal bytes', async () => {
	const fixture = createFixture();
	const cleanup = createDeferred<boolean>();
	let accepted = 0;
	fixture.setScrollbackActive(true);
	fixture.setStartCleanup(() => {
		fixture.setScrollbackActive(false);
		return cleanup.promise;
	});
	const outcome = fixture.coordinator.sendSegments([new Uint8Array([0x71])], {
		onAccepted: () => {
			accepted += 1;
		},
	});
	cleanup.resolve(true);
	assert.deepEqual(await outcome, { status: 'completed' });
	assert.equal(accepted, 1);
	assert.deepEqual(fixture.sent, []);
});

void test('no-barrier reentrant final currentness resolves promptly without transport', async () => {
	const fixture = createFixture();
	let checks = 0;
	fixture.context.terminalTransport.isLeaseCurrent = () => {
		checks += 1;
		if (checks === 4) fixture.invalidate();
		return true;
	};
	assert.deepEqual(
		await fixture.coordinator.sendSegments([new Uint8Array([1])]),
		{ status: 'superseded' },
	);
	assert.deepEqual(fixture.sent, []);
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
	const readActivity = fixture.context.activity.getSnapshot;
	let reenter = true;
	fixture.context.activity.getSnapshot = () => {
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
	const readActivity = fixture.context.activity.getSnapshot;
	let reenter = true;
	fixture.context.activity.getSnapshot = () => {
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
