import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createShellActivityRetainedDomainBridge,
	type ShellActivityRetainedDomainActions,
} from '../../src/lib/shell-controllers/activity-retained-domain-bridge';

function createHarness() {
	const calls = {
		resume: 0,
		retainedInvalidation: 0,
		browserInvalidation: 0,
		browserClose: 0,
		keyboardInvalidation: 0,
		scrollbackRequestInvalidation: 0,
		directScrollbackClear: 0,
		inactiveScrollbackCleanup: 0,
		rememberKeyboardVisibility: 0,
	};
	const deferred: (() => void)[] = [];
	const actions: ShellActivityRetainedDomainActions = {
		resume: () => calls.resume++,
		invalidateRetainedDomains: () => calls.retainedInvalidation++,
		invalidateBrowserActions: () => calls.browserInvalidation++,
		closeBrowserActions: () => calls.browserClose++,
		invalidateKeyboardRunner: () => calls.keyboardInvalidation++,
		invalidateScrollbackRequests: () => calls.scrollbackRequestInvalidation++,
		clearScrollbackDirectly: () => {
			calls.directScrollbackClear++;
		},
		runInactiveScrollbackCleanup: () => {
			calls.inactiveScrollbackCleanup++;
		},
		rememberKeyboardVisibility: () => calls.rememberKeyboardVisibility++,
	};
	const bridge = createShellActivityRetainedDomainBridge(
		() => actions,
		(task) => deferred.push(task),
	);
	return {
		bridge,
		calls,
		flush: () => {
			while (deferred.length) deferred.shift()?.();
		},
	};
}

void test('focus loss invalidates and clears retained domains exactly once', () => {
	const harness = createHarness();
	harness.bridge.reconcile({
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 0,
	});
	harness.bridge.reconcile({
		focused: false,
		appState: 'active',
		appActive: true,
		interactive: false,
		generation: 1,
	});
	// A layout-effect replay for the same generation performs no transition work.
	harness.bridge.reconcile({
		focused: false,
		appState: 'active',
		appActive: true,
		interactive: false,
		generation: 1,
	});

	assert.deepEqual(harness.calls, {
		resume: 1,
		retainedInvalidation: 1,
		browserInvalidation: 1,
		browserClose: 1,
		keyboardInvalidation: 1,
		scrollbackRequestInvalidation: 1,
		directScrollbackClear: 1,
		inactiveScrollbackCleanup: 0,
		rememberKeyboardVisibility: 0,
	});
});

void test('app inactivity uses only the inactive scrollback policy', () => {
	const harness = createHarness();
	harness.bridge.reconcile({
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 0,
	});
	harness.bridge.reconcile({
		focused: true,
		appState: 'background',
		appActive: false,
		interactive: false,
		generation: 1,
	});

	assert.equal(harness.calls.retainedInvalidation, 1);
	assert.equal(harness.calls.directScrollbackClear, 0);
	assert.equal(harness.calls.inactiveScrollbackCleanup, 1);
	assert.equal(harness.calls.rememberKeyboardVisibility, 1);
});

void test('Strict Mode replay defers cleanup and real unmount invalidates once', () => {
	const harness = createHarness();
	const firstCleanup = harness.bridge.setup();
	firstCleanup();
	const secondCleanup = harness.bridge.setup();
	harness.flush();
	assert.equal(harness.calls.retainedInvalidation, 0);

	secondCleanup();
	harness.flush();
	harness.flush();
	assert.equal(harness.calls.retainedInvalidation, 1);
});
