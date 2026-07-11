import assert from 'node:assert/strict';
import test from 'node:test';
import { type ShellConfigState } from '../../src/lib/shell-config-store';
import {
	createShellKeyboardRemoteCore,
	type ShellKeyboardRemoteTargetContext,
} from '../../src/lib/shell-controllers/keyboard-remote-core';

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

async function settlesWithin<Value>(promise: Promise<Value>): Promise<Value> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error('request did not settle')), 50),
		),
	]);
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
			getSnapshot: () => remoteStateSnapshot(),
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

function remoteStateSnapshot(version = 'current') {
	return { shellConfigState: configState(version) };
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
			getSnapshot: () => remoteStateSnapshot(),
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

void test('keyboard remote core contains a throwing start clock', async () => {
	const harness = createKeyboardRemoteHarness();
	const warnings: string[] = [];
	const core = createShellKeyboardRemoteCore({
		initialTargetContext: harness.initialTarget,
		getActivitySnapshot: () => ({
			focused: true,
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () => remoteStateSnapshot(),
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: () => {},
		invalidateShellTransport: () => {},
		now: () => {
			throw new Error('clock failed');
		},
		logger: { info: () => {}, warn: (message) => warnings.push(message) },
	});
	const pending = core.runWorkmuxCommand({ type: 'status-cycle' });
	harness.command.resolve({ success: true, output: 'cycled' });
	assert.deepEqual(await pending, { status: 'handled' });
	assert.equal(warnings.includes('Failed to read keyboard remote clock'), true);
});

void test('keyboard remote core preserves transport failure when error clock throws', async () => {
	const command = deferred<{
		success: boolean;
		output: string;
		error?: string;
	}>();
	const alerts: { title: string; message: string }[] = [];
	let clockReads = 0;
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
			getSnapshot: () => remoteStateSnapshot(),
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: (title, message) => alerts.push({ title, message }),
		invalidateShellTransport: () => {},
		now: () => {
			clockReads += 1;
			if (clockReads > 1) throw new Error('clock failed');
			return 10;
		},
	});
	const pending = core.runWorkmuxCommand({ type: 'status-cycle' });
	command.reject(new Error('transport failed'));
	assert.deepEqual(await pending, { status: 'handled' });
	assert.equal(alerts.length, 1);
	assert.match(alerts[0]?.message ?? '', /transport failed/);
	assert.doesNotMatch(alerts[0]?.message ?? '', /clock failed/);
});

void test('keyboard remote core contains a throwing result clock', async () => {
	const harness = createKeyboardRemoteHarness();
	let clockReads = 0;
	const warnings: string[] = [];
	const core = createShellKeyboardRemoteCore({
		initialTargetContext: harness.initialTarget,
		getActivitySnapshot: () => ({
			focused: true,
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () => remoteStateSnapshot(),
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: () => {},
		invalidateShellTransport: () => {},
		now: () => {
			clockReads += 1;
			if (clockReads > 1) throw new Error('result clock failed');
			return 10;
		},
		logger: { info: () => {}, warn: (message) => warnings.push(message) },
	});
	const pending = core.runWorkmuxCommand({ type: 'status-cycle' });
	harness.command.resolve({ success: true, output: 'cycled' });
	assert.deepEqual(await pending, { status: 'handled' });
	assert.equal(warnings.includes('Failed to read keyboard remote clock'), true);
});

void test('keyboard remote core suppresses result logging after clock reentry', async () => {
	const harness = createKeyboardRemoteHarness();
	const info: string[] = [];
	let clockReads = 0;
	let core!: ReturnType<typeof createShellKeyboardRemoteCore>;
	core = createShellKeyboardRemoteCore({
		initialTargetContext: harness.initialTarget,
		getActivitySnapshot: () => ({
			focused: true,
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () => remoteStateSnapshot(),
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: () => {},
		invalidateShellTransport: () => {},
		now: () => {
			clockReads += 1;
			if (clockReads === 2) core.invalidate('focus-lost');
			return clockReads;
		},
		logger: { info: (message) => info.push(message), warn: () => {} },
	});
	const pending = core.runWorkmuxCommand({ type: 'status-cycle' });
	harness.command.resolve({ success: true, output: 'cycled' });
	assert.deepEqual(await pending, { status: 'superseded' });
	assert.deepEqual(info, ['Workmux keyboard command start']);
});

void test('keyboard remote core revalidates after clock reentry before logging', async () => {
	let commandCalls = 0;
	let infoCalls = 0;
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
			getSnapshot: () => remoteStateSnapshot(),
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: () => {},
		invalidateShellTransport: () => {},
		now: () => {
			core.invalidate('focus-lost');
			return 10;
		},
		logger: { info: () => (infoCalls += 1), warn: () => {} },
	});
	assert.deepEqual(await core.runWorkmuxCommand({ type: 'status-cycle' }), {
		status: 'superseded',
	});
	assert.equal(infoCalls, 0);
	assert.equal(commandCalls, 0);
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
			getSnapshot: () => remoteStateSnapshot(),
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

void test('keyboard remote core contains throwing transport invalidation', async () => {
	const command = deferred<{
		success: boolean;
		output: string;
		error?: string;
		failureClass?: 'timeout';
	}>();
	const warnings: string[] = [];
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
			getSnapshot: () => remoteStateSnapshot(),
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: () => assert.fail('transport failure must not alert'),
		invalidateShellTransport: () => {
			throw new Error('invalidation failed');
		},
		logger: {
			info: () => {},
			warn: (message) => warnings.push(message),
		},
	});
	const pending = core.runWorkmuxCommand({ type: 'status-cycle' });
	command.resolve({
		success: false,
		output: '',
		error: 'timed out',
		failureClass: 'timeout',
	});
	assert.deepEqual(
		await Promise.race([
			pending,
			new Promise((_, reject) =>
				setTimeout(
					() => reject(new Error('public command did not settle')),
					50,
				),
			),
		]),
		{ status: 'handled' },
	);
	assert.equal(
		warnings.includes('Failed to invalidate unhealthy Workmux transport'),
		true,
	);
});

void test('keyboard remote core suppresses reentrant throwing transport feedback', async () => {
	const command = deferred<{
		success: boolean;
		output: string;
		error?: string;
		failureClass?: 'timeout';
	}>();
	const alerts: unknown[] = [];
	let core!: ReturnType<typeof createShellKeyboardRemoteCore>;
	const target = createKeyboardRemoteHarness().target('main');
	target.workmuxControlChannel = {
		...target.workmuxControlChannel,
		command: () => command.promise,
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
			getSnapshot: () => remoteStateSnapshot(),
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: (...args) => alerts.push(args),
		invalidateShellTransport: () => {
			core.invalidate('app-inactive');
			throw new Error('reentrant invalidation failed');
		},
	});
	const pending = core.runWorkmuxCommand({ type: 'status-cycle' });
	command.resolve({
		success: false,
		output: '',
		error: 'timed out',
		failureClass: 'timeout',
	});
	assert.deepEqual(await pending, { status: 'superseded' });
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
			getSnapshot: () => remoteStateSnapshot(),
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
			getSnapshot: () => remoteStateSnapshot(),
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
			getSnapshot: () => remoteStateSnapshot(),
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
			getSnapshot: () => remoteStateSnapshot(),
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
			getSnapshot: () => remoteStateSnapshot(),
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
			getSnapshot: () => remoteStateSnapshot(),
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

void test('keyboard remote core contains a throwing nav-scope getter', async () => {
	const alerts: { title: string; message: string }[] = [];
	const harness = createKeyboardRemoteHarness();
	const core = createShellKeyboardRemoteCore({
		initialTargetContext: harness.initialTarget,
		getActivitySnapshot: () => ({
			focused: true,
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getNavScope: () => {
			throw new Error('nav scope failed');
		},
		keyboardState: {
			getSnapshot: () => remoteStateSnapshot(),
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: (title, message) => alerts.push({ title, message }),
		invalidateShellTransport: () => {},
	});
	assert.deepEqual(
		await core.runWorkmuxCommand({ type: 'nav', action: 'next' }),
		{ status: 'handled' },
	);
	assert.match(alerts[0]?.message ?? '', /nav scope failed/);
	assert.equal(harness.commandCalls.length, 0);
});

void test('keyboard remote core suppresses transport after nav-scope reentry', async () => {
	let commandCalls = 0;
	const alerts: unknown[] = [];
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
		getNavScope: () => {
			core.invalidate('focus-lost');
			return 'visible';
		},
		keyboardState: {
			getSnapshot: () => remoteStateSnapshot(),
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: (...args) => alerts.push(args),
		invalidateShellTransport: () => {},
	});
	assert.deepEqual(
		await core.runWorkmuxCommand({ type: 'nav', action: 'next' }),
		{ status: 'superseded' },
	);
	assert.equal(commandCalls, 0);
	assert.deepEqual(alerts, []);
});

void test('keyboard remote core contains throwing and reentrant activity getters', async () => {
	const target = createKeyboardRemoteHarness().target('main');
	let commandCalls = 0;
	target.workmuxControlChannel = {
		...target.workmuxControlChannel,
		command: async () => {
			commandCalls += 1;
			return { success: true, output: '' };
		},
	};
	const throwing = createShellKeyboardRemoteCore({
		initialTargetContext: target,
		getActivitySnapshot: () => {
			throw new Error('activity failed');
		},
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () => remoteStateSnapshot(),
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: () => {},
		invalidateShellTransport: () => {},
	});
	assert.deepEqual(await throwing.runWorkmuxCommand({ type: 'status-cycle' }), {
		status: 'superseded',
	});
	let reentrant!: ReturnType<typeof createShellKeyboardRemoteCore>;
	reentrant = createShellKeyboardRemoteCore({
		initialTargetContext: target,
		getActivitySnapshot: () => {
			reentrant.dispose();
			return {
				focused: true,
				appActive: true,
				interactive: true,
				generation: 0,
			};
		},
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () => remoteStateSnapshot(),
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: () => {},
		invalidateShellTransport: () => {},
	});
	assert.deepEqual(
		await reentrant.runWorkmuxCommand({ type: 'status-cycle' }),
		{ status: 'superseded' },
	);
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
			getSnapshot: () => remoteStateSnapshot(),
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

void test('keyboard remote core immediately detaches an unresolved Workmux command', async () => {
	const oldCommand = deferred<{ success: boolean; output: string }>();
	const nextCommand = deferred<{ success: boolean; output: string }>();
	let calls = 0;
	const target = createKeyboardRemoteHarness().target('main');
	target.workmuxControlChannel = {
		...target.workmuxControlChannel,
		command: () => (calls++ === 0 ? oldCommand.promise : nextCommand.promise),
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
			getSnapshot: () => remoteStateSnapshot(),
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: () => {},
		invalidateShellTransport: () => {},
	});
	const old = core.runWorkmuxCommand({ type: 'status-cycle' });
	core.invalidate('focus-lost');
	assert.deepEqual(await settlesWithin(old), { status: 'superseded' });
	const next = core.runWorkmuxCommand({ type: 'status-cycle' });
	nextCommand.resolve({ success: true, output: 'next' });
	assert.deepEqual(await settlesWithin(next), { status: 'handled' });
	oldCommand.reject(new Error('late old failure'));
	await Promise.resolve();
});

void test('keyboard remote core target replacement detaches unresolved Workmux ownership', async () => {
	const old = deferred<{ success: boolean; output: string }>();
	const next = deferred<{ success: boolean; output: string }>();
	const harness = createKeyboardRemoteHarness();
	const initial = {
		...harness.initialTarget,
		workmuxControlChannel: {
			...harness.initialTarget.workmuxControlChannel,
			command: () => old.promise,
		},
	};
	const replacement = {
		...harness.target('other'),
		workmuxControlChannel: {
			...harness.target('other').workmuxControlChannel,
			command: () => next.promise,
		},
	};
	const core = createShellKeyboardRemoteCore({
		initialTargetContext: initial,
		getActivitySnapshot: () => ({
			focused: true,
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () => remoteStateSnapshot(),
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: () => {},
		invalidateShellTransport: () => {},
	});
	const stale = core.runWorkmuxCommand({ type: 'status-cycle' });
	core.setTargetContext(replacement);
	assert.deepEqual(await settlesWithin(stale), { status: 'superseded' });
	const current = core.runWorkmuxCommand({ type: 'status-cycle' });
	next.resolve({ success: true, output: '' });
	assert.deepEqual(await current, { status: 'handled' });
	old.resolve({ success: true, output: 'late' });
});

void test('keyboard remote core immediately detaches unresolved config ownership', async () => {
	const oldReload = deferred<ShellConfigState>();
	const nextReload = deferred<ShellConfigState>();
	let calls = 0;
	const applied: ShellConfigState[] = [];
	const harness = createKeyboardRemoteHarness();
	const core = createShellKeyboardRemoteCore({
		initialTargetContext: harness.initialTarget,
		getActivitySnapshot: () => ({
			focused: true,
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () => remoteStateSnapshot(),
			setShellConfigState: (state) => applied.push(state),
		},
		reloadRuntimeShellConfig: () =>
			calls++ === 0 ? oldReload.promise : nextReload.promise,
		closeCommandMenu: () => {},
		showAlert: () => {},
		invalidateShellTransport: () => {},
	});
	const old = core.reloadConfig();
	const next = core.reloadConfig();
	assert.deepEqual(await settlesWithin(old), { status: 'superseded' });
	nextReload.resolve(configState('next'));
	assert.deepEqual(await settlesWithin(next), { status: 'handled' });
	oldReload.resolve(configState('old'));
	await Promise.resolve();
	assert.deepEqual(
		applied.map((state) => state.config.version),
		['next'],
	);
});

void test('keyboard remote core immediately releases unresolved restart ownership', async () => {
	const oldRestart = deferred<{ status: 'handled' | 'failed' }>();
	const nextRestart = deferred<{ status: 'handled' | 'failed' }>();
	let calls = 0;
	const harness = createKeyboardRemoteHarness();
	const core = createShellKeyboardRemoteCore({
		initialTargetContext: harness.initialTarget,
		getActivitySnapshot: () => ({
			focused: true,
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () => remoteStateSnapshot(),
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: () => {},
		invalidateShellTransport: () => {},
		restartCodex: () =>
			calls++ === 0 ? oldRestart.promise : nextRestart.promise,
	});
	const old = core.restartCodex();
	core.invalidate('app-inactive');
	assert.deepEqual(await settlesWithin(old), { status: 'superseded' });
	const next = core.restartCodex();
	nextRestart.resolve({ status: 'handled' });
	assert.deepEqual(await settlesWithin(next), { status: 'handled' });
	oldRestart.resolve({ status: 'failed' });
	await Promise.resolve();
});

void test('keyboard remote core disposal settles unresolved config and restart requests', async () => {
	const harness = createKeyboardRemoteHarness();
	const reloadCore = createShellKeyboardRemoteCore({
		initialTargetContext: harness.initialTarget,
		getActivitySnapshot: () => ({
			focused: true,
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () => remoteStateSnapshot(),
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: () => new Promise(() => {}),
		closeCommandMenu: () => {},
		showAlert: () => {},
		invalidateShellTransport: () => {},
	});
	const reload = reloadCore.reloadConfig();
	reloadCore.dispose();
	assert.deepEqual(await settlesWithin(reload), { status: 'unavailable' });
	const restartCore = createShellKeyboardRemoteCore({
		initialTargetContext: harness.initialTarget,
		getActivitySnapshot: () => ({
			focused: true,
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () => remoteStateSnapshot(),
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: () => {},
		invalidateShellTransport: () => {},
		restartCodex: () => new Promise(() => {}),
	});
	const restart = restartCore.restartCodex();
	restartCore.dispose();
	assert.deepEqual(await settlesWithin(restart), { status: 'unavailable' });
});

void test('keyboard remote core suppresses config alert after warning reentry', async () => {
	const alerts: unknown[] = [];
	let core!: ReturnType<typeof createShellKeyboardRemoteCore>;
	const harness = createKeyboardRemoteHarness();
	core = createShellKeyboardRemoteCore({
		initialTargetContext: harness.initialTarget,
		getActivitySnapshot: () => ({
			focused: true,
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () => {
				throw new Error('state failed');
			},
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => {
			throw new Error('reload failed');
		},
		closeCommandMenu: () => {},
		showAlert: (...args) => alerts.push(args),
		invalidateShellTransport: () => {},
		logger: { info: () => {}, warn: () => core.invalidate('focus-lost') },
	});
	assert.deepEqual(await core.reloadConfig(), { status: 'superseded' });
	assert.deepEqual(alerts, []);
});

void test('keyboard remote core suppresses restart alert after warning reentry', async () => {
	const alerts: unknown[] = [];
	let core!: ReturnType<typeof createShellKeyboardRemoteCore>;
	const harness = createKeyboardRemoteHarness();
	core = createShellKeyboardRemoteCore({
		initialTargetContext: harness.initialTarget,
		getActivitySnapshot: () => ({
			focused: true,
			appActive: true,
			interactive: true,
			generation: 0,
		}),
		getNavScope: () => 'visible',
		keyboardState: {
			getSnapshot: () => remoteStateSnapshot(),
			setShellConfigState: () => {},
		},
		reloadRuntimeShellConfig: async () => configState('remote'),
		closeCommandMenu: () => {},
		showAlert: (...args) => alerts.push(args),
		invalidateShellTransport: () => {},
		restartCodex: async () => {
			throw new Error('restart failed');
		},
		logger: { info: () => {}, warn: () => core.invalidate('focus-lost') },
	});
	assert.deepEqual(await core.restartCodex(), { status: 'superseded' });
	assert.deepEqual(alerts, []);
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

void test('keyboard remote core bridge handling is inert after dispose', async () => {
	let warningCount = 0;
	const target = createKeyboardRemoteHarness().target('main');
	const core = createShellKeyboardRemoteCore({
		initialTargetContext: target,
		getActivitySnapshot: () => assert.fail('disposed bridge read activity'),
		getNavScope: () => assert.fail('disposed bridge read nav scope'),
		keyboardState: {
			getSnapshot: () => assert.fail('disposed bridge read state'),
			setShellConfigState: () => assert.fail('disposed bridge set state'),
		},
		reloadRuntimeShellConfig: () =>
			Promise.reject(new Error('disposed bridge reload')),
		closeCommandMenu: () => assert.fail('disposed bridge closed menu'),
		showAlert: () => assert.fail('disposed bridge alerted'),
		invalidateShellTransport: () => assert.fail('disposed bridge invalidated'),
		logger: {
			info: () => assert.fail('disposed bridge logged info'),
			warn: () => {
				warningCount += 1;
			},
		},
	});
	core.dispose();
	assert.deepEqual(
		await core.handleCommandBridgeEntry({
			type: 'bridge',
			label: 'Restart',
			operation: 'codex.restart',
		}),
		{ status: 'unavailable' },
	);
	assert.deepEqual(
		await core.handleCommandBridgeEntry({
			type: 'bridge',
			label: 'Unknown',
			operation: 'unknown.operation',
		} as never),
		{ status: 'unavailable' },
	);
	assert.equal(warningCount, 0);
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
