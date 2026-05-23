import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	canRunAgentNotificationBridge,
	canRunAndroidBackgroundWork,
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
