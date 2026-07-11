import assert from 'node:assert/strict';
import test from 'node:test';
import { type ShellConfigState } from '../../src/lib/shell-config-store';
import {
	createShellKeyboardRemoteCore,
	type ShellKeyboardRemoteTargetContext,
} from '../../src/lib/shell-controllers/keyboard-remote-core';
import { type ShellKeyboardStateCore } from '../../src/lib/shell-controllers/keyboard-state-core';

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function createKeyboardRemoteHarness() {
	const command = deferred<{
		success: boolean;
		output: string;
		error?: string;
	}>();
	const reload = deferred<ShellConfigState>();
	const operation = deferred<{
		success: boolean;
		output: string;
		error?: string;
	}>();
	const alerts: { title: string; message: string }[] = [];
	const appliedConfigs: unknown[] = [];
	const restartOperations: unknown[] = [];
	const commandCalls: { argv: string[]; timeoutMs?: number }[] = [];
	const operationCalls: { timeoutMs?: number }[] = [];
	let activity = {
		focused: true,
		appActive: true,
		interactive: true,
		generation: 0,
	};
	const target = (id: string): ShellKeyboardRemoteTargetContext => ({
		targetKey: `target:${id}`,
		tmuxEnabled: true,
		sessionName: id,
		connectionId: `connection:${id}`,
		channelId: 1,
		source: `source:${id}`,
		workmuxControlChannel: {
			command: (argv, options) => {
				commandCalls.push({ argv: [...argv], timeoutMs: options?.timeoutMs });
				return command.promise;
			},
			operation: (request, options) => {
				restartOperations.push(request);
				operationCalls.push({ timeoutMs: options?.timeoutMs });
				return operation.promise;
			},
		},
	});
	const initialTarget = target('main');
	const core = createShellKeyboardRemoteCore({
		initialTargetContext: initialTarget,
		getActivitySnapshot: () => activity,
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () =>
				({
					shellConfigState: configState('current'),
				}) as ReturnType<ShellKeyboardStateCore['getSnapshot']>,
			setShellConfigState: (state) => appliedConfigs.push(state),
		},
		reloadRuntimeShellConfig: () => reload.promise,
		closeCommandMenu: () => {},
		showAlert: (title, message) => alerts.push({ title, message }),
		invalidateShellTransport: () => {},
	});
	return {
		core,
		command,
		reload,
		operation,
		alerts,
		appliedConfigs,
		restartOperations,
		commandCalls,
		operationCalls,
		target,
		initialTarget,
		setActivity(next: typeof activity) {
			activity = next;
		},
	};
}

function configState(version: string): ShellConfigState {
	return {
		config: { version },
		source: 'remote',
		lastLoadedAt: 1,
		lastError: null,
	} as unknown as ShellConfigState;
}

void test('keyboard remote core suppresses stale status failure', async () => {
	const harness = createKeyboardRemoteHarness();
	const pending = harness.core.runWorkmuxCommand({ type: 'status-cycle' });
	harness.core.invalidate('focus-lost');
	harness.command.reject(new Error('status failed'));
	assert.deepEqual(await pending, { status: 'superseded' });
	assert.deepEqual(harness.alerts, []);
});

void test('keyboard remote core handles a current Workmux command', async () => {
	const harness = createKeyboardRemoteHarness();
	const pending = harness.core.runWorkmuxCommand({
		type: 'focus',
		target: 'codex',
	});
	harness.command.resolve({ success: true, output: 'focused' });
	assert.deepEqual(await pending, { status: 'handled' });
	assert.deepEqual(harness.commandCalls, [
		{
			argv: ['tmux', 'app', 'focus', 'codex', '--session', 'main'],
			timeoutMs: 10_000,
		},
	]);
});

void test('keyboard remote core owns a current Workmux failure alert', async () => {
	const harness = createKeyboardRemoteHarness();
	const pending = harness.core.runWorkmuxCommand({ type: 'status-cycle' });
	harness.command.resolve({
		success: false,
		output: '',
		error: 'remote failed',
	});
	assert.deepEqual(await pending, { status: 'handled' });
	assert.deepEqual(harness.alerts, [
		{
			title: 'Workmux action failed',
			message: 'remote failed',
		},
	]);
});

