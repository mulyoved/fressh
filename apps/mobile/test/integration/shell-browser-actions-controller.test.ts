import assert from 'node:assert/strict';
import test from 'node:test';
import { type BrowserActionErrorInput } from '../../src/lib/shell-browser-action-error-inputs';
import { createBrowserActionsControllerAdapter } from '../../src/lib/shell-controllers/browser-actions-adapter';
import {
	createBrowserActionsControllerCore,
	type BrowserActionsControllerCore,
} from '../../src/lib/shell-controllers/browser-actions-core';
import { createShellModalArbiter } from '../../src/lib/shell-controllers/modal-arbiter';
import {
	createShellTargetKey,
	createShellTransportKey,
} from '../../src/lib/shell-controllers/source-keys';

function typedAdapterDependencies(
	arbiter: ReturnType<typeof createShellModalArbiter>,
	sourceKey: ReturnType<typeof createShellTargetKey>,
) {
	return {
		hostCommands: {
			key: sourceKey,
			run: async () => ({ status: 'completed' as const, output: '' }),
		},
		workmux: {
			key: sourceKey,
			command: async () => ({ status: 'completed' as const, output: '' }),
		},
		tmuxEnabled: true,
		tmuxTarget: 'main',
		sourceKey,
		getErrorMessage: String,
		arbiter,
	};
}

type Deferred<T> = {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
};

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

