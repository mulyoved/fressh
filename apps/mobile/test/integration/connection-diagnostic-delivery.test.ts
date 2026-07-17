import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverConnectionDiagnosticPrompt } from '../../src/lib/connection-diagnostic-delivery';

void test('delivery pastes into terminal when explicitly allowed', async () => {
	const calls: string[] = [];

	const result = await deliverConnectionDiagnosticPrompt({
		prompt: 'debug prompt',
		delivery: {
			type: 'terminal',
			paste: (value) => {
				calls.push(`paste:${value}`);
			},
		},
		copyToClipboard: async () => {
			calls.push('copy');
		},
		showAlert: (title, message) => {
			calls.push(`alert:${title}:${message}`);
		},
	});

	assert.deepEqual(result, { status: 'pasted' });
	assert.deepEqual(calls, ['paste:debug prompt']);
});

void test('delivery copies and alerts when terminal paste is not allowed', async () => {
	const calls: string[] = [];

	const result = await deliverConnectionDiagnosticPrompt({
		prompt: 'debug prompt',
		delivery: { type: 'clipboard-only' },
		copyToClipboard: async (value) => {
			calls.push(`copy:${value}`);
		},
		showAlert: (title, message) => {
			calls.push(`alert:${title}:${message}`);
		},
	});

	assert.deepEqual(result, { status: 'copied' });
	assert.equal(calls[0], 'copy:debug prompt');
	assert.match(calls[1] ?? '', /alert:Connection debug prompt copied/);
});

void test('delivery falls back to clipboard when paste throws', async () => {
	const calls: string[] = [];

	const result = await deliverConnectionDiagnosticPrompt({
		prompt: 'debug prompt',
		delivery: {
			type: 'terminal',
			paste: () => {
				throw new Error('paste failed');
			},
		},
		copyToClipboard: async (value) => {
			calls.push(`copy:${value}`);
		},
		showAlert: (title, message) => {
			calls.push(`alert:${title}:${message}`);
		},
	});

	assert.deepEqual(result, { status: 'copied' });
	assert.equal(calls[0], 'copy:debug prompt');
	assert.match(calls[1] ?? '', /paste failed/i);
});

void test('delivery reports copy failure when no shell exists', async () => {
	const calls: string[] = [];

	const result = await deliverConnectionDiagnosticPrompt({
		prompt: 'debug prompt',
		delivery: { type: 'clipboard-only' },
		copyToClipboard: async () => {
			throw new Error('copy failed');
		},
		showAlert: (title, message) => {
			calls.push(`alert:${title}:${message}`);
		},
	});

	assert.deepEqual(result, { status: 'copy-failed', error: 'copy failed' });
	assert.match(calls[0] ?? '', /Connection debug prompt copy failed/);
	assert.match(calls[0] ?? '', /copy failed/);
});

void test('delivery reports copy failure after paste failure', async () => {
	const calls: string[] = [];

	const result = await deliverConnectionDiagnosticPrompt({
		prompt: 'debug prompt',
		delivery: {
			type: 'terminal',
			paste: () => {
				throw new Error('paste failed');
			},
		},
		copyToClipboard: async () => {
			throw new Error('copy failed');
		},
		showAlert: (title, message) => {
			calls.push(`alert:${title}:${message}`);
		},
	});

	assert.deepEqual(result, { status: 'copy-failed', error: 'copy failed' });
	assert.match(calls[0] ?? '', /Connection debug prompt copy failed/);
	assert.match(calls[0] ?? '', /copy failed/);
});
