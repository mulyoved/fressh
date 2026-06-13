import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createBrowserActionErrorReport,
	formatBrowserActionErrorReport,
	normalizeBrowserActionTmuxTarget,
	redactBrowserActionErrorText,
	type BrowserActionErrorReport,
} from '../../src/lib/browser-action-error-report';

void test('browser action error report formatter emits stable line-oriented text', () => {
	const report: BrowserActionErrorReport = {
		action: 'Diff',
		title: 'Diffity failed',
		message: 'mdev diffity share did not return an HTTPS URL.',
		connectionState: 'connected',
		tmuxEnabled: true,
		tmuxTarget: 'main',
		panePath: '/home/muly/fressh',
		command: "cd '/home/muly/fressh' && mdev diffity share",
		output: 'line one\nline two\n',
		url: 'https://diffity.example/current',
		details: 'Android could not open URL.',
	};

	assert.equal(
		formatBrowserActionErrorReport(report),
		[
			'Fressh Browser Action Error',
			'Action: Diff',
			'Title: Diffity failed',
			'Message: mdev diffity share did not return an HTTPS URL.',
			'Connection: connected',
			'Workmux enabled: true',
			'Tmux target: main',
			'Pane path: /home/muly/fressh',
			"Command: cd '/home/muly/fressh' && mdev diffity share",
			'URL: https://diffity.example/current',
			'Details: Android could not open URL.',
			'Output:',
			'line one',
			'line two',
		].join('\n'),
	);
});

void test('browser action error report formatter omits unavailable optional fields', () => {
	const report: BrowserActionErrorReport = {
		action: 'Open',
		title: 'Open failed',
		message: 'Remote command failed.',
		connectionState: 'missing',
		tmuxEnabled: false,
		tmuxTarget: 'main',
		output: '',
	};

	assert.equal(
		formatBrowserActionErrorReport(report),
		[
			'Fressh Browser Action Error',
			'Action: Open',
			'Title: Open failed',
			'Message: Remote command failed.',
			'Connection: missing',
			'Workmux enabled: false',
			'Tmux target: main',
		].join('\n'),
	);
});

void test('browser action error report formatter normalizes tmux target', () => {
	const report: BrowserActionErrorReport = {
		action: 'Open',
		title: 'Open failed',
		message: 'Remote command failed.',
		connectionState: 'connected',
		tmuxEnabled: true,
		tmuxTarget: '  work  ',
	};

	assert.equal(
		formatBrowserActionErrorReport(report),
		[
			'Fressh Browser Action Error',
			'Action: Open',
			'Title: Open failed',
			'Message: Remote command failed.',
			'Connection: connected',
			'Workmux enabled: true',
			'Tmux target: work',
		].join('\n'),
	);
});

void test('browser action error report formatter omits whitespace-only optional fields', () => {
	const report: BrowserActionErrorReport = {
		action: 'Open',
		title: 'Open failed',
		message: 'Remote command failed.',
		connectionState: 'missing',
		tmuxEnabled: false,
		tmuxTarget: 'main',
		panePath: '  ',
		command: '\t',
		url: '\n',
		details: ' \t ',
		output: ' \n\t ',
	};

	const formatted = formatBrowserActionErrorReport(report);

	assert.equal(
		formatted,
		[
			'Fressh Browser Action Error',
			'Action: Open',
			'Title: Open failed',
			'Message: Remote command failed.',
			'Connection: missing',
			'Workmux enabled: false',
			'Tmux target: main',
		].join('\n'),
	);
	assert.equal(formatted.includes('Pane path'), false);
	assert.equal(formatted.includes('Command'), false);
	assert.equal(formatted.includes('URL'), false);
	assert.equal(formatted.includes('Details'), false);
	assert.equal(formatted.includes('Output:'), false);
});

