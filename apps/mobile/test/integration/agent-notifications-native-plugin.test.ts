import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type * as ExpoConfigPlugins from 'expo/config-plugins';
import type withForegroundServiceType from '../../plugins/with-foreground-service';
import { createAgentNotificationsNativeWrapper } from '../../src/lib/agent-notifications-native';

const require = createRequire(import.meta.url);
const { compileModsAsync } =
	require('expo/config-plugins') as typeof ExpoConfigPlugins;
const withForegroundService = require('../../plugins/with-foreground-service')
	.default as typeof withForegroundServiceType;

const MAIN_APPLICATION_FIXTURE = [
	'package com.finalapp.vibe2',
	'',
	'import com.facebook.react.PackageList',
	'',
	'class MainApplication {',
	'  fun getPackages() = PackageList(this).packages.apply {',
	'    // add(MyReactNativePackage())',
	'  }',
	'}',
].join('\n');

async function writeAndroidFixture(
	projectRoot: string,
	manifestLines: string[],
) {
	await mkdir(
		path.join(projectRoot, 'android/app/src/main/java/com/finalapp/vibe2'),
		{ recursive: true },
	);
	await writeFile(
		path.join(projectRoot, 'android/app/src/main/AndroidManifest.xml'),
		manifestLines.join('\n'),
		'utf8',
	);
	await writeFile(
		path.join(
			projectRoot,
			'android/app/src/main/java/com/finalapp/vibe2/MainApplication.kt',
		),
		MAIN_APPLICATION_FIXTURE,
		'utf8',
	);
}

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
		await writeAndroidFixture(projectRoot, [
			'<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
			'  <application android:name=".MainApplication" />',
			'</manifest>',
		]);

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

async function generatedForegroundServiceModuleSource() {
	const projectRoot = await mkdtemp(
		path.join(os.tmpdir(), 'fressh-foreground-service-plugin-'),
	);

	try {
		await writeAndroidFixture(projectRoot, [
			'<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
			'  <application android:name=".MainApplication" />',
			'</manifest>',
		]);

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
				'android/app/src/main/java/com/finalapp/vibe2/ForegroundServiceModule.kt',
			),
			'utf8',
		);
	} finally {
		await rm(projectRoot, { force: true, recursive: true });
	}
}

async function generatedForegroundServicePackageSource() {
	const projectRoot = await mkdtemp(
		path.join(os.tmpdir(), 'fressh-foreground-service-plugin-'),
	);

	try {
		await writeAndroidFixture(projectRoot, [
			'<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
			'  <application android:name=".MainApplication" />',
			'</manifest>',
		]);

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
				'android/app/src/main/java/com/finalapp/vibe2/ForegroundServicePackage.kt',
			),
			'utf8',
		);
	} finally {
		await rm(projectRoot, { force: true, recursive: true });
	}
}

async function generatedMainApplicationSource() {
	const projectRoot = await mkdtemp(
		path.join(os.tmpdir(), 'fressh-foreground-service-plugin-'),
	);

	try {
		await writeAndroidFixture(projectRoot, [
			'<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
			'  <application android:name=".MainApplication" />',
			'</manifest>',
		]);

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
				'android/app/src/main/java/com/finalapp/vibe2/MainApplication.kt',
			),
			'utf8',
		);
	} finally {
		await rm(projectRoot, { force: true, recursive: true });
	}
}

async function generatedAndroidManifestSource() {
	const projectRoot = await mkdtemp(
		path.join(os.tmpdir(), 'fressh-foreground-service-plugin-'),
	);

	try {
		await writeAndroidFixture(projectRoot, [
			'<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
			'  <application android:name=".MainApplication">',
			'    <service android:name=".SshForegroundService" android:stopWithTask="true" />',
			'  </application>',
			'</manifest>',
		]);

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
			path.join(projectRoot, 'android/app/src/main/AndroidManifest.xml'),
			'utf8',
		);
	} finally {
		await rm(projectRoot, { force: true, recursive: true });
	}
}

