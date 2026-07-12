import assert from 'node:assert/strict';
import test from 'node:test';
import { handleDetectedOpenPickerSelection } from '../../src/app/shell/components/detected-open-picker-selection';
import { type DetectedOpenCandidate } from '../../src/lib/detected-open-actions';

const candidate: DetectedOpenCandidate = {
	kind: 'remote-url',
	raw: 'https://example.test',
	normalized: 'https://example.test',
	display: 'Example',
	path: null,
	line: null,
	url: 'https://example.test',
};

void test('detected picker selection reaches the controller before close can clear context', () => {
	let contextAvailable = true;
	const events: string[] = [];

	handleDetectedOpenPickerSelection(candidate, {
		onSelect: (selected) => {
			assert.equal(contextAvailable, true);
			assert.equal(selected, candidate);
			events.push('select');
			contextAvailable = false;
		},
	});

	assert.deepEqual(events, ['select']);
});
