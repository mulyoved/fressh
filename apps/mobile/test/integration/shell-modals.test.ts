import assert from 'node:assert/strict';
import test from 'node:test';
import {
	showBrowserActionErrorReport,
	type BrowserActionErrorAlertButton,
} from '../../src/lib/browser-action-error-alert';
import { createBrowserActionErrorReport } from '../../src/lib/browser-action-error-report';
import { cleanupBrowserActionRequests } from '../../src/lib/browser-actions-request-cleanup';
import {
	buildTmuxWindowConfigGetCommand,
	buildTmuxWindowConfigSetCommand,
} from '../../src/lib/host-browser-actions';
import {
	HostDiffityShareError,
	runHostDiffityOpenRequest,
	type HostDiffityOpenErrorReport,
	type HostDiffityShareResult,
} from '../../src/lib/host-diffity-open-request';
import { type RequestIdHandle } from '../../src/lib/request-id';
import {
	createDiffBrowserActionErrorInput,
	createHostUrlOpenBrowserActionErrorInput,
	createHostUrlSubmitBrowserActionErrorInput,
} from '../../src/lib/shell-browser-action-error-inputs';
import {
	GitHubRepositoryResolutionError,
	runGitHubTargetOpenRequest,
} from '../../src/lib/shell-github-target-request';
import { runHostUrlReadRequest } from '../../src/lib/shell-host-url-read-request';
import { runHostUrlSubmitRequest } from '../../src/lib/shell-host-url-submit-request';

const deferred = <T>() => {
	let resolve: (value: T) => void = () => {};
	let reject: (reason?: unknown) => void = () => {};
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
};

void test('browser action request cleanup invalidates browser action requests', () => {
	const events: string[] = [];
	const requestId = (name: string): RequestIdHandle => ({
		next: () => 0,
		isCurrent: () => false,
		invalidate: () => events.push(`invalidate:${name}`),
	});
	const inFlightRefs = {
		hostUrlSubmit: { current: true },
		hostDiffity: { current: true },
		hostDetectedOpen: { current: true },
	};

	cleanupBrowserActionRequests({
		hostUrlReadRequestId: requestId('hostUrlRead'),
		hostUrlSubmitRequestId: requestId('hostUrlSubmit'),
		hostUrlSubmitInFlightRef: inFlightRefs.hostUrlSubmit,
		browserGitHubTargetRequestId: requestId('browserGitHubTarget'),
		hostDiffityRequestId: requestId('hostDiffity'),
		hostDiffityInFlightRef: inFlightRefs.hostDiffity,
		hostDetectedOpenRequestId: requestId('hostDetectedOpen'),
		hostDetectedOpenInFlightRef: inFlightRefs.hostDetectedOpen,
	});

	assert.deepEqual(events, [
		'invalidate:hostUrlRead',
		'invalidate:hostUrlSubmit',
		'invalidate:browserGitHubTarget',
		'invalidate:hostDiffity',
		'invalidate:hostDetectedOpen',
	]);
	assert.equal(inFlightRefs.hostUrlSubmit.current, false);
	assert.equal(inFlightRefs.hostDiffity.current, false);
	assert.equal(inFlightRefs.hostDetectedOpen.current, false);
});

void test('shell Browser action error input preserves Diffity metadata for copyable reports', () => {
	assert.deepEqual(
		createDiffBrowserActionErrorInput({
			title: 'Diffity failed',
			message: 'remote command failed',
			panePath: '/tmp/project',
			command: "cd '/tmp/project' && mdev diffity share",
			output: 'stderr output',
			url: 'https://diffity.example/current',
		}),
		{
			action: 'Diff',
			title: 'Diffity failed',
			message: 'remote command failed',
			panePath: '/tmp/project',
			command: "cd '/tmp/project' && mdev diffity share",
			output: 'stderr output',
			url: 'https://diffity.example/current',
		},
	);
});

