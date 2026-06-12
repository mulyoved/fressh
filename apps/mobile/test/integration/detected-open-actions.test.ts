import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DETECTED_OPEN_SHORTCUTS,
	finishDetectedOpenRequest,
	getDetectedOpenTimeoutMs,
	planDetectedOpenShortcutPress,
	resolveDetectedOpenShortcutMode,
	runDetectedOpenCallback,
	runDetectedOpenControllerRequest,
	runDetectedOpenPickerSelectionRequest,
	tryBeginDetectedOpenRequest,
	type DetectedOpenCandidate,
} from '../../src/lib/detected-open-actions';

function createRequestId() {
	let current = 0;
	return {
		next: () => {
			current += 1;
			return current;
		},
		isCurrent: (requestId: number) => requestId === current,
		invalidate: () => {
			current += 1;
		},
	};
}

void test('detected open timeout is 30 seconds for auto mode', () => {
	assert.equal(getDetectedOpenTimeoutMs('auto'), 30_000);
});

void test('detected open timeout is 60 seconds for pick mode', () => {
	assert.equal(getDetectedOpenTimeoutMs('pick'), 60_000);
});

void test('detected open shortcuts define the browser keyboard byte contract', () => {
	assert.deepEqual(DETECTED_OPEN_SHORTCUTS, [
		{
			mode: 'auto',
			keyboardId: 'browser_keyboard',
			bytes: [27, 97],
			actionId: 'OPEN_HOST_DETECTED_AUTO',
		},
		{
			mode: 'pick',
			keyboardId: 'browser_keyboard',
			bytes: [27, 65],
			actionId: 'OPEN_HOST_DETECTED_PICK',
		},
	]);
});

void test('detected open request begins when no request is in flight', () => {
	const inFlightRef = { current: false };
	const busyCalls: string[] = [];

	const didBegin = tryBeginDetectedOpenRequest({
		inFlightRef,
		onBusy: () => busyCalls.push('busy'),
	});

	assert.equal(didBegin, true);
	assert.equal(inFlightRef.current, true);
	assert.deepEqual(busyCalls, []);
});

void test('detected open request reports busy when already in flight', () => {
	const inFlightRef = { current: true };
	let busyCalls = 0;

	const didBegin = tryBeginDetectedOpenRequest({
		inFlightRef,
		onBusy: () => {
			busyCalls += 1;
		},
	});

	assert.equal(didBegin, false);
	assert.equal(busyCalls, 1);
	assert.equal(inFlightRef.current, true);
});

void test('detected open request finish clears in-flight state', () => {
	const inFlightRef = { current: true };
	let busyCalls = 0;

	finishDetectedOpenRequest(inFlightRef);

	assert.equal(inFlightRef.current, false);
	assert.equal(
		tryBeginDetectedOpenRequest({
			inFlightRef,
			onBusy: () => {
				busyCalls += 1;
			},
		}),
		true,
	);
	assert.equal(inFlightRef.current, true);
	assert.equal(busyCalls, 0);
});

void test('detected open callback runs auto target only', () => {
	const calls: string[] = [];

	const result = runDetectedOpenCallback('auto', {
		onOpenDetectedAuto: () => {
			calls.push('auto');
			return true;
		},
		onOpenDetectedPick: () => {
			calls.push('pick');
			return false;
		},
	});

	assert.equal(result, true);
	assert.deepEqual(calls, ['auto']);
});

void test('detected open callback runs pick target only', () => {
	const calls: string[] = [];

	const result = runDetectedOpenCallback('pick', {
		onOpenDetectedAuto: () => {
			calls.push('auto');
			return true;
		},
		onOpenDetectedPick: () => {
			calls.push('pick');
			return false;
		},
	});

	assert.equal(result, false);
	assert.deepEqual(calls, ['pick']);
});

void test('detected open shortcut resolves browser keyboard bytes', () => {
	assert.equal(
		resolveDetectedOpenShortcutMode('browser_keyboard', {
			type: 'bytes',
			bytes: [27, 97],
		}),
		'auto',
	);
	assert.equal(
		resolveDetectedOpenShortcutMode('browser_keyboard', {
			type: 'bytes',
			bytes: [27, 65],
		}),
		'pick',
	);
});

