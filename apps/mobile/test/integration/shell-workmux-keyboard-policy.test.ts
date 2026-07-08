import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldShowShellWorkmuxKeyboardFailure } from '../../src/app/shell/shell-workmux-keyboard-policy';

void test('shell Workmux keyboard failure policy suppresses reconnect-owned bridge disposal', () => {
	assert.equal(
		shouldShowShellWorkmuxKeyboardFailure({
			failureClass: 'disposedByReconnect',
			isFocused: true,
			isAppActive: true,
		}),
		false,
	);
});

void test('shell Workmux keyboard failure policy shows ordinary active failures', () => {
	assert.equal(
		shouldShowShellWorkmuxKeyboardFailure({
			failureClass: 'remoteClosed',
			isFocused: true,
			isAppActive: true,
		}),
		true,
	);
});

void test('shell Workmux keyboard failure policy preserves focused-active suppression', () => {
	assert.equal(
		shouldShowShellWorkmuxKeyboardFailure({
			failureClass: 'remoteClosed',
			isFocused: false,
			isAppActive: true,
		}),
		false,
	);
	assert.equal(
		shouldShowShellWorkmuxKeyboardFailure({
			isFocused: true,
			isAppActive: false,
		}),
		false,
	);
});
