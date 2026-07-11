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

function extractObjectBlock(source: string, propertyStart: string): string {
	const propertyIndex = source.indexOf(propertyStart);
	assert.notEqual(
		propertyIndex,
		-1,
		`missing object property: ${propertyStart}`,
	);
	const openingBrace = source.indexOf('{', propertyIndex);
	assert.notEqual(openingBrace, -1, `missing opening brace: ${propertyStart}`);
	let depth = 0;
	for (let index = openingBrace; index < source.length; index++) {
		if (source[index] === '{') depth++;
		if (source[index] === '}') {
			depth--;
			if (depth === 0) return source.slice(propertyIndex, index + 1);
		}
	}
	assert.fail(`missing closing brace: ${propertyStart}`);
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
		'appStateRef',
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
	const notificationContext = extractObjectBlock(
		notificationComposition,
		'context: {',
	);
	const notificationRoute = extractObjectBlock(
		notificationComposition,
		'route: {',
	);
	assert.match(notificationComposition, /^\s*activity,\s*$/m);
	assert.match(notificationContext, /^\s*transportKey,\s*$/m);
	assert.match(notificationContext, /^\s*targetKey,\s*$/m);
	assert.match(
		notificationContext,
		/storedConnectionId:\s*connectionStoredConnectionId\s*\?\?\s*null/,
	);
	assert.match(notificationContext, /^\s*channelId,\s*$/m);
	assert.match(notificationContext, /^\s*tmuxEnabled,\s*$/m);
	assert.match(notificationContext, /^\s*tmuxTarget,\s*$/m);
	assert.match(notificationRoute, /^\s*agentConnectionId,\s*$/m);
	assert.match(notificationRoute, /^\s*agentSession,\s*$/m);
	assert.match(notificationRoute, /^\s*agentWindowId,\s*$/m);
	assert.match(notificationRoute, /^\s*agentEventId,\s*$/m);
	assert.match(notificationRoute, /^\s*agentTapToken,\s*$/m);
	assert.match(
		notificationComposition,
		/^\s*runWorkmuxCommand:\s*runNotificationWorkmuxCommand,\s*$/m,
	);
	assert.match(notificationComposition, /^\s*logger,\s*$/m);
	assert.doesNotMatch(
		notificationContext,
		/storedConnectionId:\s*(?:searchParams\.)?storedConnectionId\b/,
	);

	const activityBridge = extractBlock(
		source,
		'const [retainedDomainBridge] = useState',
		'const enableSystemKeyboard',
	);
	const retainedDomainActions = extractBlock(
		source,
		'const retainedDomainActions:',
		'const retainedDomainActionsRef',
	);
	assert.match(source, /createShellActivityRetainedDomainBridge/);
	assert.match(source, /createShellActivityKeyboardActions/);
	assert.match(
		source,
		/setupInitialKeyboard:\s*keyboardActivityActions\.setupInitialKeyboard/,
	);
	assert.match(
		source,
		/resumeFromAppState:\s*keyboardActivityActions\.resumeFromAppState/,
	);
	assert.match(activityBridge, /activity\.snapshot\.generation/);
	assert.match(activityBridge, /activity\.snapshot\.focused/);
	assert.match(activityBridge, /activity\.snapshot\.appState/);
	assert.match(activityBridge, /activity\.snapshot\.appActive/);
	assert.match(source, /const getActivitySnapshot = activity\.getSnapshot/);
	assert.match(
		activityBridge,
		/retainedDomainBridge\.reconcile\(getActivitySnapshot\(\)\)/,
	);
	assert.match(activityBridge, /retainedDomainBridge\.setup\(\)/);
	assert.match(source, /invalidateKeyboardRunner/);
	assert.match(source, /useShellScrollbackController\(\{/);
	assert.match(
		retainedDomainActions,
		/invalidateScrollbackRequests:\s*\(\)\s*=>\s*\{\}/,
	);
	assert.match(
		retainedDomainActions,
		/runInactiveScrollbackCleanup:\s*\(\)\s*=>\s*\{\}/,
	);
	assert.doesNotMatch(
		retainedDomainActions,
		/scrollback\.(?:clear|invalidate)/,
	);
	assert.doesNotMatch(
		activityBridge,
		/return retainedDomainBridge\.reconcile|return invalidateRetainedDomains/,
	);
	assert.doesNotMatch(activityBridge, /addEventListener|Notification/);
});