void test('detected open shortcut ignores other keyboard items', () => {
	assert.equal(
		resolveDetectedOpenShortcutMode('base_keyboard', {
			type: 'bytes',
			bytes: [27, 97],
		}),
		null,
	);
	assert.equal(
		resolveDetectedOpenShortcutMode('browser_keyboard', {
			type: 'bytes',
			bytes: [27, 66],
		}),
		null,
	);
	assert.equal(
		resolveDetectedOpenShortcutMode('browser_keyboard', {
			type: 'action',
		}),
		null,
	);
});

void test('detected open shortcut press plans guarded actions for browser keyboard bytes', () => {
	assert.deepEqual(
		planDetectedOpenShortcutPress('browser_keyboard', {
			type: 'bytes',
			bytes: [27, 97],
		}),
		{ type: 'action', actionId: 'OPEN_HOST_DETECTED_AUTO' },
	);
	assert.deepEqual(
		planDetectedOpenShortcutPress('browser_keyboard', {
			type: 'bytes',
			bytes: [27, 65],
		}),
		{ type: 'action', actionId: 'OPEN_HOST_DETECTED_PICK' },
	);
});

void test('detected open shortcut press falls back to raw bytes for nonmatches', () => {
	assert.deepEqual(
		planDetectedOpenShortcutPress('base_keyboard', {
			type: 'bytes',
			bytes: [27, 97],
		}),
		{ type: 'bytes', bytes: [27, 97] },
	);
	assert.deepEqual(
		planDetectedOpenShortcutPress('browser_keyboard', {
			type: 'bytes',
			bytes: [27, 66],
		}),
		{ type: 'bytes', bytes: [27, 66] },
	);
});