void test('shell Diffity copyable report includes metadata and shell context', async () => {
	let buttons: BrowserActionErrorAlertButton[] = [];
	const copied: string[] = [];

	showBrowserActionErrorReport(
		createBrowserActionErrorReport({
			...createDiffBrowserActionErrorInput({
				title: 'Diffity failed',
				message: 'remote command failed',
				panePath: '/tmp/project',
				command: "cd '/tmp/project' && mdev diffity share",
				output: 'stderr output',
				url: 'https://diffity.example/current',
			}),
			connectionPresent: true,
			tmuxEnabled: true,
			tmuxTarget: ' work ',
		}),
		{
			alert: (_title, _message, alertButtons) => {
				buttons = alertButtons;
			},
			copyText: async (text) => {
				copied.push(text);
			},
			warn: () => {},
		},
	);

	buttons[0]?.onPress?.();
	await new Promise((resolve) => setTimeout(resolve, 0));

	assert.deepEqual(copied, [
		[
			'Fressh Browser Action Error',
			'Action: Diff',
			'Title: Diffity failed',
			'Message: remote command failed',
			'Connection: connected',
			'Workmux enabled: true',
			'Tmux target: work',
			'Pane path: /tmp/project',
			"Command: cd '/tmp/project' && mdev diffity share",
			'URL: https://diffity.example/current',
			'Output:',
			'stderr output',
		].join('\n'),
	]);
});

void test('shell Browser action error input includes saved URL submit context', () => {
	assert.deepEqual(
		createHostUrlSubmitBrowserActionErrorInput({
			slot: 'window-url',
			message: 'tmux config set failed',
			panePath: '/tmp/project',
			url: 'https://example.test',
		}),
		{
			action: 'URL',
			title: 'Save URL failed',
			message: 'tmux config set failed',
			panePath: '/tmp/project',
			url: 'https://example.test',
		},
	);
});

void test('shell Browser action error input distinguishes saved URL open failures', () => {
	assert.deepEqual(
		createHostUrlOpenBrowserActionErrorInput({
			slot: 'window-url',
			message: 'Android could not open URL',
			panePath: '/tmp/project',
			command: 'mdev tmux url get window-url',
			url: 'https://example.test',
		}),
		{
			action: 'URL',
			title: 'Open URL failed',
			message: 'Android could not open URL',
			panePath: '/tmp/project',
			command: 'mdev tmux url get window-url',
			url: 'https://example.test',
		},
	);
});

void test('GitHub target request reports Android open failures with context', async () => {
	for (const testCase of [
		{
			target: 'issues' as const,
			action: 'GitHub Issues',
			title: 'GitHub Issues failed',
			url: 'https://github.com/owner/repo/issues',
		},
		{
			target: 'pulls' as const,
			action: 'GitHub Pull Requests',
			title: 'GitHub Pull Requests failed',
			url: 'https://github.com/owner/repo/pulls',
		},
	]) {
		let currentId = 0;
		const requestId: RequestIdHandle = {
			next: () => {
				currentId += 1;
				return currentId;
			},
			isCurrent: (id) => id === currentId,
			invalidate: () => {
				currentId += 1;
			},
		};
		const reports: {
			action: string;
			title: string;
			message: string;
			panePath?: string;
			command?: string;
			output?: string;
			url?: string;
		}[] = [];

		runGitHubTargetOpenRequest({
			target: testCase.target,
			requestId,
			resolveRepositoryContext: async () => ({
				repository: 'owner/repo',
				panePath: '/tmp/project',
				command: 'git remote get-url origin',
				output: 'owner/repo',
			}),
			openAndroidUrl: async () => {
				throw new Error('Android could not open URL');
			},
			showError: (report) => reports.push(report),
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		});

		await Promise.resolve();
		await Promise.resolve();
		assert.deepEqual(reports, [
			{
				action: testCase.action,
				title: testCase.title,
				message: 'Android could not open URL',
				panePath: '/tmp/project',
				command: 'git remote get-url origin',
				output: 'owner/repo',
				url: testCase.url,
			},
		]);
	}
});

