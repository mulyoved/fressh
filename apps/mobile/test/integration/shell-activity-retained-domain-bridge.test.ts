import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createShellKeyboardResumeDismissScheduler,
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
		cancelPendingResumeDismiss: 0,
	};
	const deferred: (() => void)[] = [];
	const events: string[] = [];
	const timers = new Map<number, () => void>();
	let nextTimerId = 0;
	let lateDismisses = 0;
	let dismissSchedules = 0;
	const scheduledDelays: number[] = [];
	const dismissScheduler = createShellKeyboardResumeDismissScheduler({
		schedule: (task, delayMs) => {
			scheduledDelays.push(delayMs);
			nextTimerId++;
			timers.set(nextTimerId, task);
			return nextTimerId;
		},
		cancel: (timerId) => timers.delete(timerId),
	});
	const actions: ShellActivityRetainedDomainActions = {
		setupInitialKeyboard: () => {
			calls.resume++;
			events.push('setup-initial-keyboard');
		},
		resumeFromAppState: () => {
			calls.resume++;
			events.push('resume-from-app-state');
			dismissSchedules++;
			dismissScheduler.schedule(() => lateDismisses++);
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
		cancelPendingResumeDismiss: () => {
			calls.cancelPendingResumeDismiss++;
			events.push('cancel-resume-dismiss');
			dismissScheduler.cancel();
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
		get dismissSchedules() {
			return dismissSchedules;
		},
		get lateDismisses() {
			return lateDismisses;
		},
		get pendingDismisses() {
			return timers.size;
		},
		scheduledDelays,
		flushTimers: () => {
			const pending = [...timers.values()];
			timers.clear();
			for (const task of pending) task();
		},
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
		keyboardInvalidation: 1,
		scrollbackRequestInvalidation: 1,
		directScrollbackClear: 1,
		inactiveScrollbackCleanup: 0,
		rememberKeyboardVisibility: 0,
		cancelPendingResumeDismiss: 1,
	});
	assert.deepEqual(harness.events, [
		'setup-initial-keyboard',
		'cancel-resume-dismiss',
		'invalidate-retained',
		'invalidate-browser',
		'close-browser',
		'invalidate-scrollback-request',
		'invalidate-keyboard',
		'clear-scrollback-directly',
	]);
	assert.equal(harness.pendingDismisses, 0);
	harness.flushTimers();
	assert.equal(harness.lateDismisses, 0);
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
		cancelPendingResumeDismiss: 1,
	});
	assert.equal(harness.pendingDismisses, 0);
	harness.flushTimers();
	assert.equal(harness.lateDismisses, 0);
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
		cancelPendingResumeDismiss: 1,
	});
	assert.deepEqual(harness.events.slice(1), [
		'cancel-resume-dismiss',
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
		keyboardInvalidation: 2,
		scrollbackRequestInvalidation: 1,
		directScrollbackClear: 1,
		inactiveScrollbackCleanup: 1,
		rememberKeyboardVisibility: 1,
		cancelPendingResumeDismiss: 2,
	});
});

void test('app inactivity then focus loss applies only the missing focus policy', () => {
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
		keyboardInvalidation: 2,
		scrollbackRequestInvalidation: 1,
		directScrollbackClear: 1,
		inactiveScrollbackCleanup: 1,
		rememberKeyboardVisibility: 1,
		cancelPendingResumeDismiss: 2,
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
		keyboardInvalidation: 1,
		scrollbackRequestInvalidation: 1,
		directScrollbackClear: 1,
		inactiveScrollbackCleanup: 0,
		rememberKeyboardVisibility: 0,
		cancelPendingResumeDismiss: 1,
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
		cancelPendingResumeDismiss: 1,
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
	assert.deepEqual(inverse.calls, {
		...initialCalls,
		resume: initialCalls.resume + 1,
	});
	assert.equal(inverse.dismissSchedules, 1);
	inverse.bridge.reconcile({
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 1,
	});
	assert.equal(inverse.calls.retainedInvalidation, 2);
	assert.equal(inverse.calls.resume, 1);
	assert.equal(inverse.dismissSchedules, 1);
	assert.deepEqual(inverse.scheduledDelays, [150]);
	assert.equal(inverse.calls.browserInvalidation, 1);
	assert.equal(inverse.calls.inactiveScrollbackCleanup, 1);
});

void test('initial keyboard setup has no delayed dismiss that can close later input', () => {
	const harness = createHarness();
	harness.bridge.reconcile({
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 0,
	});

	assert.equal(harness.calls.resume, 1);
	assert.equal(harness.dismissSchedules, 0);
	assert.equal(harness.pendingDismisses, 0);
	harness.flushTimers();
	assert.equal(harness.lateDismisses, 0);
});

