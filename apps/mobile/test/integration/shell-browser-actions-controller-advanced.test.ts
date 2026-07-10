import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserActionsControllerAdapter } from '../../src/lib/shell-controllers/browser-actions-adapter';
import { createBrowserActionsControllerCore } from '../../src/lib/shell-controllers/browser-actions-core';
import { createShellModalArbiter } from '../../src/lib/shell-controllers/modal-arbiter';
import {
	createShellTargetKey,
	createShellTransportKey,
} from '../../src/lib/shell-controllers/source-keys';

type Deferred<T> = {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
};

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

const workmuxContext = JSON.stringify({
	sessionName: 'main',
	target: 'main:@1',
	windowId: '@1',
	windowIndex: 1,
	windowName: 'shell',
	workspaceId: 'workspace-1',
	role: 'codex',
	roleWindow: true,
	homeWindow: false,
	paneId: '%1',
	paneTty: '/dev/pts/1',
	panePath: '/repo',
	projectRoot: '/repo',
	projectName: 'repo',
});

const sourceKey = createShellTargetKey(
	createShellTransportKey('conn', 7),
	'main',
);

async function settled(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
}

void test('GitHub overlap keeps completion promises bound to their own platform opens', async () => {
	const platformOpens: { url: string; deferred: Deferred<void> }[] = [];
	const core = createBrowserActionsControllerCore({
		initialSourceKey: sourceKey,
		requestOpen: (onOpen) => {
			onOpen();
			return true;
		},
		getTmuxEnabled: () => true,
		getTmuxTarget: () => 'main',
		runHostBrowserCommand: async (command) =>
			command.includes('git remote get-url') ? 'mulyoved/fressh' : '',
		runWorkmuxCommand: async () => workmuxContext,
		openAndroidUrl: (url) => {
			const pending = deferred<void>();
			platformOpens.push({ url, deferred: pending });
			return pending.promise;
		},
		showError: () => {},
		getErrorMessage: String,
	});

	const first = core.openGitHubTarget('issues');
	await settled();
	const second = core.openGitHubTarget('pulls');
	await settled();
	let secondSettled = false;
	void second.then(() => {
		secondSettled = true;
	});

	assert.deepEqual(
		platformOpens.map(({ url }) => url),
		[
			'https://github.com/mulyoved/fressh/issues',
			'https://github.com/mulyoved/fressh/pulls',
		],
	);
	await first;
	platformOpens[0]!.deferred.resolve();
	await settled();
	assert.equal(secondSettled, false);
	platformOpens[1]!.deferred.resolve();
	await second;
});

void test('Diffity overlap keeps completion promises bound across invalidation', async () => {
	const platformOpens: Deferred<void>[] = [];
	const core = createBrowserActionsControllerCore({
		initialSourceKey: sourceKey,
		requestOpen: (onOpen) => {
			onOpen();
			return true;
		},
		getTmuxEnabled: () => true,
		getTmuxTarget: () => 'main',
		runHostBrowserCommand: async (command) =>
			command.includes('mdev diffity share')
				? 'https://diffity.test/share'
				: '',
		runWorkmuxCommand: async () => workmuxContext,
		openAndroidUrl: () => {
			const pending = deferred<void>();
			platformOpens.push(pending);
			return pending.promise;
		},
		showError: () => {},
		getErrorMessage: String,
	});

	const first = core.openDiffity();
	await settled();
	core.invalidate('focus-lost');
	const second = core.openDiffity();
	await settled();
	let secondSettled = false;
	void second.then(() => {
		secondSettled = true;
	});

	assert.equal(platformOpens.length, 2);
	await first;
	platformOpens[0]!.resolve();
	await settled();
	assert.equal(secondSettled, false);
	platformOpens[1]!.resolve();
	await second;
});

