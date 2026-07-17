import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { HOST_BROWSER_NO_CONNECTION_MESSAGE } from '../../src/lib/host-browser-actions';
import { WORKMUX_KEYBOARD_COMMAND_DISABLED_MESSAGE } from '../../src/lib/keyboard-actions';
import { MDEV_BRIDGE_UPDATE_MESSAGE } from '../../src/lib/mdev-bridge-client';
import { createShellModalArbiter } from '../../src/lib/shell-controllers/modal-arbiter';
import {
	type ShellWorkmuxOutcome,
	type ShellWorkmuxPort,
} from '../../src/lib/shell-controllers/session-contracts';
import {
	createShellTargetKey,
	createShellTransportKey,
} from '../../src/lib/shell-controllers/source-keys';
import {
	createWorktreeWorkspaceControllerAdapter,
	classifyWorktreeWorkspaceFailure,
} from '../../src/lib/shell-controllers/worktree-workspace-adapter';
import { type WorktreeWorkspaceFailure } from '../../src/lib/shell-controllers/worktree-workspace-contracts';
import {
	createWorktreeWorkspaceCore,
	type WorktreeWorkspaceCoreDependencies,
} from '../../src/lib/shell-controllers/worktree-workspace-core';
import {
	buildWorkmuxAppContextArgv,
	type WorkmuxAppContext,
} from '../../src/lib/workmux-app-commands';
import {
	WORKTREE_WORKSPACE_CLOSE_OPERATION_ID,
	WORKTREE_WORKSPACE_CREATE_OPERATION_ID,
	WORKTREE_WORKSPACE_OPERATION_TIMEOUT_MS,
	WORKTREE_WORKSPACE_PREPARE_CLOSE_OPERATION_ID,
	WORKTREE_WORKSPACE_PREPARE_NEW_OPERATION_ID,
	type CloseWorktreeWorkspacePreparation,
	type NewWorktreeWorkspacePreparation,
} from '../../src/lib/worktree-workspace-bridge';

type Deferred<T> = {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
};

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

const NEW_PREPARATION: NewWorktreeWorkspacePreparation = {
	target: 'main:2.1',
	repositoryName: 'fressh',
	projectRoot: '/home/muly/code/fressh',
	suggestedBranch: 'issue-131-native-worktree-workspace',
};
const SOURCE_KEY = createShellTargetKey(
	createShellTransportKey('connection-1', 7),
	'main',
);

const CLOSE_PREPARATION: CloseWorktreeWorkspacePreparation = {
	session: 'main',
	workspaceId: 'workspace-131',
	workspaceLabel: 'fressh.issue-131',
	worktreePath: '/home/muly/code/fressh.issue-131',
	closeFingerprint: `sha256:${'a'.repeat(64)}`,
	windows: [
		{ id: '@2', name: 'fressh.issue-131' },
		{ id: '@3', name: 'fressh.issue-131.git' },
	],
};

const REMOTE_FAILURE: WorktreeWorkspaceFailure = {
	kind: 'remote',
	message: 'Worktrunk failed safely.',
};

function createWorktreeAdapter(
	arbiter: ReturnType<typeof createShellModalArbiter>,
) {
	return createWorktreeWorkspaceControllerAdapter({
		getCommittedDependencies: () => ({
			connectionAvailable: true,
			tmuxEnabled: true,
			sessionName: 'main',
			sourceKey: SOURCE_KEY,
			workmux: {
				command: async () => ({ status: 'unavailable' as const }),
				operation: async () => ({ status: 'unavailable' as const }),
			},
			arbiter,
		}),
		reportPrecondition: () => {},
		logger: { error: () => {} },
	});
}

