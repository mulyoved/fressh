import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellWisprControllerCore } from '../../src/lib/shell-controllers/wispr-core';
import { createWisprNativeControlAuthority } from '../../src/lib/shell-controllers/wispr-native-control-authority';
import {
	createHarness,
	deferred,
	openReady,
	settled,
	startRecording,
} from './shell-wispr-controller-test-support';

void test('Android ready status opens text entry and auto-starts one tap', async () => {
	const harness = createHarness();
	harness.core.setAutoStart(true);
	await openReady(harness);
	assert.equal(harness.modalOpen, true);
	assert.equal(harness.core.getSnapshot().automation.phase, 'openingTextEntry');
	harness.core.onTextEntryFocused('', { x: 10, y: 20, width: 100, height: 80 });
	await settled();
	assert.equal(harness.taps.length, 1);
	harness.taps[0]!.resolve('started');
	await settled();
	assert.equal(harness.core.getSnapshot().automation.phase, 'recording');
});

void test('modal publication is visible before a dependent auto-start decision', async () => {
	const harness = createHarness();
	await openReady(harness);
	assert.equal(harness.modalOpen, true);
	harness.core.setAutoStart(true);
	assert.equal(harness.core.getSnapshot().automation.phase, 'openingTextEntry');
	harness.core.closeTextEntry();
	assert.equal(harness.modalOpen, false);
	assert.equal(harness.core.getSnapshot().automation.phase, 'idle');
});

void test('rejected modal arbitration cannot report a completed Wispr open', async () => {
	const harness = createHarness();
	const core = createShellWisprControllerCore({
		controlAuthority: createWisprNativeControlAuthority(),
		native: harness.native,
		modal: {
			isOpen: () => false,
			open: () => false,
			close: () => {},
		},
		now: harness.clock.now,
		setTimeout: harness.clock.setTimeout,
		clearTimeout: harness.clock.clearTimeout,
		pixelRatio: () => 1,
		platformOS: 'android',
		logger: { info: () => {}, warn: () => {} },
	});
	const opening = core.openTextEditor();
	harness.statusRequests[0]!.resolve({
		serviceEnabled: true,
		serviceConnected: true,
	});
	assert.equal((await opening).status, 'failed');
	assert.equal(core.getSnapshot().automation.phase, 'failed');
});

void test('unsupported platform opens editor without native work and publishes existing copy', async () => {
	const harness = createHarness('ios');
	assert.deepEqual(await harness.core.openTextEditor(), {
		status: 'unavailable',
	});
	assert.equal(harness.statusRequests.length, 0);
	assert.equal(harness.modalOpen, true);
	assert.deepEqual(harness.core.getSnapshot().availability, {
		type: 'setup-required',
		reason: 'service-disabled',
		message: 'Wispr automation is only available on Android.',
		openAccessibilitySettings: false,
	});
	assert.equal(harness.core.getSnapshot().automation.phase, 'failed');
});

for (const status of [
	{ serviceEnabled: false, serviceConnected: false },
	{ serviceEnabled: true, serviceConnected: false },
] as const) {
	void test(`Android setup-required status ${JSON.stringify(status)} opens text entry without native taps`, async () => {
		const harness = createHarness();
		harness.core.setAutoStart(true);
		const opening = harness.core.openTextEditor();
		harness.statusRequests[0]!.resolve(status);

		assert.deepEqual(await opening, { status: 'completed' });
		assert.equal(harness.modalOpen, true);
		assert.deepEqual(harness.core.getSnapshot(), {
			autoStartEnabled: true,
			availability: {
				type: 'setup-required',
				reason: 'service-disabled',
				message: 'Wispr automation is disabled. Text entry is still available.',
				openAccessibilitySettings: false,
			},
			automation: {
				phase: 'failed',
				reason: 'service-disabled',
				message: 'Wispr automation is disabled. Text entry is still available.',
			},
			control: { type: 'setup-pill', label: 'Wispr disabled' },
			busy: false,
		});
		assert.equal(harness.taps.length, 0);
	});
}

void test('repeated opens are ignored throughout active automation', async () => {
	const harness = createHarness();
	harness.core.setAutoStart(true);
	await openReady(harness);
	assert.deepEqual(await harness.core.openTextEditor(), {
		status: 'superseded',
	});
	harness.core.onTextEntryFocused('');
	assert.deepEqual(await harness.core.openTextEditor(), {
		status: 'superseded',
	});
	harness.taps[0]!.resolve('started');
	await settled();
	assert.deepEqual(await harness.core.openTextEditor(), {
		status: 'superseded',
	});
	assert.equal(harness.statusRequests.length, 1);
});

