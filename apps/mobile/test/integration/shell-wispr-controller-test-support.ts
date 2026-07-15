import assert from 'node:assert/strict';
import {
	createShellWisprControllerCore,
	type ShellWisprNativePort,
} from '../../src/lib/shell-controllers/wispr-core';
import {
	createWisprNativeControlAuthority,
	type WisprNativeControlAuthority,
} from '../../src/lib/shell-controllers/wispr-native-control-authority';

type Timer = { at: number; run(): void };

export class FakeClock {
	nowMs = 0;
	nextId = 1;
	timers = new Map<number, Timer>();

	now = () => this.nowMs;
	setTimeout = (run: () => void, delayMs: number) => {
		const id = this.nextId++;
		this.timers.set(id, { at: this.nowMs + delayMs, run });
		return id;
	};
	clearTimeout = (id: number) => {
		this.timers.delete(id);
	};

	async advance(delayMs: number): Promise<void> {
		const end = this.nowMs + delayMs;
		for (;;) {
			const next = [...this.timers.entries()]
				.filter(([, timer]) => timer.at <= end)
				.sort((left, right) => left[1].at - right[1].at)[0];
			if (!next) break;
			this.nowMs = next[1].at;
			this.timers.delete(next[0]);
			next[1].run();
			await settled();
		}
		this.nowMs = end;
		await settled();
	}
}

export type Deferred<T> = {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
};

export function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

export const settled = () =>
	new Promise<void>((resolve) => setImmediate(resolve));

export function createHarness(
	platformOS = 'android',
	configureClock: (clock: FakeClock) => void = () => {},
	controlAuthority: WisprNativeControlAuthority = createWisprNativeControlAuthority(),
) {
	const clock = new FakeClock();
	configureClock(clock);
	const statusRequests: Deferred<{
		serviceEnabled: boolean;
		serviceConnected: boolean;
	}>[] = [];
	const taps: Deferred<unknown>[] = [];
	const warnings: { message: string; error: unknown }[] = [];
	let modalOpen = false;
	let nativeActive = false;
	let settingsCalls = 0;
	const native: ShellWisprNativePort = {
		getStatus: () => {
			const request = deferred<{
				serviceEnabled: boolean;
				serviceConnected: boolean;
			}>();
			statusRequests.push(request);
			return request.promise;
		},
		tapControl: () => {
			const tap = deferred<unknown>();
			taps.push(tap);
			return tap.promise.then((result) => {
				nativeActive = !nativeActive;
				return result;
			});
		},
		tapScreen: async () => undefined,
		openSettings: async () => {
			settingsCalls += 1;
		},
	};
	const core = createShellWisprControllerCore({
		controlAuthority,
		native,
		modal: {
			isOpen: () => modalOpen,
			open: () => {
				modalOpen = true;
				return true;
			},
			close: () => {
				modalOpen = false;
			},
		},
		now: clock.now,
		setTimeout: clock.setTimeout,
		clearTimeout: clock.clearTimeout,
		pixelRatio: () => 2,
		platformOS,
		logger: {
			info: () => {},
			warn: (message, error) => warnings.push({ message, error }),
		},
	});
	return {
		clock,
		core,
		native,
		statusRequests,
		taps,
		warnings,
		get modalOpen() {
			return modalOpen;
		},
		get nativeActive() {
			return nativeActive;
		},
		get settingsCalls() {
			return settingsCalls;
		},
	};
}

export async function openReady(harness: ReturnType<typeof createHarness>) {
	const requestIndex = harness.statusRequests.length;
	const opening = harness.core.openTextEditor();
	assert.equal(harness.statusRequests.length, requestIndex + 1);
	harness.statusRequests[requestIndex]!.resolve({
		serviceEnabled: true,
		serviceConnected: true,
	});
	assert.deepEqual(await opening, { status: 'completed' });
}

export async function startRecording(
	harness: ReturnType<typeof createHarness>,
) {
	harness.core.setAutoStart(true);
	await openReady(harness);
	harness.core.onTextEntryFocused('before');
	assert.equal(harness.taps.length, 1);
	harness.taps[0]!.resolve('started');
	await settled();
	assert.deepEqual(harness.core.getSnapshot().automation, {
		phase: 'recording',
		textBeforeStart: 'before',
	});
}
