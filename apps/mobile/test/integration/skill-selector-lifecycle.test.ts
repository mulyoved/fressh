import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { syncControllerSource } from '../../src/lib/shell-controllers/controller-lifecycle';

void test('controller source synchronization requires an explicit authority selector', () => {
	const source = readFileSync(
		'src/lib/shell-controllers/controller-lifecycle.ts',
		'utf8',
	);

	assert.match(source, /getAuthority\(dependencies: Dependencies\): unknown/);
	assert.doesNotMatch(source, /getAuthority\?/);
	assert.doesNotMatch(source, /as Dependencies & \{ connection\?: unknown \}/);
});

void test('skill selector invalidates once for a tmux-only source change', () => {
	const events: string[] = [];
	const connection = { id: 'connection-1' };
	const committed = {
		current: {
			sourceKey: 'target-1',
			tmuxEnabled: false,
			connection,
			label: 'old',
		},
	};
	const tracked = {
		current: {
			sourceKey: 'target-1',
			tmuxEnabled: false,
			authority: connection,
		},
	};
	const dependencies = {
		sourceKey: 'target-1',
		tmuxEnabled: true,
		connection,
		label: 'current',
	};

	syncControllerSource({
		committedDependencies: committed,
		trackedSource: tracked,
		dependencies,
		getAuthority: (current) => current.connection,
		core: {
			setSourceKey: (sourceKey) => events.push(`source:${sourceKey}`),
			invalidate: (reason) => events.push(`invalidate:${reason}`),
		},
	});

	assert.deepEqual(events, ['source:target-1', 'invalidate:source-change']);
	assert.equal(committed.current, dependencies);
	assert.deepEqual(tracked.current, {
		sourceKey: 'target-1',
		tmuxEnabled: true,
		authority: connection,
	});
});

void test('skill selector avoids double invalidation when target and tmux change together', () => {
	const events: string[] = [];
	const firstConnection = { id: 'connection-1' };
	const committed = {
		current: {
			sourceKey: 'target-1',
			tmuxEnabled: false,
			connection: firstConnection,
		},
	};
	const tracked = {
		current: {
			sourceKey: 'target-1',
			tmuxEnabled: false,
			authority: firstConnection,
		},
	};

	syncControllerSource({
		committedDependencies: committed,
		trackedSource: tracked,
		dependencies: {
			sourceKey: 'target-2',
			tmuxEnabled: true,
			connection: { id: 'connection-2' },
		},
		getAuthority: (current) => current.connection,
		core: {
			setSourceKey: (sourceKey) => events.push(`source:${sourceKey}`),
			invalidate: (reason) => events.push(`invalidate:${reason}`),
		},
	});

	assert.deepEqual(events, ['source:target-2']);
});

void test('skill selector invalidates once when the connection handle is replaced', () => {
	const events: string[] = [];
	const firstConnection = { id: 'connection-1' };
	const secondConnection = { id: 'connection-2' };
	const committed = {
		current: {
			sourceKey: 'target-1',
			tmuxEnabled: true,
			connection: firstConnection,
		},
	};
	const tracked = {
		current: {
			sourceKey: 'target-1',
			tmuxEnabled: true,
			authority: firstConnection,
		},
	};

	syncControllerSource({
		committedDependencies: committed,
		trackedSource: tracked,
		dependencies: {
			sourceKey: 'target-1',
			tmuxEnabled: true,
			connection: secondConnection,
		},
		getAuthority: (current) => current.connection,
		core: {
			setSourceKey: (sourceKey) => events.push(`source:${sourceKey}`),
			invalidate: (reason) => events.push(`invalidate:${reason}`),
		},
	});

	assert.deepEqual(events, ['source:target-1', 'invalidate:source-change']);
	assert.equal(tracked.current.authority, secondConnection);
});
