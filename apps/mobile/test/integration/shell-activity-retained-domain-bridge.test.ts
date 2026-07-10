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
	const events: string[] = [];
	const actions: ShellActivityRetainedDomainActions = {
		resume: () => {
			calls.resume++;
			events.push('resume');
		},
		invalidateRetainedDomains: () => {
			calls.retainedInvalidation++;
			events.push('invalidate-retained');
		},
		invalidateBrowserActions: () => {
			calls.browserInvalidation++;
			events.push('invalidate-browser');
		},
		closeBrowserActions: () => {
			calls.browserClose++;
			events.push('close-browser');
		},
		invalidateKeyboardRunner: () => {
			calls.keyboardInvalidation++;
			events.push('invalidate-keyboard');
		},
		invalidateScrollbackRequests: () => {
			calls.scrollbackRequestInvalidation++;
			events.push('invalidate-scrollback-request');
		},
		clearScrollbackDirectly: () => {
			calls.directScrollbackClear++;
			events.push('clear-scrollback-directly');
		},
		runInactiveScrollbackCleanup: () => {
			calls.inactiveScrollbackCleanup++;
			events.push('cleanup-scrollback-inactive');
		},
		rememberKeyboardVisibility: () => {
			calls.rememberKeyboardVisibility++;
			events.push('remember-keyboard');
		},
	};
	const bridge = createShellActivityRetainedDomainBridge(
		() => actions,
		(task) => deferred.push(task),
	);
	return {
		bridge,
		calls,
		events,
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
	assert.equal(harness.calls.retainedInvalidation, 0);
	assert.equal(harness.calls.resume, 1);
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
		keyboardInvalidation: 0,
		scrollbackRequestInvalidation: 1,
		directScrollbackClear: 1,
		inactiveScrollbackCleanup: 0,
		rememberKeyboardVisibility: 0,
	});
	assert.deepEqual(harness.events, [
		'resume',
		'invalidate-retained',
		'invalidate-browser',
		'close-browser',
		'invalidate-scrollback-request',
		'clear-scrollback-directly',
	]);
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

	assert.deepEqual(harness.calls, {
		resume: 1,
		retainedInvalidation: 1,
		browserInvalidation: 1,
		browserClose: 0,
		keyboardInvalidation: 1,
		scrollbackRequestInvalidation: 0,
		directScrollbackClear: 0,
		inactiveScrollbackCleanup: 1,
		rememberKeyboardVisibility: 1,
	});
});

void test('combined focus loss and app inactivity use one inactive scrollback path', () => {
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
		appState: 'background',
		appActive: false,
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
		directScrollbackClear: 0,
		inactiveScrollbackCleanup: 1,
		rememberKeyboardVisibility: 1,
	});
	assert.deepEqual(harness.events.slice(1), [
		'invalidate-retained',
		'invalidate-browser',
		'close-browser',
		'invalidate-scrollback-request',
		'invalidate-keyboard',
		'cleanup-scrollback-inactive',
		'remember-keyboard',
	]);
});

void test('focus loss then backgrounding applies both policies without common replay', () => {
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
	harness.bridge.reconcile({
		focused: false,
		appState: 'background',
		appActive: false,
		interactive: false,
		generation: 1,
	});

	assert.deepEqual(harness.calls, {
		resume: 1,
		retainedInvalidation: 1,
		browserInvalidation: 2,
		browserClose: 1,
		keyboardInvalidation: 1,
		scrollbackRequestInvalidation: 1,
		directScrollbackClear: 1,
		inactiveScrollbackCleanup: 1,
		rememberKeyboardVisibility: 1,
	});
});

void test('initial noninteractive causes and inverse resume follow the action matrix', () => {
	const focusLost = createHarness();
	focusLost.bridge.reconcile({
		focused: false,
		appState: 'active',
		appActive: true,
		interactive: false,
		generation: 0,
	});
	assert.deepEqual(focusLost.calls, {
		resume: 0,
		retainedInvalidation: 1,
		browserInvalidation: 1,
		browserClose: 1,
		keyboardInvalidation: 0,
		scrollbackRequestInvalidation: 1,
		directScrollbackClear: 1,
		inactiveScrollbackCleanup: 0,
		rememberKeyboardVisibility: 0,
	});

	const background = createHarness();
	background.bridge.reconcile({
		focused: true,
		appState: 'background',
		appActive: false,
		interactive: false,
		generation: 0,
	});
	assert.deepEqual(background.calls, {
		resume: 0,
		retainedInvalidation: 1,
		browserInvalidation: 1,
		browserClose: 0,
		keyboardInvalidation: 1,
		scrollbackRequestInvalidation: 0,
		directScrollbackClear: 0,
		inactiveScrollbackCleanup: 1,
		rememberKeyboardVisibility: 1,
	});

	const inverse = createHarness();
	inverse.bridge.reconcile({
		focused: false,
		appState: 'background',
		appActive: false,
		interactive: false,
		generation: 0,
	});
	const initialCalls = { ...inverse.calls };
	inverse.bridge.reconcile({
		focused: false,
		appState: 'active',
		appActive: true,
		interactive: false,
		generation: 0,
	});
	assert.deepEqual(inverse.calls, initialCalls);
	inverse.bridge.reconcile({
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 1,
	});
	assert.equal(inverse.calls.retainedInvalidation, 2);
	assert.equal(inverse.calls.resume, 1);
	assert.equal(inverse.calls.browserInvalidation, 1);
	assert.equal(inverse.calls.inactiveScrollbackCleanup, 1);
});

void test('resume generation invalidates retained work once without inactive cleanup', () => {
	const harness = createHarness();
	harness.bridge.reconcile({
		focused: false,
		appState: 'active',
		appActive: true,
		interactive: false,
		generation: 0,
	});
	const beforeResume = { ...harness.calls };
	assert.equal(beforeResume.retainedInvalidation, 1);
	assert.equal(beforeResume.resume, 0);

	harness.bridge.reconcile({
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 1,
	});
	harness.bridge.reconcile({
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 1,
	});

	assert.equal(
		harness.calls.retainedInvalidation,
		beforeResume.retainedInvalidation + 1,
	);
	assert.equal(harness.calls.resume, beforeResume.resume + 1);
	assert.equal(
		harness.calls.directScrollbackClear,
		beforeResume.directScrollbackClear,
	);
	assert.equal(
		harness.calls.inactiveScrollbackCleanup,
		beforeResume.inactiveScrollbackCleanup,
	);
	assert.equal(
		harness.calls.browserInvalidation,
		beforeResume.browserInvalidation,
	);
	assert.equal(
		harness.calls.keyboardInvalidation,
		beforeResume.keyboardInvalidation,
	);
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
