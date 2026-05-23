import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	canAttemptBackgroundReconnect,
	canRunAgentNotificationBridge,
	canRunAndroidBackgroundWork,
	createAgentNotificationRestartCoordinator,
	createForegroundServiceStartCoordinator,
	getForegroundServiceNotificationMessage,
	getNextConfiguredResumeKey,
	shouldPreservePendingWithoutConfiguredTarget,
	shouldPreservePendingWithoutTarget,
	shouldPreserveForegroundServiceForShellDrop,
	shouldRunForegroundService,
	shouldStopReconnectOnBackground,
	shouldWaitForForegroundServiceCoverage,
	shouldClearPendingAgentNotifications,
	shouldClearPendingAgentNotificationsForResumeKeyChange,
} from '../../src/lib/agent-notification-runtime';

void test('foreground service notification message avoids connection identity', () => {
	assert.equal(
		getForegroundServiceNotificationMessage({
			hasConnection: true,
			isAutoConnecting: false,
			isReconnecting: false,
		}),
		'SSH session active',
	);
	assert.equal(
		getForegroundServiceNotificationMessage({
			hasConnection: false,
			isAutoConnecting: false,
			isReconnecting: true,
		}),
		'Reconnecting...',
	);
});

void test('agent notification bridge runs while the Android app is active', () => {
	assert.equal(
		canRunAgentNotificationBridge({
			platformOS: 'android',
			appActive: true,
			foregroundServiceStarted: false,
		}),
		true,
	);
});

void test('agent notification bridge requires foreground service coverage in Android background', () => {
	assert.equal(
		canRunAgentNotificationBridge({
			platformOS: 'android',
			appActive: false,
			foregroundServiceStarted: false,
		}),
		false,
	);
	assert.equal(
		canRunAgentNotificationBridge({
			platformOS: 'android',
			appActive: false,
			foregroundServiceStarted: true,
		}),
		true,
	);
});

void test('Android background work is allowed only after foreground service start succeeds', () => {
	assert.equal(
		canRunAndroidBackgroundWork({
			platformOS: 'android',
			foregroundServiceStarted: false,
		}),
		false,
	);
	assert.equal(
		canRunAndroidBackgroundWork({
			platformOS: 'android',
			foregroundServiceStarted: true,
		}),
		true,
	);
	assert.equal(
		canRunAndroidBackgroundWork({
			platformOS: 'ios',
			foregroundServiceStarted: true,
		}),
		false,
	);
});

void test('foreground service keeps running while reconnecting without shells', () => {
	assert.equal(
		shouldRunForegroundService({
			shellCount: 0,
			isAutoConnecting: false,
			isReconnecting: true,
		}),
		true,
	);
	assert.equal(
		shouldRunForegroundService({
			shellCount: 0,
			isAutoConnecting: false,
			isReconnecting: false,
		}),
		false,
	);
});

void test('background shell drop preserves foreground service until reconnect scheduling runs', () => {
	assert.equal(
		shouldPreserveForegroundServiceForShellDrop({
			platformOS: 'android',
			appActive: false,
			backgroundWorkAllowed: true,
			previousShellCount: 1,
			nextShellCount: 0,
			isAutoConnecting: false,
			isReconnecting: false,
		}),
		true,
	);
});

void test('foreground service is not preserved for unsupported shell drops', () => {
	assert.equal(
		shouldPreserveForegroundServiceForShellDrop({
			platformOS: 'android',
			appActive: false,
			backgroundWorkAllowed: false,
			previousShellCount: 1,
			nextShellCount: 0,
			isAutoConnecting: false,
			isReconnecting: false,
		}),
		false,
	);
	assert.equal(
		shouldPreserveForegroundServiceForShellDrop({
			platformOS: 'ios',
			appActive: false,
			backgroundWorkAllowed: true,
			previousShellCount: 1,
			nextShellCount: 0,
			isAutoConnecting: false,
			isReconnecting: false,
		}),
		false,
	);
	assert.equal(
		shouldPreserveForegroundServiceForShellDrop({
			platformOS: 'android',
			appActive: false,
			backgroundWorkAllowed: true,
			previousShellCount: 0,
			nextShellCount: 0,
			isAutoConnecting: false,
			isReconnecting: false,
		}),
		false,
	);
});

void test('background transition keeps reconnect running when Android background work is allowed', () => {
	assert.equal(
		shouldStopReconnectOnBackground({
			platformOS: 'android',
			backgroundWorkAllowed: true,
		}),
		false,
	);
});