function createBrowserActionsHarness(): {
	core: BrowserActionsControllerCore;
	urlRead: Deferred<string>;
	urlSubmit: Deferred<string>;
	repository: Deferred<string>;
	openedUrls: string[];
	errors: BrowserActionErrorInput[];
	settled(): Promise<void>;
} {
	const urlRead = createDeferred<string>();
	const urlSubmit = createDeferred<string>();
	const repository = createDeferred<string>();
	const openedUrls: string[] = [];
	const errors: BrowserActionErrorInput[] = [];
	const initialSourceKey = createShellTargetKey(
		createShellTransportKey('conn', 7),
		'main',
	);

	const core = createBrowserActionsControllerCore({
		initialSourceKey,
		requestOpen: (onOpen) => {
			onOpen();
			return true;
		},
		getTmuxEnabled: () => true,
		getTmuxTarget: () => 'main',
		runHostBrowserCommand: async (command) => {
			if (command.includes('mdev tmux url get')) return urlRead.promise;
			if (command.includes('mdev tmux url set-value')) {
				return urlSubmit.promise;
			}
			if (command.includes('git remote get-url')) return repository.promise;
			return '';
		},
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
		showError: (input) => {
			errors.push(input);
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	return {
		core,
		urlRead,
		urlSubmit,
		repository,
		openedUrls,
		errors,
		settled: async () => {
			await new Promise<void>((resolve) => setImmediate(resolve));
		},
	};
}

void test('browser controller source change clears all request-owned UI', async () => {
	const harness = createBrowserActionsHarness();
	harness.core.open();
	harness.core.editUrlSlot('window-url');
	harness.urlRead.resolve('https://example.test');
	await harness.settled();
	assert.deepEqual(harness.core.getSnapshot().hostUrl, {
		mode: 'edit',
		slot: 'window-url',
		panePath: '/repo',
		initialValue: 'https://example.test',
	});
	harness.core.setSourceKey(
		createShellTargetKey(createShellTransportKey('conn', 7), 'other'),
	);
	const state = harness.core.getSnapshot();
	assert.equal(state.open, false);
	assert.equal(state.hostUrl, null);
	assert.equal(state.detectedOpenPicker, null);
});

void test('browser controller does not open URL after invalidation', async () => {
	const harness = createBrowserActionsHarness();
	const pending = harness.core.openGitHubTarget('issues');
	harness.core.invalidate('focus-lost');
	harness.repository.resolve('git@github.com:mulyoved/fressh.git');
	await pending;
	assert.deepEqual(harness.openedUrls, []);
	assert.deepEqual(harness.errors, []);
});

void test('browser controller vetoes host URL close while submit is active', async () => {
	const harness = createBrowserActionsHarness();
	harness.core.editUrlSlot('window-url');
	harness.urlRead.resolve('https://old.example.test');
	await harness.settled();

	harness.core.submitHostUrl('https://new.example.test');
	assert.equal(harness.core.closeHostUrl(), false);
	harness.urlSubmit.resolve('');
	await harness.settled();
	assert.equal(harness.core.closeHostUrl(), true);
});

void test('browser adapter preserves modal conflict order', () => {
	const arbiter = createShellModalArbiter();
	const events: string[] = [];
	const sourceKey = createShellTargetKey(
		createShellTransportKey('conn', 7),
		'main',
	);
	for (const id of [
		'command-menu',
		'commander',
		'skill-selector',
		'text-entry',
		'configure',
		'feature-request',
	] as const) {
		arbiter.register(id, () => {
			events.push(`close:${id}`);
		});
	}
	const adapter = createBrowserActionsControllerAdapter({
		getCommittedDependencies: () =>
			typedAdapterDependencies(arbiter, sourceKey),
		openAndroidUrl: async () => {},
		showError: () => {},
	});

	assert.equal(
		adapter.requestOpen(() => events.push('open:browser-actions')),
		true,
	);
	assert.deepEqual(events, [
		'close:command-menu',
		'close:commander',
		'close:skill-selector',
		'close:text-entry',
		'close:configure',
		'close:feature-request',
		'open:browser-actions',
	]);
});

void test('browser adapter invalidates URL reads for matching modal transitions', () => {
	const arbiter = createShellModalArbiter();
	const events: string[] = [];
	const sourceKey = createShellTargetKey(
		createShellTransportKey('conn', 7),
		'main',
	);
	const adapter = createBrowserActionsControllerAdapter({
		getCommittedDependencies: () =>
			typedAdapterDependencies(arbiter, sourceKey),
		openAndroidUrl: async () => {},
		showError: () => {},
	});
	adapter.registerClose({
		invalidateHostUrlReads: () => events.push('invalidate:url-read'),
		closeHostUrl: () => true,
		closeDetectedPicker: () => events.push('close:picker'),
		close: () => events.push('close:browser-actions'),
	});

	for (const target of [
		'feature-request',
		'configure',
		'text-entry',
	] as const) {
		arbiter.requestOpen({
			target,
			conflicts: ['browser-actions'],
			onOpen() {},
		});
	}
	assert.deepEqual(events, [
		'invalidate:url-read',
		'close:picker',
		'close:browser-actions',
		'invalidate:url-read',
		'close:picker',
		'close:browser-actions',
		'invalidate:url-read',
		'close:picker',
		'close:browser-actions',
	]);
});

void test('browser adapter vetoes modal arbitration while host URL submit is active', () => {
	const arbiter = createShellModalArbiter();
	const events: string[] = [];
	const sourceKey = createShellTargetKey(
		createShellTransportKey('conn', 7),
		'main',
	);
	const adapter = createBrowserActionsControllerAdapter({
		getCommittedDependencies: () =>
			typedAdapterDependencies(arbiter, sourceKey),
		openAndroidUrl: async () => {},
		showError: () => {},
	});
	adapter.registerClose({
		invalidateHostUrlReads: () => events.push('invalidate:url-read'),
		closeHostUrl: () => {
			events.push('veto:host-url');
			return false;
		},
		closeDetectedPicker: () => events.push('close:picker'),
		close: () => events.push('close:browser-actions'),
	});

	const opened = arbiter.requestOpen({
		target: 'feature-request',
		conflicts: ['browser-actions'],
		onOpen: () => events.push('open:feature-request'),
	});

	assert.equal(opened, false);
	assert.deepEqual(events, ['veto:host-url']);
});

void test('browser adapter closes child and parent state after an accepted arbitration', () => {
	const arbiter = createShellModalArbiter();
	const events: string[] = [];
	const sourceKey = createShellTargetKey(
		createShellTransportKey('conn', 7),
		'main',
	);
	const adapter = createBrowserActionsControllerAdapter({
		getCommittedDependencies: () =>
			typedAdapterDependencies(arbiter, sourceKey),
		openAndroidUrl: async () => {},
		showError: () => {},
	});
	adapter.registerClose({
		closeHostUrl: () => {
			events.push('close:host-url');
			return true;
		},
		invalidateHostUrlReads: () => events.push('invalidate:url-read'),
		closeDetectedPicker: () => events.push('close:picker'),
		close: () => events.push('close:browser-actions'),
	});

	assert.equal(
		arbiter.requestOpen({
			target: 'configure',
			conflicts: ['browser-actions'],
			onOpen: () => events.push('open:configure'),
		}),
		true,
	);
	assert.deepEqual(events, [
		'close:host-url',
		'invalidate:url-read',
		'close:picker',
		'close:browser-actions',
		'open:configure',
	]);
});
