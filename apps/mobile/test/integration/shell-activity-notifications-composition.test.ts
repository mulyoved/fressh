import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function extractBlock(source: string, start: string, end: string): string {
	const startIndex = source.indexOf(start);
	assert.notEqual(startIndex, -1, `missing block start: ${start}`);
	const endIndex = source.indexOf(end, startIndex);
	assert.notEqual(endIndex, -1, `missing block end: ${end}`);
	return source.slice(startIndex, endIndex);
}

void test('shell detail delegates activity and notification lifecycle', () => {
	const source = readFileSync(
		join(process.cwd(), 'src/app/shell/detail.tsx'),
		'utf8',
	);

	assert.equal(source.match(/useShellActivityController\(\)/g)?.length, 1);
	assert.equal(source.match(/useShellNotificationsController\(\{/g)?.length, 1);
	for (const legacyRef of [
		'agentNotificationAckRequestIdRef',
		'handledAgentAlertRouteRef',
		'acknowledgeVisibleAgentNotificationRef',
		'isFocusedRef',
		'isAppActiveRef',
		'visibleConnectionIdRef',
		'visibleChannelIdRef',
		'visibleTmuxTargetRef',
	]) {
		assert.doesNotMatch(source, new RegExp(legacyRef));
	}
	assert.doesNotMatch(source, /useIsFocused/);
	assert.doesNotMatch(source, /AppState\.addEventListener/);
	assert.doesNotMatch(source, /subscribeAgentNotificationPending/);
	assert.doesNotMatch(
		source,
		/handleAgentNotificationRoute|acknowledgeVisibleAgentNotification|acknowledgeRoutedAgentNotification/,
	);

	const notificationComposition = extractBlock(
		source,
		'useShellNotificationsController({',
		'const browserActions = useBrowserActionsController',
	);
	assert.match(notificationComposition, /activity,/);
	for (const contextValue of [
		'transportKey',
		'targetKey',
		'storedConnectionId',
		'channelId',
		'tmuxEnabled',
		'tmuxTarget',
		'agentConnectionId',
		'agentSession',
		'agentWindowId',
		'agentEventId',
		'agentTapToken',
		'runNotificationWorkmuxCommand',
		'logger',
	]) {
		assert.match(notificationComposition, new RegExp(`\\b${contextValue}\\b`));
	}

	const activityBridge = extractBlock(
		source,
		'useLayoutEffect(() => {\n\t\tconst activitySnapshot = getActivitySnapshot();',
		'const enableSystemKeyboard',
	);
	assert.match(activityBridge, /activity\.snapshot\.generation/);
	assert.match(source, /const getActivitySnapshot = activity\.getSnapshot/);
	assert.match(activityBridge, /getActivitySnapshot\(\)/);
	assert.match(activityBridge, /workmuxKeyboardCommandRunner\.invalidate\(\)/);
	assert.match(activityBridge, /clearScrollbackState/);
	assert.doesNotMatch(activityBridge, /addEventListener|Notification/);
});
