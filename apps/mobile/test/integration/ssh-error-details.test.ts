import assert from 'node:assert/strict';
import test from 'node:test';
import {
	extractTmuxAttachFailureReason,
	formatSshErrorMessage,
} from '../../src/lib/ssh-error-details';

void test('extracts the UniFFI tmux attach failure inner reason', () => {
	const error = {
		tag: 'TmuxAttachFailed',
		inner: ['Workmux attach exited with status 1: missing session'],
	};

	assert.equal(
		extractTmuxAttachFailureReason(error),
		'Workmux attach exited with status 1: missing session',
	);
});

void test('ignores non-tmux attach errors', () => {
	assert.equal(
		extractTmuxAttachFailureReason({
			tag: 'Auth',
			inner: ['permission denied'],
		}),
		null,
	);
});

void test('formats UniFFI Russh errors with their inner detail', () => {
	assert.equal(
		formatSshErrorMessage({
			tag: 'Russh',
			message: 'SshError.Russh',
			inner: ['No route to host'],
		}),
		'No route to host',
	);
});
