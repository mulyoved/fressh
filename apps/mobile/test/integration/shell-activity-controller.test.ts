import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createShellActivityControllerCore } from '../../src/lib/shell-controllers/activity-core';

void test('activity generation advances at interactive boundaries only', () => {
	const core = createShellActivityControllerCore({
		focused: true,
		appState: 'active',
	});
	assert.deepEqual(core.getSnapshot(), {
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 0,
	});

	core.setFocused(true);
	assert.equal(core.getSnapshot().generation, 0);
	core.setFocused(false);
	assert.equal(core.getSnapshot().generation, 1);
	core.setAppState('background');
	assert.equal(core.getSnapshot().generation, 1);
	core.setFocused(true);
	assert.equal(core.getSnapshot().generation, 1);
	core.setAppState('active');
	assert.equal(core.getSnapshot().generation, 2);
});

void test('activity publishes only changed snapshots', () => {
	const core = createShellActivityControllerCore({
		focused: true,
		appState: 'active',
	});
	let publishCount = 0;
	const unsubscribe = core.subscribe(() => {
		publishCount += 1;
	});

	core.setFocused(true);
	core.setAppState('active');
	assert.equal(publishCount, 0);

	core.setAppState('inactive');
	assert.equal(publishCount, 1);
	assert.deepEqual(core.getSnapshot(), {
		focused: true,
		appState: 'inactive',
		appActive: false,
		interactive: false,
		generation: 1,
	});

	unsubscribe();
	core.setFocused(false);
	assert.equal(publishCount, 1);
});

void test('activity invalidation maps lifecycle reasons to activity signals', () => {
	const focusCore = createShellActivityControllerCore({
		focused: true,
		appState: 'active',
	});
	focusCore.invalidate('focus-lost');
	assert.equal(focusCore.getSnapshot().focused, false);
	assert.equal(focusCore.getSnapshot().interactive, false);

	const appStateCore = createShellActivityControllerCore({
		focused: true,
		appState: 'active',
	});
	appStateCore.invalidate('app-inactive');
	assert.equal(appStateCore.getSnapshot().appState, 'inactive');
	assert.equal(appStateCore.getSnapshot().appActive, false);
	assert.equal(appStateCore.getSnapshot().interactive, false);
});

void test('activity setters are safe as unbound platform callbacks', () => {
	const core = createShellActivityControllerCore({
		focused: true,
		appState: 'active',
	});
	const setFocused = core.setFocused;
	const setAppState = core.setAppState;

	setFocused(false);
	setAppState('background');

	assert.deepEqual(core.getSnapshot(), {
		focused: false,
		appState: 'background',
		appActive: false,
		interactive: false,
		generation: 1,
	});
});

void test('activity dispose publishes a final noninteractive state once', () => {
	const core = createShellActivityControllerCore({
		focused: true,
		appState: 'active',
	});
	let publishCount = 0;
	core.subscribe(() => {
		publishCount += 1;
	});

	core.dispose();
	core.dispose();

	assert.equal(core.getSnapshot().interactive, false);
	assert.equal(core.getSnapshot().generation, 1);
	assert.equal(publishCount, 1);
	core.setFocused(true);
	assert.equal(core.getSnapshot().interactive, false);
});

void test('activity hook uses replay-safe disposal for its retained core', () => {
	const source = readFileSync('src/lib/shell-controllers/activity.tsx', 'utf8');

	assert.match(source, /createReplaySafeDisposer\(core\.dispose\)/);
	assert.match(source, /useEffect\(\(\) => coreLifecycle\.setup\(\)/);
	assert.doesNotMatch(source, /useEffect\(\(\) => \(\) => core\.dispose\(\)/);
});