void test('pure focus regain does not repeat AppState keyboard restoration', () => {
	const harness = createHarness();
	harness.bridge.reconcile({
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 0,
	});
	const initialSchedules = harness.dismissSchedules;
	harness.bridge.reconcile({
		focused: false,
		appState: 'active',
		appActive: true,
		interactive: false,
		generation: 1,
	});
	harness.bridge.reconcile({
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 2,
	});

	assert.equal(harness.calls.resume, 1);
	assert.equal(harness.dismissSchedules, initialSchedules);
	assert.equal(harness.pendingDismisses, 0);
	harness.flushTimers();
	assert.equal(harness.lateDismisses, 0);
});

void test('focus-gain generation invalidates retained work without keyboard restoration', () => {
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
	assert.equal(harness.calls.resume, beforeResume.resume);
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

void test('focus loss cancels a real AppState resume dismiss', () => {
	const harness = createHarness();
	harness.bridge.reconcile({
		focused: true,
		appState: 'background',
		appActive: false,
		interactive: false,
		generation: 0,
	});
	harness.bridge.reconcile({
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 1,
	});
	assert.equal(harness.pendingDismisses, 1);
	assert.deepEqual(harness.scheduledDelays, [150]);
	harness.bridge.reconcile({
		focused: false,
		appState: 'active',
		appActive: true,
		interactive: false,
		generation: 2,
	});

	assert.equal(harness.pendingDismisses, 0);
	harness.flushTimers();
	assert.equal(harness.lateDismisses, 0);
});

void test('Strict Mode replay defers cleanup and real unmount invalidates once', () => {
	const harness = createHarness();
	harness.bridge.reconcile({
		focused: true,
		appState: 'background',
		appActive: false,
		interactive: false,
		generation: 0,
	});
	harness.bridge.reconcile({
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 1,
	});
	const invalidationsBeforeReplay = harness.calls.retainedInvalidation;
	const cancellationsBeforeReplay = harness.calls.cancelPendingResumeDismiss;
	const firstCleanup = harness.bridge.setup();
	firstCleanup();
	const secondCleanup = harness.bridge.setup();
	harness.flush();
	assert.equal(harness.calls.retainedInvalidation, invalidationsBeforeReplay);
	assert.equal(
		harness.calls.cancelPendingResumeDismiss,
		cancellationsBeforeReplay,
	);
	assert.equal(harness.pendingDismisses, 1);

	secondCleanup();
	harness.flush();
	harness.flush();
	assert.equal(
		harness.calls.retainedInvalidation,
		invalidationsBeforeReplay + 1,
	);
	assert.equal(
		harness.calls.cancelPendingResumeDismiss,
		cancellationsBeforeReplay + 1,
	);
	assert.equal(harness.pendingDismisses, 0);
	harness.flushTimers();
	assert.equal(harness.lateDismisses, 0);
});

void test('app inactivity followed by unmount cannot leave a late dismiss', () => {
	const harness = createHarness();
	harness.bridge.reconcile({
		focused: true,
		appState: 'background',
		appActive: false,
		interactive: false,
		generation: 0,
	});
	harness.bridge.reconcile({
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 1,
	});
	assert.equal(harness.pendingDismisses, 1);
	const cleanup = harness.bridge.setup();
	harness.bridge.reconcile({
		focused: true,
		appState: 'background',
		appActive: false,
		interactive: false,
		generation: 2,
	});
	assert.equal(harness.calls.cancelPendingResumeDismiss, 2);
	assert.equal(harness.pendingDismisses, 0);

	cleanup();
	harness.flush();
	assert.equal(harness.calls.cancelPendingResumeDismiss, 3);
	assert.equal(harness.calls.retainedInvalidation, 4);
	harness.flushTimers();
	assert.equal(harness.lateDismisses, 0);
});

void test('dismiss scheduler replaces the pending timer at exactly 150 ms', () => {
	const timers = new Map<number, () => void>();
	const delays: number[] = [];
	const canceled: number[] = [];
	const fired: string[] = [];
	let nextTimer = 0;
	const scheduler = createShellKeyboardResumeDismissScheduler({
		schedule: (task, delayMs) => {
			delays.push(delayMs);
			nextTimer++;
			timers.set(nextTimer, task);
			return nextTimer;
		},
		cancel: (timer) => {
			canceled.push(timer);
			timers.delete(timer);
		},
	});

	scheduler.schedule(() => fired.push('first'));
	scheduler.schedule(() => fired.push('latest'));
	assert.deepEqual(delays, [150, 150]);
	assert.deepEqual(canceled, [1]);
	assert.equal(timers.size, 1);
	for (const task of timers.values()) task();
	timers.clear();
	assert.deepEqual(fired, ['latest']);
	scheduler.cancel();
	scheduler.cancel();
	assert.deepEqual(canceled, [1]);
});