void test('tap timeout publishes retryable failure and closes a late successful start', async () => {
	const harness = createHarness();
	harness.core.setAutoStart(true);
	await openReady(harness);
	harness.core.onTextEntryFocused('');
	await harness.clock.advance(750);
	assert.deepEqual(harness.core.getSnapshot().automation, {
		phase: 'failed',
		reason: 'tap-failed',
		message: 'Wispr tap failed: Wispr tap timed out',
	});
	harness.core.closeTextEntry();
	harness.taps[0]!.resolve('late start');
	await settled();
	assert.equal(harness.taps.length, 2);
});

void test('close waits for the matching in-flight start before tapping close', async () => {
	const harness = createHarness();
	harness.core.setAutoStart(true);
	await openReady(harness);
	harness.core.onTextEntryFocused('');
	harness.core.closeTextEntry();
	assert.equal(harness.taps.length, 1);
	harness.taps[0]!.resolve('started');
	await settled();
	assert.equal(harness.taps.length, 2);
});

void test('new auto-start waits behind prior close and resumes after success', async () => {
	const harness = createHarness();
	await startRecording(harness);
	harness.core.closeTextEntry();
	assert.equal(harness.taps.length, 2);
	await openReady(harness);
	assert.equal(harness.core.getSnapshot().automation.phase, 'idle');
	harness.taps[1]!.resolve('closed');
	await settled();
	assert.equal(harness.core.getSnapshot().automation.phase, 'openingTextEntry');
	harness.core.onTextEntryFocused('next');
	assert.equal(harness.taps.length, 3);
});

void test('dictated text returns idle and supersedes the recording generation', async () => {
	const harness = createHarness();
	await startRecording(harness);
	harness.core.onTextChanged('before dictated');
	assert.deepEqual(harness.core.getSnapshot().automation, { phase: 'idle' });
	assert.equal(harness.core.getSnapshot().busy, false);
});

void test('invalidation silences UI completions and reconciles native recording', async () => {
	const statusHarness = createHarness();
	const opening = statusHarness.core.openTextEditor();
	statusHarness.core.invalidate('source-change');
	statusHarness.statusRequests[0]!.resolve({
		serviceEnabled: true,
		serviceConnected: true,
	});
	assert.deepEqual(await opening, { status: 'superseded' });
	assert.equal(statusHarness.modalOpen, false);

	const tapHarness = createHarness();
	tapHarness.core.setAutoStart(true);
	await openReady(tapHarness);
	tapHarness.core.onTextEntryFocused('');
	tapHarness.core.invalidate('focus-lost');
	tapHarness.taps[0]!.resolve('stale');
	await settled();
	assert.equal(tapHarness.core.getSnapshot().automation.phase, 'idle');
	assert.equal(tapHarness.taps.length, 2);
	assert.equal(tapHarness.nativeActive, true);
	tapHarness.taps[1]!.resolve('closed');
	await settled();
	assert.equal(tapHarness.nativeActive, false);
	assert.equal(tapHarness.taps.length, 2);
});

void test('dispose clears timers, invalidates work, bounds cleanup, and is idempotent', async () => {
	const harness = createHarness();
	await startRecording(harness);
	assert.equal(harness.nativeActive, true);
	harness.core.dispose();
	harness.core.dispose();
	assert.equal(harness.taps.length, 2);
	await harness.clock.advance(5_000);
	assert.equal(harness.clock.timers.size, 0);
	harness.taps[1]!.resolve('late close');
	await settled();
	assert.equal(harness.nativeActive, false);
	assert.equal(harness.taps.length, 2);
});

void test('opening fallback waits exactly 750 ms before starting', async () => {
	const harness = createHarness();
	harness.core.setAutoStart(true);
	await openReady(harness);
	await harness.clock.advance(749);
	assert.equal(harness.taps.length, 0);
	await harness.clock.advance(1);
	assert.equal(harness.taps.length, 1);
});

void test('screen prime uses physical pixels before starting Wispr control', async () => {
	const harness = createHarness();
	harness.core.setAutoStart(true);
	await openReady(harness);
	harness.core.onTextEntryFocused('before', {
		x: 10,
		y: 20,
		width: 100,
		height: 200,
	});
	await settled();
	assert.deepEqual(harness.screenTaps, [[120, 136]]);
	assert.equal(harness.taps.length, 1);
});

