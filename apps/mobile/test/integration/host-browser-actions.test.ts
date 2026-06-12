import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildDiffityShareCommand,
	buildMdevOpenAutoPrintUrlCommand,
	buildMdevOpenBridgePrintUrlCommand,
	buildMdevOpenCommand,
	buildMdevOpenDetectJsonCommand,
	buildTmuxWindowConfigGetCommand,
	buildTmuxWindowConfigSetCommand,
	extractLastHttpsUrl,
	getHostBrowserUrlSlotLabel,
	isHostBrowserUrlSlot,
	parseDetectedOpenCandidates,
	parseHostBrowserUrlInput,
	parsePrintedOpenUrl,
} from '../../src/lib/host-browser-actions';

void test('extractLastHttpsUrl returns the final https URL from helper output', () => {
	const output = [
		'Base: dev (open PR) - reused',
		'',
		'https://host.tailnet.ts.net:8123/diff?ref=dev',
		'trailing log line',
		'https://host.tailnet.ts.net:9000/diff?ref=main',
	].join('\n');

	assert.equal(
		extractLastHttpsUrl(output),
		'https://host.tailnet.ts.net:9000/diff?ref=main',
	);
	assert.equal(extractLastHttpsUrl('no url here'), null);
});

void test('host browser mdev command builders shell-quote dynamic values', () => {
	assert.equal(
		buildDiffityShareCommand("/home/muly/work folder/repo's"),
		"cd '/home/muly/work folder/repo'\\''s' && mdev diffity share",
	);
	assert.equal(
		buildTmuxWindowConfigGetCommand('window-url', '/tmp/work repo'),
		"TMUX_PANE_PATH='/tmp/work repo' mdev tmux url get 'window-url'",
	);
	assert.equal(
		buildTmuxWindowConfigSetCommand(
			'dev-web-server-url',
			'/tmp/work repo',
			'https://example.com/app?q=1',
		),
		"TMUX_PANE_PATH='/tmp/work repo' mdev tmux url set-value 'dev-web-server-url' 'https://example.com/app?q=1'",
	);
});

void test('mdev open command shell-quotes pane context values', () => {
	assert.equal(
		buildMdevOpenCommand('auto', {
			paneId: '%12',
			paneTty: '/dev/pts/7',
			panePath: "/home/muly/work repo's",
		}),
		"TMUX_PANE='%12' TMUX_PANE_TTY='/dev/pts/7' TMUX_PANE_PATH='/home/muly/work repo'\\''s' mdev open auto",
	);
	assert.equal(
		buildMdevOpenCommand('pick', {
			paneId: '%12',
			paneTty: '/dev/pts/7',
			panePath: '/home/muly/work repo',
		}),
		"TMUX_PANE='%12' TMUX_PANE_TTY='/dev/pts/7' TMUX_PANE_PATH='/home/muly/work repo' mdev open pick",
	);
});

void test('mdev open print-url command builders shell-quote pane context and candidates', () => {
	const context = {
		paneId: '%12',
		paneTty: '/dev/pts/7',
		panePath: "/home/muly/work repo's",
	};

	assert.equal(
		buildMdevOpenAutoPrintUrlCommand(context),
		"TMUX_PANE='%12' TMUX_PANE_TTY='/dev/pts/7' TMUX_PANE_PATH='/home/muly/work repo'\\''s' mdev open auto --print-url",
	);
	assert.equal(
		buildMdevOpenDetectJsonCommand(context),
		"TMUX_PANE='%12' TMUX_PANE_TTY='/dev/pts/7' TMUX_PANE_PATH='/home/muly/work repo'\\''s' mdev open detect --json",
	);
	assert.equal(
		buildMdevOpenBridgePrintUrlCommand(
			context,
			"https://example.test/app's",
		),
		"TMUX_PANE='%12' TMUX_PANE_TTY='/dev/pts/7' TMUX_PANE_PATH='/home/muly/work repo'\\''s' mdev open bridge --print-url -- 'https://example.test/app'\\''s'",
	);
	assert.equal(
		buildMdevOpenBridgePrintUrlCommand(context, '--print-url'),
		"TMUX_PANE='%12' TMUX_PANE_TTY='/dev/pts/7' TMUX_PANE_PATH='/home/muly/work repo'\\''s' mdev open bridge --print-url -- '--print-url'",
	);
	assert.equal(
		buildMdevOpenBridgePrintUrlCommand(context, '--emit'),
		"TMUX_PANE='%12' TMUX_PANE_TTY='/dev/pts/7' TMUX_PANE_PATH='/home/muly/work repo'\\''s' mdev open bridge --print-url -- '--emit'",
	);
});

