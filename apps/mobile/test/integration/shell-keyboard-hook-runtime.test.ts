import assert from 'node:assert/strict';
import test from 'node:test';
import {
	applyKeyboardSelectionMode,
	createKeyboardAnimationIdentityTracker,
	createKeyboardClipboardAuthority,
	createKeyboardControllerAdmission,
	subscribeKeyboardVisibility,
} from '../../src/lib/shell-controllers/keyboard-hook-runtime';

void test('animation identity survives setup replay and animates semantic replacement once', () => {
	const tracker = createKeyboardAnimationIdentityTracker('main');
	assert.equal(tracker.replace('main'), false);
	assert.equal(tracker.replace('main'), false);
	assert.equal(tracker.replace('advanced'), true);
	assert.equal(tracker.replace('advanced'), false);
});

void test('Android visibility subscription owns exactly one listener pair and cleanup', () => {
	const listeners = new Map<string, () => void>();
	const removed: string[] = [];
	const visible: boolean[] = [];
	const cleanup = subscribeKeyboardVisibility({
		platformOS: 'android',
		addListener: (event, listener) => {
			listeners.set(event, listener);
			return { remove: () => removed.push(event) };
		},
		onVisibility: (value) => visible.push(value),
	});
	listeners.get('keyboardDidShow')?.();
	listeners.get('keyboardDidHide')?.();
	cleanup();
	assert.deepEqual(visible, [true, false]);
	assert.deepEqual(removed, ['keyboardDidShow', 'keyboardDidHide']);
});

void test('clipboard authority supersedes an older selection read before write', async () => {
	const authority = createKeyboardClipboardAuthority();
	const writes: string[] = [];
	let resolveFirst!: (value: string) => void;
	const firstSelection = new Promise<string>((resolve) => {
		resolveFirst = resolve;
	});
	const ports = (getSelection: () => Promise<string>) => ({
		isAdmitted: () => true,
		getInstanceId: () => 'instance',
		getSelection,
		isCurrentInstance: () => true,
		writeClipboard: async (text: string) => {
			writes.push(text);
		},
		exitSelectionState: () => {},
		exitSelectionView: () => {},
		completeSlotPress: () => {},
		warn: () => {},
	});
	const first = authority.copy(ports(() => firstSelection));
	const second = authority.copy(ports(async () => 'new'));
	resolveFirst('old');
	await Promise.all([first, second]);
	assert.deepEqual(writes, ['new']);
});

void test('clipboard authority suppresses duplicate copy and completes despite view failure', async () => {
	const authority = createKeyboardClipboardAuthority();
	const calls: string[] = [];
	const ports = {
		isAdmitted: () => true,
		getInstanceId: () => 'instance',
		getSelection: async () => 'same',
		isCurrentInstance: () => true,
		writeClipboard: async () => {
			calls.push('write');
		},
		exitSelectionState: () => calls.push('state'),
		exitSelectionView: () => {
			calls.push('view');
			throw new Error('view');
		},
		completeSlotPress: () => calls.push('complete'),
		warn: () => calls.push('warn'),
	};
	await authority.copy(ports);
	await authority.copy(ports);
	assert.deepEqual(calls, ['write', 'state', 'view', 'warn', 'complete']);
});

void test('selection entry and exit preserve exact legacy system keyboard order', () => {
	const calls: string[] = [];
	const run = (enabled: boolean) =>
		applyKeyboardSelectionMode({
			enabled,
			platformOS: 'android',
			isCurrent: () => true,
			setSelectionMode: (value) => calls.push(`selection:${value}`),
			setTerminalSystemKeyboard: (value) => calls.push(`terminal:${value}`),
			dismissKeyboard: () => calls.push('dismiss'),
			clearKeyboardVisibility: () => calls.push('visible:false'),
			setSystemKeyboard: (value) => calls.push(`system:${value}`),
			warn: () => calls.push('warn'),
		});
	run(true);
	run(false);
	assert.deepEqual(calls, [
		'selection:true',
		'terminal:false',
		'dismiss',
		'visible:false',
		'system:false',
		'selection:false',
		'terminal:true',
		'system:true',
	]);
});

void test('selection transition stops after reentrant authority loss', () => {
	const calls: string[] = [];
	let current = true;
	applyKeyboardSelectionMode({
		enabled: true,
		platformOS: 'android',
		isCurrent: () => current,
		setSelectionMode: () => calls.push('selection'),
		setTerminalSystemKeyboard: () => {
			calls.push('terminal');
			current = false;
		},
		dismissKeyboard: () => calls.push('dismiss'),
		clearKeyboardVisibility: () => calls.push('visible'),
		setSystemKeyboard: () => calls.push('system'),
		warn: () => calls.push('warn'),
	});
	assert.deepEqual(calls, ['selection', 'terminal']);
});

void test('controller admission closes synchronously and matching setup reopens it', () => {
	const invalidations: string[] = [];
	const admission = createKeyboardControllerAdmission((reason) =>
		invalidations.push(reason),
	);
	const first = admission.setup();
	assert.equal(admission.isCurrent(first), true);
	admission.cleanup(first);
	assert.equal(admission.isCurrent(first), false);
	assert.deepEqual(invalidations, ['unmount']);
	const second = admission.setup();
	assert.equal(admission.isCurrent(second), true);
	assert.equal(admission.isCurrent(first), false);
	admission.cleanup(first);
	assert.equal(admission.isCurrent(second), true);
});
