import assert from 'node:assert/strict';
import test from 'node:test';
import {
	applyKeyboardSelectionMode,
	createKeyboardAnimationIdentityTracker,
	createKeyboardAnimationController,
	createKeyboardClipboardAuthority,
	createKeyboardControllerAdmission,
	invalidateKeyboardControllerDomains,
	subscribeKeyboardVisibility,
} from '../../src/lib/shell-controllers/keyboard-hook-runtime';

void test('animation identity survives setup replay and animates semantic replacement once', () => {
	const tracker = createKeyboardAnimationIdentityTracker('main');
	assert.equal(tracker.replace('main'), false);
	assert.equal(tracker.replace('main'), false);
	assert.equal(tracker.replace('advanced'), true);
	assert.equal(tracker.replace('advanced'), false);
});

void test('domain invalidation attempts every sibling after failures', () => {
	const calls: string[] = [];
	invalidateKeyboardControllerDomains('focus-lost', [
		() => {
			calls.push('clipboard');
			throw new Error('clipboard');
		},
		() => calls.push('animation'),
		(reason) => {
			calls.push(`input:${reason}`);
			throw new Error('input');
		},
		(reason) => calls.push(`remote:${reason}`),
	]);
	assert.deepEqual(calls, [
		'clipboard',
		'animation',
		'input:focus-lost',
		'remote:focus-lost',
	]);
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

void test('routine invalidation stales old ownership and immediately admits new work', () => {
	const invalidations: string[] = [];
	const admission = createKeyboardControllerAdmission((reason) =>
		invalidations.push(reason),
	);
	const first = admission.setup();
	const second = admission.invalidate('focus-lost');
	assert.equal(admission.isCurrent(first), false);
	assert.ok(second !== null);
	assert.equal(admission.isCurrent(second), true);
	const third = admission.invalidate('runtime-reset');
	assert.ok(third !== null);
	assert.equal(admission.isCurrent(second), false);
	assert.equal(admission.isCurrent(third), true);
	assert.deepEqual(invalidations, ['focus-lost', 'runtime-reset']);
	admission.cleanup(first);
	assert.equal(admission.getGeneration(), null);
	assert.equal(admission.invalidate('source-change'), null);
	const replay = admission.setup();
	assert.equal(admission.isCurrent(replay), true);
	admission.dispose();
	assert.equal(admission.setup(), null);
	assert.equal(admission.invalidate('runtime-reset'), null);
});

void test('invalidation closes admission before domains and reopens after throwing invalidator', () => {
	let admission!: ReturnType<typeof createKeyboardControllerAdmission>;
	const observed: (number | null)[] = [];
	admission = createKeyboardControllerAdmission(() => {
		observed.push(admission.getGeneration());
		throw new Error('domain failed');
	});
	const mounted = admission.setup();
	const reopened = admission.invalidate('focus-lost');
	assert.deepEqual(observed, [null]);
	assert.equal(admission.isCurrent(mounted), false);
	assert.ok(reopened !== null);
	assert.equal(admission.isCurrent(reopened), true);
});

void test('cleanup or dispose during invalidation prevents reopen', () => {
	let admission!: ReturnType<typeof createKeyboardControllerAdmission>;
	let mounted: number | null = null;
	let mode: 'cleanup' | 'dispose' = 'cleanup';
	admission = createKeyboardControllerAdmission(() => {
		if (mode === 'cleanup') admission.cleanup(mounted);
		else admission.dispose();
	});
	mounted = admission.setup();
	assert.equal(admission.invalidate('focus-lost'), null);
	assert.equal(admission.getGeneration(), null);
	mounted = admission.setup();
	mode = 'dispose';
	assert.equal(admission.invalidate('runtime-reset'), null);
	assert.equal(admission.setup(), null);
});

void test('nested invalidation cannot let the outer transaction overwrite its generation', () => {
	let admission!: ReturnType<typeof createKeyboardControllerAdmission>;
	let nested = false;
	let nestedGeneration: number | null = null;
	admission = createKeyboardControllerAdmission(() => {
		if (nested) return;
		nested = true;
		nestedGeneration = admission.invalidate('runtime-reset');
	});
	admission.setup();
	const outerResult = admission.invalidate('focus-lost');
	assert.equal(outerResult, nestedGeneration);
	assert.ok(nestedGeneration !== null);
	assert.equal(admission.getGeneration(), nestedGeneration);
});

void test('animation completion is current-only and cleanup stops exact timing', () => {
	const names: (string | null)[] = [];
	const values: number[] = [];
	const configurations: {
		duration: number;
		delay: number;
		useNativeDriver: boolean;
	}[] = [];
	const completions: ((result: { finished: boolean }) => void)[] = [];
	let stops = 0;
	let admissionGeneration: number | null = 1;
	const controller = createKeyboardAnimationController({
		initialIdentity: 'main',
		getAdmissionGeneration: () => admissionGeneration,
		setName: (name) => names.push(name),
		setOpacity: (value) => values.push(value),
		start: (configuration, completion) => {
			configurations.push(configuration);
			completions.push(completion);
			return () => {
				stops += 1;
			};
		},
	});
	assert.equal(controller.replace('main', 'Main'), false);
	assert.equal(controller.replace('advanced', 'Advanced'), true);
	assert.deepEqual(configurations, [
		{ duration: 800, delay: 400, useNativeDriver: true },
	]);
	assert.deepEqual(values, [1]);
	assert.equal(controller.replace('browser', 'Browser'), true);
	assert.equal(stops, 1);
	completions[0]?.({ finished: true });
	assert.deepEqual(names, ['Advanced', 'Browser']);
	admissionGeneration = 2;
	completions[1]?.({ finished: true });
	assert.deepEqual(names, ['Advanced', 'Browser']);
	controller.cancel();
	assert.equal(stops, 2);
});
