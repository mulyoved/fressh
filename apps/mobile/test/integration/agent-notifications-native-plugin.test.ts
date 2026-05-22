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