void test('Diffity does not dispatch share after invalidation between context and command', async () => {
	const context = deferred<string>();
	const hostCommands: string[] = [];
	const core = createBrowserActionsControllerCore({
		initialSourceKey: sourceKey,
		requestOpen: (onOpen) => {
			onOpen();
			return true;
		},
		getTmuxEnabled: () => true,
		getTmuxTarget: () => 'main',
		runHostBrowserCommand: async (command) => {
			hostCommands.push(command);
			return 'https://diffity.test/share';
		},
		runWorkmuxCommand: async () => context.promise,
		openAndroidUrl: async () => {},
		showError: () => {},
		getErrorMessage: String,
	});

	const pending = core.openDiffity();
	context.resolve(workmuxContext);
	queueMicrotask(() => core.invalidate('focus-lost'));
	await pending;

	assert.deepEqual(hostCommands, []);
});

const detectedCandidate = {
	kind: 'remote-url' as const,
	raw: 'https://detected.test/app',
	normalized: 'https://detected.test/app',
	display: 'Detected app',
	path: null,
	line: null,
	url: 'https://detected.test/app',
};

function createFunctionalCore(input?: {
	getValues?: string[];
	failOpenUrl?: string;
	failSave?: boolean;
}) {
	const hostCommands: { command: string; timeoutMs: number }[] = [];
	const openedUrls: string[] = [];
	const errors: unknown[] = [];
	const getValues = [...(input?.getValues ?? [])];
	const core = createBrowserActionsControllerCore({
		initialSourceKey: sourceKey,
		requestOpen: (onOpen) => {
			onOpen();
			return true;
		},
		getTmuxEnabled: () => true,
		getTmuxTarget: () => 'main',
		runHostBrowserCommand: async (command, timeoutMs) => {
			hostCommands.push({ command, timeoutMs });
			if (command.includes('git remote get-url')) {
				return 'git@github.com:mulyoved/fressh.git';
			}
			if (command.includes('mdev diffity share')) {
				return 'shared at https://diffity.test/share';
			}
			if (command.includes('mdev open detect --json')) {
				return JSON.stringify([detectedCandidate]);
			}
			if (command.includes('mdev open auto --print-url')) {
				return 'https://auto.test/app';
			}
			if (command.includes('mdev open bridge --print-url')) {
				return 'https://bridge.test/app';
			}
			if (command.includes('mdev tmux url get')) return getValues.shift() ?? '';
			if (command.includes('mdev tmux url set-value')) {
				if (input?.failSave) throw new Error('remote save failed');
				return '';
			}
			return '';
		},
		runWorkmuxCommand: async () => workmuxContext,
		openAndroidUrl: async (url) => {
			if (url === input?.failOpenUrl) throw new Error('platform refused URL');
			openedUrls.push(url);
		},
		showError: (error) => errors.push(error),
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});
	return { core, hostCommands, openedUrls, errors };
}

void test('public browser commands wire GitHub, Diffity, detected auto and picker selection', async () => {
	const harness = createFunctionalCore();
	harness.core.open();
	assert.equal(harness.core.getSnapshot().open, true);

	await harness.core.openGitHubTarget('issues');
	await harness.core.openGitHubTarget('pulls');
	await harness.core.openDiffity();
	assert.equal(harness.core.openDetected('auto'), true);
	await settled();
	assert.equal(harness.core.openDetected('pick'), true);
	await settled();
	assert.deepEqual(harness.core.getSnapshot().detectedOpenPicker?.candidates, [
		detectedCandidate,
	]);
	await harness.core.selectDetected(detectedCandidate);
	assert.equal(harness.core.getSnapshot().detectedOpenPicker, null);

	assert.deepEqual(harness.openedUrls, [
		'https://github.com/mulyoved/fressh/issues',
		'https://github.com/mulyoved/fressh/pulls',
		'https://diffity.test/share',
		'https://auto.test/app',
		'https://bridge.test/app',
	]);
	assert.deepEqual(harness.errors, []);
	assert.equal(harness.core.openDetected('pick'), true);
	await settled();
	harness.core.closeDetectedPicker();
	assert.equal(harness.core.getSnapshot().detectedOpenPicker, null);
});

