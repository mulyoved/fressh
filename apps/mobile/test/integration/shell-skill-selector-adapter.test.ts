import assert from 'node:assert/strict';
import test from 'node:test';
import { type ShellModalArbiter } from '../../src/lib/shell-controllers/modal-arbiter';
import {
	createSkillSelectorControllerAdapter,
	type SkillSelectorControllerDependencies,
	type SkillSelectorProjectLoader,
} from '../../src/lib/shell-controllers/skill-selector-adapter';
import { type SkillDiscoveryCache } from '../../src/lib/skill-discovery-cache';
import { type SkillSelectorProjectLoadResult } from '../../src/lib/skill-selector-loader';

type TestConnection = { id: string };

const cache: SkillDiscoveryCache = {
	read: () => null,
	write: () => {
		throw new Error('not used');
	},
	delete: () => {},
};

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

function createDependencies(
	overrides?: Partial<SkillSelectorControllerDependencies<TestConnection>>,
): SkillSelectorControllerDependencies<TestConnection> {
	return {
		connection: { id: 'connection' },
		tmuxEnabled: true,
		runHostBrowserCommand: async () => 'output',
		resolveHostBrowserWorkspace: async () => ({
			panePath: '/pane',
			projectRoot: '/repo/fressh',
			projectName: 'fressh',
		}),
		sendTextRaw: () => {},
		sourceKey: 'source-1',
		stableConnectionId: 'stable-1',
		tmuxTarget: 'work',
		getErrorMessage: (error) => String(error),
		arbiter: createArbiterHarness().arbiter,
		...overrides,
	};
}

void test('skill selector adapter rejects unavailable connection before loading', async () => {
	let loadCount = 0;
	const adapter = createSkillSelectorControllerAdapter({
		getCommittedDependencies: () => createDependencies({ connection: null }),
		cache,
		loadProject: async () => {
			loadCount += 1;
			throw new Error('unexpected');
		},
	});

	await assert.rejects(
		adapter.loadProject({ forceRefresh: false }),
		/No SSH connection available\./,
	);
	assert.equal(loadCount, 0);
});

void test('skill selector adapter rejects a connection without tmux', async () => {
	const adapter = createSkillSelectorControllerAdapter({
		getCommittedDependencies: () => createDependencies({ tmuxEnabled: false }),
		cache,
		loadProject: async () => {
			throw new Error('unexpected');
		},
	});

	await assert.rejects(
		adapter.loadProject({ forceRefresh: false }),
		/Skill selector requires a tmux-enabled connection\./,
	);
});

void test('skill selector adapter forwards committed load dependencies and timeout', async () => {
	const commands: { command: string; timeoutMs: number | undefined }[] = [];
	const workspace = {
		panePath: '/pane',
		projectRoot: '/repo/current',
		projectName: 'current',
	};
	let received: Parameters<SkillSelectorProjectLoader>[0] | undefined;
	let committed = createDependencies({
		stableConnectionId: 'stale',
		tmuxTarget: 'stale',
	});
	const adapter = createSkillSelectorControllerAdapter({
		getCommittedDependencies: () => committed,
		cache,
		loadProject: async (input) => {
			received = input;
			const resolvedWorkspace = await input.resolveWorkspace();
			const output = await input.runCommand('discover-skills');
			assert.equal(output, 'discovered');
			return {
				source: 'remote',
				projectRoot: resolvedWorkspace.projectRoot,
				projectName: resolvedWorkspace.projectName,
				skills: [],
				updatedAt: null,
				cacheRecord: null,
			} satisfies SkillSelectorProjectLoadResult;
		},
	});
	committed = createDependencies({
		stableConnectionId: 'stable-current',
		tmuxTarget: 'target-current',
		resolveHostBrowserWorkspace: async () => workspace,
		runHostBrowserCommand: async (command, timeoutMs) => {
			commands.push({ command, timeoutMs });
			return 'discovered';
		},
	});

	const result = await adapter.loadProject({ forceRefresh: true });

	assert.equal(received?.cache, cache);
	assert.equal(received?.stableConnectionId, 'stable-current');
	assert.equal(received?.tmuxTarget, 'target-current');
	assert.equal(received?.forceRefresh, true);
	assert.deepEqual(commands, [
		{ command: 'discover-skills', timeoutMs: 10_000 },
	]);
	assert.equal(result.projectRoot, workspace.projectRoot);
});

void test('skill selector adapter uses current committed callbacks and conflict order', () => {
	const staleArbiter = createArbiterHarness();
	const currentArbiter = createArbiterHarness();
	const sent: string[] = [];
	let committed = createDependencies({ arbiter: staleArbiter.arbiter });
	const adapter = createSkillSelectorControllerAdapter({
		getCommittedDependencies: () => committed,
		cache,
		loadProject: async () => {
			throw new Error('not used');
		},
	});
	committed = createDependencies({
		arbiter: currentArbiter.arbiter,
		sendTextRaw: (value) => sent.push(value),
		getErrorMessage: () => 'current error',
	});
	let opened = false;

	adapter.sendText('text');
	assert.equal(adapter.getErrorMessage(new Error('ignored')), 'current error');
	assert.equal(
		adapter.requestOpen(() => {
			opened = true;
		}),
		true,
	);

	assert.deepEqual(sent, ['text']);
	assert.equal(opened, true);
	assert.equal(currentArbiter.getRequested()?.target, 'skill-selector');
	assert.deepEqual(currentArbiter.getRequested()?.conflicts, [
		'command-menu',
		'browser-actions',
		'commander',
		'configure',
		'feature-request',
		'text-entry',
	]);
	assert.equal(staleArbiter.getRequested(), undefined);
});

void test('skill selector adapter registers and unregisters its close command', () => {
	const arbiterHarness = createArbiterHarness();
	const adapter = createSkillSelectorControllerAdapter({
		getCommittedDependencies: () =>
			createDependencies({ arbiter: arbiterHarness.arbiter }),
		cache,
		loadProject: async () => {
			throw new Error('not used');
		},
	});
	let closeCount = 0;

	const unregister = adapter.registerClose(() => {
		closeCount += 1;
	});
	assert.equal(arbiterHarness.getRegistered()?.id, 'skill-selector');
	arbiterHarness.getRegistered()?.close({ opening: 'configure' });
	assert.equal(closeCount, 1);
	unregister();
	assert.equal(arbiterHarness.getUnregisterCount(), 1);
});
