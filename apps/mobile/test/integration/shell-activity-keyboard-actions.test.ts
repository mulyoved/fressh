import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellActivityKeyboardActions } from '../../src/lib/shell-controllers/activity-keyboard-actions';

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
