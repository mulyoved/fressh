import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	canRunAgentNotificationBridge,
	canRunAndroidBackgroundWork,
	createForegroundServiceStartCoordinator,
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