void test('parsePrintedOpenUrl accepts a single http or https URL', () => {
	assert.deepEqual(parsePrintedOpenUrl(' https://example.test/app\n'), {
		type: 'valid',
		url: 'https://example.test/app',
	});
	assert.deepEqual(parsePrintedOpenUrl('http://localhost:3000/path'), {
		type: 'valid',
		url: 'http://localhost:3000/path',
	});
	assert.deepEqual(
		parsePrintedOpenUrl(
			'warning: tailscale serve already configured\nhttps://example.test/app\n',
		),
		{
			type: 'valid',
			url: 'https://example.test/app',
		},
	);
	assert.deepEqual(
		parsePrintedOpenUrl('warning only\nhttps://good.example/path'),
		{
			type: 'valid',
			url: 'https://good.example/path',
		},
	);
	assert.deepEqual(
		parsePrintedOpenUrl('ftp://example.test\nhttps://good.example/path'),
		{
			type: 'valid',
			url: 'https://good.example/path',
		},
	);
	assert.deepEqual(parsePrintedOpenUrl(''), {
		type: 'invalid',
		message: 'mdev open did not return a URL.',
	});
	assert.deepEqual(parsePrintedOpenUrl('not a url'), {
		type: 'invalid',
		message: 'mdev open returned an invalid URL.',
	});
	assert.deepEqual(
		parsePrintedOpenUrl(
			'noise https://bad.example/path\nhttps://good.example/path',
		),
		{
			type: 'invalid',
			message: 'mdev open returned an invalid URL.',
		},
	);
	assert.deepEqual(
		parsePrintedOpenUrl(
			'prefixhttps://bad.example/path\nhttps://good.example/path',
		),
		{
			type: 'invalid',
			message: 'mdev open returned an invalid URL.',
		},
	);
	assert.deepEqual(parsePrintedOpenUrl('http://\nhttps://good.example/path'), {
		type: 'invalid',
		message: 'mdev open returned an invalid URL.',
	});
	assert.deepEqual(parsePrintedOpenUrl('https://example.test/app\nhttps://example.test/other'), {
		type: 'invalid',
		message: 'mdev open returned an invalid URL.',
	});
	assert.deepEqual(
		parsePrintedOpenUrl(
			'https://example.test/app https://example.test/other',
		),
		{
			type: 'invalid',
			message: 'mdev open returned an invalid URL.',
		},
	);
	assert.deepEqual(
		parsePrintedOpenUrl(
			'https://good.example/pathhttps://bad.example/other',
		),
		{
			type: 'invalid',
			message: 'mdev open returned an invalid URL.',
		},
	);
	assert.deepEqual(parsePrintedOpenUrl('ftp://example.test'), {
		type: 'invalid',
		message: 'mdev open returned a non-http URL.',
	});
});

