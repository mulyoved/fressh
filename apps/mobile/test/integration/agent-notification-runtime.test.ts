import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	canRunAgentNotificationBridge,
	canRunAndroidBackgroundWork,
	createForegroundServiceStartCoordinator,
	shouldPreservePendingWithoutTarget,
	shouldPreserveForegroundServiceForShellDrop,
	shouldRunForegroundService,
	shouldStopReconnectOnBackground,
	shouldClearPendingAgentNotifications,
	shouldClearPendingAgentNotificationsForResumeKeyChange,
} from '../../src/lib/agent-notification-runtime';

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
