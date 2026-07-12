import assert from 'node:assert/strict';
import test from 'node:test';
import { createReplaySafeDisposer } from '../../src/lib/shell-controllers/controller-core';
import { createShellModalArbiter } from '../../src/lib/shell-controllers/modal-arbiter';
import { createShellSimpleModalsCore } from '../../src/lib/shell-controllers/simple-modals';

function createTaskQueue() {
	const tasks: (() => void)[] = [];
	return {
		schedule: (task: () => void) => tasks.push(task),
		flush: () => {
			let task = tasks.shift();
			while (task) {
				task();
				task = tasks.shift();
			}
		},
	};
}

void test('modal arbiter closes conflicts in requested order before opening', () => {
	const events: string[] = [];
	const arbiter = createShellModalArbiter();
	arbiter.register('commander', () => {
		events.push('close:commander');
	});
	arbiter.register('configure', () => {
		events.push('close:configure');
	});

	const opened = arbiter.requestOpen({
		target: 'browser-actions',
		conflicts: ['commander', 'configure'],
		onOpen: () => events.push('open:browser-actions'),
	});

	assert.equal(opened, true);
	assert.deepEqual(events, [
		'close:commander',
		'close:configure',
		'open:browser-actions',
	]);
});

void test('modal arbiter stops on close veto and does not open target', () => {
	const events: string[] = [];
	const arbiter = createShellModalArbiter();
	arbiter.register('feature-request', () => {
		events.push('veto:feature-request');
		return false;
	});
	arbiter.register('configure', () => {
		events.push('close:configure');
	});

	assert.equal(
		arbiter.requestOpen({
			target: 'browser-actions',
			conflicts: ['feature-request', 'configure'],
			onOpen: () => events.push('opened'),
		}),
		false,
	);
	assert.deepEqual(events, ['veto:feature-request']);
});

void test('modal arbiter stale unregister keeps a replacement closer registered', () => {
	const events: string[] = [];
	const arbiter = createShellModalArbiter();
	const unregisterStale = arbiter.register('commander', () => {
		events.push('stale');
	});
	arbiter.register('commander', () => {
		events.push('replacement');
	});
	unregisterStale();

	assert.equal(
		arbiter.requestOpen({
			target: 'configure',
			conflicts: ['configure', 'commander'],
			onOpen: () => events.push('open:configure'),
		}),
		true,
	);
	assert.deepEqual(events, ['replacement', 'open:configure']);
});

void test('modal arbiter current unregister removes its closer', () => {
	const events: string[] = [];
	const arbiter = createShellModalArbiter();
	const unregister = arbiter.register('commander', () => {
		events.push('close:commander');
	});
	unregister();

	assert.equal(
		arbiter.requestOpen({
			target: 'configure',
			conflicts: ['commander'],
			onOpen: () => events.push('open:configure'),
		}),
		true,
	);
	assert.deepEqual(events, ['open:configure']);
});

void test('modal arbiter passes the opening target to a closer', () => {
	let context: unknown;
	const arbiter = createShellModalArbiter();
	arbiter.register('commander', (nextContext) => {
		context = nextContext;
	});

	arbiter.requestOpen({
		target: 'skill-selector',
		conflicts: ['commander'],
		onOpen: () => {},
	});

	assert.deepEqual(context, { opening: 'skill-selector' });
});

void test('modal arbiter skips a registered target closer', () => {
	const events: string[] = [];
	const arbiter = createShellModalArbiter();
	arbiter.register('browser-actions', () => {
		events.push('close:browser-actions');
	});

	arbiter.requestOpen({
		target: 'browser-actions',
		conflicts: ['browser-actions'],
		onOpen: () => events.push('open:browser-actions'),
	});

	assert.deepEqual(events, ['open:browser-actions']);
});

void test('simple modal core owns open state and disposal', () => {
	const core = createShellSimpleModalsCore();
	core.open('commander');
	core.open('text-entry');
	assert.deepEqual(core.getSnapshot(), {
		commandMenu: false,
		commander: true,
		textEntry: true,
		configure: false,
	});
	core.close('commander');
	let disposedSnapshot = core.getSnapshot();
	core.subscribe(() => {
		disposedSnapshot = core.getSnapshot();
	});
	core.dispose();
	core.open('configure');
	const closedSnapshot = {
		commandMenu: false,
		commander: false,
		textEntry: false,
		configure: false,
	};
	assert.deepEqual(disposedSnapshot, closedSnapshot);
	assert.deepEqual(core.getSnapshot(), closedSnapshot);
});

void test('simple modal core invalidation closes every modal', () => {
	const core = createShellSimpleModalsCore();
	core.open('command-menu');
	core.open('commander');
	core.open('text-entry');
	core.open('configure');

	core.invalidate('focus-lost');

	assert.deepEqual(core.getSnapshot(), {
		commandMenu: false,
		commander: false,
		textEntry: false,
		configure: false,
	});
});

void test('replay setup cancels queued disposal before real unmount disposes', () => {
	const queue = createTaskQueue();
	let disposalCount = 0;
	const lifecycle = createReplaySafeDisposer(() => {
		disposalCount += 1;
	}, queue.schedule);
	const replayCleanup = lifecycle.setup();

	replayCleanup();
	const realUnmountCleanup = lifecycle.setup();
	queue.flush();
	assert.equal(disposalCount, 0);

	realUnmountCleanup();
	queue.flush();
	assert.equal(disposalCount, 1);
});

void test('real unmount cleanup disposes after the deferred boundary', () => {
	const queue = createTaskQueue();
	let disposalCount = 0;
	const lifecycle = createReplaySafeDisposer(() => {
		disposalCount += 1;
	}, queue.schedule);
	const cleanup = lifecycle.setup();

	cleanup();
	assert.equal(disposalCount, 0);
	queue.flush();

	assert.equal(disposalCount, 1);
});