void test('parseDetectedOpenCandidates validates mdev open detect JSON', () => {
	const remoteUrlCandidate = {
		kind: 'remote-url',
		raw: 'https://example.test/app',
		normalized: 'https://example.test/app',
		display: 'https://example.test/app',
		sourceLine: 1,
		sourceColumn: 6,
		path: null,
		line: null,
		url: 'https://example.test/app',
	};
	const localUrlCandidate = {
		kind: 'local-url',
		raw: 'http://localhost:5173/app',
		normalized: 'http://localhost:5173/app',
		display: 'http://localhost:5173/app',
		sourceLine: 2,
		sourceColumn: 1,
		path: null,
		line: null,
		url: 'http://localhost:5173/app',
	};
	const fileCandidate = {
		kind: 'file',
		raw: 'src/app.ts:12',
		normalized: '/repo/src/app.ts:12',
		display: 'src/app.ts:12',
		sourceLine: 3,
		sourceColumn: 1,
		path: '/repo/src/app.ts',
		line: 12,
		url: null,
	};
	const output = JSON.stringify([
		remoteUrlCandidate,
		localUrlCandidate,
		fileCandidate,
	]);

	assert.deepEqual(parseDetectedOpenCandidates(output), {
		type: 'valid',
		candidates: [
			{
				kind: 'remote-url',
				raw: 'https://example.test/app',
				normalized: 'https://example.test/app',
				display: 'https://example.test/app',
				path: null,
				line: null,
				url: 'https://example.test/app',
			},
			{
				kind: 'local-url',
				raw: 'http://localhost:5173/app',
				normalized: 'http://localhost:5173/app',
				display: 'http://localhost:5173/app',
				path: null,
				line: null,
				url: 'http://localhost:5173/app',
			},
			{
				kind: 'file',
				raw: 'src/app.ts:12',
				normalized: '/repo/src/app.ts:12',
				display: 'src/app.ts:12',
				path: '/repo/src/app.ts',
				line: 12,
				url: null,
			},
		],
	});
	assert.deepEqual(parseDetectedOpenCandidates('[]'), {
		type: 'valid',
		candidates: [],
	});
	assert.deepEqual(parseDetectedOpenCandidates(''), {
		type: 'invalid',
		message: 'mdev open detect did not return JSON.',
	});
	assert.deepEqual(parseDetectedOpenCandidates('{bad json'), {
		type: 'invalid',
		message: 'mdev open detect returned invalid JSON.',
	});
	assert.deepEqual(parseDetectedOpenCandidates('{}'), {
		type: 'invalid',
		message: 'mdev open detect returned an unexpected payload.',
	});
	assert.deepEqual(
		parseDetectedOpenCandidates(
			JSON.stringify([
				{ kind: 'other', raw: 'x', normalized: 'x', display: 'x' },
			]),
		),
		{
			type: 'invalid',
			message: 'mdev open detect returned an invalid candidate.',
		},
	);
	for (const candidate of [
		null,
		'not an object',
		{ ...remoteUrlCandidate, raw: undefined },
		{ ...remoteUrlCandidate, normalized: undefined },
		{ ...remoteUrlCandidate, display: undefined },
		{ ...remoteUrlCandidate, path: 123 },
		{ ...remoteUrlCandidate, line: '12' },
		{ ...remoteUrlCandidate, url: 123 },
	]) {
		assert.deepEqual(parseDetectedOpenCandidates(JSON.stringify([candidate])), {
			type: 'invalid',
			message: 'mdev open detect returned an invalid candidate.',
		});
	}
});

void test('host browser URL slots have user-facing labels', () => {
	assert.equal(getHostBrowserUrlSlotLabel('window-url'), 'URL');
	assert.equal(getHostBrowserUrlSlotLabel('dev-web-server-url'), 'Web');
	assert.equal(getHostBrowserUrlSlotLabel('storybook-url'), 'Story');
	assert.equal(getHostBrowserUrlSlotLabel('app-url'), 'App');
});

void test('isHostBrowserUrlSlot identifies supported URL slots', () => {
	assert.equal(isHostBrowserUrlSlot('window-url'), true);
	assert.equal(isHostBrowserUrlSlot('dev-web-server-url'), true);
	assert.equal(isHostBrowserUrlSlot('unknown-url'), false);
	assert.equal(isHostBrowserUrlSlot(''), false);
});

void test('parseHostBrowserUrlInput trims and validates http URLs', () => {
	assert.deepEqual(parseHostBrowserUrlInput('   '), { type: 'empty' });
	assert.deepEqual(parseHostBrowserUrlInput('ftp://example.com'), {
		type: 'invalid',
		message: 'Enter an http:// or https:// URL.',
	});
	assert.deepEqual(parseHostBrowserUrlInput('not a url'), {
		type: 'invalid',
		message: 'Enter a valid URL.',
	});
	assert.deepEqual(parseHostBrowserUrlInput(' https://example.com/path '), {
		type: 'valid',
		url: 'https://example.com/path',
	});
	assert.deepEqual(parseHostBrowserUrlInput('https://example.com/foo bar'), {
		type: 'valid',
		url: 'https://example.com/foo%20bar',
	});
});