void test('detected open controller auto mode opens parsed URL and clears in-flight state', async () => {
	const inFlightRef = { current: false };
	const openStates: boolean[] = [];
	const openedUrls: string[] = [];
	const commands: { command: string; timeoutMs: number }[] = [];
	const errors: string[] = [];
	const result = runDetectedOpenControllerRequest({
		mode: 'auto',
		inFlightRef,
		requestId: createRequestId(),
		setOpen: (open) => {
			openStates.push(open);
		},
		showError: (title, message) => {
			errors.push(`${title}: ${message}`);
		},
		showErrorReport: (report) => {
			errors.push(`${report.title}: ${report.message}`);
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
		openUrl: async (url) => {
			openedUrls.push(url);
		},
		setPickerCandidates: () => {
			throw new Error('setPickerCandidates should not run');
		},
		resolvePaneContext: async () => ({
			paneId: '%9',
			paneTty: '/dev/pts/9',
			panePath: '/tmp/project',
		}),
		runHostBrowserCommand: async (command, timeoutMs) => {
			commands.push({ command, timeoutMs });
			return 'warning: reused serve\nhttps://example.test/app\n';
		},
	});

	assert.equal(result.accepted, true);
	assert.equal(inFlightRef.current, true);
	assert.deepEqual(openStates, [false]);
	if (result.accepted) await result.completion;

	assert.equal(inFlightRef.current, false);
	assert.deepEqual(errors, []);
	assert.deepEqual(openedUrls, ['https://example.test/app']);
	assert.deepEqual(commands, [
		{
			command:
				"TMUX_PANE='%9' TMUX_PANE_TTY='/dev/pts/9' TMUX_PANE_PATH='/tmp/project' mdev open auto --print-url",
			timeoutMs: 30_000,
		},
	]);
});

void test('detected open controller auto mode reports invalid printed URL output', async () => {
	const inFlightRef = { current: false };
	const openCalls: string[] = [];
	const commands: { command: string; timeoutMs: number }[] = [];
	const errors: {
		title: string;
		message: string;
		panePath?: string;
		command?: string;
	}[] = [];
	const result = runDetectedOpenControllerRequest({
		mode: 'auto',
		inFlightRef,
		requestId: createRequestId(),
		setOpen: () => {},
		showError: (title, message) => {
			errors.push({ title, message });
		},
		showErrorReport: (report) => {
			errors.push(report);
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
		openUrl: async (url) => {
			openCalls.push(url);
		},
		setPickerCandidates: () => {
			throw new Error('setPickerCandidates should not run');
		},
		resolvePaneContext: async () => ({
			paneId: '%9',
			paneTty: '/dev/pts/9',
			panePath: '/tmp/project',
		}),
		runHostBrowserCommand: async (command, timeoutMs) => {
			commands.push({ command, timeoutMs });
			return 'not a url';
		},
	});

	assert.equal(result.accepted, true);
	assert.equal(inFlightRef.current, true);
	if (result.accepted) await result.completion;

	const expectedCommand =
		"TMUX_PANE='%9' TMUX_PANE_TTY='/dev/pts/9' TMUX_PANE_PATH='/tmp/project' mdev open auto --print-url";
	assert.equal(inFlightRef.current, false);
	assert.deepEqual(openCalls, []);
	assert.deepEqual(commands, [{ command: expectedCommand, timeoutMs: 30_000 }]);
	assert.deepEqual(errors, [
		{
			title: 'Open failed',
			message: 'mdev open returned an invalid URL.',
			panePath: '/tmp/project',
			command: expectedCommand,
		},
	]);
});

void test('detected open controller auto mode reports openUrl rejection', async () => {
	const inFlightRef = { current: false };
	const commands: { command: string; timeoutMs: number }[] = [];
	const errors: {
		title: string;
		message: string;
		panePath?: string;
		command?: string;
	}[] = [];
	const result = runDetectedOpenControllerRequest({
		mode: 'auto',
		inFlightRef,
		requestId: createRequestId(),
		setOpen: () => {},
		showError: (title, message) => {
			errors.push({ title, message });
		},
		showErrorReport: (report) => {
			errors.push(report);
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
		openUrl: async () => {
			throw new Error('Android could not open URL');
		},
		setPickerCandidates: () => {
			throw new Error('setPickerCandidates should not run');
		},
		resolvePaneContext: async () => ({
			paneId: '%9',
			paneTty: '/dev/pts/9',
			panePath: '/tmp/project',
		}),
		runHostBrowserCommand: async (command, timeoutMs) => {
			commands.push({ command, timeoutMs });
			return 'https://example.test/app\n';
		},
	});

	assert.equal(result.accepted, true);
	assert.equal(inFlightRef.current, true);
	if (result.accepted) await result.completion;

	const expectedCommand =
		"TMUX_PANE='%9' TMUX_PANE_TTY='/dev/pts/9' TMUX_PANE_PATH='/tmp/project' mdev open auto --print-url";
	assert.equal(inFlightRef.current, false);
	assert.deepEqual(commands, [{ command: expectedCommand, timeoutMs: 30_000 }]);
	assert.deepEqual(errors, [
		{
			title: 'Open failed',
			message: 'Android could not open URL',
			panePath: '/tmp/project',
			command: expectedCommand,
		},
	]);
});

void test('detected open controller pick mode sets candidates without opening URL', async () => {
	const inFlightRef = { current: false };
	const openStates: boolean[] = [];
	const openedUrls: string[] = [];
	const pickerSelections: {
		candidates: DetectedOpenCandidate[];
		context: {
			paneId: string;
			paneTty: string;
			panePath: string;
		};
	}[] = [];
	const commands: { command: string; timeoutMs: number }[] = [];
	const errors: string[] = [];
	const candidates: DetectedOpenCandidate[] = [
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
			kind: 'file',
			raw: 'src/app.ts:12',
			normalized: '/tmp/project/src/app.ts:12',
			display: 'src/app.ts:12',
			path: '/tmp/project/src/app.ts',
			line: 12,
			url: null,
		},
	];
	const context = {
		paneId: '%9',
		paneTty: '/dev/pts/9',
		panePath: '/tmp/project',
	};
	const result = runDetectedOpenControllerRequest({
		mode: 'pick',
		inFlightRef,
		requestId: createRequestId(),
		setOpen: (open) => {
			openStates.push(open);
		},
		showError: (title, message) => {
			errors.push(`${title}: ${message}`);
		},
		showErrorReport: (report) => {
			errors.push(`${report.title}: ${report.message}`);
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
		openUrl: async (url) => {
			openedUrls.push(url);
		},
		setPickerCandidates: (nextCandidates, nextContext) => {
			pickerSelections.push({
				candidates: nextCandidates,
				context: nextContext,
			});
		},
		resolvePaneContext: async () => context,
		runHostBrowserCommand: async (command, timeoutMs) => {
			commands.push({ command, timeoutMs });
			return JSON.stringify(candidates);
		},
	});

	assert.equal(result.accepted, true);
	assert.equal(inFlightRef.current, true);
	assert.deepEqual(openStates, [false]);
	if (result.accepted) await result.completion;

	assert.equal(inFlightRef.current, false);
	assert.deepEqual(errors, []);
	assert.deepEqual(openedUrls, []);
	assert.deepEqual(pickerSelections, [{ candidates, context }]);
	assert.deepEqual(commands, [
		{
			command:
				"TMUX_PANE='%9' TMUX_PANE_TTY='/dev/pts/9' TMUX_PANE_PATH='/tmp/project' mdev open detect --json",
			timeoutMs: 60_000,
		},
	]);
});

void test('detected open picker selection opens parsed bridge URL', async () => {
	const commands: { command: string; timeoutMs: number }[] = [];
	const openedUrls: string[] = [];
	const candidate: DetectedOpenCandidate = {
		kind: 'file',
		raw: '--print-url',
		normalized: '/tmp/project/--print-url',
		display: '--print-url',
		path: '/tmp/project/--print-url',
		line: null,
		url: null,
	};

	await runDetectedOpenPickerSelectionRequest({
		context: {
			paneId: '%9',
			paneTty: '/dev/pts/9',
			panePath: '/tmp/project',
		},
		candidate,
		runHostBrowserCommand: async (command, timeoutMs) => {
			commands.push({ command, timeoutMs });
			return 'https://example.test/file\n';
		},
		openUrl: async (url) => {
			openedUrls.push(url);
		},
	});

	assert.deepEqual(openedUrls, ['https://example.test/file']);
	assert.deepEqual(commands, [
		{
			command:
				"TMUX_PANE='%9' TMUX_PANE_TTY='/dev/pts/9' TMUX_PANE_PATH='/tmp/project' mdev open bridge --print-url -- '--print-url'",
			timeoutMs: 60_000,
		},
	]);
});

void test('detected open controller rejects busy request without closing modal', () => {
	const result = runDetectedOpenControllerRequest({
		mode: 'pick',
		inFlightRef: { current: true },
		requestId: createRequestId(),
		setOpen: () => {
			throw new Error('setOpen should not run');
		},
		showError: (title, message) => {
			assert.deepEqual(
				{ title, message },
				{
					title: 'Open already running',
					message: 'Wait for the current browser action to finish.',
				},
			);
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
		openUrl: async () => {
			throw new Error('openUrl should not run');
		},
		setPickerCandidates: () => {
			throw new Error('setPickerCandidates should not run');
		},
		resolvePaneContext: async () => {
			throw new Error('resolvePaneContext should not run');
		},
		runHostBrowserCommand: async () => {
			throw new Error('runHostBrowserCommand should not run');
		},
	});

	assert.deepEqual(result, { accepted: false, completion: null });
});

void test('detected open controller reports mode-specific failures and clears in-flight state', async () => {
	const cases = [
		{
			mode: 'auto' as const,
			expectedTitle: 'Open failed',
			expectedCommand:
				"TMUX_PANE='%9' TMUX_PANE_TTY='/dev/pts/9' TMUX_PANE_PATH='/tmp/project' mdev open auto --print-url",
		},
		{
			mode: 'pick' as const,
			expectedTitle: 'Pick failed',
			expectedCommand:
				"TMUX_PANE='%9' TMUX_PANE_TTY='/dev/pts/9' TMUX_PANE_PATH='/tmp/project' mdev open detect --json",
		},
	];

	for (const testCase of cases) {
		const inFlightRef = { current: false };
		const errors: {
			title: string;
			message: string;
			panePath?: string;
			command?: string;
		}[] = [];
		const result = runDetectedOpenControllerRequest({
			mode: testCase.mode,
			inFlightRef,
			requestId: createRequestId(),
			setOpen: () => {},
			showError: (title, message) => {
				errors.push({ title, message });
			},
			showErrorReport: (report) => {
				errors.push(report);
			},
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
			openUrl: async () => {
				throw new Error('openUrl should not run');
			},
			setPickerCandidates: () => {
				throw new Error('setPickerCandidates should not run');
			},
			resolvePaneContext: async () => ({
				paneId: '%9',
				paneTty: '/dev/pts/9',
				panePath: '/tmp/project',
			}),
			runHostBrowserCommand: async () => {
				throw new Error('remote failed');
			},
		});

		assert.equal(result.accepted, true);
		if (result.accepted) await result.completion;

		assert.equal(inFlightRef.current, false);
		assert.deepEqual(errors, [
			{
				title: testCase.expectedTitle,
				message: 'remote failed',
				panePath: '/tmp/project',
				command: testCase.expectedCommand,
			},
		]);
	}
});

void test('detected open controller supports legacy two-argument error callback', async () => {
	const inFlightRef = { current: false };
	const errors: string[] = [];
	const result = runDetectedOpenControllerRequest({
		mode: 'auto',
		inFlightRef,
		requestId: createRequestId(),
		setOpen: () => {},
		showError: (title, message) => {
			errors.push(`${title}: ${message}`);
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
		openUrl: async () => {
			throw new Error('openUrl should not run');
		},
		setPickerCandidates: () => {
			throw new Error('setPickerCandidates should not run');
		},
		resolvePaneContext: async () => ({
			paneId: '%9',
			paneTty: '/dev/pts/9',
			panePath: '/tmp/project',
		}),
		runHostBrowserCommand: async () => {
			throw new Error('remote failed');
		},
	});

	assert.equal(result.accepted, true);
	if (result.accepted) await result.completion;
	assert.deepEqual(errors, ['Open failed: remote failed']);
	assert.equal(inFlightRef.current, false);
});

void test('detected open controller suppresses stale request side effects', async () => {
	const inFlightRef = { current: false };
	const requestId = createRequestId();
	const commands: string[] = [];
	const errors: string[] = [];
	let resumeContext: () => void = () => {
		throw new Error('resolvePaneContext was not started');
	};

	const result = runDetectedOpenControllerRequest({
		mode: 'auto',
		inFlightRef,
		requestId,
		setOpen: () => {},
		showError: (title, message) => {
			errors.push(`${title}: ${message}`);
		},
		showErrorReport: (report) => {
			errors.push(`${report.title}: ${report.message}`);
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
		openUrl: async () => {
			throw new Error('openUrl should not run');
		},
		setPickerCandidates: () => {
			throw new Error('setPickerCandidates should not run');
		},
		resolvePaneContext: async () =>
			new Promise((resolve) => {
				resumeContext = () => {
					resolve({
						paneId: '%9',
						paneTty: '/dev/pts/9',
						panePath: '/tmp/project',
					});
				};
			}),
		runHostBrowserCommand: async (command) => {
			commands.push(command);
			throw new Error('stale command should not run');
		},
	});

	assert.equal(result.accepted, true);
	assert.equal(inFlightRef.current, true);
	requestId.invalidate();
	inFlightRef.current = false;
	resumeContext();
	if (result.accepted) await result.completion;

	assert.equal(inFlightRef.current, false);
	assert.deepEqual(commands, []);
	assert.deepEqual(errors, []);
});

void test('detected open controller suppresses stale command rejection', async () => {
	const inFlightRef = { current: false };
	const requestId = createRequestId();
	const commands: string[] = [];
	const errors: string[] = [];
	let rejectCommand: (error: Error) => void = () => {
		throw new Error('runHostBrowserCommand was not started');
	};

	const result = runDetectedOpenControllerRequest({
		mode: 'auto',
		inFlightRef,
		requestId,
		setOpen: () => {},
		showError: (title, message) => {
			errors.push(`${title}: ${message}`);
		},
		showErrorReport: (report) => {
			errors.push(`${report.title}: ${report.message}`);
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
		openUrl: async () => {
			throw new Error('openUrl should not run');
		},
		setPickerCandidates: () => {
			throw new Error('setPickerCandidates should not run');
		},
		resolvePaneContext: async () => ({
			paneId: '%9',
			paneTty: '/dev/pts/9',
			panePath: '/tmp/project',
		}),
		runHostBrowserCommand: async (command) =>
			new Promise((_, reject) => {
				commands.push(command);
				rejectCommand = reject;
			}),
	});

	assert.equal(result.accepted, true);
	await Promise.resolve();
	assert.equal(commands.length, 1);
	requestId.invalidate();
	inFlightRef.current = false;
	rejectCommand(new Error('stale remote failed'));
	if (result.accepted) await result.completion;

	assert.equal(inFlightRef.current, false);
	assert.deepEqual(errors, []);
});