void test('browser action error report formatter redacts credential-bearing URLs', () => {
	const report: BrowserActionErrorReport = {
		action: 'URL',
		title: 'Open URL failed',
		message:
			'Android could not open https://user:password@example.test/path#access_token=fragment-secret',
		connectionState: 'connected',
		tmuxEnabled: true,
		tmuxTarget: 'main',
		panePath: '/tmp/project',
		command:
			"TMUX_PANE_PATH='/tmp/project' mdev tmux url set-value 'window-url' 'https://user:password@example.test/path?token=secret&ok=1'",
		url: 'https://user:password@example.test/path?token=secret&ok=1#refresh_token=fragment-secret',
		details:
			'fetch https://example.test/callback?api_key=abc123&client_secret=secret&ok=1',
		output: [
			'origin https://x-access-token:ghp_secret@github.com/owner/repo.git?access_token=secret&id_token=jwt',
			'GITHUB_TOKEN=ghp_secret',
			'Authorization: Bearer ghp_secret',
		].join('\n'),
	};

	assert.equal(
		formatBrowserActionErrorReport(report),
		[
			'Fressh Browser Action Error',
			'Action: URL',
			'Title: Open URL failed',
			'Message: Android could not open https://[redacted]@example.test/path#access_token=[redacted]',
			'Connection: connected',
			'Workmux enabled: true',
			'Tmux target: main',
			'Pane path: /tmp/project',
			"Command: TMUX_PANE_PATH='/tmp/project' mdev tmux url set-value 'window-url' 'https://[redacted]@example.test/path?token=[redacted]&ok=1'",
			'URL: https://[redacted]@example.test/path?token=[redacted]&ok=1#refresh_token=[redacted]',
			'Details: fetch https://example.test/callback?api_key=[redacted]&client_secret=[redacted]&ok=1',
			'Output:',
			'origin https://[redacted]@github.com/owner/repo.git?access_token=[redacted]&id_token=[redacted]',
			'GITHUB_TOKEN=[redacted]',
			'Authorization: Bearer [redacted]',
		].join('\n'),
	);
});

void test('browser action error redaction covers common secret assignments and headers', () => {
	assert.equal(
		redactBrowserActionErrorText(
			[
				'GITHUB_TOKEN=ghp_secret',
				'api-key="abc123"',
				'Authorization: Bearer ghp_secret',
				'password: "secret-value"',
				'SESSION_TOKEN="secret with spaces"',
				"refresh-token='quoted secret with spaces'",
				'Authorization: Bearer "token with spaces"',
				'PROJECT_NAME=fressh',
			].join('\n'),
		),
		[
			'GITHUB_TOKEN=[redacted]',
			'api-key="[redacted]"',
			'Authorization: Bearer [redacted]',
			'password: "[redacted]"',
			'SESSION_TOKEN="[redacted]"',
			"refresh-token='[redacted]'",
			'Authorization: Bearer "[redacted]"',
			'PROJECT_NAME=fressh',
		].join('\n'),
	);
});

void test('browser action error report redaction preserves non-secret URLs', () => {
	assert.equal(
		redactBrowserActionErrorText(
			'https://example.test/path?ok=1&name=value git@github.com:owner/repo.git',
		),
		'https://example.test/path?ok=1&name=value git@github.com:owner/repo.git',
	);
});

void test('browser action tmux target normalization trims and defaults to main', () => {
	assert.equal(normalizeBrowserActionTmuxTarget('  work  '), 'work');
	assert.equal(normalizeBrowserActionTmuxTarget('  '), 'main');
});

void test('browser action error report factory maps state, target, and optional fields', () => {
	assert.deepEqual(
		createBrowserActionErrorReport({
			action: 'Diff',
			title: 'Diffity failed',
			message: 'mdev diffity share did not return an HTTPS URL.',
			connectionPresent: true,
			tmuxEnabled: true,
			tmuxTarget: '  work  ',
			panePath: '/home/muly/fressh',
			command: "cd '/home/muly/fressh' && mdev diffity share",
			output: 'line one\nline two\n',
			url: 'https://diffity.example/current',
			details: 'Android could not open URL.',
		}),
		{
			action: 'Diff',
			title: 'Diffity failed',
			message: 'mdev diffity share did not return an HTTPS URL.',
			connectionState: 'connected',
			tmuxEnabled: true,
			tmuxTarget: 'work',
			panePath: '/home/muly/fressh',
			command: "cd '/home/muly/fressh' && mdev diffity share",
			output: 'line one\nline two\n',
			url: 'https://diffity.example/current',
			details: 'Android could not open URL.',
		},
	);

	assert.deepEqual(
		createBrowserActionErrorReport({
			action: 'Open',
			title: 'Open failed',
			message: 'Remote command failed.',
			connectionPresent: false,
			tmuxEnabled: false,
			tmuxTarget: '  ',
		}),
		{
			action: 'Open',
			title: 'Open failed',
			message: 'Remote command failed.',
			connectionState: 'missing',
			tmuxEnabled: false,
			tmuxTarget: 'main',
			panePath: undefined,
			command: undefined,
			output: undefined,
			url: undefined,
			details: undefined,
		},
	);
});
