import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const panelPath = join(process.cwd(), 'src/lib/TailscaleRecoveryPanel.tsx');

void test('TailscaleRecoveryPanel keeps the visible guard and action wiring inline', () => {
	const source = readFileSync(panelPath, 'utf8');

	assert.match(source, /if \(!presentation\.visible\) return null;/);
	assert.match(source, /\{ actionsAvailable: props\.actions !== null \}/);
	assert.match(source, /onPress=\{props\.actions\?\.openTailscale\}/);
	assert.match(source, /onPress=\{props\.actions\?\.retry\}/);
	assert.match(source, /onPress=\{props\.actions\?\.reset\}/);
});

void test('TailscaleRecoveryPanel does not use overlay positioning or safe area plumbing', () => {
	const source = readFileSync(panelPath, 'utf8');

	assert.doesNotMatch(source, /position:\s*'absolute'/);
	assert.doesNotMatch(source, /\bzIndex\b/);
	assert.doesNotMatch(source, /useSafeAreaInsets/);
});
