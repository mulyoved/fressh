import assert from 'node:assert/strict';
import test from 'node:test';
import {
	showBrowserActionErrorReport,
	type BrowserActionErrorAlertButton,
} from '../../src/lib/browser-action-error-alert';
import { type BrowserActionErrorReport } from '../../src/lib/browser-action-error-report';

function createReport(): BrowserActionErrorReport {
	return {
		action: 'Diff',
		title: 'Diffity failed',
		message: 'no url here',
		connectionState: 'connected',
		tmuxEnabled: true,
		tmuxTarget: 'main',
		panePath: '/tmp/project',
		command: "cd '/tmp/project' && mdev diffity share",
		output: 'no url here',
	};
}

void test('browser action error alert includes copy and OK buttons', () => {
	const alerts: {
		title: string;
		message: string;
		buttons: BrowserActionErrorAlertButton[];
	}[] = [];

	showBrowserActionErrorReport(createReport(), {
		alert: (title, message, buttons) => {
			alerts.push({ title, message, buttons });
		},
		copyText: async () => {},
		warn: () => {},
	});

	assert.equal(alerts.length, 1);
	assert.equal(alerts[0]?.title, 'Diffity failed');
	assert.equal(alerts[0]?.message, 'no url here');
	assert.deepEqual(
		alerts[0]?.buttons.map((button) => button.text),
		['Copy Error', 'OK'],
	);
});

void test('browser action error alert copies formatted report when Copy Error is pressed', async () => {
	let buttons: BrowserActionErrorAlertButton[] = [];
	const copied: string[] = [];

	showBrowserActionErrorReport(createReport(), {
		alert: (_title, _message, alertButtons) => {
			buttons = alertButtons;
		},
		copyText: async (text) => {
			copied.push(text);
		},
		warn: () => {},
	});

	buttons[0]?.onPress?.();
	await Promise.resolve();
	await Promise.resolve();

	assert.deepEqual(copied, [
		[
			'Fressh Browser Action Error',
			'Action: Diff',
			'Title: Diffity failed',
			'Message: no url here',
			'Connection: connected',
			'Workmux enabled: true',
			'Tmux target: main',
			'Pane path: /tmp/project',
			"Command: cd '/tmp/project' && mdev diffity share",
			'Output:',
			'no url here',
		].join('\n'),
	]);
});

void test('browser action error alert logs copy failures without throwing', async () => {
	let buttons: BrowserActionErrorAlertButton[] = [];
	const warnings: string[] = [];
	const copyError = new Error('clipboard unavailable');

	showBrowserActionErrorReport(createReport(), {
		alert: (_title, _message, alertButtons) => {
			buttons = alertButtons;
		},
		copyText: async () => {
			throw copyError;
		},
		warn: (message, error) => {
			warnings.push(
				`${message}: ${error instanceof Error ? error.message : String(error)}`,
			);
		},
	});

	buttons[0]?.onPress?.();
	await Promise.resolve();
	await Promise.resolve();

	assert.deepEqual(warnings, [
		'copy Browser action error failed: clipboard unavailable',
	]);
});
