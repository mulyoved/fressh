import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync('src/app/shell/detail.tsx', 'utf8');

void test('failed reconnect hostPage destination routes back to Host config', () => {
	const hostPageBranch = source.match(
		/lastReconnectOutcome\.destination === 'hostPage'[\s\S]*?return;/,
	)?.[0];

	assert.ok(hostPageBranch, 'expected a hostPage reconnect outcome branch');
	assert.doesNotMatch(
		hostPageBranch,
		/router\.replace\('\/shell'\)/,
		'hostPage reconnect outcomes must not navigate to the Shells tab',
	);
	assert.match(
		hostPageBranch,
		/pathname:\s*'\/'/,
		'hostPage reconnect outcomes should route to the Host form',
	);
	assert.match(
		hostPageBranch,
		/editConnectionId:\s*storedConnectionId\s*\?\?\s*connectionId/,
		'Host form should edit the connection that just failed to reconnect',
	);
});
