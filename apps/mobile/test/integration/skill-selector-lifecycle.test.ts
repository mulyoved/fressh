import assert from 'node:assert/strict';
import test from 'node:test';
import { syncSkillSelectorControllerSource } from '../../src/lib/shell-controllers/skill-selector-lifecycle';

void test('skill selector invalidates once for a tmux-only source change', () => {
	const events: string[] = [];
	const committed = {
		current: { sourceKey: 'target-1', tmuxEnabled: false, label: 'old' },
	};
	const tracked = {
		current: { sourceKey: 'target-1', tmuxEnabled: false },
	};
	const dependencies = {
		sourceKey: 'target-1',
		tmuxEnabled: true,
		label: 'current',
	};

	syncSkillSelectorControllerSource({
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
	});
});

void test('skill selector avoids double invalidation when target and tmux change together', () => {
	const events: string[] = [];
	const committed = {
		current: { sourceKey: 'target-1', tmuxEnabled: false },
	};
	const tracked = {
		current: { sourceKey: 'target-1', tmuxEnabled: false },
	};

	syncSkillSelectorControllerSource({
		committedDependencies: committed,
		trackedSource: tracked,
		dependencies: { sourceKey: 'target-2', tmuxEnabled: true },
		core: {
			setSourceKey: (sourceKey) => events.push(`source:${sourceKey}`),
			invalidate: (reason) => events.push(`invalidate:${reason}`),
		},
	});

	assert.deepEqual(events, ['source:target-2']);
});