function tick(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

void test('worktree admission closes every conflicting modal in order before opening', () => {
	const events: string[] = [];
	const arbiter = createShellModalArbiter();
	const conflicts = [
		'command-menu',
		'commander',
		'text-entry',
		'configure',
		'browser-actions',
		'feature-request',
		'skill-selector',
	] as const;
	for (const conflict of conflicts) {
		arbiter.register(conflict, ({ opening }) => {
			assert.equal(opening, 'worktree-workspace');
			events.push(`close:${conflict}`);
		});
	}

	const adapter = createWorktreeAdapter(arbiter);
	assert.equal(
		adapter.requestOpen(() => events.push('open:worktree-workspace')),
		true,
	);
	assert.deepEqual(events, [
		...conflicts.map((conflict) => `close:${conflict}`),
		'open:worktree-workspace',
	]);
});

void test('worktree admission stops when a conflicting modal blocks close', () => {
	const events: string[] = [];
	const arbiter = createShellModalArbiter();
	arbiter.register('command-menu', () => {
		events.push('close:command-menu');
	});
	arbiter.register('commander', () => {
		events.push('block:commander');
		return false;
	});
	arbiter.register('text-entry', () => {
		events.push('close:text-entry');
	});

	const adapter = createWorktreeAdapter(arbiter);
	assert.equal(
		adapter.requestOpen(() => events.push('opened')),
		false,
	);
	assert.deepEqual(events, ['close:command-menu', 'block:commander']);
});

void test('worktree hook owns committed typed source lifecycle without a terminal-input escape hatch', () => {
	const hookSource = readFileSync(
		join(process.cwd(), 'src/lib/shell-controllers/worktree-workspace.tsx'),
		'utf8',
	);
	const adapterSource = readFileSync(
		join(
			process.cwd(),
			'src/lib/shell-controllers/worktree-workspace-adapter.ts',
		),
		'utf8',
	);

	assert.match(
		hookSource,
		/getCommittedDependencies: \(\) => committedDepsRef\.current/,
	);
	assert.match(
		hookSource,
		/syncControllerSource\(\{[\s\S]*?dependencies: deps,[\s\S]*?core,[\s\S]*?\}\)/,
	);
	assert.match(hookSource, /createReplaySafeControllerLifecycle\(core\)/);
	assert.match(hookSource, /adapter\.registerClose\(core\.close\)/);
	assert.match(
		hookSource,
		/Alert\.alert\('Worktree Workspace', failure\.message/,
	);
	assert.doesNotMatch(
		`${hookSource}\n${adapterSource}`,
		/sendTextRaw|sendBytes|sendData|runCommandSteps|terminal-transport|onTerminalInput/,
	);
});

function createCoreHarness(input?: {
	connected?: boolean;
	tmuxEnabled?: boolean;
	admitted?: boolean;
}) {
	let connected = input?.connected ?? true;
	let tmuxEnabled = input?.tmuxEnabled ?? true;
	let admitted = input?.admitted ?? true;
	const targets: Deferred<string>[] = [];
	const newPreparations: Deferred<NewWorktreeWorkspacePreparation>[] = [];
	const creates: Deferred<Readonly<{ status: 'created' }>>[] = [];
	const closePreparations: Deferred<CloseWorktreeWorkspacePreparation>[] = [];
	const closes: Deferred<Readonly<{ status: 'closed' }>>[] = [];
	const createInputs: {
		target: string;
		expectedProjectRoot: string;
		branch: string;
	}[] = [];
	const closeInputs: {
		session: string;
		workspaceId: string;
		expectedWorktreePath: string;
		expectedCloseFingerprint: string;
	}[] = [];
	const reports: WorktreeWorkspaceFailure[] = [];
	const openRequests: (() => void)[] = [];
	const errors: { message: string; payload?: unknown }[] = [];

	const dependencies: WorktreeWorkspaceCoreDependencies = {
		initialSourceKey: 'source-a',
		hasConnection: () => connected,
		isWorkmuxEnabled: () => tmuxEnabled,
		requestOpen: (onOpen) => {
			openRequests.push(onOpen);
			if (!admitted) return false;
			onOpen();
			return true;
		},
		resolveTarget: () => {
			const deferred = createDeferred<string>();
			targets.push(deferred);
			return deferred.promise;
		},
		prepareNewWorktreeWorkspace: () => {
			const deferred = createDeferred<NewWorktreeWorkspacePreparation>();
			newPreparations.push(deferred);
			return deferred.promise;
		},
		createWorktreeWorkspace: (request) => {
			createInputs.push(request);
			const deferred = createDeferred<Readonly<{ status: 'created' }>>();
			creates.push(deferred);
			return deferred.promise;
		},
		prepareCloseWorktreeWorkspace: () => {
			const deferred = createDeferred<CloseWorktreeWorkspacePreparation>();
			closePreparations.push(deferred);
			return deferred.promise;
		},
		closeWorktreeWorkspace: (request) => {
			closeInputs.push(request);
			const deferred = createDeferred<Readonly<{ status: 'closed' }>>();
			closes.push(deferred);
			return deferred.promise;
		},
		classifyFailure: classifyWorktreeWorkspaceFailure,
		reportPrecondition: (failure) => reports.push(failure),
		logger: {
			error: (message, payload) => errors.push({ message, payload }),
		},
	};
	const core = createWorktreeWorkspaceCore(dependencies);

	return {
		core,
		targets,
		newPreparations,
		creates,
		closePreparations,
		closes,
		createInputs,
		closeInputs,
		reports,
		openRequests,
		errors,
		setConnected: (value: boolean) => {
			connected = value;
		},
		setTmuxEnabled: (value: boolean) => {
			tmuxEnabled = value;
		},
		setAdmitted: (value: boolean) => {
			admitted = value;
		},
	};
}

async function completeNewPreparation(
	harness: ReturnType<typeof createCoreHarness>,
	preparation = NEW_PREPARATION,
) {
	harness.targets.at(-1)?.resolve(preparation.target);
	await tick();
	harness.newPreparations.at(-1)?.resolve(preparation);
	await tick();
}

async function completeClosePreparation(
	harness: ReturnType<typeof createCoreHarness>,
	preparation = CLOSE_PREPARATION,
) {
	harness.targets.at(-1)?.resolve('main:2.1');
	await tick();
	harness.closePreparations.at(-1)?.resolve(preparation);
	await tick();
}

void test('worktree workspace preconditions stay idle and issue zero requests', () => {
	const disconnected = createCoreHarness({ connected: false });
	disconnected.core.openNew();
	assert.deepEqual(disconnected.core.getState(), { phase: 'idle' });
	assert.deepEqual(disconnected.reports, [
		{ kind: 'precondition', message: HOST_BROWSER_NO_CONNECTION_MESSAGE },
	]);
	assert.equal(disconnected.openRequests.length, 0);
	assert.equal(disconnected.targets.length, 0);

	const disabled = createCoreHarness({ tmuxEnabled: false });
	disabled.core.openClose();
	assert.deepEqual(disabled.core.getState(), { phase: 'idle' });
	assert.deepEqual(disabled.reports, [
		{
			kind: 'precondition',
			message: WORKMUX_KEYBOARD_COMMAND_DISABLED_MESSAGE,
		},
	]);
	assert.equal(disabled.openRequests.length, 0);
	assert.equal(disabled.targets.length, 0);
});

void test('worktree workspace denied admission and repeated taps start no extra work', () => {
	const denied = createCoreHarness({ admitted: false });
	denied.core.openNew();
	assert.deepEqual(denied.core.getState(), { phase: 'idle' });
	assert.equal(denied.openRequests.length, 1);
	assert.equal(denied.targets.length, 0);

	const admitted = createCoreHarness();
	admitted.core.openNew();
	assert.deepEqual(admitted.core.getState(), { phase: 'preparing-new' });
	admitted.core.openNew();
	admitted.core.openClose();
	assert.equal(admitted.openRequests.length, 1);
	assert.equal(admitted.targets.length, 1);
});

void test('worktree workspace close cancels pending preparation', async () => {
	const harness = createCoreHarness();
	harness.core.openNew();
	assert.equal(harness.core.getState, harness.core.getSnapshot);
	assert.equal(harness.core.close(), true);
	assert.deepEqual(harness.core.getState(), { phase: 'idle' });
	harness.targets[0]?.resolve(NEW_PREPARATION.target);
	await tick();
	assert.equal(harness.newPreparations.length, 0);
	assert.deepEqual(harness.core.getState(), { phase: 'idle' });
});

void test('worktree workspace prepares and creates through every new phase', async () => {
	const harness = createCoreHarness();
	harness.core.openNew();
	assert.deepEqual(harness.core.getState(), { phase: 'preparing-new' });

	harness.targets[0]?.resolve(NEW_PREPARATION.target);
	await tick();
	assert.deepEqual(harness.core.getState(), { phase: 'preparing-new' });
	assert.equal(harness.newPreparations.length, 1);

	harness.newPreparations[0]?.resolve(NEW_PREPARATION);
	await tick();
	assert.deepEqual(harness.core.getState(), {
		phase: 'editing-new',
		preparation: NEW_PREPARATION,
	});

	const creating = harness.core.create('  issue-131  ');
	assert.deepEqual(harness.core.getState(), {
		phase: 'creating',
		preparation: NEW_PREPARATION,
	});
	assert.deepEqual(harness.createInputs, [
		{
			target: NEW_PREPARATION.target,
			expectedProjectRoot: NEW_PREPARATION.projectRoot,
			branch: 'issue-131',
		},
	]);
	harness.creates[0]?.resolve({ status: 'created' });
	assert.deepEqual(await creating, { status: 'completed' });
	assert.deepEqual(harness.core.getState(), { phase: 'idle' });
});

void test('worktree workspace retries only failed preparation with a fresh target', async () => {
	const harness = createCoreHarness();
	harness.core.openNew();
	harness.targets[0]?.resolve('stale-target');
	await tick();
	harness.newPreparations[0]?.reject(REMOTE_FAILURE);
	await tick();
	assert.deepEqual(harness.core.getState(), {
		phase: 'preparing-new',
		error: REMOTE_FAILURE,
	});

	harness.core.retry();
	assert.deepEqual(harness.core.getState(), { phase: 'preparing-new' });
	assert.equal(harness.targets.length, 2);
	await completeNewPreparation(harness);
	assert.deepEqual(harness.core.getState(), {
		phase: 'editing-new',
		preparation: NEW_PREPARATION,
	});
	assert.equal(harness.newPreparations.length, 2);

	harness.core.retry();
	assert.equal(harness.targets.length, 2);
});

void test('worktree workspace rejects an empty branch locally without losing preparation', async () => {
	const harness = createCoreHarness();
	harness.core.openNew();
	await completeNewPreparation(harness);
	const result = await harness.core.create(' \n\t ');
	const failure: WorktreeWorkspaceFailure = {
		kind: 'precondition',
		message: 'Task branch is required.',
	};
	assert.deepEqual(result, { status: 'failed', failure });
	assert.deepEqual(harness.core.getState(), {
		phase: 'editing-new',
		preparation: NEW_PREPARATION,
		error: failure,
	});
	assert.equal(harness.creates.length, 0);
});

void test('worktree workspace preserves preparation on create failure and rejects double submit', async () => {
	const harness = createCoreHarness();
	harness.core.openNew();
	await completeNewPreparation(harness);
	const first = harness.core.create('draft branch');
	const second = await harness.core.create('second');
	assert.deepEqual(second, { status: 'unavailable' });
	assert.equal(harness.creates.length, 1);
	assert.equal(harness.core.close(), false);

	harness.creates[0]?.reject(REMOTE_FAILURE);
	assert.deepEqual(await first, { status: 'failed', failure: REMOTE_FAILURE });
	assert.deepEqual(harness.core.getState(), {
		phase: 'editing-new',
		preparation: NEW_PREPARATION,
		error: REMOTE_FAILURE,
	});
});

void test('worktree workspace prepares and closes with captured identity', async () => {
	const harness = createCoreHarness();
	harness.core.openClose();
	assert.deepEqual(harness.core.getState(), { phase: 'preparing-close' });
	await completeClosePreparation(harness);
	assert.deepEqual(harness.core.getState(), {
		phase: 'confirming-close',
		preparation: CLOSE_PREPARATION,
	});

	const closing = harness.core.confirmClose();
	assert.deepEqual(harness.core.getState(), {
		phase: 'closing',
		preparation: CLOSE_PREPARATION,
	});
	assert.deepEqual(harness.closeInputs, [
		{
			session: CLOSE_PREPARATION.session,
			workspaceId: CLOSE_PREPARATION.workspaceId,
			expectedWorktreePath: CLOSE_PREPARATION.worktreePath,
			expectedCloseFingerprint: CLOSE_PREPARATION.closeFingerprint,
		},
	]);
	assert.equal(harness.core.close(), false);
	harness.closes[0]?.resolve({ status: 'closed' });
	assert.deepEqual(await closing, { status: 'completed' });
	assert.deepEqual(harness.core.getState(), { phase: 'idle' });
});

void test('worktree workspace close failure requires a wholly fresh preview', async () => {
	const harness = createCoreHarness();
	harness.core.openClose();
	await completeClosePreparation(harness);
	const closing = harness.core.confirmClose();
	harness.closes[0]?.reject(REMOTE_FAILURE);
	assert.deepEqual(await closing, {
		status: 'failed',
		failure: REMOTE_FAILURE,
	});
	assert.deepEqual(harness.core.getState(), {
		phase: 'preparing-close',
		error: REMOTE_FAILURE,
	});

	harness.core.retry();
	assert.deepEqual(harness.core.getState(), { phase: 'preparing-close' });
	assert.equal(harness.targets.length, 2);
	harness.targets[1]?.resolve('main:4.1');
	await tick();
	assert.equal(harness.closePreparations.length, 2);
	const fresh = { ...CLOSE_PREPARATION, workspaceId: 'workspace-132' };
	harness.closePreparations[1]?.resolve(fresh);
	await tick();
	assert.deepEqual(harness.core.getState(), {
		phase: 'confirming-close',
		preparation: fresh,
	});
});

void test('worktree workspace source changes and explicit invalidation suppress late preparation', async () => {
	const sourceChanged = createCoreHarness();
	sourceChanged.core.openNew();
	sourceChanged.core.setSourceKey('source-b');
	assert.deepEqual(sourceChanged.core.getState(), { phase: 'idle' });
	sourceChanged.targets[0]?.resolve(NEW_PREPARATION.target);
	await tick();
	assert.equal(sourceChanged.newPreparations.length, 0);
	assert.deepEqual(sourceChanged.core.getState(), { phase: 'idle' });

	const invalidated = createCoreHarness();
	invalidated.core.openClose();
	invalidated.targets[0]?.resolve('main:2.1');
	await tick();
	invalidated.core.invalidate('focus-lost');
	invalidated.closePreparations[0]?.reject(REMOTE_FAILURE);
	await tick();
	assert.deepEqual(invalidated.core.getState(), { phase: 'idle' });
	assert.equal(invalidated.errors.length, 0);
});

void test('worktree workspace invalidation and disposal suppress late mutations', async () => {
	const invalidated = createCoreHarness();
	invalidated.core.openNew();
	await completeNewPreparation(invalidated);
	const staleCreate = invalidated.core.create('issue-131');
	invalidated.core.invalidate('source-change');
	invalidated.creates[0]?.reject(REMOTE_FAILURE);
	assert.deepEqual(await staleCreate, { status: 'superseded' });
	assert.deepEqual(invalidated.core.getState(), { phase: 'idle' });

	const disposed = createCoreHarness();
	disposed.core.openClose();
	await completeClosePreparation(disposed);
	const staleClose = disposed.core.confirmClose();
	disposed.core.dispose();
	disposed.closes[0]?.reject(REMOTE_FAILURE);
	assert.deepEqual(await staleClose, { status: 'superseded' });
	assert.deepEqual(disposed.core.getState(), { phase: 'idle' });
	assert.equal(disposed.errors.length, 0);
});

void test('worktree workspace failure classification is exact', () => {
	for (const operation of [
		WORKTREE_WORKSPACE_PREPARE_NEW_OPERATION_ID,
		WORKTREE_WORKSPACE_CREATE_OPERATION_ID,
		WORKTREE_WORKSPACE_PREPARE_CLOSE_OPERATION_ID,
		WORKTREE_WORKSPACE_CLOSE_OPERATION_ID,
	]) {
		assert.deepEqual(
			classifyWorktreeWorkspaceFailure(
				new Error(`Unknown operation: ${operation}`),
			),
			{ kind: 'unsupported', message: MDEV_BRIDGE_UPDATE_MESSAGE },
		);
	}
	assert.deepEqual(
		classifyWorktreeWorkspaceFailure({
			message: 'request expired',
			failureClass: 'timeout',
		}),
		{
			kind: 'timeout',
			message:
				'Worktree workspace request timed out. The remote operation may have completed; inspect the workspace list before trying again.',
		},
	);
	assert.deepEqual(
		classifyWorktreeWorkspaceFailure(
			new Error('Invalid worktree workspace bridge response.'),
		),
		{
			kind: 'invalid-response',
			message: 'Invalid worktree workspace bridge response.',
		},
	);
	for (const message of [
		'Worktree creation target changed; refusing stale project context',
		'Worktree close target changed; refusing stale workspace window set',
		'Worktree close target changed; refusing to remove stale worktree path',
	]) {
		assert.deepEqual(classifyWorktreeWorkspaceFailure(new Error(message)), {
			kind: 'stale-target',
			message,
		});
	}
	assert.deepEqual(
		classifyWorktreeWorkspaceFailure(new Error('  wt remove failed safely  ')),
		{ kind: 'remote', message: 'wt remove failed safely' },
	);
});

void test('worktree workspace publishes every classified preparation failure', async () => {
	const cases: readonly {
		error: unknown;
		failure: WorktreeWorkspaceFailure;
	}[] = [
		{
			error: new Error(
				`Missing bridge operation ${WORKTREE_WORKSPACE_PREPARE_NEW_OPERATION_ID}`,
			),
			failure: { kind: 'unsupported', message: MDEV_BRIDGE_UPDATE_MESSAGE },
		},
		{
			error: { message: 'request expired', failureClass: 'timeout' },
			failure: {
				kind: 'timeout',
				message:
					'Worktree workspace request timed out. The remote operation may have completed; inspect the workspace list before trying again.',
			},
		},
		{
			error: new Error('Invalid worktree workspace bridge response.'),
			failure: {
				kind: 'invalid-response',
				message: 'Invalid worktree workspace bridge response.',
			},
		},
		{
			error: new Error(
				'Worktree creation target changed; refusing stale project context',
			),
			failure: {
				kind: 'stale-target',
				message:
					'Worktree creation target changed; refusing stale project context',
			},
		},
		{
			error: new Error('wt switch failed safely'),
			failure: { kind: 'remote', message: 'wt switch failed safely' },
		},
	];

	for (const input of cases) {
		const harness = createCoreHarness();
		harness.core.openNew();
		assert.deepEqual(harness.core.getState(), { phase: 'preparing-new' });
		harness.targets[0]?.resolve(NEW_PREPARATION.target);
		await tick();
		assert.deepEqual(harness.core.getState(), { phase: 'preparing-new' });
		harness.newPreparations[0]?.reject(input.error);
		await tick();
		assert.deepEqual(harness.core.getState(), {
			phase: 'preparing-new',
			error: input.failure,
		});
	}
});

const APP_CONTEXT: WorkmuxAppContext = {
	sessionName: 'main',
	target: 'main:2.1',
	windowId: '@2',
	windowIndex: 2,
	windowName: 'fressh',
	workspaceId: 'workspace-131',
	role: 'environment',
	roleWindow: true,
	homeWindow: true,
	paneId: '%3',
	paneTty: '/dev/pts/3',
	panePath: '/home/muly/code/fressh',
	projectRoot: '/home/muly/code/fressh',
	projectName: 'fressh',
};

void test('worktree workspace adapter sends exact typed bridge calls and parses once', async () => {
	const calls: {
		kind: 'command' | 'operation';
		request: unknown;
		options: unknown;
	}[] = [];
	const operationResults: ShellWorkmuxOutcome[] = [
		{ status: 'completed', output: JSON.stringify(NEW_PREPARATION) },
		{ status: 'completed', output: JSON.stringify({ status: 'created' }) },
		{ status: 'completed', output: JSON.stringify(CLOSE_PREPARATION) },
		{ status: 'completed', output: JSON.stringify({ status: 'closed' }) },
	];
	const workmux: Pick<ShellWorkmuxPort, 'command' | 'operation'> = {
		command: async (argv, options) => {
			calls.push({ kind: 'command', request: argv, options });
			return {
				status: 'completed' as const,
				output: JSON.stringify(APP_CONTEXT),
			};
		},
		operation: async (request, options) => {
			calls.push({ kind: 'operation', request, options });
			return operationResults.shift() ?? { status: 'unavailable' as const };
		},
	};
	const adapter = createWorktreeWorkspaceControllerAdapter({
		getCommittedDependencies: () => ({
			connectionAvailable: true,
			tmuxEnabled: true,
			sessionName: 'main',
			sourceKey: SOURCE_KEY,
			workmux,
			arbiter: {
				register: () => () => {},
				requestOpen: ({ onOpen }) => {
					onOpen();
					return true;
				},
			},
		}),
		reportPrecondition: () => {},
		logger: { error: () => {} },
	});

	assert.equal(await adapter.resolveTarget(), APP_CONTEXT.target);
	assert.deepEqual(
		await adapter.prepareNewWorktreeWorkspace(APP_CONTEXT.target),
		NEW_PREPARATION,
	);
	assert.deepEqual(
		await adapter.createWorktreeWorkspace({
			target: NEW_PREPARATION.target,
			expectedProjectRoot: NEW_PREPARATION.projectRoot,
			branch: 'issue-131',
		}),
		{ status: 'created' },
	);
	assert.deepEqual(
		await adapter.prepareCloseWorktreeWorkspace(APP_CONTEXT.target),
		CLOSE_PREPARATION,
	);
	assert.deepEqual(
		await adapter.closeWorktreeWorkspace({
			session: CLOSE_PREPARATION.session,
			workspaceId: CLOSE_PREPARATION.workspaceId,
			expectedWorktreePath: CLOSE_PREPARATION.worktreePath,
			expectedCloseFingerprint: CLOSE_PREPARATION.closeFingerprint,
		}),
		{ status: 'closed' },
	);

	const timeout = { timeoutMs: WORKTREE_WORKSPACE_OPERATION_TIMEOUT_MS };
	assert.deepEqual(calls, [
		{
			kind: 'command',
			request: buildWorkmuxAppContextArgv('main'),
			options: timeout,
		},
		{
			kind: 'operation',
			request: {
				operation: WORKTREE_WORKSPACE_PREPARE_NEW_OPERATION_ID,
				params: { target: APP_CONTEXT.target },
			},
			options: timeout,
		},
		{
			kind: 'operation',
			request: {
				operation: WORKTREE_WORKSPACE_CREATE_OPERATION_ID,
				params: {
					target: NEW_PREPARATION.target,
					expectedProjectRoot: NEW_PREPARATION.projectRoot,
					branch: 'issue-131',
				},
			},
			options: timeout,
		},
		{
			kind: 'operation',
			request: {
				operation: WORKTREE_WORKSPACE_PREPARE_CLOSE_OPERATION_ID,
				params: { target: APP_CONTEXT.target },
			},
			options: timeout,
		},
		{
			kind: 'operation',
			request: {
				operation: WORKTREE_WORKSPACE_CLOSE_OPERATION_ID,
				params: {
					session: CLOSE_PREPARATION.session,
					workspaceId: CLOSE_PREPARATION.workspaceId,
					expectedWorktreePath: CLOSE_PREPARATION.worktreePath,
					expectedCloseFingerprint: CLOSE_PREPARATION.closeFingerprint,
				},
			},
			options: timeout,
		},
	]);
	assert.equal('sendTextRaw' in adapter, false);
	assert.equal('sendBytes' in adapter, false);
	assert.equal('runCommandSteps' in adapter, false);
});

void test('worktree workspace adapter turns failed results and malformed output into classified failures', async () => {
	const results: ShellWorkmuxOutcome[] = [
		{
			status: 'failed',
			failure: {
				message: `Unsupported operation ${WORKTREE_WORKSPACE_PREPARE_NEW_OPERATION_ID}`,
			},
		},
		{ status: 'completed', output: '{}' },
		{
			status: 'failed',
			failure: {
				message: 'Timed out after 60000ms',
				failureClass: 'timeout',
			},
		},
		{ status: 'superseded' },
		{ status: 'unavailable' },
	];
	const workmux: Pick<ShellWorkmuxPort, 'command' | 'operation'> = {
		command: async () => ({
			status: 'completed' as const,
			output: JSON.stringify(APP_CONTEXT),
		}),
		operation: async () =>
			results.shift() ?? { status: 'unavailable' as const },
	};
	const adapter = createWorktreeWorkspaceControllerAdapter({
		getCommittedDependencies: () => ({
			connectionAvailable: true,
			tmuxEnabled: true,
			sessionName: 'main',
			sourceKey: SOURCE_KEY,
			workmux,
			arbiter: {
				register: () => () => {},
				requestOpen: () => false,
			},
		}),
		reportPrecondition: () => {},
		logger: { error: () => {} },
	});

	await assert.rejects(
		adapter.prepareNewWorktreeWorkspace(APP_CONTEXT.target),
		(error) => {
			assert.deepEqual(classifyWorktreeWorkspaceFailure(error), {
				kind: 'unsupported',
				message: MDEV_BRIDGE_UPDATE_MESSAGE,
			});
			return true;
		},
	);
	await assert.rejects(
		adapter.createWorktreeWorkspace({
			target: NEW_PREPARATION.target,
			expectedProjectRoot: NEW_PREPARATION.projectRoot,
			branch: 'issue-131',
		}),
		(error) => {
			assert.deepEqual(classifyWorktreeWorkspaceFailure(error), {
				kind: 'invalid-response',
				message: 'Invalid worktree workspace bridge response.',
			});
			return true;
		},
	);
	await assert.rejects(
		adapter.prepareCloseWorktreeWorkspace(APP_CONTEXT.target),
		(error) => {
			assert.deepEqual(classifyWorktreeWorkspaceFailure(error), {
				kind: 'timeout',
				message:
					'Worktree workspace request timed out. The remote operation may have completed; inspect the workspace list before trying again.',
			});
			return true;
		},
	);
	await assert.rejects(
		adapter.closeWorktreeWorkspace({
			session: CLOSE_PREPARATION.session,
			workspaceId: CLOSE_PREPARATION.workspaceId,
			expectedWorktreePath: CLOSE_PREPARATION.worktreePath,
			expectedCloseFingerprint: CLOSE_PREPARATION.closeFingerprint,
		}),
		/Worktree workspace request was superseded\./,
	);
	await assert.rejects(
		adapter.closeWorktreeWorkspace({
			session: CLOSE_PREPARATION.session,
			workspaceId: CLOSE_PREPARATION.workspaceId,
			expectedWorktreePath: CLOSE_PREPARATION.worktreePath,
			expectedCloseFingerprint: CLOSE_PREPARATION.closeFingerprint,
		}),
		/Worktree workspace request is unavailable\./,
	);
});
