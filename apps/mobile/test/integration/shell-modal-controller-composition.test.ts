import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

void test('shell detail composes focused modal controllers without shell-modals', () => {
	const source = readFileSync(
		join(process.cwd(), 'src/app/shell/detail.tsx'),
		'utf8',
	);
	assert.match(source, /shell-controllers\/browser-actions/);
	assert.match(source, /shell-controllers\/feature-request/);
	assert.match(source, /shell-controllers\/skill-selector/);
	assert.match(source, /shell-controllers\/simple-modals/);
	assert.match(source, /createShellModalArbiter/);
	assert.doesNotMatch(source, /from '@\/lib\/shell-modals'/);
	assert.equal(
		existsSync(join(process.cwd(), 'src/lib/shell-modals.tsx')),
		false,
	);
});
