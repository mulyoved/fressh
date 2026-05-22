import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAgentNotificationsNativeWrapper } from '../../src/lib/agent-notifications-native';

const require = createRequire(import.meta.url);
const { compileModsAsync } = require(
	'expo/config-plugins',
) as typeof import('expo/config-plugins');
const withForegroundService = require('../../plugins/with-foreground-service')
	.default as typeof import('../../plugins/with-foreground-service').default;

async function foregroundPluginSource() {
	return readFile(
		new URL('../../plugins/with-foreground-service.ts', import.meta.url)
			.pathname,
		'utf8',
	);
}

async function committedForegroundServiceModuleSource() {
	return readFile(
		new URL(
			'../../android/app/src/main/java/com/finalapp/vibe2/ForegroundServiceModule.kt',
			import.meta.url,
		).pathname,
		'utf8',
	);
}

async function committedSshForegroundServiceSource() {
	return readFile(
		new URL(
			'../../android/app/src/main/java/com/finalapp/vibe2/SshForegroundService.kt',
			import.meta.url,
		).pathname,
		'utf8',
	);
}

async function generatedSshForegroundServiceSource() {
	const projectRoot = await mkdtemp(
		path.join(os.tmpdir(), 'fressh-foreground-service-plugin-'),
	);

	try {
		await mkdir(path.join(projectRoot, 'android/app/src/main'), {
			recursive: true,
		});
		await writeFile(
			path.join(projectRoot, 'android/app/src/main/AndroidManifest.xml'),
			[
				'<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
				'  <application android:name=".MainApplication" />',
				'</manifest>',
			].join('\n'),
			'utf8',
		);

		const config = withForegroundService({
			name: 'Fressh Test Fixture',
			slug: 'fressh-test-fixture',
			android: {
				package: 'com.finalapp.vibe2',
			},
		});

		await compileModsAsync(config, {
			projectRoot,
			platforms: ['android'],
		});

		return await readFile(
			path.join(
				projectRoot,
				'android/app/src/main/java/com/finalapp/vibe2/SshForegroundService.kt',
			),
			'utf8',
		);
	} finally {
		await rm(projectRoot, { force: true, recursive: true });
	}
}

async function agentNotificationsNativeSource() {
	return readFile(
		new URL('../../src/lib/agent-notifications-native.ts', import.meta.url)
			.pathname,
		'utf8',
	);
}

void test('foreground service plugin defines a separate agent alert channel', async () => {
	const source = await foregroundPluginSource();

	assert.doesNotMatch(source, /import\s+ConfigPlugins\s+from/);
	assert.match(
		source,
		/AndroidConfig,[\s\S]*withAndroidManifest,[\s\S]*withDangerousMod,[\s\S]*from 'expo\/config-plugins'/,
	);
	assert.match(source, /AGENT_ALERT_CHANNEL_ID = "fressh_agent_alerts"/);
	assert.match(source, /AGENT_ALERT_CHANNEL_NAME = "Fressh Agent Alerts"/);
	assert.match(source, /NotificationManager\.IMPORTANCE_DEFAULT/);
});