void test('keyboard remote core instruments failed Workmux command results', async () => {
	const command = deferred<{
		success: boolean;
		output: string;
		error?: string;
	}>();
	const info: string[] = [];
	const target = createKeyboardRemoteHarness().target('main');
	target.workmuxControlChannel = {
		...target.workmuxControlChannel,
		command: () => command.promise,
	};
	const core = createShellKeyboardRemoteCore({
		initialTargetContext: target,
		getActivitySnapshot: () => ({
			focused: true,
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () =>
				({ shellConfigState: configState('current') }) as never,
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: () => {},
		invalidateShellTransport: () => {},
		logger: {
			info: (message) => info.push(message),
			warn: () => {},
		},
	});
	const pending = core.runWorkmuxCommand({ type: 'status-cycle' });
	command.resolve({ success: false, output: '', error: 'remote failed' });
	assert.deepEqual(await pending, { status: 'handled' });
	assert.deepEqual(info, [
		'Workmux keyboard command start',
		'Workmux keyboard command result',
	]);
});

void test('keyboard remote core routes current transport failure to invalidation', async () => {
	const command = deferred<{
		success: boolean;
		output: string;
		error?: string;
		failureClass?: 'timeout';
	}>();
	const invalidations: [string, number][] = [];
	const alerts: unknown[] = [];
	const target = createKeyboardRemoteHarness().target('main');
	target.workmuxControlChannel = {
		...target.workmuxControlChannel,
		command: () => command.promise,
	};
	const core = createShellKeyboardRemoteCore({
		initialTargetContext: target,
		getActivitySnapshot: () => ({
			focused: true,
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () =>
				({ shellConfigState: configState('current') }) as never,
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: (...args) => alerts.push(args),
		invalidateShellTransport: (connectionId, channelId) =>
			invalidations.push([connectionId, channelId]),
	});
	const pending = core.runWorkmuxCommand({ type: 'status-cycle' });
	command.resolve({
		success: false,
		output: '',
		error: 'timed out',
		failureClass: 'timeout',
	});
	assert.deepEqual(await pending, { status: 'handled' });
	assert.deepEqual(invalidations, [['connection:main', 1]]);
	assert.deepEqual(alerts, []);
});

void test('keyboard remote core keeps a semantically identical target current', async () => {
	const harness = createKeyboardRemoteHarness();
	const pending = harness.core.runWorkmuxCommand({ type: 'status-cycle' });
	harness.core.setTargetContext({ ...harness.initialTarget });
	harness.command.resolve({ success: true, output: 'cycled' });
	assert.deepEqual(await pending, { status: 'handled' });
});

void test('keyboard remote core bounds queued Workmux commands to the latest replacement', async () => {
	const firstCommand = deferred<{
		success: boolean;
		output: string;
	}>();
	const latestCommand = deferred<{
		success: boolean;
		output: string;
	}>();
	let commandCalls = 0;
	const target = createKeyboardRemoteHarness().target('main');
	target.workmuxControlChannel = {
		...target.workmuxControlChannel,
		command: () =>
			commandCalls++ === 0 ? firstCommand.promise : latestCommand.promise,
	};
	const core = createShellKeyboardRemoteCore({
		initialTargetContext: target,
		getActivitySnapshot: () => ({
			focused: true,
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () =>
				({ shellConfigState: configState('current') }) as never,
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: () => {},
		invalidateShellTransport: () => {},
	});
	const first = core.runWorkmuxCommand({ type: 'status-cycle' });
	const replaced = core.runWorkmuxCommand({ type: 'focus', target: 'git' });
	const latest = core.runWorkmuxCommand({ type: 'focus', target: 'codex' });
	assert.deepEqual(await replaced, { status: 'superseded' });
	firstCommand.resolve({ success: true, output: 'first' });
	assert.deepEqual(await first, { status: 'handled' });
	await Promise.resolve();
	latestCommand.resolve({ success: true, output: 'latest' });
	assert.deepEqual(await latest, { status: 'handled' });
	assert.equal(commandCalls, 2);
});

void test('keyboard remote core applies and reports a current config reload', async () => {
	const harness = createKeyboardRemoteHarness();
	const next = configState('remote-v2');
	const pending = harness.core.reloadConfig();
	harness.reload.resolve(next);
	assert.deepEqual(await pending, { status: 'handled' });
	assert.deepEqual(harness.appliedConfigs, [next]);
	assert.deepEqual(harness.alerts, [
		{
			title: 'Config reloaded',
			message: 'Loaded remote-v2 from GitHub.',
		},
	]);
});

void test('keyboard remote core applies exact current config failure feedback', async () => {
	const harness = createKeyboardRemoteHarness();
	const pending = harness.core.reloadConfig();
	harness.reload.reject(new Error('network unavailable'));
	assert.deepEqual(await pending, { status: 'failed' });
	assert.equal(
		(harness.appliedConfigs[0] as ShellConfigState).lastError,
		'network unavailable',
	);
	assert.deepEqual(harness.alerts, [
		{ title: 'Config reload failed', message: 'network unavailable' },
	]);
});

void test('keyboard remote core gives the latest config reload ownership', async () => {
	const harness = createKeyboardRemoteHarness();
	const first = harness.core.reloadConfig();
	const second = harness.core.reloadConfig();
	harness.reload.resolve(configState('latest'));
	assert.deepEqual(await first, { status: 'superseded' });
	assert.deepEqual(await second, { status: 'handled' });
	assert.equal(harness.appliedConfigs.length, 1);
	assert.equal(harness.alerts.length, 1);
});

void test('keyboard remote core contains config state callback failures', async () => {
	const alerts: string[] = [];
	const target = createKeyboardRemoteHarness().target('main');
	const core = createShellKeyboardRemoteCore({
		initialTargetContext: target,
		getActivitySnapshot: () => ({
			focused: true,
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () =>
				({ shellConfigState: configState('current') }) as never,
			setShellConfigState: () => {
				throw new Error('state callback failed');
			},
		},
		reloadRuntimeShellConfig: async () => {
			throw new Error('reload failed');
		},
		closeCommandMenu: () => {},
		showAlert: (title) => alerts.push(title),
		invalidateShellTransport: () => {},
	});
	assert.deepEqual(await core.reloadConfig(), { status: 'failed' });
	assert.deepEqual(alerts, ['Config reload failed']);
});

void test('keyboard remote core restarts Codex with the requested timeout', async () => {
	const harness = createKeyboardRemoteHarness();
	const pending = harness.core.restartCodex({ timeoutMs: 4321 });
	harness.command.resolve({
		success: true,
		output: JSON.stringify({
			sessionName: 'main',
			target: 'main:@12',
			windowId: '@12',
			windowName: 'codex',
			workspaceId: 'workspace-1',
			role: 'codex',
			paneId: '%34',
			paneTty: '/dev/pts/12',
			panePath: '/repo',
			projectRoot: '/repo',
			projectName: 'repo',
		}),
	});
	await Promise.resolve();
	harness.operation.resolve({ success: true, output: '' });
	assert.deepEqual(await pending, { status: 'handled' });
	assert.deepEqual(harness.operationCalls, [{ timeoutMs: 4321 }]);
	assert.deepEqual(harness.alerts, []);
});

void test('keyboard remote core rejects a concurrent Codex restart', async () => {
	const harness = createKeyboardRemoteHarness();
	const first = harness.core.restartCodex();
	assert.deepEqual(await harness.core.restartCodex(), {
		status: 'unavailable',
	});
	harness.core.invalidate('focus-lost');
	harness.command.reject(new Error('stale'));
	assert.deepEqual(await first, { status: 'superseded' });
});

void test('keyboard remote core snapshots a command bridge timeout', async () => {
	const harness = createKeyboardRemoteHarness();
	const entry = {
		type: 'bridge' as const,
		label: 'Restart',
		operation: 'codex.restart' as const,
		timeoutMs: 7654,
	};
	const pending = harness.core.handleCommandBridgeEntry(entry);
	entry.timeoutMs = 1;
	assert.equal(harness.commandCalls[0]?.timeoutMs, 7654);
	harness.core.invalidate('focus-lost');
	harness.command.reject(new Error('stale'));
	assert.deepEqual(await pending, { status: 'superseded' });
});

void test('keyboard remote core suppresses completion after activity generation changes', async () => {
	const harness = createKeyboardRemoteHarness();
	const pending = harness.core.reloadConfig();
	harness.setActivity({
		focused: true,
		appActive: true,
		interactive: true,
		generation: 1,
	});
	harness.reload.resolve(configState('stale'));
	assert.deepEqual(await pending, { status: 'superseded' });
	assert.deepEqual(harness.appliedConfigs, []);
});

void test('keyboard remote core suppresses a Workmux failure after activity replacement', async () => {
	const harness = createKeyboardRemoteHarness();
	const pending = harness.core.runWorkmuxCommand({ type: 'status-cycle' });
	harness.setActivity({
		focused: true,
		appActive: true,
		interactive: true,
		generation: 1,
	});
	harness.command.reject(new Error('stale failure'));
	assert.deepEqual(await pending, { status: 'superseded' });
	assert.deepEqual(harness.alerts, []);
});

void test('keyboard remote core closes admission before a reentrant config reload', async () => {
	let reloadCalls = 0;
	let core!: ReturnType<typeof createShellKeyboardRemoteCore>;
	const target = createKeyboardRemoteHarness().target('main');
	core = createShellKeyboardRemoteCore({
		initialTargetContext: target,
		getActivitySnapshot: () => ({
			focused: true,
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () =>
				({ shellConfigState: configState('current') }) as never,
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => {
			reloadCalls += 1;
			return configState('remote');
		},
		closeCommandMenu: () => core.dispose(),
		showAlert: () => {},
		invalidateShellTransport: () => {},
	});
	assert.deepEqual(await core.reloadConfig(), { status: 'unavailable' });
	assert.equal(reloadCalls, 0);
});

void test('keyboard remote core lets a reentrant config reload replace its caller', async () => {
	const reload = deferred<ShellConfigState>();
	let reloadCalls = 0;
	let reentered = false;
	let nested!: Promise<unknown>;
	let core!: ReturnType<typeof createShellKeyboardRemoteCore>;
	const target = createKeyboardRemoteHarness().target('main');
	core = createShellKeyboardRemoteCore({
		initialTargetContext: target,
		getActivitySnapshot: () => ({
			focused: true,
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () =>
				({ shellConfigState: configState('current') }) as never,
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: () => {
			reloadCalls += 1;
			return reload.promise;
		},
		closeCommandMenu: () => {
			if (reentered) return;
			reentered = true;
			nested = core.reloadConfig();
		},
		showAlert: () => {},
		invalidateShellTransport: () => {},
	});
	const outer = core.reloadConfig();
	assert.equal(reloadCalls, 1);
	reload.resolve(configState('remote'));
	assert.deepEqual(await outer, { status: 'superseded' });
	assert.deepEqual(await nested, { status: 'handled' });
});

void test('keyboard remote core suppresses feedback after alert reentry', async () => {
	const reload = deferred<ShellConfigState>();
	const alerts: string[] = [];
	let core!: ReturnType<typeof createShellKeyboardRemoteCore>;
	const target = createKeyboardRemoteHarness().target('main');
	core = createShellKeyboardRemoteCore({
		initialTargetContext: target,
		getActivitySnapshot: () => ({
			focused: true,
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () =>
				({ shellConfigState: configState('current') }) as never,
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: () => reload.promise,
		closeCommandMenu: () => {},
		showAlert: (title) => {
			alerts.push(title);
			core.dispose();
		},
		invalidateShellTransport: () => {},
	});
	const pending = core.reloadConfig();
	reload.resolve(configState('remote'));
	assert.deepEqual(await pending, { status: 'superseded' });
	assert.deepEqual(alerts, ['Config reloaded']);
});

void test('keyboard remote core revalidates after logger reentry', async () => {
	let commandCalls = 0;
	let core!: ReturnType<typeof createShellKeyboardRemoteCore>;
	const target = createKeyboardRemoteHarness().target('main');
	target.workmuxControlChannel = {
		...target.workmuxControlChannel,
		command: async () => {
			commandCalls += 1;
			return { success: true, output: '' };
		},
	};
	core = createShellKeyboardRemoteCore({
		initialTargetContext: target,
		getActivitySnapshot: () => ({
			focused: true,
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () =>
				({ shellConfigState: configState('current') }) as never,
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: () => {},
		invalidateShellTransport: () => {},
		logger: {
			info: () => core.invalidate('focus-lost'),
			warn: () => {},
		},
	});
	assert.deepEqual(await core.runWorkmuxCommand({ type: 'status-cycle' }), {
		status: 'superseded',
	});
	assert.equal(commandCalls, 0);
});

void test('keyboard remote core invalidation is reusable', async () => {
	const firstCommand = deferred<{
		success: boolean;
		output: string;
		error?: string;
	}>();
	const secondCommand = deferred<{
		success: boolean;
		output: string;
		error?: string;
	}>();
	let commandCount = 0;
	const target = createKeyboardRemoteHarness().target('main');
	target.workmuxControlChannel = {
		...target.workmuxControlChannel,
		command: () =>
			commandCount++ === 0 ? firstCommand.promise : secondCommand.promise,
	};
	const core = createShellKeyboardRemoteCore({
		initialTargetContext: target,
		getActivitySnapshot: () => ({
			focused: true,
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () =>
				({ shellConfigState: configState('current') }) as never,
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: () => {},
		invalidateShellTransport: () => {},
	});
	const first = core.runWorkmuxCommand({ type: 'status-cycle' });
	core.invalidate('focus-lost');
	firstCommand.resolve({ success: true, output: '' });
	assert.deepEqual(await first, { status: 'superseded' });
	const second = core.runWorkmuxCommand({ type: 'status-cycle' });
	secondCommand.resolve({ success: true, output: '' });
	assert.deepEqual(await second, { status: 'handled' });
});

void test('keyboard remote core dispose is idempotent and permanently inert', async () => {
	const harness = createKeyboardRemoteHarness();
	harness.core.dispose();
	harness.core.dispose();
	harness.core.invalidate('app-inactive');
	harness.core.setTargetContext(harness.target('other'));
	assert.deepEqual(
		await harness.core.runWorkmuxCommand({ type: 'status-cycle' }),
		{ status: 'superseded' },
	);
	assert.deepEqual(await harness.core.reloadConfig(), {
		status: 'unavailable',
	});
	assert.deepEqual(await harness.core.restartCodex(), {
		status: 'unavailable',
	});
	assert.equal(harness.commandCalls.length, 0);
});

void test('keyboard remote core ignores config completion after target replacement', async () => {
	const harness = createKeyboardRemoteHarness();
	const pending = harness.core.reloadConfig();
	harness.core.setTargetContext(harness.target('other'));
	harness.reload.resolve(configState('remote'));
	assert.deepEqual(await pending, { status: 'superseded' });
	assert.deepEqual(harness.appliedConfigs, []);
	assert.deepEqual(harness.alerts, []);
});

void test('keyboard remote core prevents stale Codex operation and failure alert', async () => {
	const harness = createKeyboardRemoteHarness();
	const pending = harness.core.restartCodex();
	harness.command.resolve({
		success: true,
		output: JSON.stringify({ target: { kind: 'pane', paneId: '%1' } }),
	});
	harness.core.invalidate('app-inactive');
	assert.deepEqual(await pending, { status: 'superseded' });
	assert.equal(harness.restartOperations.length, 0);
	assert.deepEqual(harness.alerts, []);
});