async function generatedFreshAndroidManifestSource() {
	const projectRoot = await mkdtemp(
		path.join(os.tmpdir(), 'fressh-foreground-service-plugin-'),
	);

	try {
		await writeAndroidFixture(projectRoot, [
			'<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
			'  <application android:name=".MainApplication" />',
			'</manifest>',
		]);

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
			path.join(projectRoot, 'android/app/src/main/AndroidManifest.xml'),
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
	const pluginSource = await foregroundPluginSource();
	const source = await generatedSshForegroundServiceSource();

	assert.doesNotMatch(pluginSource, /import\s+ConfigPlugins\s+from/);
	assert.match(
		pluginSource,
		/AndroidConfig,[\s\S]*withAndroidManifest,[\s\S]*withDangerousMod,[\s\S]*withMainApplication,[\s\S]*from 'expo\/config-plugins'/,
	);
	assert.doesNotMatch(pluginSource, /const SSH_FOREGROUND_SERVICE_KOTLIN/);
	assert.doesNotMatch(pluginSource, /const FOREGROUND_SERVICE_MODULE_KOTLIN/);
	assert.match(source, /AGENT_ALERT_CHANNEL_ID = "fressh_agent_alerts"/);
	assert.match(source, /AGENT_ALERT_CHANNEL_NAME = "Fressh Agent Alerts"/);
	assert.match(source, /NotificationManager\.IMPORTANCE_DEFAULT/);
});

