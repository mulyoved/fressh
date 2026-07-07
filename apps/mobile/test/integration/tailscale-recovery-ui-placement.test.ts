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

void test('Inline Tailscale panel does not use overlay positioning', () => {
	const source = readFileSync(
		require.resolve('../../src/lib/TailscaleRecoveryPanel.tsx'),
		'utf8',
	);

	assert.doesNotMatch(source, /position:\s*'absolute'/);
	assert.doesNotMatch(source, /zIndex/);
	assert.doesNotMatch(source, /useSafeAreaInsets/);
});