void test('GitHub target request suppresses stale errors', async () => {
	let currentId = 0;
	const requestId: RequestIdHandle = {
		next: () => {
			currentId += 1;
			return currentId;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const deferredResolution = deferred<{
		repository: string;
		panePath?: string;
		command?: string;
		output?: string;
	}>();
	const reports: unknown[] = [];

	runGitHubTargetOpenRequest({
		target: 'pulls',
		requestId,
		resolveRepositoryContext: () => deferredResolution.promise,
		openAndroidUrl: async () => {
			throw new Error('should not open stale URL');
		},
		showError: (report) => reports.push(report),
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});
	requestId.invalidate();

	deferredResolution.resolve({ repository: 'owner/repo' });
	await deferredResolution.promise;
	await Promise.resolve();
	assert.deepEqual(reports, []);
});

void test('GitHub target request reports repository parse failures with context', async () => {
	let currentId = 0;
	const requestId: RequestIdHandle = {
		next: () => {
			currentId += 1;
			return currentId;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const reports: {
		action: string;
		title: string;
		message: string;
		panePath?: string;
		command?: string;
		output?: string;
	}[] = [];

	runGitHubTargetOpenRequest({
		target: 'issues',
		requestId,
		resolveRepositoryContext: async () => {
			throw new GitHubRepositoryResolutionError({
				message: 'Could not resolve GitHub repository for current window.',
				panePath: '/tmp/project',
				command: 'git remote get-url origin',
				output: 'not a GitHub remote',
			});
		},
		openAndroidUrl: async () => {
			throw new Error('should not open without repository');
		},
		showError: (report) => reports.push(report),
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	await Promise.resolve();
	await Promise.resolve();
	assert.deepEqual(reports, [
		{
			action: 'GitHub Issues',
			title: 'GitHub Issues failed',
			message: 'Could not resolve GitHub repository for current window.',
			panePath: '/tmp/project',
			command: 'git remote get-url origin',
			output: 'not a GitHub remote',
		},
	]);
});

void test('host URL read request reports existing saved URL open failures with context', async () => {
	let currentId = 0;
	const requestId: RequestIdHandle = {
		next: () => {
			currentId += 1;
			return currentId;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const reports: {
		action: string;
		title: string;
		message: string;
		panePath?: string;
		command?: string;
		url?: string;
	}[] = [];
	const modalStates: unknown[] = [];
	const modalErrors: (string | null)[] = [];
	const openStates: boolean[] = [];

	runHostUrlReadRequest({
		mode: 'open',
		slot: 'window-url',
		requestId,
		resolvePanePath: async () => '/tmp/project',
		runHostBrowserCommand: async () => 'https://example.test/',
		openAndroidUrl: async () => {
			throw new Error('Android could not open URL');
		},
		setOpen: (open) => openStates.push(open),
		setHostUrlModalState: (state) => modalStates.push(state),
		setHostUrlModalError: (message) => modalErrors.push(message),
		showError: (report) => reports.push(report),
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(openStates, [false]);
	assert.deepEqual(modalStates, []);
	assert.deepEqual(modalErrors, []);
	assert.equal(reports.length, 1);
	assert.equal(reports[0]?.action, 'URL');
	assert.equal(reports[0]?.title, 'Open URL failed');
	assert.equal(reports[0]?.message, 'Android could not open URL');
	assert.equal(reports[0]?.panePath, '/tmp/project');
	assert.equal(
		reports[0]?.command,
		buildTmuxWindowConfigGetCommand('window-url', '/tmp/project'),
	);
	assert.equal(reports[0]?.url, 'https://example.test/');
});

void test('host URL read request reports edit read failures with command context', async () => {
	let currentId = 0;
	const requestId: RequestIdHandle = {
		next: () => {
			currentId += 1;
			return currentId;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const reports: {
		action: string;
		title: string;
		message: string;
		panePath?: string;
		command?: string;
	}[] = [];

	runHostUrlReadRequest({
		mode: 'edit',
		slot: 'window-url',
		requestId,
		resolvePanePath: async () => '/tmp/project',
		runHostBrowserCommand: async () => {
			throw new Error('tmux config get failed');
		},
		openAndroidUrl: async () => {
			throw new Error('should not open while editing');
		},
		setOpen: () => {},
		setHostUrlModalState: () => {
			throw new Error('modal should not open on read failure');
		},
		setHostUrlModalError: () => {},
		showError: (report) => reports.push(report),
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	await Promise.resolve();
	await Promise.resolve();
	assert.deepEqual(reports, [
		{
			action: 'URL',
			title: 'Edit URL failed',
			message: 'tmux config get failed',
			panePath: '/tmp/project',
			command: buildTmuxWindowConfigGetCommand('window-url', '/tmp/project'),
		},
	]);
});

void test('host URL read request reports open read failures with command context', async () => {
	let currentId = 0;
	const requestId: RequestIdHandle = {
		next: () => {
			currentId += 1;
			return currentId;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const reports: {
		action: string;
		title: string;
		message: string;
		panePath?: string;
		command?: string;
	}[] = [];

	runHostUrlReadRequest({
		mode: 'open',
		slot: 'window-url',
		requestId,
		resolvePanePath: async () => '/tmp/project',
		runHostBrowserCommand: async () => {
			throw new Error('tmux config get failed');
		},
		openAndroidUrl: async () => {
			throw new Error('should not open after read failure');
		},
		setOpen: () => {},
		setHostUrlModalState: () => {
			throw new Error('modal should not open on read failure');
		},
		setHostUrlModalError: () => {},
		showError: (report) => reports.push(report),
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	await Promise.resolve();
	await Promise.resolve();
	assert.deepEqual(reports, [
		{
			action: 'URL',
			title: 'URL failed',
			message: 'tmux config get failed',
			panePath: '/tmp/project',
			command: buildTmuxWindowConfigGetCommand('window-url', '/tmp/project'),
		},
	]);
});

void test('host URL submit request reports open-after-save failures as open failures', async () => {
	let currentId = 0;
	const requestId: RequestIdHandle = {
		next: () => {
			currentId += 1;
			return currentId;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const inFlightRef = { current: false };
	const commands: string[] = [];
	const reports: {
		action: string;
		title: string;
		message: string;
		panePath?: string;
		url?: string;
	}[] = [];
	const errors: (string | null)[] = [];
	const openedUrls: string[] = [];

	assert.equal(
		runHostUrlSubmitRequest({
			state: {
				mode: 'open-missing',
				slot: 'window-url',
				panePath: '/tmp/project',
			},
			url: 'https://example.test/',
			hostUrlSubmitInFlightRef: inFlightRef,
			hostUrlSubmitRequestId: requestId,
			runHostBrowserCommand: async (command) => {
				commands.push(command);
				return '';
			},
			openAndroidUrl: async (url) => {
				openedUrls.push(url);
				throw new Error('Android could not open URL');
			},
			setHostUrlModalState: () => {
				throw new Error('modal should remain open on failure');
			},
			setHostUrlModalSubmitting: () => {},
			setHostUrlModalError: (message) => errors.push(message),
			showError: (report) => reports.push(report),
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);

	await new Promise((resolve) => setTimeout(resolve, 0));

	assert.equal(inFlightRef.current, false);
	assert.deepEqual(commands, [
		buildTmuxWindowConfigSetCommand(
			'window-url',
			'/tmp/project',
			'https://example.test/',
		),
	]);
	assert.deepEqual(openedUrls, ['https://example.test/']);
	assert.deepEqual(errors, [null, 'Android could not open URL']);
	assert.deepEqual(reports, [
		{
			action: 'URL',
			title: 'Open URL failed',
			message: 'Android could not open URL',
			panePath: '/tmp/project',
			command: buildTmuxWindowConfigSetCommand(
				'window-url',
				'/tmp/project',
				'https://example.test/',
			),
			url: 'https://example.test/',
		},
	]);
});

void test('stale host URL submit completion does not clear newer in-flight request', async () => {
	let currentId = 0;
	const nextIds = [1, 3];
	const requestId: RequestIdHandle = {
		next: () => {
			const next = nextIds.shift();
			if (next == null) throw new Error('missing next request id');
			currentId = next;
			return next;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const inFlightRef = { current: false };
	const firstSave = deferred<string>();
	const secondSave = deferred<string>();
	const saves = [firstSave.promise, secondSave.promise];
	const closed: null[] = [];
	const errors: (string | null)[] = [];
	const reports: unknown[] = [];

	assert.equal(
		runHostUrlSubmitRequest({
			state: {
				mode: 'edit',
				slot: 'window-url',
				panePath: '/tmp/project',
			},
			url: 'https://example.test/old',
			hostUrlSubmitInFlightRef: inFlightRef,
			hostUrlSubmitRequestId: requestId,
			runHostBrowserCommand: () => {
				const save = saves.shift();
				if (!save) throw new Error('missing save request');
				return save;
			},
			openAndroidUrl: async () => {
				throw new Error('should not open in edit mode');
			},
			setHostUrlModalState: (state) => {
				closed.push(state);
			},
			setHostUrlModalSubmitting: () => {},
			setHostUrlModalError: (message) => errors.push(message),
			showError: (report) => reports.push(report),
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);
	assert.equal(inFlightRef.current, true);

	requestId.invalidate();
	inFlightRef.current = false;
	assert.equal(
		runHostUrlSubmitRequest({
			state: {
				mode: 'edit',
				slot: 'window-url',
				panePath: '/tmp/project',
			},
			url: 'https://example.test/new',
			hostUrlSubmitInFlightRef: inFlightRef,
			hostUrlSubmitRequestId: requestId,
			runHostBrowserCommand: () => {
				const save = saves.shift();
				if (!save) throw new Error('missing save request');
				return save;
			},
			openAndroidUrl: async () => {
				throw new Error('should not open in edit mode');
			},
			setHostUrlModalState: (state) => {
				closed.push(state);
			},
			setHostUrlModalSubmitting: () => {},
			setHostUrlModalError: (message) => errors.push(message),
			showError: (report) => reports.push(report),
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);
	assert.equal(inFlightRef.current, true);

	firstSave.resolve('');
	await firstSave.promise;
	await Promise.resolve();
	assert.equal(inFlightRef.current, true);
	assert.deepEqual(closed, []);

	secondSave.resolve('');
	await secondSave.promise;
	await Promise.resolve();
	assert.equal(inFlightRef.current, false);
	assert.deepEqual(closed, [null]);
	assert.deepEqual(errors, [null, null]);
	assert.deepEqual(reports, []);
});

void test('stale host URL submit rejection does not report old failure', async () => {
	let currentId = 0;
	const nextIds = [1, 3];
	const requestId: RequestIdHandle = {
		next: () => {
			const next = nextIds.shift();
			if (next == null) throw new Error('missing next request id');
			currentId = next;
			return next;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const inFlightRef = { current: false };
	const firstSave = deferred<string>();
	const secondSave = deferred<string>();
	const saves = [firstSave.promise, secondSave.promise];
	const closed: null[] = [];
	const errors: (string | null)[] = [];
	const reports: unknown[] = [];

	const runRequest = (url: string) =>
		runHostUrlSubmitRequest({
			state: {
				mode: 'edit',
				slot: 'window-url',
				panePath: '/tmp/project',
			},
			url,
			hostUrlSubmitInFlightRef: inFlightRef,
			hostUrlSubmitRequestId: requestId,
			runHostBrowserCommand: () => {
				const save = saves.shift();
				if (!save) throw new Error('missing save request');
				return save;
			},
			openAndroidUrl: async () => {
				throw new Error('should not open in edit mode');
			},
			setHostUrlModalState: (state) => {
				closed.push(state);
			},
			setHostUrlModalSubmitting: () => {},
			setHostUrlModalError: (message) => errors.push(message),
			showError: (report) => reports.push(report),
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		});

	assert.equal(runRequest('https://example.test/old'), true);
	requestId.invalidate();
	inFlightRef.current = false;
	assert.equal(runRequest('https://example.test/new'), true);

	firstSave.reject(new Error('old save failed'));
	await firstSave.promise.catch(() => {});
	await Promise.resolve();
	assert.equal(inFlightRef.current, true);
	assert.deepEqual(closed, []);
	assert.deepEqual(reports, []);

	secondSave.resolve('');
	await secondSave.promise;
	await Promise.resolve();
	assert.equal(inFlightRef.current, false);
	assert.deepEqual(closed, [null]);
	assert.deepEqual(errors, [null, null]);
	assert.deepEqual(reports, []);
});

void test('browser action cleanup suppresses pending host URL submit completion', async () => {
	let currentId = 0;
	const requestId: RequestIdHandle = {
		next: () => {
			currentId += 1;
			return currentId;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const inFlightRef = { current: false };
	const save = deferred<string>();
	const closed: null[] = [];
	const errors: (string | null)[] = [];
	const reports: unknown[] = [];

	assert.equal(
		runHostUrlSubmitRequest({
			state: {
				mode: 'edit',
				slot: 'window-url',
				panePath: '/tmp/project',
			},
			url: 'https://example.test/',
			hostUrlSubmitInFlightRef: inFlightRef,
			hostUrlSubmitRequestId: requestId,
			runHostBrowserCommand: () => save.promise,
			openAndroidUrl: async () => {
				throw new Error('should not open in edit mode');
			},
			setHostUrlModalState: (state) => {
				closed.push(state);
			},
			setHostUrlModalSubmitting: () => {},
			setHostUrlModalError: (message) => errors.push(message),
			showError: (report) => reports.push(report),
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);
	assert.equal(inFlightRef.current, true);

	cleanupBrowserActionRequests({
		hostUrlReadRequestId: requestId,
		hostUrlSubmitRequestId: requestId,
		hostUrlSubmitInFlightRef: inFlightRef,
		browserGitHubTargetRequestId: requestId,
		hostDiffityRequestId: requestId,
		hostDiffityInFlightRef: { current: true },
		hostDetectedOpenRequestId: requestId,
		hostDetectedOpenInFlightRef: { current: true },
	});
	assert.equal(inFlightRef.current, false);

	save.resolve('');
	await save.promise;
	await Promise.resolve();
	assert.deepEqual(closed, []);
	assert.deepEqual(errors, [null]);
	assert.deepEqual(reports, []);
	assert.equal(inFlightRef.current, false);
});

void test('host URL submit request reports command failures as save failures', async () => {
	let currentId = 0;
	const requestId: RequestIdHandle = {
		next: () => {
			currentId += 1;
			return currentId;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const inFlightRef = { current: false };
	const reports: {
		action: string;
		title: string;
		message: string;
		panePath?: string;
		url?: string;
	}[] = [];
	const errors: (string | null)[] = [];
	let openCalled = false;

	assert.equal(
		runHostUrlSubmitRequest({
			state: {
				mode: 'open-missing',
				slot: 'window-url',
				panePath: '/tmp/project',
			},
			url: 'https://example.test/',
			hostUrlSubmitInFlightRef: inFlightRef,
			hostUrlSubmitRequestId: requestId,
			runHostBrowserCommand: async () => {
				throw new Error('tmux config set failed');
			},
			openAndroidUrl: async () => {
				openCalled = true;
			},
			setHostUrlModalState: () => {
				throw new Error('modal should remain open on failure');
			},
			setHostUrlModalSubmitting: () => {},
			setHostUrlModalError: (message) => errors.push(message),
			showError: (report) => reports.push(report),
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);

	await new Promise((resolve) => setTimeout(resolve, 0));

	assert.equal(openCalled, false);
	assert.equal(inFlightRef.current, false);
	assert.deepEqual(errors, [null, 'tmux config set failed']);
	assert.deepEqual(reports, [
		{
			action: 'URL',
			title: 'Save URL failed',
			message: 'tmux config set failed',
			panePath: '/tmp/project',
			command: buildTmuxWindowConfigSetCommand(
				'window-url',
				'/tmp/project',
				'https://example.test/',
			),
			url: 'https://example.test/',
		},
	]);
});

void test('stale Diffity completion does not clear newer in-flight request', async () => {
	let currentId = 0;
	const nextIds = [1, 3];
	const requestId: RequestIdHandle = {
		next: () => {
			const next = nextIds.shift();
			if (next == null) throw new Error('missing next request id');
			currentId = next;
			return next;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const inFlightRef = { current: false };
	const firstShare = deferred<HostDiffityShareResult>();
	const secondShare = deferred<HostDiffityShareResult>();
	const shares = [firstShare.promise, secondShare.promise];
	const openedUrls: string[] = [];
	const errors: HostDiffityOpenErrorReport[] = [];

	assert.equal(
		runHostDiffityOpenRequest({
			hostDiffityInFlightRef: inFlightRef,
			hostDiffityRequestId: requestId,
			runDiffityShare: () => {
				const share = shares.shift();
				if (!share) throw new Error('missing Diffity share request');
				return share;
			},
			openAndroidUrl: async (url) => {
				openedUrls.push(url);
			},
			showError: (title, message) => {
				throw new Error(
					`legacy error callback should not run: ${title} ${message}`,
				);
			},
			showErrorReport: (report) => {
				errors.push(report);
			},
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);
	assert.equal(inFlightRef.current, true);

	requestId.invalidate();
	inFlightRef.current = false;
	assert.equal(
		runHostDiffityOpenRequest({
			hostDiffityInFlightRef: inFlightRef,
			hostDiffityRequestId: requestId,
			runDiffityShare: () => {
				const share = shares.shift();
				if (!share) throw new Error('missing Diffity share request');
				return share;
			},
			openAndroidUrl: async (url) => {
				openedUrls.push(url);
			},
			showError: (title, message) => {
				throw new Error(
					`legacy error callback should not run: ${title} ${message}`,
				);
			},
			showErrorReport: (report) => {
				errors.push(report);
			},
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);
	assert.equal(inFlightRef.current, true);

	firstShare.resolve({ output: 'https://diffity.example/old' });
	await firstShare.promise;
	await Promise.resolve();
	assert.equal(inFlightRef.current, true);
	assert.deepEqual(openedUrls, []);

	secondShare.resolve({ output: 'https://diffity.example/new' });
	await secondShare.promise;
	await Promise.resolve();
	assert.equal(inFlightRef.current, false);
	assert.deepEqual(openedUrls, ['https://diffity.example/new']);
	assert.deepEqual(errors, []);
});

void test('Diffity open request accepts legacy string output and two-argument errors', async () => {
	let currentId = 0;
	const requestId: RequestIdHandle = {
		next: () => {
			currentId += 1;
			return currentId;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const inFlightRef = { current: false };
	const errors: string[] = [];

	assert.equal(
		runHostDiffityOpenRequest({
			hostDiffityInFlightRef: inFlightRef,
			hostDiffityRequestId: requestId,
			runDiffityShare: async () => 'no url here',
			openAndroidUrl: async () => {
				throw new Error('should not open');
			},
			showError: (title, message) => {
				errors.push(`${title}: ${message}`);
			},
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);

	await Promise.resolve();
	await Promise.resolve();
	assert.deepEqual(errors, ['Diffity failed: no url here']);
});

void test('browser action cleanup suppresses pending Diffity completion', async () => {
	let currentId = 0;
	const requestId: RequestIdHandle = {
		next: () => {
			currentId += 1;
			return currentId;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const inFlightRef = { current: false };
	const share = deferred<HostDiffityShareResult>();
	const openedUrls: string[] = [];
	const errors: HostDiffityOpenErrorReport[] = [];

	assert.equal(
		runHostDiffityOpenRequest({
			hostDiffityInFlightRef: inFlightRef,
			hostDiffityRequestId: requestId,
			runDiffityShare: () => share.promise,
			openAndroidUrl: async (url) => {
				openedUrls.push(url);
			},
			showError: (title, message) => {
				throw new Error(
					`legacy error callback should not run: ${title} ${message}`,
				);
			},
			showErrorReport: (report) => {
				errors.push(report);
			},
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);
	assert.equal(inFlightRef.current, true);

	cleanupBrowserActionRequests({
		hostUrlReadRequestId: requestId,
		hostUrlSubmitRequestId: requestId,
		hostUrlSubmitInFlightRef: { current: true },
		browserGitHubTargetRequestId: requestId,
		hostDiffityRequestId: requestId,
		hostDiffityInFlightRef: inFlightRef,
		hostDetectedOpenRequestId: requestId,
		hostDetectedOpenInFlightRef: { current: true },
	});
	assert.equal(inFlightRef.current, false);

	share.resolve({ output: 'https://diffity.example/backgrounded' });
	await share.promise;
	await Promise.resolve();
	assert.deepEqual(openedUrls, []);
	assert.deepEqual(errors, []);
	assert.equal(inFlightRef.current, false);
});

void test('current Diffity request reports missing HTTPS URL output with command context', async () => {
	let currentId = 0;
	const requestId: RequestIdHandle = {
		next: () => {
			currentId += 1;
			return currentId;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const inFlightRef = { current: false };
	const errors: HostDiffityOpenErrorReport[] = [];

	const shareResult: HostDiffityShareResult = {
		output: 'no url here',
		panePath: '/tmp/project',
		command: "cd '/tmp/project' && mdev diffity share",
	};

	assert.equal(
		runHostDiffityOpenRequest({
			hostDiffityInFlightRef: inFlightRef,
			hostDiffityRequestId: requestId,
			runDiffityShare: async () => shareResult,
			openAndroidUrl: async () => {
				throw new Error('should not open');
			},
			showError: (title, message) => {
				throw new Error(
					`legacy error callback should not run: ${title} ${message}`,
				);
			},
			showErrorReport: (report) => {
				errors.push(report);
			},
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);

	await Promise.resolve();
	await Promise.resolve();
	assert.equal(inFlightRef.current, false);
	assert.deepEqual(errors, [
		{
			title: 'Diffity failed',
			message: 'no url here',
			panePath: '/tmp/project',
			command: "cd '/tmp/project' && mdev diffity share",
			output: 'no url here',
		},
	]);
});

void test('current Diffity request reports empty output fallback message', async () => {
	let currentId = 0;
	const requestId: RequestIdHandle = {
		next: () => {
			currentId += 1;
			return currentId;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const inFlightRef = { current: false };
	const errors: HostDiffityOpenErrorReport[] = [];

	assert.equal(
		runHostDiffityOpenRequest({
			hostDiffityInFlightRef: inFlightRef,
			hostDiffityRequestId: requestId,
			runDiffityShare: async () => ({
				output: '',
				panePath: '/tmp/project',
				command: "cd '/tmp/project' && mdev diffity share",
			}),
			openAndroidUrl: async () => {
				throw new Error('should not open');
			},
			showError: (title, message) => {
				throw new Error(
					`legacy error callback should not run: ${title} ${message}`,
				);
			},
			showErrorReport: (report) => {
				errors.push(report);
			},
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);

	await Promise.resolve();
	await Promise.resolve();
	assert.deepEqual(errors, [
		{
			title: 'Diffity failed',
			message: 'mdev diffity share did not return an HTTPS URL.',
			panePath: '/tmp/project',
			command: "cd '/tmp/project' && mdev diffity share",
			output: '',
		},
	]);
});

void test('current Diffity request reports Android URL open failures with extracted URL', async () => {
	let currentId = 0;
	const requestId: RequestIdHandle = {
		next: () => {
			currentId += 1;
			return currentId;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const inFlightRef = { current: false };
	const errors: HostDiffityOpenErrorReport[] = [];

	assert.equal(
		runHostDiffityOpenRequest({
			hostDiffityInFlightRef: inFlightRef,
			hostDiffityRequestId: requestId,
			runDiffityShare: async () => ({
				output: 'created https://diffity.example/current',
				panePath: '/tmp/project',
				command: "cd '/tmp/project' && mdev diffity share",
			}),
			openAndroidUrl: async () => {
				throw new Error('cannot open URL');
			},
			showError: (title, message) => {
				throw new Error(
					`legacy error callback should not run: ${title} ${message}`,
				);
			},
			showErrorReport: (report) => {
				errors.push(report);
			},
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);

	await Promise.resolve();
	await Promise.resolve();
	assert.equal(inFlightRef.current, false);
	assert.deepEqual(errors, [
		{
			title: 'Diffity failed',
			message: 'cannot open URL',
			panePath: '/tmp/project',
			command: "cd '/tmp/project' && mdev diffity share",
			output: 'created https://diffity.example/current',
			url: 'https://diffity.example/current',
		},
	]);
});

void test('current Diffity request reports command rejection with command context', async () => {
	let currentId = 0;
	const requestId: RequestIdHandle = {
		next: () => {
			currentId += 1;
			return currentId;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const inFlightRef = { current: false };
	const errors: HostDiffityOpenErrorReport[] = [];

	assert.equal(
		runHostDiffityOpenRequest({
			hostDiffityInFlightRef: inFlightRef,
			hostDiffityRequestId: requestId,
			runDiffityShare: async () => {
				throw new HostDiffityShareError({
					message: 'remote command failed',
					panePath: '/tmp/project',
					command: "cd '/tmp/project' && mdev diffity share",
					cause: new Error('remote command failed'),
				});
			},
			openAndroidUrl: async () => {
				throw new Error('should not open');
			},
			showError: (title, message) => {
				throw new Error(
					`legacy error callback should not run: ${title} ${message}`,
				);
			},
			showErrorReport: (report) => {
				errors.push(report);
			},
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);

	await Promise.resolve();
	await Promise.resolve();
	assert.equal(inFlightRef.current, false);
	assert.deepEqual(errors, [
		{
			title: 'Diffity failed',
			message: 'remote command failed',
			panePath: '/tmp/project',
			command: "cd '/tmp/project' && mdev diffity share",
		},
	]);
});
