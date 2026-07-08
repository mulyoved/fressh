import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

void test('Host Connect uses form onSubmit for SSH side effects, not async validators', async () => {
	const source = await readFile('src/app/(tabs)/index.tsx', 'utf8');
	const formConfigStart = source.indexOf('const connectionForm = useAppForm({');
	assert.notEqual(formConfigStart, -1);
	const formConfigEnd = source.indexOf('});', formConfigStart);
	assert.notEqual(formConfigEnd, -1);
	const formConfig = source.slice(formConfigStart, formConfigEnd);

	assert.equal(
		formConfig.includes('onSubmitAsync'),
		false,
		'async validators can keep previous SSH failures in form validity and block retry',
	);
	assert.equal(
		formConfig.includes('onSubmit: async'),
		true,
		'Host Connect should run SSH side effects through form onSubmit',
	);
});
