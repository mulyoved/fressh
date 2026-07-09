import assert from 'node:assert/strict';
import test from 'node:test';
import {
	WorkmuxCommandFailure,
	runShellWorkmuxKeyboardCommand,
	shouldShowShellWorkmuxKeyboardFailure,
	shouldTreatShellWorkmuxKeyboardFailureAsTransportUnhealthy,
	showShellWorkmuxKeyboardFailure,
} from '../../src/app/shell/shell-workmux-keyboard-policy';

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
			failureClass: 'protocolError',
			isFocused: true,
			isAppActive: true,
		}),
		true,
	);
});

void test('shell Workmux keyboard failure policy treats transport failures as reconnect signals', () => {
	for (const failureClass of ['timeout', 'remoteClosed', 'sendFailed'] as const) {
		assert.equal(
			shouldTreatShellWorkmuxKeyboardFailureAsTransportUnhealthy({
				failureClass,
			}),
			true,
		);
		assert.equal(
			shouldShowShellWorkmuxKeyboardFailure({
				failureClass,
				isFocused: true,
				isAppActive: true,
			}),
			false,
		);
	}
	assert.equal(
		shouldTreatShellWorkmuxKeyboardFailureAsTransportUnhealthy({
			failureClass: 'protocolError',
		}),
		false,
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

void test('shell Workmux keyboard command converts failed bridge results into typed failures', async () => {
	await assert.rejects(
		runShellWorkmuxKeyboardCommand({
			argv: ['mdev', 'workmux', 'focus', '--target', 'codex'],
			runCommand: async () => ({
				success: false,
				output: '',
				error: 'mdev bridge stream closed.',
				failureClass: 'disposedByReconnect',
			}),
			timeoutMs: 123,
		}),
		(error: unknown) => {
			assert.equal(error instanceof WorkmuxCommandFailure, true);
			assert.equal((error as WorkmuxCommandFailure).message, 'mdev bridge stream closed.');
			assert.equal(
				(error as WorkmuxCommandFailure).failureClass,
				'disposedByReconnect',
			);
			return true;
		},
	);
});

void test('shell Workmux keyboard command forwards argv and timeout and returns output on success', async () => {
	const calls: { argv: string[]; timeoutMs?: number }[] = [];
	const output = await runShellWorkmuxKeyboardCommand({
		argv: ['mdev', 'workmux', 'focus', '--target', 'git'],
		runCommand: async (argv, options) => {
			calls.push({ argv, timeoutMs: options.timeoutMs });
			return { success: true, output: 'focused' };
		},
		timeoutMs: 456,
	});

	assert.equal(output, 'focused');
	assert.deepEqual(calls, [
		{
			argv: ['mdev', 'workmux', 'focus', '--target', 'git'],
			timeoutMs: 456,
		},
	]);
});

void test('shell Workmux keyboard failure alert suppresses reconnect disposal and shows real failures', () => {
	const alerts: { title: string; message: string }[] = [];
	const showAlert = (title: string, message: string) => {
		alerts.push({ title, message });
	};

	showShellWorkmuxKeyboardFailure({
		failureClass: 'disposedByReconnect',
		isFocused: true,
		isAppActive: true,
		message: 'mdev bridge stream closed.',
		showAlert,
	});
	showShellWorkmuxKeyboardFailure({
		failureClass: 'protocolError',
		isFocused: true,
		isAppActive: true,
		message: 'remote failed',
		showAlert,
	});
	showShellWorkmuxKeyboardFailure({
		failureClass: 'protocolError',
		isFocused: false,
		isAppActive: true,
		message: 'background failed',
		showAlert,
	});

	assert.deepEqual(alerts, [
		{ title: 'Workmux action failed', message: 'remote failed' },
	]);
});
