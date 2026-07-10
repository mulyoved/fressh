import assert from 'node:assert/strict';
import test from 'node:test';
import { createSkillSelectorControllerCore } from '../../src/lib/shell-controllers/skill-selector-core';
import { type DiscoveredSkill } from '../../src/lib/skill-discovery';

type Deferred<T> = {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
};

type LoadedProject = {
	projectName: string;
	projectRoot: string;
	updatedAt: string | null;
	skills: DiscoveredSkill[];
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

function createSkillSelectorHarness(options?: { requestOpen?: boolean }) {
	const loads: Deferred<LoadedProject>[] = [];
	const forceRefreshes: boolean[] = [];
	const sentText: string[] = [];
	const core = createSkillSelectorControllerCore({
		initialSourceKey: 'source-1',
		loadProject: ({ forceRefresh }) => {
			forceRefreshes.push(forceRefresh);
			const load = createDeferred<LoadedProject>();
			loads.push(load);
			return load.promise;
		},
		sendText: (value) => sentText.push(value),
		requestOpen: (onOpen) => {
			if (options?.requestOpen === false) return false;
			onOpen();
			return true;
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	return {
		core,
		loads,
		forceRefreshes,
		sentText,
		settled: () => new Promise<void>((resolve) => setImmediate(resolve)),
	};
}

const brainstorming: DiscoveredSkill = {
	name: 'brainstorming',
	path: '/repo/fressh/.codex/skills/brainstorming/SKILL.md',
	description: 'Design',
};

void test('skill selector publishes loaded project for the current source', async () => {
	const harness = createSkillSelectorHarness();
	harness.core.open();
	harness.loads[0]?.resolve({
		projectName: 'fressh',
		projectRoot: '/repo/fressh',
		updatedAt: '2026-07-10T00:00:00Z',
		skills: [brainstorming],
	});
	await harness.settled();

	assert.deepEqual(harness.core.getSnapshot(), {
		open: true,
		skills: [brainstorming],
		projectName: 'fressh',
		projectRoot: '/repo/fressh',
		updatedAt: '2026-07-10T00:00:00Z',
		isLoading: false,
		isRefreshing: false,
		error: null,
		refreshError: null,
	});
	assert.deepEqual(harness.forceRefreshes, [false]);
});

void test('skill selector suppresses completion after source invalidation', async () => {
	const harness = createSkillSelectorHarness();
	harness.core.open();
	harness.core.setSourceKey('source-2');
	harness.loads[0]?.resolve({
		projectName: 'stale',
		projectRoot: '/stale',
		updatedAt: null,
		skills: [],
	});
	await harness.settled();

	assert.equal(harness.core.getSnapshot().open, false);
	assert.equal(harness.core.getSnapshot().projectName, null);
});

void test('skill selector refresh preserves visible skills and reports refresh errors', async () => {
	const harness = createSkillSelectorHarness();
	harness.core.open();
	harness.loads[0]?.resolve({
		projectName: 'fressh',
		projectRoot: '/repo/fressh',
		updatedAt: null,
		skills: [brainstorming],
	});
	await harness.settled();

	harness.core.refresh();
	assert.equal(harness.core.getSnapshot().isRefreshing, true);
	assert.deepEqual(harness.core.getSnapshot().skills, [brainstorming]);
	harness.loads[1]?.reject(new Error('refresh failed'));
	await harness.settled();

	assert.equal(harness.core.getSnapshot().error, null);
	assert.equal(harness.core.getSnapshot().refreshError, 'refresh failed');
	assert.deepEqual(harness.core.getSnapshot().skills, [brainstorming]);
	assert.deepEqual(harness.forceRefreshes, [false, true]);
});

void test('skill selector selects only from the current source and then closes', async () => {
	const harness = createSkillSelectorHarness();
	harness.core.open();
	harness.loads[0]?.resolve({
		projectName: 'fressh',
		projectRoot: '/repo/fressh',
		updatedAt: null,
		skills: [brainstorming],
	});
	await harness.settled();

	harness.core.select(brainstorming);

	assert.deepEqual(harness.sentText, ['$brainstorming ']);
	assert.equal(harness.core.getSnapshot().open, false);
});

void test('skill selector respects an open veto without loading', () => {
	const harness = createSkillSelectorHarness({ requestOpen: false });

	harness.core.open();

	assert.equal(harness.core.getSnapshot().open, false);
	assert.equal(harness.loads.length, 0);
});

void test('skill selector disposal clears state and suppresses pending completion', async () => {
	const harness = createSkillSelectorHarness();
	harness.core.open();
	harness.core.dispose();
	harness.loads[0]?.resolve({
		projectName: 'stale',
		projectRoot: '/stale',
		updatedAt: null,
		skills: [brainstorming],
	});
	await harness.settled();

	assert.equal(harness.core.getSnapshot().open, false);
	assert.deepEqual(harness.core.getSnapshot().skills, []);
	harness.core.open();
	assert.equal(harness.loads.length, 1);
});