void test('foreground service native module exposes agent alert methods', async () => {
	const moduleSource = await generatedForegroundServiceModuleSource();
	const serviceSource = await generatedSshForegroundServiceSource();

	assert.match(moduleSource, /fun isRunning\(promise: Promise\)/);
	assert.match(moduleSource, /fun postAgentAlert\(/);
	assert.match(moduleSource, /eventId: String/);
	assert.match(moduleSource, /tapToken: String/);
	assert.match(moduleSource, /fun cancelAgentAlert\(/);
	assert.match(
		serviceSource,
		/notify\(notificationId, buildAgentAlertNotification/,
	);
	assert.match(serviceSource, /cancel\(notificationId\)/);
});

void test('committed Android module exposes agent alert methods', async () => {
	const source = await committedForegroundServiceModuleSource();

	assert.match(source, /fun isRunning\(promise: Promise\)/);
	assert.match(source, /fun postAgentAlert\(/);
	assert.match(source, /eventId: String/);
	assert.match(source, /tapToken: String/);
	assert.match(source, /fun cancelAgentAlert\(/);
	assert.match(source, /SshForegroundService\.postAgentAlert\(/);
	assert.match(
		source,
		/SshForegroundService\.postAgentAlert\([\s\S]*windowId,\s*eventId,\s*tapToken[\s\S]*\)/,
	);
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

void test('foreground service plugin generates committed Kotlin exactly', async () => {
	assert.equal(
		await generatedSshForegroundServiceSource(),
		await committedSshForegroundServiceSource(),
	);
	assert.equal(
		await generatedForegroundServiceModuleSource(),
		await committedForegroundServiceModuleSource(),
	);
});

void test('foreground service plugin owns native package registration', async () => {
	const packageSource = await generatedForegroundServicePackageSource();
	const mainApplicationSource = await generatedMainApplicationSource();

	assert.match(packageSource, /class ForegroundServicePackage : ReactPackage/);
	assert.match(packageSource, /ForegroundServiceModule\(reactContext\)/);
	assert.doesNotMatch(packageSource, /WisprAutomationModule/);
	assert.match(mainApplicationSource, /add\(ForegroundServicePackage\(\)\)/);
});

void test('foreground service restart and wakelock policy keeps background work alive while service runs', async () => {
	for (const source of [
		await committedSshForegroundServiceSource(),
		await generatedSshForegroundServiceSource(),
	]) {
		assert.match(source, /return START_NOT_STICKY/);
		assert.doesNotMatch(source, /return START_STICKY/);
		assert.match(source, /if \(intent == null\)/);
		assert.match(source, /stopSelf\(startId\)/);
		assert.match(source, /WAKE_LOCK_LEASE_MS/);
		assert.match(source, /WAKE_LOCK_RENEWAL_MS/);
		assert.match(source, /wakeLock\?\.acquire\(WAKE_LOCK_LEASE_MS\)/);
		assert.match(source, /postDelayed\(renewWakeLockRunnable/);
		assert.match(
			source,
			/override fun onTimeout\(startId: Int, fgsType: Int\)/,
		);
		assert.match(source, /stopSelf\(startId\)/);
		assert.doesNotMatch(source, /postDelayed\([\s\S]*stopSelf/);
	}
});

void test('foreground service is not stopped just because the task is removed', async () => {
	const manifest = await generatedAndroidManifestSource();
	const freshManifest = await generatedFreshAndroidManifestSource();

	assert.match(manifest, /android:stopWithTask="false"/);
	assert.match(manifest, /android:foregroundServiceType="specialUse"/);
	assert.match(
		manifest,
		/android:name="android\.permission\.FOREGROUND_SERVICE_SPECIAL_USE"/,
	);
	assert.doesNotMatch(
		manifest,
		/android:name="android\.permission\.FOREGROUND_SERVICE_DATA_SYNC"/,
	);
	assert.match(
		manifest,
		/android:name="android\.app\.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"/,
	);
	assert.match(
		manifest,
		/android:value="Long-running user-visible SSH terminal session and agent status listener"/,
	);
	assert.match(freshManifest, /android:foregroundServiceType="specialUse"/);
	assert.match(
		freshManifest,
		/android:name="android\.app\.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"/,
	);
	assert.doesNotMatch(manifest, /android:stopWithTask="true"/);
	assert.match(
		await foregroundPluginSource(),
		/'android:stopWithTask': 'false'/,
	);
	assert.match(
		await foregroundPluginSource(),
		/'android:foregroundServiceType': 'specialUse'/,
	);
	assert.match(
		await foregroundPluginSource(),
		/'android.permission.FOREGROUND_SERVICE_SPECIAL_USE'/,
	);
});

void test('committed Android service passes agent alert intent extras to MainActivity', async () => {
	const source = await committedSshForegroundServiceSource();

	assert.match(source, /Intent\(Intent\.ACTION_VIEW,/);
	assert.match(source, /Uri\.Builder\(\)/);
	assert.match(source, /\.scheme\("fressh"\)/);
	assert.match(source, /\.path\("\/shell\/detail"\)/);
	assert.match(source, /EXTRA_AGENT_CONNECTION_ID = "agentConnectionId"/);
	assert.match(source, /EXTRA_AGENT_SESSION = "agentSession"/);
	assert.match(source, /EXTRA_AGENT_TARGET = "agentTarget"/);
	assert.match(source, /EXTRA_AGENT_WINDOW_ID = "agentWindowId"/);
	assert.match(source, /EXTRA_AGENT_EVENT_ID = "agentEventId"/);
	assert.match(source, /EXTRA_AGENT_TAP_TOKEN = "agentTapToken"/);
	assert.match(source, /EXTRA_AGENT_NOTIFICATION_CONNECTION_ID/);
	assert.match(
		source,
		/appendQueryParameter\("agentConnectionId", notificationConnectionId\)/,
	);
	assert.match(
		source,
		/appendQueryParameter\("channelId", channelId\.toString\(\)\)/,
	);
	assert.match(source, /appendQueryParameter\("agentSession", session\)/);
	assert.match(source, /appendQueryParameter\("agentWindowId", windowId\)/);
	assert.match(source, /appendQueryParameter\("agentEventId", eventId\)/);
	assert.match(source, /appendQueryParameter\("agentTapToken", tapToken\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_CONNECTION_ID, connectionId\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_SESSION, session\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_TARGET, target\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_WINDOW_ID, windowId\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_EVENT_ID, eventId\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_TAP_TOKEN, tapToken\)/);
	assert.match(source, /\.setAutoCancel\(false\)/);
});

void test('foreground service plugin passes agent alert intent extras to MainActivity', async () => {
	const source = await generatedSshForegroundServiceSource();

	assert.match(source, /Intent\(Intent\.ACTION_VIEW,/);
	assert.match(source, /Uri\.Builder\(\)/);
	assert.match(source, /\.scheme\("fressh"\)/);
	assert.match(source, /\.path\("\/shell\/detail"\)/);
	assert.match(source, /EXTRA_AGENT_CONNECTION_ID = "agentConnectionId"/);
	assert.match(source, /EXTRA_AGENT_SESSION = "agentSession"/);
	assert.match(source, /EXTRA_AGENT_TARGET = "agentTarget"/);
	assert.match(source, /EXTRA_AGENT_WINDOW_ID = "agentWindowId"/);
	assert.match(source, /EXTRA_AGENT_EVENT_ID = "agentEventId"/);
	assert.match(source, /EXTRA_AGENT_TAP_TOKEN = "agentTapToken"/);
	assert.match(source, /EXTRA_AGENT_NOTIFICATION_CONNECTION_ID/);
	assert.match(
		source,
		/appendQueryParameter\("agentConnectionId", notificationConnectionId\)/,
	);
	assert.match(
		source,
		/appendQueryParameter\("channelId", channelId\.toString\(\)\)/,
	);
	assert.match(source, /appendQueryParameter\("agentSession", session\)/);
	assert.match(source, /appendQueryParameter\("agentWindowId", windowId\)/);
	assert.match(source, /appendQueryParameter\("agentEventId", eventId\)/);
	assert.match(source, /appendQueryParameter\("agentTapToken", tapToken\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_CONNECTION_ID, connectionId\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_SESSION, session\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_TARGET, target\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_WINDOW_ID, windowId\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_EVENT_ID, eventId\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_TAP_TOKEN, tapToken\)/);
	assert.match(source, /\.setAutoCancel\(false\)/);
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
	assert.match(source, /EXTRA_AGENT_EVENT_ID = "agentEventId"/);
	assert.match(source, /EXTRA_AGENT_TAP_TOKEN = "agentTapToken"/);
	assert.match(source, /EXTRA_AGENT_NOTIFICATION_CONNECTION_ID/);
	assert.match(
		source,
		/appendQueryParameter\("agentConnectionId", notificationConnectionId\)/,
	);
	assert.match(
		source,
		/appendQueryParameter\("channelId", channelId\.toString\(\)\)/,
	);
	assert.match(source, /appendQueryParameter\("agentSession", session\)/);
	assert.match(source, /appendQueryParameter\("agentWindowId", windowId\)/);
	assert.match(source, /appendQueryParameter\("agentEventId", eventId\)/);
	assert.match(source, /appendQueryParameter\("agentTapToken", tapToken\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_CONNECTION_ID, connectionId\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_SESSION, session\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_TARGET, target\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_WINDOW_ID, windowId\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_EVENT_ID, eventId\)/);
	assert.match(source, /putExtra\(EXTRA_AGENT_TAP_TOKEN, tapToken\)/);
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
	const source = await generatedSshForegroundServiceSource();

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
	channelId: 7,
	notificationConnectionId: 'saved-host',
	session: 'main',
	target: 'main:1',
	windowId: '@1',
	eventId: 'main:@1:2000:waiting',
	tapToken: 'tap-token',
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
	assert.equal(
		await iosWrapper.postAgentAlertNotification(agentAlertInput),
		false,
	);
	assert.equal(
		await iosWrapper.cancelAgentAlertNotification(
			agentAlertInput.notificationId,
		),
		false,
	);

	const missingModuleWrapper = createAgentNotificationsNativeWrapper({
		getPlatformOS: () => 'android',
		getNativeModule: () => undefined,
		ensureNotificationPermission: async () => {
			permissionCalls.push('missing-module-permission');
			return true;
		},
		logger,
	});
	assert.equal(
		await missingModuleWrapper.postAgentAlertNotification(agentAlertInput),
		false,
	);
	assert.equal(
		await missingModuleWrapper.cancelAgentAlertNotification(
			agentAlertInput.notificationId,
		),
		false,
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
				channelId,
				notificationConnectionId,
				session,
				target,
				windowId,
				eventId,
				tapToken,
			) => {
				calls.push('native-post');
				assert.deepEqual(
					[
						notificationId,
						title,
						message,
						connectionId,
						channelId,
						notificationConnectionId,
						session,
						target,
						windowId,
						eventId,
						tapToken,
					],
					[
						123,
						'Agent waiting',
						'main:1 needs attention',
						'conn-1',
						7,
						'saved-host',
						'main',
						'main:1',
						'@1',
						'main:@1:2000:waiting',
						'tap-token',
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

	assert.equal(await wrapper.postAgentAlertNotification(agentAlertInput), true);

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

	assert.equal(await wrapper.cancelAgentAlertNotification(98765), true);

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

	assert.equal(
		await wrapper.postAgentAlertNotification(agentAlertInput),
		false,
	);

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

	await assert.doesNotReject(
		wrapper.postAgentAlertNotification(agentAlertInput),
	);
	await assert.doesNotReject(
		wrapper.cancelAgentAlertNotification(agentAlertInput.notificationId),
	);
	assert.equal(
		await wrapper.postAgentAlertNotification(agentAlertInput),
		false,
	);
	assert.equal(
		await wrapper.cancelAgentAlertNotification(agentAlertInput.notificationId),
		false,
	);

	assert.deepEqual(entries, [
		['agent alert notification post unavailable'],
		['agent alert notification cancel unavailable'],
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

	await assert.doesNotReject(
		wrapper.postAgentAlertNotification(agentAlertInput),
	);
	await assert.doesNotReject(
		wrapper.cancelAgentAlertNotification(agentAlertInput.notificationId),
	);
	assert.equal(
		await wrapper.postAgentAlertNotification(agentAlertInput),
		false,
	);
	assert.equal(
		await wrapper.cancelAgentAlertNotification(agentAlertInput.notificationId),
		false,
	);

	assert.deepEqual(entries, [
		['agent alert notification post failed', postError],
		['agent alert notification cancel failed', cancelError],
		['agent alert notification post failed', postError],
		['agent alert notification cancel failed', cancelError],
	]);
});

void test('agent notification wrapper does not post route alerts through old native arity', async () => {
	const calls: unknown[][] = [];
	const { entries, logger } = createTestLogger();
	const wrapper = createAgentNotificationsNativeWrapper({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			postAgentAlert: async (...args: unknown[]) => {
				calls.push(args);
				if (args.length === 11) {
					throw new Error(
						'FresshForegroundService.postAgentAlert got 11 arguments, expected 10',
					);
				}
			},
		}),
		ensureNotificationPermission: async () => true,
		logger,
	});

	assert.equal(
		await wrapper.postAgentAlertNotification(agentAlertInput),
		false,
	);

	assert.deepEqual(
		calls.map((args) => args.length),
		[11],
	);
	assert.deepEqual(entries, [
		[
			'agent alert notification post failed',
			new Error(
				'FresshForegroundService.postAgentAlert got 11 arguments, expected 10',
			),
		],
	]);
});

void test('agent notification wrapper does not fall back for unrelated native post errors', async () => {
	const nativeError = new Error('expected remote command failed');
	const { entries, logger } = createTestLogger();
	const wrapper = createAgentNotificationsNativeWrapper({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			postAgentAlert: async () => {
				throw nativeError;
			},
		}),
		ensureNotificationPermission: async () => true,
		logger,
	});

	assert.equal(
		await wrapper.postAgentAlertNotification(agentAlertInput),
		false,
	);

	assert.deepEqual(entries, [
		['agent alert notification post failed', nativeError],
	]);
});
