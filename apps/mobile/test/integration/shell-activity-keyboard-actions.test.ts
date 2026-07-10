import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellActivityKeyboardActions } from '../../src/lib/shell-controllers/activity-keyboard-actions';
import { createShellKeyboardResumeDismissScheduler } from '../../src/lib/shell-controllers/activity-retained-domain-bridge';

function createHarness(
	input: {
		platformOS?: string;
		systemKeyboardEnabled?: boolean;
		wasKeyboardVisible?: boolean;
	} = {},
) {
	let visible = input.wasKeyboardVisible ?? false;
	const enabled = input.systemKeyboardEnabled ?? true;
	const synchronized: boolean[] = [];
	let dismisses = 0;
	let schedules = 0;
	const actions = createShellActivityKeyboardActions({
		platformOS: input.platformOS ?? 'android',
		getSystemKeyboardEnabled: () => enabled,
		getWasKeyboardVisible: () => visible,
		setKeyboardVisible: (nextVisible) => {
			visible = nextVisible;
		},
		setXtermSystemKeyboardEnabled: (nextEnabled) => {
			synchronized.push(nextEnabled);
		},
		dismissKeyboard: () => dismisses++,
		scheduleDelayedDismiss: () => schedules++,
	});
	return {
		actions,
		get dismisses() {
			return dismisses;
		},
		get schedules() {
			return schedules;
		},
		synchronized,
		get visible() {
			return visible;
		},
	};
}

void test('initial Android setup synchronizes and dismisses without scheduling', () => {
	const harness = createHarness();
	harness.actions.setupInitialKeyboard();

	assert.deepEqual(harness.synchronized, [true]);
	assert.equal(harness.dismisses, 1);
	assert.equal(harness.schedules, 0);
});

void test('non-Android initial setup and resume are no-ops', () => {
	const harness = createHarness({ platformOS: 'ios' });
	harness.actions.setupInitialKeyboard();
	harness.actions.resumeFromAppState();

	assert.deepEqual(harness.synchronized, []);
	assert.equal(harness.dismisses, 0);
	assert.equal(harness.schedules, 0);
});

void test('resume preserves an enabled keyboard that was visible', () => {
	const harness = createHarness({
		systemKeyboardEnabled: true,
		wasKeyboardVisible: true,
	});
	harness.actions.resumeFromAppState();

	assert.deepEqual(harness.synchronized, [true]);
	assert.equal(harness.dismisses, 0);
	assert.equal(harness.schedules, 0);
	assert.equal(harness.visible, true);
});

void test('resume dismisses when the system keyboard is disabled', () => {
	const harness = createHarness({
		systemKeyboardEnabled: false,
		wasKeyboardVisible: true,
	});
	harness.actions.resumeFromAppState();

	assert.deepEqual(harness.synchronized, [false]);
	assert.equal(harness.dismisses, 1);
	assert.equal(harness.schedules, 1);
	assert.equal(harness.visible, false);
});

void test('resume dismisses when the keyboard was not previously visible', () => {
	const harness = createHarness({
		systemKeyboardEnabled: true,
		wasKeyboardVisible: false,
	});
	harness.actions.resumeFromAppState();

	assert.deepEqual(harness.synchronized, [true]);
	assert.equal(harness.dismisses, 1);
	assert.equal(harness.schedules, 1);
	assert.equal(harness.visible, false);
});

void test('production keyboard actions compose with exact scheduler replacement', () => {
	const timers = new Map<number, { delayMs: number; task: () => void }>();
	const canceled: number[] = [];
	let nextTimer = 0;
	let dismisses = 0;
	const scheduler = createShellKeyboardResumeDismissScheduler({
		schedule: (task, delayMs) => {
			nextTimer++;
			timers.set(nextTimer, { delayMs, task });
			return nextTimer;
		},
		cancel: (timer) => {
			canceled.push(timer);
			timers.delete(timer);
		},
	});
	const actions = createShellActivityKeyboardActions({
		platformOS: 'android',
		getSystemKeyboardEnabled: () => false,
		getWasKeyboardVisible: () => true,
		setKeyboardVisible: () => {},
		setXtermSystemKeyboardEnabled: () => {},
		dismissKeyboard: () => dismisses++,
		scheduleDelayedDismiss: scheduler.schedule,
	});

	actions.resumeFromAppState();
	actions.resumeFromAppState();
	assert.deepEqual(canceled, [1]);
	assert.equal(timers.size, 1);
	assert.equal(timers.get(2)?.delayMs, 150);
	timers.get(2)?.task();
	timers.delete(2);
	assert.equal(dismisses, 3);

	actions.resumeFromAppState();
	scheduler.cancel();
	scheduler.cancel();
	assert.deepEqual(canceled, [1, 3]);
	assert.equal(timers.size, 0);
	assert.equal(dismisses, 4);
});
