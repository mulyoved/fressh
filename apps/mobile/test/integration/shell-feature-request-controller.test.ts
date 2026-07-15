import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCreateGitHubIssueCommand } from '../../src/lib/repo-feature-request';
import { createReplaySafeControllerLifecycle } from '../../src/lib/shell-controllers/controller-lifecycle';
import { createFeatureRequestControllerAdapter } from '../../src/lib/shell-controllers/feature-request-adapter';
import {
	createFeatureRequestControllerCore,
	type FeatureRequestSubmissionResult,
} from '../../src/lib/shell-controllers/feature-request-core';
import { type ShellModalArbiter } from '../../src/lib/shell-controllers/modal-arbiter';

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

function createFeatureRequestHarness(options?: {
	connected?: boolean;
	requestOpen?: boolean;
}) {
	const resolves: Deferred<string>[] = [];
	const submissions: Deferred<FeatureRequestSubmissionResult>[] = [];
	const commands: { command: string; timeoutMs: number }[] = [];
	const alerts: (string | null)[] = [];
	const infoLogs: { message: string; payload?: unknown }[] = [];
	const errorLogs: { message: string; payload?: unknown }[] = [];
	const core = createFeatureRequestControllerCore({
		resolveCurrentGitHubRepository: () => {
			const deferred = createDeferred<string>();
			resolves.push(deferred);
			return deferred.promise;
		},
		isSubmissionAvailable: () => options?.connected !== false,
		executeSubmission: (command, timeoutMs) => {
			commands.push({ command, timeoutMs });
			const deferred = createDeferred<FeatureRequestSubmissionResult>();
			submissions.push(deferred);
			return deferred.promise;
		},
		requestOpen: (onOpen) => {
			if (options?.requestOpen === false) return false;
			onOpen();
			return true;
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
		logger: {
			info: (message, payload) => infoLogs.push({ message, payload }),
			error: (message, payload) => errorLogs.push({ message, payload }),
		},
		showSubmittedAlert: (issueUrl) => alerts.push(issueUrl),
	});

	return {
		core,
		resolves,
		submissions,
		commands,
		alerts,
		infoLogs,
		errorLogs,
		resolveCurrent: async (repository = 'mulyoved/fressh') => {
			resolves.at(-1)?.resolve(repository);
			await new Promise<void>((resolve) => setImmediate(resolve));
		},
		settled: () => new Promise<void>((resolve) => setImmediate(resolve)),
	};
}

void test('feature request resolves the current repository when opened', async () => {
	const harness = createFeatureRequestHarness();
	harness.core.open();
	assert.deepEqual(harness.core.getSnapshot(), {
		open: true,
		isSubmitting: false,
		targetRepository: null,
		isResolvingTarget: true,
		error: undefined,
	});

	await harness.resolveCurrent();

	assert.deepEqual(harness.core.getSnapshot(), {
		open: true,
		isSubmitting: false,
		targetRepository: 'mulyoved/fressh',
		isResolvingTarget: false,
		error: undefined,
	});
});

void test('feature request suppresses stale repository resolution', async () => {
	const harness = createFeatureRequestHarness();
	harness.core.open();
	harness.core.markSourceStale();
	harness.resolves[0]?.resolve('stale/repository');
	await harness.settled();

	assert.deepEqual(harness.core.getSnapshot(), {
		open: false,
		isSubmitting: false,
		targetRepository: null,
		isResolvingTarget: false,
		error: undefined,
	});
});

void test('feature request publishes current repository resolution errors', async () => {
	const harness = createFeatureRequestHarness();
	harness.core.open();
	harness.resolves[0]?.reject(new Error('repository unavailable'));
	await harness.settled();

	assert.deepEqual(harness.core.getSnapshot(), {
		open: true,
		isSubmitting: false,
		targetRepository: null,
		isResolvingTarget: false,
		error: 'repository unavailable',
	});
});

void test('feature request close vetoes while submission is active', async () => {
	const harness = createFeatureRequestHarness();
	harness.core.open();
	await harness.resolveCurrent();
	const pending = harness.core.submit('description', 'mulyoved/fressh');
	assert.equal(harness.core.close(), false);
	harness.core.markSourceStale();
	harness.submissions[0]?.resolve({
		status: 'completed',
		output: '',
		issueUrl: 'https://github.com/mulyoved/fressh/issues/1',
	});
	await pending;
	assert.equal(harness.alerts.length, 0);
	assert.equal(harness.core.getSnapshot().open, false);
});

void test('feature request current success closes and alerts once', async () => {
	const harness = createFeatureRequestHarness();
	harness.core.open();
	await harness.resolveCurrent();
	const description = 'Add deterministic controller ownership';
	const repository = 'mulyoved/fressh';
	const pending = harness.core.submit(description, repository);
	harness.submissions[0]?.resolve({
		status: 'completed',
		output: '',
		issueUrl: null,
	});
	await pending;
	assert.equal(harness.core.getSnapshot().open, false);
	assert.equal(harness.core.getSnapshot().isSubmitting, false);
	assert.equal(harness.alerts.length, 1);
	assert.deepEqual(harness.commands, [
		{
			command: buildCreateGitHubIssueCommand({ description, repository }),
			timeoutMs: 60_000,
		},
	]);
	assert.equal(
		harness.infoLogs[0]?.message,
		'Feature request submitted successfully',
	);
});

void test('feature request preserves submission fallback messages', async () => {
	const disconnected = createFeatureRequestHarness({ connected: false });
	await disconnected.core.submit('description', 'mulyoved/fressh');
	assert.equal(
		disconnected.core.getSnapshot().error,
		'No SSH connection available',
	);

	const unresolved = createFeatureRequestHarness();
	await unresolved.core.submit('description', '');
	assert.equal(
		unresolved.core.getSnapshot().error,
		'Could not resolve GitHub repository for current window.',
	);

	const failed = createFeatureRequestHarness();
	const pending = failed.core.submit('description', 'mulyoved/fressh');
	failed.submissions[0]?.resolve({
		status: 'failed',
		failure: {
			message:
				'Failed to create issue. Make sure gh and claude CLIs are installed and authenticated on the remote host.',
		},
		output: '',
	});
	await pending;
	assert.equal(
		failed.core.getSnapshot().error,
		'Failed to create issue. Make sure gh and claude CLIs are installed and authenticated on the remote host.',
	);
	assert.equal(failed.core.getSnapshot().isSubmitting, false);
});

void test('feature request submission rejection logs and clears submitting', async () => {
	const harness = createFeatureRequestHarness();
	const pending = harness.core.submit('description', 'mulyoved/fressh');
	harness.submissions[0]?.reject(new Error('submission transport failed'));
	await pending;

	assert.equal(harness.core.getSnapshot().error, 'submission transport failed');
	assert.equal(harness.core.getSnapshot().isSubmitting, false);
	assert.equal(harness.errorLogs.length, 1);
	assert.equal(harness.errorLogs[0]?.message, 'Feature request error');
});

void test('feature request suppresses resolver success after a newer submission error', async () => {
	const harness = createFeatureRequestHarness();
	harness.core.open();
	const pending = harness.core.submit('description', 'pinned/repository');
	assert.equal(harness.core.getSnapshot().isResolvingTarget, false);
	harness.submissions[0]?.resolve({
		status: 'failed',
		output: '',
		failure: { message: 'pinned submission failed' },
	});
	await pending;
	harness.resolves[0]?.resolve('resolved/current');
	await harness.settled();

	assert.equal(harness.core.getSnapshot().targetRepository, null);
	assert.equal(harness.core.getSnapshot().isResolvingTarget, false);
	assert.equal(harness.core.getSnapshot().error, 'pinned submission failed');
});

void test('feature request suppresses resolver rejection after a newer submission error', async () => {
	const harness = createFeatureRequestHarness();
	harness.core.open();
	const pending = harness.core.submit('description', 'pinned/repository');
	assert.equal(harness.core.getSnapshot().isResolvingTarget, false);
	harness.submissions[0]?.resolve({
		status: 'failed',
		output: '',
		failure: { message: 'pinned submission failed' },
	});
	await pending;
	harness.resolves[0]?.reject(new Error('older resolution failed'));
	await harness.settled();

	assert.equal(harness.core.getSnapshot().targetRepository, null);
	assert.equal(harness.core.getSnapshot().isResolvingTarget, false);
	assert.equal(harness.core.getSnapshot().error, 'pinned submission failed');
});

void test('feature request accepted validation failure cancels repository resolution', async () => {
	const harness = createFeatureRequestHarness({ connected: false });
	harness.core.open();
	await harness.core.submit('description', 'pinned/repository');

	assert.equal(harness.core.getSnapshot().isResolvingTarget, false);
	assert.equal(harness.core.getSnapshot().error, 'No SSH connection available');
	harness.resolves[0]?.resolve('older/current');
	await harness.settled();
	assert.equal(harness.core.getSnapshot().targetRepository, null);
	assert.equal(harness.core.getSnapshot().error, 'No SSH connection available');
});

void test('feature request pinned success closes exactly and suppresses older resolver success', async () => {
	const harness = createFeatureRequestHarness();
	harness.core.open();
	const pending = harness.core.submit('description', 'pinned/repository');
	harness.submissions[0]?.resolve({
		status: 'completed',
		output: '',
		issueUrl: 'https://github.com/pinned/repository/issues/83',
	});
	await pending;

	const closedState = {
		open: false,
		isSubmitting: false,
		targetRepository: null,
		isResolvingTarget: false,
		error: undefined,
	} as const;
	assert.deepEqual(harness.core.getSnapshot(), closedState);
	assert.deepEqual(harness.alerts, [
		'https://github.com/pinned/repository/issues/83',
	]);

	harness.resolves[0]?.resolve('older/current');
	await harness.settled();
	assert.deepEqual(harness.core.getSnapshot(), closedState);
});

void test('feature request pinned success suppresses older resolver rejection', async () => {
	const harness = createFeatureRequestHarness();
	harness.core.open();
	const pending = harness.core.submit('description', 'pinned/repository');
	harness.submissions[0]?.resolve({ status: 'completed', output: '' });
	await pending;
	harness.resolves[0]?.reject(new Error('older resolution failed'));
	await harness.settled();

	assert.deepEqual(harness.core.getSnapshot(), {
		open: false,
		isSubmitting: false,
		targetRepository: null,
		isResolvingTarget: false,
		error: undefined,
	});
});

void test('feature request open during submission starts no new work', async () => {
	const harness = createFeatureRequestHarness();
	harness.core.open();
	const pending = harness.core.submit('description', 'pinned/repository');
	harness.core.open();

	assert.equal(harness.resolves.length, 1);
	assert.equal(harness.commands.length, 1);
	assert.equal(harness.submissions.length, 1);
	harness.submissions[0]?.resolve({
		status: 'failed',
		output: '',
		failure: { message: 'failed' },
	});
	await pending;
});

void test('feature request suppresses a stale rejected submission', async () => {
	const harness = createFeatureRequestHarness();
	harness.core.open();
	const pending = harness.core.submit('description', 'mulyoved/fressh');
	harness.core.markSourceStale();
	harness.submissions[0]?.reject(new Error('stale submission failed'));
	await pending;

	assert.deepEqual(harness.core.getSnapshot(), {
		open: false,
		isSubmitting: false,
		targetRepository: null,
		isResolvingTarget: false,
		error: undefined,
	});
	assert.equal(harness.alerts.length, 0);
	assert.equal(harness.errorLogs.length, 1);
});

void test('feature request ignores repeated submission while one is active', async () => {
	const harness = createFeatureRequestHarness();
	const first = harness.core.submit('first', 'mulyoved/fressh');
	await harness.core.submit('second', 'other/repository');

	assert.equal(harness.commands.length, 1);
	assert.equal(harness.submissions.length, 1);
	harness.submissions[0]?.resolve({
		status: 'failed',
		output: '',
		failure: { message: 'failed' },
	});
	await first;
});

void test('feature request disposal suppresses an active submission', async () => {
	const harness = createFeatureRequestHarness();
	harness.core.open();
	const pending = harness.core.submit('description', 'mulyoved/fressh');
	harness.core.dispose();
	harness.submissions[0]?.resolve({
		status: 'completed',
		output: '',
		issueUrl: 'https://github.com/mulyoved/fressh/issues/83',
	});
	await pending;

	assert.equal(harness.core.getSnapshot().open, false);
	assert.equal(harness.core.getSnapshot().isSubmitting, false);
	assert.equal(harness.alerts.length, 0);
});

void test('feature request lifecycle invalidates synchronously before replay-safe disposal', async () => {
	const harness = createFeatureRequestHarness();
	const queued: (() => void)[] = [];
	const lifecycle = createReplaySafeControllerLifecycle(harness.core, (task) =>
		queued.push(task),
	);
	const cleanup = lifecycle.setup();
	harness.core.open();
	await harness.resolveCurrent();
	const pending = harness.core.submit('description', 'mulyoved/fressh');

	cleanup();
	harness.submissions[0]?.resolve({
		status: 'completed',
		output: '',
		issueUrl: 'https://github.com/mulyoved/fressh/issues/83',
	});
	await pending;

	assert.equal(queued.length, 1);
	assert.deepEqual(harness.alerts, []);
	assert.equal(harness.core.getSnapshot().open, false);
});

void test('feature request suppresses older resolution and respects an open veto', async () => {
	const harness = createFeatureRequestHarness();
	harness.core.open();
	harness.core.open();
	harness.resolves[0]?.resolve('older/repository');
	await harness.settled();
	assert.equal(harness.core.getSnapshot().targetRepository, null);
	harness.resolves[1]?.resolve('newer/repository');
	await harness.settled();
	assert.equal(harness.core.getSnapshot().targetRepository, 'newer/repository');

	const vetoed = createFeatureRequestHarness({ requestOpen: false });
	vetoed.core.open();
	assert.equal(vetoed.core.getSnapshot().open, false);
	assert.equal(vetoed.resolves.length, 0);
});

void test('feature request disposal suppresses pending work permanently', async () => {
	const harness = createFeatureRequestHarness();
	harness.core.open();
	harness.core.dispose();
	harness.resolves[0]?.resolve('stale/repository');
	await harness.settled();
	assert.equal(harness.core.getSnapshot().open, false);
	harness.core.open();
	assert.equal(harness.resolves.length, 1);
});

type TestConnection = { id: string };

function createArbiterHarness() {
	let requested: Parameters<ShellModalArbiter['requestOpen']>[0] | undefined;
	let registered:
		| {
				id: Parameters<ShellModalArbiter['register']>[0];
				close: Parameters<ShellModalArbiter['register']>[1];
		  }
		| undefined;
	let unregisterCount = 0;
	const arbiter: ShellModalArbiter = {
		requestOpen: (input) => {
			requested = input;
			input.onOpen();
			return true;
		},
		register: (id, close) => {
			registered = { id, close };
			return () => {
				unregisterCount += 1;
			};
		},
	};
	return {
		arbiter,
		getRequested: () => requested,
		getRegistered: () => registered,
		getUnregisterCount: () => unregisterCount,
	};
}

function createAdapterDependencies(input?: {
	hostCommands?: TestConnection | null;
	arbiter?: ShellModalArbiter;
	executions?: {
		connection: TestConnection;
		command: string;
		timeoutMs: number;
	}[];
}) {
	const executions = input?.executions ?? [];
	const connection =
		input && 'hostCommands' in input
			? (input.hostCommands ?? null)
			: ({ id: 'connection' } satisfies TestConnection);
	return {
		hostCommands: connection
			? {
					key: 'test-host' as never,
					run: async (command: string, timeoutMs: number) => {
						executions.push({ connection, command, timeoutMs });
						return {
							status: 'completed' as const,
							output: '',
							issueUrl: null,
						};
					},
				}
			: null,
		resolveCurrentGitHubRepository: async () => 'mulyoved/fressh',
		getErrorMessage: (error: unknown) => String(error),
		logger: {
			info: () => {},
			error: () => {},
		},
		arbiter: input?.arbiter ?? createArbiterHarness().arbiter,
	};
}

void test('feature request adapter reads committed submission dependencies', async () => {
	const executions: {
		connection: TestConnection;
		command: string;
		timeoutMs: number;
	}[] = [];
	let committed = createAdapterDependencies({ hostCommands: null, executions });
	const alerts: (string | null)[] = [];
	const adapter = createFeatureRequestControllerAdapter({
		getCommittedDependencies: () => committed,
		showSubmittedAlert: (issueUrl) => alerts.push(issueUrl),
	});
	committed = createAdapterDependencies({
		hostCommands: { id: 'current' },
		executions,
	});

	assert.equal(adapter.isSubmissionAvailable(), true);
	assert.equal(
		await adapter.resolveCurrentGitHubRepository(),
		'mulyoved/fressh',
	);
	await adapter.executeSubmission('command', 60_000);
	adapter.showSubmittedAlert('https://github.com/mulyoved/fressh/issues/83');

	assert.deepEqual(executions, [
		{
			connection: { id: 'current' },
			command: 'command',
			timeoutMs: 60_000,
		},
	]);
	assert.deepEqual(alerts, ['https://github.com/mulyoved/fressh/issues/83']);
});

void test('feature request adapter preserves conflict order and close registration', () => {
	const arbiterHarness = createArbiterHarness();
	const adapter = createFeatureRequestControllerAdapter({
		getCommittedDependencies: () =>
			createAdapterDependencies({ arbiter: arbiterHarness.arbiter }),
		showSubmittedAlert: () => {},
	});
	let opened = false;
	let closeCount = 0;

	assert.equal(
		adapter.requestOpen(() => {
			opened = true;
		}),
		true,
	);
	const unregister = adapter.registerClose(() => {
		closeCount += 1;
		return false;
	});

	assert.equal(opened, true);
	assert.equal(arbiterHarness.getRequested()?.target, 'feature-request');
	assert.deepEqual(arbiterHarness.getRequested()?.conflicts, [
		'browser-actions',
		'skill-selector',
		'configure',
	]);
	assert.equal(arbiterHarness.getRegistered()?.id, 'feature-request');
	assert.equal(
		arbiterHarness.getRegistered()?.close({ opening: 'configure' }),
		false,
	);
	assert.equal(closeCount, 1);
	unregister();
	assert.equal(arbiterHarness.getUnregisterCount(), 1);
});
