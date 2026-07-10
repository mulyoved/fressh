import assert from 'node:assert/strict';
import test from 'node:test';
import { syncControllerSource } from '../../src/lib/shell-controllers/controller-lifecycle';

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
		current: { sourceKey: 'target-1', tmuxEnabled: false, connection },
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
		connection,
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
			connection: firstConnection,
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
			connection: firstConnection,
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
		core: {
			setSourceKey: (sourceKey) => events.push(`source:${sourceKey}`),
			invalidate: (reason) => events.push(`invalidate:${reason}`),
		},
	});

	assert.deepEqual(events, ['source:target-1', 'invalidate:source-change']);
	assert.equal(tracked.current.connection, secondConnection);
});
