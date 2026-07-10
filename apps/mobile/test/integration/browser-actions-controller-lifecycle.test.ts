import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserActionsControllerCore } from '../../src/lib/shell-controllers/browser-actions-core';
import {
	createBrowserActionsControllerLifecycle,
	syncBrowserActionsControllerSource,
} from '../../src/lib/shell-controllers/browser-actions-lifecycle';
import {
	createShellTargetKey,
	createShellTransportKey,
} from '../../src/lib/shell-controllers/source-keys';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((onResolve) => {
		resolve = onResolve;
	});
	return { promise, resolve };
}

void test('tmux-only dependency change invalidates stale browser work once', async () => {
	const repository = deferred<string>();
	const openedUrls: string[] = [];
	const sourceKey = createShellTargetKey(
		createShellTransportKey('conn', 7),
		'main',
	);
	let tmuxEnabled = true;
	const core = createBrowserActionsControllerCore({
		initialSourceKey: sourceKey,
		requestOpen: (onOpen) => {
			onOpen();
			return true;
		},
		getTmuxEnabled: () => tmuxEnabled,
		getTmuxTarget: () => 'main',
		runHostBrowserCommand: async (command) =>
			command.includes('git remote get-url') ? repository.promise : '',
		runWorkmuxCommand: async () =>
			JSON.stringify({
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
			}),
		openAndroidUrl: async (url) => {
			openedUrls.push(url);
		},
		showError: () => {},
		getErrorMessage: String,
	});
	const committed = { current: { sourceKey, tmuxEnabled } };
	const tracked = { current: { sourceKey, tmuxEnabled } };
	const pending = core.openGitHubTarget('issues');

	tmuxEnabled = false;
	syncBrowserActionsControllerSource({
		committedDependencies: committed,
		trackedSource: tracked,
		dependencies: { sourceKey, tmuxEnabled },
		core,
	});
	repository.resolve('mulyoved/fressh');
	await pending;

	assert.deepEqual(openedUrls, []);
	assert.deepEqual(committed.current, { sourceKey, tmuxEnabled: false });
});

void test('source synchronization avoids a second invalidation when target key changed', () => {
	const firstKey = createShellTargetKey(
		createShellTransportKey('conn', 7),
		'main',
	);
	const secondKey = createShellTargetKey(
		createShellTransportKey('conn', 7),
		'other',
	);
	const events: string[] = [];
	const dependencies = { sourceKey: secondKey, tmuxEnabled: false };

	syncBrowserActionsControllerSource({
		committedDependencies: {
			current: { sourceKey: firstKey, tmuxEnabled: true },
		},
		trackedSource: {
			current: { sourceKey: firstKey, tmuxEnabled: true },
		},
		dependencies,
		core: {
			setSourceKey: () => events.push('set-source'),
			invalidate: () => events.push('invalidate'),
		},
	});

	assert.deepEqual(events, ['set-source']);
});

void test('browser lifecycle invalidates synchronously and defers replay-safe disposal', () => {
	const events: string[] = [];
	const queued: (() => void)[] = [];
	let continuationCurrent = true;
	let continuationSideEffects = 0;
	const lifecycle = createBrowserActionsControllerLifecycle(
		{
			invalidate: () => {
				continuationCurrent = false;
				events.push('invalidate');
			},
			dispose: () => events.push('dispose'),
		},
		(task) => queued.push(task),
	);

	const firstCleanup = lifecycle.setup();
	firstCleanup();
	if (continuationCurrent) continuationSideEffects += 1;
	assert.deepEqual(events, ['invalidate']);
	assert.equal(continuationSideEffects, 0);
	const secondCleanup = lifecycle.setup();
	queued.shift()?.();
	assert.deepEqual(events, ['invalidate']);
	secondCleanup();
	assert.deepEqual(events, ['invalidate', 'invalidate']);
	queued.shift()?.();
	assert.deepEqual(events, ['invalidate', 'invalidate', 'dispose']);
});