void test('background transition stops reconnect without Android background work', () => {
	assert.equal(
		shouldStopReconnectOnBackground({
			platformOS: 'android',
			backgroundWorkAllowed: false,
		}),
		true,
	);
	assert.equal(
		shouldStopReconnectOnBackground({
			platformOS: 'ios',
			backgroundWorkAllowed: true,
		}),
		true,
	);
});

void test('background reconnect waits for foreground service coverage to restart', () => {
	assert.equal(
		shouldWaitForForegroundServiceCoverage({
			platformOS: 'android',
			appActive: false,
			backgroundWorkAllowed: false,
			foregroundServiceRequired: true,
		}),
		true,
	);
	assert.equal(
		shouldWaitForForegroundServiceCoverage({
			platformOS: 'android',
			appActive: false,
			backgroundWorkAllowed: false,
			foregroundServiceRequired: false,
		}),
		false,
	);
	assert.equal(
		shouldWaitForForegroundServiceCoverage({
			platformOS: 'android',
			appActive: true,
			backgroundWorkAllowed: false,
			foregroundServiceRequired: true,
		}),
		false,
	);
});

void test('scheduled background reconnect waits instead of attempting while service coverage restarts', () => {
	assert.equal(
		canAttemptBackgroundReconnect({
			platformOS: 'android',
			appActive: false,
			backgroundWorkAllowed: false,
		}),
		false,
	);
	assert.equal(
		canAttemptBackgroundReconnect({
			platformOS: 'android',
			appActive: true,
			backgroundWorkAllowed: false,
		}),
		true,
	);
	assert.equal(
		canAttemptBackgroundReconnect({
			platformOS: 'android',
			appActive: false,
			backgroundWorkAllowed: true,
		}),
		true,
	);
});

void test('foreground service start coordinator keeps same-key pending results current', () => {
	const coordinator = createForegroundServiceStartCoordinator();
	const request = coordinator.begin('Fressh Terminal|Connected');

	assert.equal(
		coordinator.isCurrent(request, 'Fressh Terminal|Connected'),
		true,
	);
	assert.equal(
		coordinator.isCurrent(request, 'Fressh Terminal|Reconnecting'),
		false,
	);
});

void test('foreground service start coordinator invalidates stale starts on stop or replacement', () => {
	const coordinator = createForegroundServiceStartCoordinator();
	const first = coordinator.begin('Fressh Terminal|Connected');
	const second = coordinator.begin('Fressh Terminal|Reconnecting');

	assert.equal(
		coordinator.isCurrent(first, 'Fressh Terminal|Connected'),
		false,
	);
	assert.equal(
		coordinator.isCurrent(second, 'Fressh Terminal|Reconnecting'),
		true,
	);

	coordinator.invalidate();

	assert.equal(
		coordinator.isCurrent(second, 'Fressh Terminal|Reconnecting'),
		false,
	);
});

void test('runtime bridge pause does not clear pending agent notifications', () => {
	assert.equal(
		shouldClearPendingAgentNotifications({
			hasListenerTarget: false,
			hasConfiguredTarget: true,
		}),
		false,
	);
});

void test('missing configured target clears pending agent notifications', () => {
	assert.equal(
		shouldClearPendingAgentNotifications({
			hasListenerTarget: false,
			hasConfiguredTarget: false,
		}),
		true,
	);
	assert.equal(
		shouldClearPendingAgentNotifications({
			hasListenerTarget: true,
			hasConfiguredTarget: true,
		}),
		false,
	);
});

void test('missing configured target preserves pending agent notifications while reconnect is expected', () => {
	assert.equal(
		shouldClearPendingAgentNotifications({
			hasListenerTarget: false,
			hasConfiguredTarget: false,
			reconnectExpected: true,
		}),
		false,
	);
});

void test('missing configured target preserves pending agent notifications during reconnect', () => {
	assert.equal(
		shouldPreservePendingWithoutTarget({
			previousShellCount: 0,
			shellCount: 0,
			appActive: false,
			androidBackgroundWorkAllowed: true,
			isReconnecting: true,
		}),
		true,
	);
	assert.equal(
		shouldPreservePendingWithoutTarget({
			previousShellCount: 0,
			shellCount: 0,
			appActive: false,
			androidBackgroundWorkAllowed: false,
			isReconnecting: true,
		}),
		false,
	);
});