void test('public host URL commands cover open, edit, empty, invalid and save success', async () => {
	const harness = createFunctionalCore({
		getValues: [
			'https://saved.test',
			'https://old.test',
			'https://old.test',
			'https://old.test',
		],
	});

	harness.core.openUrlSlot('window-url');
	await settled();
	assert.deepEqual(harness.openedUrls, ['https://saved.test/']);

	harness.core.editUrlSlot('window-url');
	await settled();
	assert.equal(
		harness.core.getSnapshot().hostUrl?.initialValue,
		'https://old.test',
	);
	harness.core.submitHostUrl('   ');
	assert.equal(harness.core.getSnapshot().hostUrl, null);

	harness.core.editUrlSlot('window-url');
	await settled();
	harness.core.submitHostUrl('ftp://invalid.test');
	assert.match(harness.core.getSnapshot().hostUrlError ?? '', /http/i);

	harness.core.closeHostUrl();
	harness.core.editUrlSlot('window-url');
	await settled();
	harness.core.submitHostUrl('https://new.test/path');
	await settled();
	assert.equal(harness.core.getSnapshot().hostUrl, null);
	assert.equal(harness.core.getSnapshot().hostUrlSubmitting, false);
	assert.deepEqual(harness.errors, []);
	assert.equal(
		harness.hostCommands.filter(({ command }) =>
			command.includes('mdev tmux url set-value'),
		).length,
		1,
	);
});

void test('host URL open-after-save failure retains metadata and clears in-flight state', async () => {
	const harness = createFunctionalCore({
		getValues: [''],
		failOpenUrl: 'https://new.test/',
	});
	harness.core.openUrlSlot('window-url');
	await settled();
	assert.equal(harness.core.getSnapshot().hostUrl?.mode, 'open-missing');
	harness.core.submitHostUrl('https://new.test');
	assert.equal(harness.core.getSnapshot().hostUrlSubmitting, true);
	await settled();

	assert.equal(harness.core.getSnapshot().hostUrlSubmitting, false);
	assert.equal(harness.core.getSnapshot().hostUrlError, 'platform refused URL');
	assert.deepEqual(harness.errors, [
		{
			action: 'URL',
			title: 'Open URL failed',
			message: 'platform refused URL',
			panePath: '/repo',
			command:
				"TMUX_PANE_PATH='/repo' mdev tmux url set-value 'window-url' 'https://new.test/'",
			url: 'https://new.test/',
		},
	]);
	assert.equal(harness.core.closeHostUrl(), true);
});

void test('host URL save failure reports command context and clears in-flight state', async () => {
	const harness = createFunctionalCore({
		getValues: ['https://old.test'],
		failSave: true,
	});
	harness.core.editUrlSlot('window-url');
	await settled();
	harness.core.submitHostUrl('https://new.test');
	await settled();

	assert.equal(harness.core.getSnapshot().hostUrlSubmitting, false);
	assert.equal(harness.core.getSnapshot().hostUrlError, 'remote save failed');
	assert.deepEqual(harness.errors, [
		{
			action: 'URL',
			title: 'Save URL failed',
			message: 'remote save failed',
			panePath: '/repo',
			command:
				"TMUX_PANE_PATH='/repo' mdev tmux url set-value 'window-url' 'https://new.test/'",
			url: 'https://new.test/',
		},
	]);
});