void test('foreground service native module exposes agent alert methods', async () => {
	const source = await foregroundPluginSource();

	assert.match(source, /fun postAgentAlert\(/);
	assert.match(source, /fun cancelAgentAlert\(/);
	assert.match(source, /notify\(notificationId, buildAgentAlertNotification/);
	assert.match(source, /cancel\(notificationId\)/);
});

void test('committed Android module exposes agent alert methods', async () => {
	const source = await committedForegroundServiceModuleSource();

	assert.match(source, /fun postAgentAlert\(/);
	assert.match(source, /fun cancelAgentAlert\(/);
	assert.match(source, /SshForegroundService\.postAgentAlert\(/);
	assert.match(source, /SshForegroundService\.cancelAgentAlert\(/);
});

void test('committed Android service defines and creates agent alert channel', async () => {
	const source = await committedSshForegroundServiceSource();

	assert.match(source, /AGENT_ALERT_CHANNEL_ID = "fressh_agent_alerts"/);
	assert.match(source, /AGENT_ALERT_CHANNEL_NAME = "Fressh Agent Alerts"/);
	assert.match(source, /NotificationManager\.IMPORTANCE_DEFAULT/);
	assert.match(source, /ensureNotificationChannels\(context\)/);
	assert.match(source, /notify\(notificationId, buildAgentAlertNotification/);
	assert.match(source, /cancel\(notificationId\)/);
});

void test('committed Android service passes agent alert intent extras to MainActivity', async () => {
	const source = await committedSshForegroundServiceSource();

	assert.match(source, /EXTRA_AGENT_CONNECTION_ID = "agentConnectionId"/);
	assert.match(source, /EXTRA_AGENT_SESSION = "agentSession"/);
	assert.match(source, /EXTRA_AGENT_TARGET = "agentTarget"/);
	assert.match(source, /EXTRA_AGENT_WINDOW_ID = "agentWindowId"/);
	assert.match(source, /putExtra\(EXTRA_AGENT_CONNECTION_ID, connectionId\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_SESSION, session\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_TARGET, target\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_WINDOW_ID, windowId\)/);
});

void test('foreground service plugin passes agent alert intent extras to MainActivity', async () => {
	const source = await foregroundPluginSource();

	assert.match(source, /EXTRA_AGENT_CONNECTION_ID = "agentConnectionId"/);
	assert.match(source, /EXTRA_AGENT_SESSION = "agentSession"/);
	assert.match(source, /EXTRA_AGENT_TARGET = "agentTarget"/);
	assert.match(source, /EXTRA_AGENT_WINDOW_ID = "agentWindowId"/);
	assert.match(source, /putExtra\(EXTRA_AGENT_CONNECTION_ID, connectionId\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_SESSION, session\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_TARGET, target\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_WINDOW_ID, windowId\)/);
});

void test('foreground service plugin generates Kotlin with agent alert routing data', async () => {
	const source = await generatedSshForegroundServiceSource();

	assert.match(source, /AGENT_ALERT_CHANNEL_ID = "fressh_agent_alerts"/);
	assert.match(source, /AGENT_ALERT_CHANNEL_NAME = "Fressh Agent Alerts"/);
	assert.match(source, /NotificationManager\.IMPORTANCE_DEFAULT/);
	assert.match(source, /EXTRA_AGENT_CONNECTION_ID = "agentConnectionId"/);
	assert.match(source, /EXTRA_AGENT_SESSION = "agentSession"/);
	assert.match(source, /EXTRA_AGENT_TARGET = "agentTarget"/);
	assert.match(source, /EXTRA_AGENT_WINDOW_ID = "agentWindowId"/);
	assert.match(source, /putExtra\(EXTRA_AGENT_CONNECTION_ID, connectionId\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_SESSION, session\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_TARGET, target\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_WINDOW_ID, windowId\)/);
	assert.match(
		source,
		/buildAgentAlertNotification\([\s\S]*notificationId: Int[\s\S]*PendingIntent\.getActivity\(\s*context,\s*notificationId,/,
	);
});

void test('committed Android service uses notificationId for agent alert pending intent identity', async () => {
	const source = await committedSshForegroundServiceSource();

	assert.doesNotMatch(
		source,
		/connectionId\.hashCode\(\)\s+xor\s+windowId\.hashCode\(\)/,
	);
	assert.match(
		source,
		/buildAgentAlertNotification\([\s\S]*notificationId: Int[\s\S]*PendingIntent\.getActivity\(\s*context,\s*notificationId,/,
	);
});

void test('foreground service plugin uses notificationId for agent alert pending intent identity', async () => {
	const source = await foregroundPluginSource();

	assert.doesNotMatch(
		source,
		/connectionId\.hashCode\(\)\s+xor\s+windowId\.hashCode\(\)/,
	);
	assert.match(
		source,
		/buildAgentAlertNotification\([\s\S]*notificationId: Int[\s\S]*PendingIntent\.getActivity\(\s*context,\s*notificationId,/,
	);
});

void test('agent notification native wrapper checks permission and method availability', async () => {
	const source = await agentNotificationsNativeSource();

	assert.match(source, /ensureNotificationPermission\(\)/);
	assert.match(source, /typeof nativeModule\.postAgentAlert !== 'function'/);
	assert.match(source, /typeof nativeModule\.cancelAgentAlert !== 'function'/);
	assert.match(source, /agent alert notification post unavailable/);
	assert.match(source, /agent alert notification cancel unavailable/);
});

const agentAlertInput = {
	notificationId: 123,
	title: 'Agent waiting',
	message: 'main:1 needs attention',
	connectionId: 'conn-1',
	session: 'main',
	target: 'main:1',
	windowId: '@1',
};

function createTestLogger() {
	const entries: unknown[][] = [];
	return {
		entries,
		logger: {
			warn: (...args: unknown[]) => entries.push(args),
		},
	};
}

void test('agent notification wrapper ignores non-Android platforms and missing native modules', async () => {
	const nativeCalls: string[] = [];
	const permissionCalls: string[] = [];
	const { logger } = createTestLogger();

	const iosWrapper = createAgentNotificationsNativeWrapper({
		getPlatformOS: () => 'ios',
		getNativeModule: () => ({
			postAgentAlert: async () => {
				nativeCalls.push('ios-post');
			},
			cancelAgentAlert: async () => {
				nativeCalls.push('ios-cancel');
			},
		}),
		ensureNotificationPermission: async () => {
			permissionCalls.push('ios-permission');
			return true;
		},
		logger,
	});
	await iosWrapper.postAgentAlertNotification(agentAlertInput);
	await iosWrapper.cancelAgentAlertNotification(agentAlertInput.notificationId);

	const missingModuleWrapper = createAgentNotificationsNativeWrapper({
		getPlatformOS: () => 'android',
		getNativeModule: () => undefined,
		ensureNotificationPermission: async () => {
			permissionCalls.push('missing-module-permission');
			return true;
		},
		logger,
	});
	await missingModuleWrapper.postAgentAlertNotification(agentAlertInput);
	await missingModuleWrapper.cancelAgentAlertNotification(
		agentAlertInput.notificationId,
	);

	assert.deepEqual(nativeCalls, []);
	assert.deepEqual(permissionCalls, []);
});

void test('agent notification wrapper checks permission before posting native alert', async () => {
	const calls: string[] = [];
	const { logger } = createTestLogger();
	const wrapper = createAgentNotificationsNativeWrapper({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			postAgentAlert: async (
				notificationId,
				title,
				message,
				connectionId,
				session,
				target,
				windowId,
			) => {
				calls.push('native-post');
				assert.deepEqual(
					[
						notificationId,
						title,
						message,
						connectionId,
						session,
						target,
						windowId,
					],
					[
						123,
						'Agent waiting',
						'main:1 needs attention',
						'conn-1',
						'main',
						'main:1',
						'@1',
					],
				);
			},
		}),
		ensureNotificationPermission: async () => {
			calls.push('permission');
			return true;
		},
		logger,
	});

	await wrapper.postAgentAlertNotification(agentAlertInput);

	assert.deepEqual(calls, ['permission', 'native-post']);
});

void test('agent notification wrapper passes exact notification id to native cancel', async () => {
	const calls: number[] = [];
	const { logger } = createTestLogger();
	const wrapper = createAgentNotificationsNativeWrapper({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			cancelAgentAlert: async (notificationId) => {
				calls.push(notificationId);
			},
		}),
		ensureNotificationPermission: async () => {
			throw new Error('cancel should not check notification permission');
		},
		logger,
	});

	await wrapper.cancelAgentAlertNotification(98765);

	assert.deepEqual(calls, [98765]);
});

void test('agent notification wrapper skips native post when notification permission is denied', async () => {
	const calls: string[] = [];
	const { entries, logger } = createTestLogger();
	const wrapper = createAgentNotificationsNativeWrapper({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			postAgentAlert: async () => {
				calls.push('native-post');
			},
		}),
		ensureNotificationPermission: async () => {
			calls.push('permission');
			return false;
		},
		logger,
	});

	await wrapper.postAgentAlertNotification(agentAlertInput);

	assert.deepEqual(calls, ['permission']);
	assert.deepEqual(entries, [
		['notification permission not granted; skipping agent alert'],
	]);
});

void test('agent notification wrapper logs and returns cleanly when native methods are missing', async () => {
	const { entries, logger } = createTestLogger();
	const wrapper = createAgentNotificationsNativeWrapper({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({}),
		ensureNotificationPermission: async () => true,
		logger,
	});

	await assert.doesNotReject(wrapper.postAgentAlertNotification(agentAlertInput));
	await assert.doesNotReject(
		wrapper.cancelAgentAlertNotification(agentAlertInput.notificationId),
	);

	assert.deepEqual(entries, [
		['agent alert notification post unavailable'],
		['agent alert notification cancel unavailable'],
	]);
});

void test('agent notification wrapper catches and logs native post and cancel failures', async () => {
	const postError = new Error('post failed');
	const cancelError = new Error('cancel failed');
	const { entries, logger } = createTestLogger();
	const wrapper = createAgentNotificationsNativeWrapper({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			postAgentAlert: async () => {
				throw postError;
			},
			cancelAgentAlert: async () => {
				throw cancelError;
			},
		}),
		ensureNotificationPermission: async () => true,
		logger,
	});

	await assert.doesNotReject(wrapper.postAgentAlertNotification(agentAlertInput));
	await assert.doesNotReject(
		wrapper.cancelAgentAlertNotification(agentAlertInput.notificationId),
	);

	assert.deepEqual(entries, [
		['agent alert notification post failed', postError],
		['agent alert notification cancel failed', cancelError],
	]);
});