void test('missing configured target preserves pending agent notifications while shell settings load', () => {
	assert.equal(
		shouldPreservePendingWithoutConfiguredTarget({
			reconnectExpected: false,
			hasShell: true,
			hasConnection: true,
			settingsLoaded: false,
		}),
		true,
	);
	assert.equal(
		shouldPreservePendingWithoutConfiguredTarget({
			reconnectExpected: false,
			hasShell: true,
			hasConnection: true,
			settingsLoaded: true,
		}),
		false,
	);
	assert.equal(
		shouldPreservePendingWithoutConfiguredTarget({
			reconnectExpected: true,
			hasShell: false,
			hasConnection: false,
			settingsLoaded: false,
		}),
		true,
	);
});

void test('shell-only listener target changes do not clear pending agent notifications', () => {
	assert.equal(
		shouldClearPendingAgentNotificationsForResumeKeyChange({
			previousResumeKey: 'conn-1:main',
			nextResumeKey: 'conn-1:main',
		}),
		false,
	);
});

void test('resume target changes clear pending agent notifications', () => {
	assert.equal(
		shouldClearPendingAgentNotificationsForResumeKeyChange({
			previousResumeKey: 'conn-1:main',
			nextResumeKey: 'conn-2:main',
		}),
		true,
	);
	assert.equal(
		shouldClearPendingAgentNotificationsForResumeKeyChange({
			previousResumeKey: 'conn-1:main',
			nextResumeKey: null,
		}),
		true,
	);
	assert.equal(
		shouldClearPendingAgentNotificationsForResumeKeyChange({
			previousResumeKey: null,
			nextResumeKey: 'conn-1:main',
		}),
		false,
	);
});

void test('transient missing resume target does not clear pending agent notifications while reconnect is expected', () => {
	assert.equal(
		shouldClearPendingAgentNotificationsForResumeKeyChange({
			previousResumeKey: 'conn-1:main',
			nextResumeKey: null,
			reconnectExpected: true,
		}),
		false,
	);
});

void test('transient reconnect keeps the last non-null resume key for the next comparison', () => {
	assert.equal(
		getNextConfiguredResumeKey({
			previousResumeKey: 'saved-host:main',
			nextResumeKey: null,
			reconnectExpected: true,
		}),
		'saved-host:main',
	);
	assert.equal(
		getNextConfiguredResumeKey({
			previousResumeKey: 'saved-host:main',
			nextResumeKey: 'other-host:main',
			reconnectExpected: true,
		}),
		'other-host:main',
	);
	assert.equal(
		getNextConfiguredResumeKey({
			previousResumeKey: 'saved-host:main',
			nextResumeKey: null,
			reconnectExpected: false,
		}),
		null,
	);
});

void test('agent notification restart coordinator exhausts delays and resets after healthy work', () => {
	const coordinator = createAgentNotificationRestartCoordinator({
		maxAttempts: 2,
		delaysMs: [100, 200],
		healthyResetMs: 1_000,
	});

	assert.equal(coordinator.attempts, 0);
	assert.deepEqual(coordinator.consume(), { attempt: 0, delayMs: 100 });
	assert.equal(coordinator.attempts, 1);
	assert.deepEqual(coordinator.consume(), { attempt: 1, delayMs: 200 });
	assert.equal(coordinator.attempts, 2);
	assert.equal(coordinator.consume(), null);
	assert.equal(coordinator.attempts, 2);

	assert.equal(
		coordinator.resetIfHealthy({ nowMs: 1_500, startedAtMs: 1_000 }),
		false,
	);
	assert.equal(coordinator.attempts, 2);
	assert.equal(
		coordinator.resetIfHealthy({ nowMs: 2_000, startedAtMs: 1_000 }),
		true,
	);

	assert.equal(coordinator.attempts, 0);
	assert.deepEqual(coordinator.consume(), { attempt: 0, delayMs: 100 });
});

void test('agent notification restart coordinator reuses the last delay after the delay list is exhausted', () => {
	const coordinator = createAgentNotificationRestartCoordinator({
		maxAttempts: 4,
		delaysMs: [100, 200],
	});

	assert.deepEqual(coordinator.consume(), { attempt: 0, delayMs: 100 });
	assert.deepEqual(coordinator.consume(), { attempt: 1, delayMs: 200 });
	assert.deepEqual(coordinator.consume(), { attempt: 2, delayMs: 200 });
	assert.deepEqual(coordinator.consume(), { attempt: 3, delayMs: 200 });
	assert.equal(coordinator.consume(), null);
});
