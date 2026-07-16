import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

void test('Connect tab owns the inline Tailscale recovery panel', () => {
	const source = readFileSync(
		require.resolve('../../src/app/(tabs)/index.tsx'),
		'utf8',
	);
	const titleSentinel = 'A fast, friendly SSH client';
	const panelSentinel = '<TailscaleRecoveryPanel';
	const formSentinel = '<connectionForm.AppForm>';
	const titleIndex = source.indexOf(titleSentinel);
	const panelIndex = source.indexOf(panelSentinel);
	const formIndex = source.indexOf(formSentinel);

	assert.notEqual(titleIndex, -1);
	assert.notEqual(panelIndex, -1);
	assert.notEqual(formIndex, -1);
	assert.ok(
		titleIndex < panelIndex,
		'title should appear before recovery panel',
	);
	assert.ok(
		panelIndex < formIndex,
		'recovery panel should appear before connection form',
	);
	assert.match(source, /TailscaleRecoveryPanel/);
	assert.match(source, /useTailscaleRecoveryUiStore/);
	assert.match(source, /state=\{tailscaleRecoveryUiState\}/);
	assert.match(source, /actions=\{tailscaleRecoveryActions\}/);
});

void test('AutoConnectManager does not render Tailscale recovery UI directly', () => {
	const source = readFileSync(
		require.resolve('../../src/lib/auto-connect.tsx'),
		'utf8',
	);

	assert.doesNotMatch(source, /<TailscaleRecoveryPanel/);
	assert.doesNotMatch(source, /<TailscaleRecoveryBanner/);
});

void test('shell session owns host-page reconnect routing outside shell detail', () => {
	const detailSource = readFileSync(
		require.resolve('../../src/app/shell/detail.tsx'),
		'utf8',
	);
	const sessionSource = readFileSync(
		require.resolve('../../src/lib/shell-controllers/session.tsx'),
		'utf8',
	);
	const coreSource = readFileSync(
		require.resolve('../../src/lib/shell-controllers/session-core.ts'),
		'utf8',
	);

	assert.match(sessionSource, /state\) => state\.lastReconnectOutcome/);
	assert.match(sessionSource, /state\) => state\.isReconnecting/);
	assert.match(sessionSource, /lastReconnectOutcome,/);
	assert.match(
		coreSource,
		/lastReconnectOutcome\?\.destination !== 'hostPage'/,
	);
	assert.match(sessionSource, /pathname:\s*'\/'/);
	assert.match(sessionSource, /params:\s*\{ editConnectionId \}/);
	assert.doesNotMatch(detailSource, /lastReconnectOutcome/);
	assert.doesNotMatch(detailSource, /state\) => state\.isReconnecting/);
});

void test('Inline Tailscale panel does not use overlay positioning', () => {
	const source = readFileSync(
		require.resolve('../../src/lib/TailscaleRecoveryPanel.tsx'),
		'utf8',
	);

	assert.doesNotMatch(source, /position:\s*'absolute'/);
	assert.doesNotMatch(source, /zIndex/);
	assert.doesNotMatch(source, /useSafeAreaInsets/);
});
