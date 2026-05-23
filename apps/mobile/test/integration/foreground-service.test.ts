import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldStartForegroundService } from '../../src/lib/agent-notification-runtime';
import { createForegroundServiceStarter } from '../../src/lib/foreground-service-core';

void test('foreground service restart is required when liveness flips to stopped', () => {
	const key = 'Fressh Terminal|Connected';

	assert.equal(
		shouldStartForegroundService({
			currentKey: key,
			nextKey: key,
			foregroundServiceStarted: true,
		}),
		false,
	);
	assert.equal(
		shouldStartForegroundService({
			currentKey: key,
			nextKey: key,
			foregroundServiceStarted: false,
		}),
		true,
	);
});

void test('foreground service starter reports native start success', async () => {
	const calls: [string, string][] = [];
	const starter = createForegroundServiceStarter({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			start: async (title, message) => {
				calls.push([title, message]);
			},
		}),
		ensureNotificationPermission: async () => true,
		logger: { warn: () => {} },
	});

	const started = await starter.startForegroundService({
		title: 'Terminal',
		message: 'Connected',
	});

	assert.equal(started, true);
	assert.deepEqual(calls, [['Terminal', 'Connected']]);
});

void test('foreground service starter reports native running state', async () => {
	const starter = createForegroundServiceStarter({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			start: async () => {},
			isRunning: async () => true,
		}),
		ensureNotificationPermission: async () => true,
		logger: { warn: () => {} },
	});

	assert.equal(await starter.isForegroundServiceRunning(), true);
});

void test('foreground service starter treats missing running probe as compatible', async () => {
	const starter = createForegroundServiceStarter({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			start: async () => {},
		}),
		ensureNotificationPermission: async () => true,
		logger: { warn: () => {} },
	});

	assert.equal(await starter.isForegroundServiceRunning(), true);
});

void test('foreground service starter reports native start failure', async () => {
	const error = new Error('start rejected');
	const warnings: unknown[][] = [];
	const starter = createForegroundServiceStarter({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			start: async () => {
				throw error;
			},
		}),
		ensureNotificationPermission: async () => true,
		logger: { warn: (...args) => warnings.push(args) },
	});

	const started = await starter.startForegroundService();

	assert.equal(started, false);
	assert.deepEqual(warnings, [['foreground service start failed', error]]);
});

void test('foreground service starter does not claim background coverage without native module', async () => {
	const starter = createForegroundServiceStarter({
		getPlatformOS: () => 'android',
		getNativeModule: () => undefined,
		ensureNotificationPermission: async () => true,
		logger: { warn: () => {} },
	});

	assert.equal(await starter.startForegroundService(), false);
});
