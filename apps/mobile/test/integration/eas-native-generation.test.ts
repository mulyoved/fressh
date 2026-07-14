import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');

void test('EAS excludes the generated Android project so prebuild always runs', async () => {
	const easIgnore = await readFile(path.join(repoRoot, '.easignore'), 'utf8');
	const activeRules = easIgnore
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter((line) => line !== '' && !line.startsWith('#'));

	assert.ok(
		activeRules.includes('apps/mobile/android/'),
		'EAS must exclude apps/mobile/android/ so stale generated native code cannot skip Expo prebuild',
	);
});