void test('screen prime rejection warns and still starts Wispr control', async () => {
	const harness = createHarness();
	harness.native.tapScreen = async (x, y) => {
		harness.screenTaps.push([x, y]);
		throw new Error('screen prime rejected');
	};
	harness.core.setAutoStart(true);
	await openReady(harness);
	harness.core.onTextEntryFocused('before', {
		x: 10,
		y: 20,
		width: 100,
		height: 200,
	});
	await settled();
	assert.deepEqual(harness.screenTaps, [[120, 136]]);
	assert.equal(harness.warnings.length, 1);
	assert.equal(
		harness.warnings[0]!.message,
		'Failed to prime Wispr text field',
	);
	assert.equal(harness.taps.length, 1);
});

void test('dispose orders one bounded cleanup after its in-flight start', async () => {
	const harness = createHarness();
	harness.core.setAutoStart(true);
	await openReady(harness);
	harness.core.onTextEntryFocused('');
	harness.core.dispose();
	assert.equal(harness.taps.length, 1);
	assert.equal(harness.clock.timers.size, 1);
	harness.taps[0]!.resolve('started');
	await settled();
	assert.equal(harness.taps.length, 2);
	assert.equal(harness.clock.timers.size, 1);
	await harness.clock.advance(750);
	assert.equal(harness.clock.timers.size, 0);
	harness.taps[1]!.resolve('late close');
	await settled();
	assert.equal(harness.nativeActive, false);
	assert.equal(harness.taps.length, 2);
});

void test('settings outcomes are explicit and unsupported settings avoid native work', async () => {
	const android = createHarness();
	assert.deepEqual(await android.core.openSettings(), { status: 'completed' });
	assert.equal(android.settingsCalls, 1);
	const ios = createHarness('ios');
	assert.deepEqual(await ios.core.openSettings(), { status: 'unavailable' });
	assert.equal(ios.settingsCalls, 0);
});

void test('invalidation silences a pending settings completion', async () => {
	const harness = createHarness();
	const settings = deferred<unknown>();
	harness.native.openSettings = () => settings.promise;
	const opening = harness.core.openSettings();
	harness.core.invalidate('source-change');
	settings.resolve(undefined);
	assert.deepEqual(await opening, { status: 'superseded' });
});

void test('active settings rejection returns a typed failure and warns', async () => {
	const harness = createHarness();
	const rejection = new Error('settings rejected');
	harness.native.openSettings = async () => {
		throw rejection;
	};

	assert.deepEqual(await harness.core.openSettings(), {
		status: 'failed',
		failure: {
			reason: 'service-disabled',
			message: 'Failed to open accessibility settings.',
		},
	});
	assert.deepEqual(harness.warnings, [
		{ message: 'Failed to open accessibility settings', error: rejection },
	]);
});

void test('stale settings rejection returns superseded without warning', async () => {
	const harness = createHarness();
	const settings = deferred<unknown>();
	harness.native.openSettings = () => settings.promise;
	const opening = harness.core.openSettings();
	harness.core.invalidate('source-change');
	settings.reject(new Error('stale settings rejection'));

	assert.deepEqual(await opening, { status: 'superseded' });
	assert.deepEqual(harness.warnings, []);
	assert.deepEqual(harness.core.getSnapshot().automation, { phase: 'idle' });
});

void test('throwing logger cannot break native failure publication', async () => {
	const harness = createHarness();
	const core = createShellWisprControllerCore({
		controlAuthority: createWisprNativeControlAuthority(),
		native: {
			...harness.native,
			getStatus: () => {
				throw new Error('status exploded');
			},
		},
		modal: { isOpen: () => false, open: () => false, close: () => {} },
		now: harness.clock.now,
		setTimeout: harness.clock.setTimeout,
		clearTimeout: harness.clock.clearTimeout,
		pixelRatio: () => 1,
		platformOS: 'android',
		logger: {
			info: () => {},
			warn: () => {
				throw new Error('logger');
			},
		},
	});
	const outcome = await core.openTextEditor();
	assert.equal(outcome.status, 'failed');
	assert.equal(core.getSnapshot().automation.phase, 'failed');
});

void test('subscriber re-entry observes a coherent snapshot', async () => {
	const harness = createHarness();
	let closes = 0;
	harness.core.setAutoStart(true);
	const unsubscribe = harness.core.subscribe(() => {
		if (harness.core.getSnapshot().automation.phase !== 'openingTextEntry')
			return;
		closes += 1;
		harness.core.closeTextEntry();
	});
	await openReady(harness);
	unsubscribe();
	assert.equal(closes, 1);
	assert.equal(harness.modalOpen, false);
	assert.equal(harness.core.getSnapshot().automation.phase, 'idle');
});
