import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellModalArbiter } from '../../src/lib/shell-controllers/modal-arbiter';
import { createShellSimpleModalsCore } from '../../src/lib/shell-controllers/simple-modals';

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

	assert.equal(
		arbiter.requestOpen({
			target: 'browser-actions',
			conflicts: ['feature-request'],
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
	core.dispose();
	core.open('configure');
	assert.equal(core.getSnapshot().commander, false);
	assert.equal(core.getSnapshot().configure, false);
});
