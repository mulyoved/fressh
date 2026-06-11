import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createBrowserActionErrorReport,
	formatBrowserActionErrorReport,
	normalizeBrowserActionTmuxTarget,
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
