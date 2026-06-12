import assert from 'node:assert/strict';
import test from 'node:test';

import {
	getDetectedOpenCandidateSubtitle,
	handleDetectedOpenPickerSelect,
} from '../../src/app/shell/components/detected-open-picker-modal-controller';
import { type DetectedOpenCandidate } from '../../src/lib/detected-open-actions';

const remoteCandidate: DetectedOpenCandidate = {
	kind: 'remote-url',
	raw: 'https://example.test/app',
	normalized: 'https://example.test/app',
	display: 'https://example.test/app',
	path: null,
	line: null,
	url: 'https://example.test/app',
};

void test('detected open picker select closes then selects candidate', () => {
	const calls: string[] = [];

	handleDetectedOpenPickerSelect({
		candidate: remoteCandidate,
		onClose: () => calls.push('close'),
		onSelect: (candidate) => calls.push(`select:${candidate.raw}`),
	});

	assert.deepEqual(calls, ['close', 'select:https://example.test/app']);
});

void test('detected open picker candidate subtitles are user-facing labels', () => {
	assert.equal(getDetectedOpenCandidateSubtitle(remoteCandidate), 'Remote URL');
	assert.equal(
		getDetectedOpenCandidateSubtitle({
			...remoteCandidate,
			kind: 'local-url',
			raw: 'localhost:3000',
			display: 'localhost:3000',
		}),
		'Local URL',
	);
	assert.equal(
		getDetectedOpenCandidateSubtitle({
			...remoteCandidate,
			kind: 'file',
			raw: 'README.md',
			display: 'README.md',
			path: '/tmp/project/README.md',
			url: null,
		}),
		'File',
	);
});
