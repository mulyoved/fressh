import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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

async function agentNotificationsNativeSource() {
	return readFile(
		new URL('../../src/lib/agent-notifications-native.ts', import.meta.url)
			.pathname,
		'utf8',
	);
}

void test('foreground service plugin defines a separate agent alert channel', async () => {
	const source = await foregroundPluginSource();

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

void test('agent notification native wrapper checks permission and method availability', async () => {
	const source = await agentNotificationsNativeSource();

	assert.match(source, /ensureNotificationPermission\(\)/);
	assert.match(source, /typeof nativeModule\.postAgentAlert !== 'function'/);
	assert.match(source, /typeof nativeModule\.cancelAgentAlert !== 'function'/);
	assert.match(source, /agent alert notification post unavailable/);
	assert.match(source, /agent alert notification cancel unavailable/);
});
