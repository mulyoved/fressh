import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellSimpleModalsCore } from '../../src/lib/shell-controllers/simple-modals';

void test('simple modal commands publish before dependent controller reads', () => {
	const core = createShellSimpleModalsCore();
	core.open('text-entry');
	assert.equal(core.getSnapshot().textEntry, true);
	core.close('text-entry');
	assert.equal(core.getSnapshot().textEntry, false);
});