void test('public resolvers use the real adapter and current committed dependencies', async () => {
	type Connection = { id: string };
	const arbiter = createShellModalArbiter();
	const sideCalls: unknown[][] = [];
	const workmuxCalls: unknown[][] = [];
	const reports: { error: unknown; context: unknown }[] = [];
	let failRepository = false;
	let dependencies = {
		connection: null as Connection | null,
		tmuxEnabled: true,
		tmuxTarget: 'main',
		sourceKey,
		executeSideChannelCommand: async (
			connection: Connection,
			command: string,
			timeoutMs: number,
		) => {
			sideCalls.push([connection.id, command, timeoutMs]);
			if (command.includes('git remote get-url') && failRepository) {
				return { success: false, output: '', error: 'remote denied' };
			}
			if (command.includes('git remote get-url')) {
				return { success: true, output: 'git@github.com:mulyoved/fressh.git' };
			}
			if (command === 'fail') {
				return { success: false, output: '', error: 'remote denied' };
			}
			return { success: true, output: '  side output  ' };
		},
		runWorkmuxCommand: async (
			connection: Connection,
			argv: string[],
			timeoutMs: number,
		) => {
			workmuxCalls.push([connection.id, argv, timeoutMs]);
			return workmuxContext;
		},
		getErrorMessage: (error: unknown) =>
			error instanceof Error ? `converted: ${error.message}` : String(error),
		arbiter,
	};
	const adapter = createBrowserActionsControllerAdapter({
		getCommittedDependencies: () => dependencies,
		openAndroidUrl: async () => {},
		showError: (error, context) => reports.push({ error, context }),
	});
	const core = createBrowserActionsControllerCore({
		initialSourceKey: sourceKey,
		requestOpen: adapter.requestOpen,
		getTmuxEnabled: adapter.getTmuxEnabled,
		getTmuxTarget: adapter.getTmuxTarget,
		runHostBrowserCommand: adapter.runHostBrowserCommand,
		runWorkmuxCommand: adapter.runWorkmuxCommand,
		openAndroidUrl: adapter.openAndroidUrl,
		showError: adapter.showError,
		getErrorMessage: adapter.getErrorMessage,
	});

	await assert.rejects(
		core.runHostBrowserCommand('pwd'),
		/No SSH connection available/,
	);
	dependencies = { ...dependencies, connection: { id: 'current' } };
	assert.equal(await core.runHostBrowserCommand('pwd'), 'side output');
	assert.equal(await core.runHostBrowserCommand('pwd', 1234), 'side output');
	assert.equal(
		await core.runHostBrowserCommand(
			"mdev tmux app context --session 'main'",
			4321,
		),
		workmuxContext,
	);
	assert.deepEqual(await core.resolvePaneContext(), {
		paneId: '%1',
		paneTty: '/dev/pts/1',
		panePath: '/repo',
	});
	assert.equal(await core.resolvePanePath(), '/repo');
	assert.deepEqual(await core.resolveWorkspace(), {
		panePath: '/repo',
		projectRoot: '/repo',
		projectName: 'repo',
	});
	assert.equal(await core.resolveCurrentGitHubRepository(), 'mulyoved/fressh');
	await assert.rejects(core.runHostBrowserCommand('fail'), /remote denied/);
	failRepository = true;
	dependencies = { ...dependencies, tmuxTarget: 'other' };
	await core.openGitHubTarget('issues');

	assert.deepEqual(sideCalls.slice(0, 2), [
		['current', 'pwd', 30_000],
		['current', 'pwd', 1234],
	]);
	assert.equal(workmuxCalls.length, 6);
	assert.deepEqual(workmuxCalls[0], [
		'current',
		['tmux', 'app', 'context', '--session', 'main'],
		4321,
	]);
	assert.equal(
		workmuxCalls
			.slice(1)
			.every(
				([connection, _argv, timeout]) =>
					connection === 'current' && timeout === 10_000,
			),
		true,
	);
	assert.deepEqual(workmuxCalls.at(-1)?.[1], [
		'tmux',
		'app',
		'context',
		'--session',
		'other',
	]);
	assert.equal(reports.length, 1);
	assert.deepEqual(reports[0]?.context, {
		connectionPresent: true,
		tmuxEnabled: true,
		tmuxTarget: 'other',
	});
	const reportedError = reports[0]?.error as {
		action: string;
		title: string;
		message: string;
		panePath: string;
		command: string;
	};
	assert.equal(reportedError.action, 'GitHub Issues');
	assert.equal(reportedError.title, 'GitHub Issues failed');
	assert.match(reportedError.message, /converted: .*remote denied/);
	assert.equal(reportedError.panePath, '/repo');
	assert.match(reportedError.command, /git remote get-url origin/);
});
