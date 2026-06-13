import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const sourcePath = join(
	process.cwd(),
	'src/app/shell/components/FeatureRequestTargetPicker.tsx',
);

void test('FeatureRequestTargetPicker exports the picker component', () => {
	const source = readFileSync(sourcePath, 'utf8');
	assert.match(source, /export function FeatureRequestTargetPicker\(/);
});

void test('FeatureRequestTargetPicker renders the Current row and iterates pinned entries', () => {
	const source = readFileSync(sourcePath, 'utf8');
	assert.match(source, /onSelect\(\{ kind: 'current' \}\)/);
	assert.match(source, /pinned\.map\(\(/);
	assert.match(
		source,
		/onSelect\(\{ kind: 'pinned', repository: entry\.repository \}\)/,
	);
});

void test('FeatureRequestTargetPicker shows Resolving and Unavailable states for Current', () => {
	const source = readFileSync(sourcePath, 'utf8');
	assert.match(source, /Resolving/);
	assert.match(source, /Unavailable/);
});

void test('FeatureRequestTargetPicker threads bottomOffset for keyboard avoidance', () => {
	const source = readFileSync(sourcePath, 'utf8');
	assert.match(source, /bottomOffset/);
});
