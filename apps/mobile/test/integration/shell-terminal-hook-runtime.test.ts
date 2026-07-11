import assert from 'node:assert/strict';
import test from 'node:test';
// eslint-disable-next-line import/consistent-type-specifier-style -- Avoid evaluating React Native in Node integration tests.
import type { SshShell } from '@fressh/react-native-uniffi-russh';
// eslint-disable-next-line import/consistent-type-specifier-style -- Avoid evaluating the React Native WebView package in Node tests.
import type { XtermWebViewHandle } from '@fressh/react-native-xtermjs-webview';
import { createReplaySafeDisposer } from '../../src/lib/shell-controllers/controller-core';
import { createShellTransportKey } from '../../src/lib/shell-controllers/source-keys';
import {
	createShellTerminalHookRuntime,
	type TerminalHookRuntimeFactories,
} from '../../src/lib/shell-controllers/terminal-hook-runtime';
import {
	type CreateTerminalLifecycleControllerInput,
	type TerminalLifecycleController,
} from '../../src/lib/shell-controllers/terminal-lifecycle-core';
import {
	type CreateTerminalSizeControllerInput,
	type TerminalSizeController,
} from '../../src/lib/shell-controllers/terminal-size-core';
import {
	type ShellTerminalTransportController,
	type TerminalInputLease,
} from '../../src/lib/shell-controllers/terminal-transport';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function createFixture(
	options: {
		lifecycleDisposeError?: Error;
		attachPromise?: Promise<void>;
	} = {},
) {
	const calls: string[] = [];
	const deferredTasks: (() => void)[] = [];
	let transportInput:
		| Parameters<TerminalHookRuntimeFactories['createTransport']>[0]
		| undefined;
	let lifecycleInput: CreateTerminalLifecycleControllerInput | undefined;
	let sizeInput: CreateTerminalSizeControllerInput | undefined;
	let lifecycleSnapshot = {
		ready: false,
		hasRendered: false,
		runtimeKey: null,
	};
	const transport: ShellTerminalTransportController = {
		captureLease: () => null,
		isLeaseCurrent: (_lease: TerminalInputLease) => false,
		sendBatch: async () => {},
		setShell: (key) => calls.push(`transport.shell:${key}`),
		clearShell: () => calls.push('transport.clearShell'),
		setRuntimeInstance: () => {},
		clearRuntime: () => {},
		invalidate: () => {},
		dispose: () => calls.push('transport.dispose'),
	};
	const size: TerminalSizeController = {
		getSnapshot: () => ({ lastSize: null }),
		subscribe: () => () => {},
		invalidate: () => {},
		dispose: () => calls.push('size.dispose'),
		handleResize: () => {},
		waitForSizeAfterFit: async () => null,
	};
	const lifecycle: TerminalLifecycleController = {
		getSnapshot: () => lifecycleSnapshot,
		subscribe: () => () => {},
		invalidate: () => {},
		dispose: () => {
			calls.push('lifecycle.dispose');
			if (options.lifecycleDisposeError) throw options.lifecycleDisposeError;
		},
		setShell: (key, shell) =>
			calls.push(`lifecycle.shell:${key}:${shell ? 'set' : 'clear'}`),
		setViewModes: ({ systemKeyboardEnabled, selectionModeEnabled }) =>
			calls.push(`modes:${systemKeyboardEnabled}:${selectionModeEnabled}`),
		handleInitialized: () => {},
		handleLoadStart: () => {},
		attach: () => {
			calls.push('lifecycle.attach');
			return options.attachPromise ?? Promise.resolve();
		},
		detach: () => {},
		getRuntimeKey: () => null,
		getRuntimeInstanceId: () => 'instance-1',
		isCurrentInstance: (instanceId) => instanceId === 'instance-1',
		isAttached: () => false,
	};
	const counts = { transport: 0, size: 0, lifecycle: 0, disposer: 0 };
	const factories: TerminalHookRuntimeFactories = {
		createTransport: (input) => {
			counts.transport += 1;
			transportInput = input;
			return transport;
		},
		createSize: (input) => {
			counts.size += 1;
			sizeInput = input;
			return size;
		},
		createLifecycle: (input) => {
			counts.lifecycle += 1;
			lifecycleInput = input;
			return lifecycle;
		},
		createDisposer: (dispose, defer) => {
			counts.disposer += 1;
			return createReplaySafeDisposer(dispose, defer);
		},
	};
	const xtermRef: { current: XtermWebViewHandle | null } = { current: null };
	const oldEvents: string[] = [];
	const runtime = createShellTerminalHookRuntime({
		xtermRef,
		platformOS: 'android',
		dependencies: {
			logger: {
				info: () => {},
				warn: (message) => oldEvents.push(`warn:${message}`),
			},
			router: { back: () => oldEvents.push('back') },
			onRuntimeChanged: (_key, instanceId) =>
				oldEvents.push(`runtime:${instanceId}`),
		},
		factories,
		deferDisposal: (task) => deferredTasks.push(task),
	});
	return {
		runtime,
		xtermRef,
		calls,
		counts,
		deferredTasks,
		oldEvents,
		getTransportInput: () => {
			assert.ok(transportInput);
			return transportInput;
		},
		getLifecycleInput: () => {
			assert.ok(lifecycleInput);
			return lifecycleInput;
		},
		getSizeInput: () => {
			assert.ok(sizeInput);
			return sizeInput;
		},
		setReady: (ready: boolean) => {
			lifecycleSnapshot = { ...lifecycleSnapshot, ready };
		},
	};
}

function createShell(calls: string[]): SshShell {
	return {
		sendData: async (buffer: ArrayBuffer) =>
			calls.push(`send:${new Uint8Array(buffer).join(',')}`),
		resizePty: async (cols: number, rows: number) =>
			calls.push(`resize:${cols}x${rows}`),
	} as unknown as SshShell;
}

function createXterm(calls: string[]): XtermWebViewHandle {
	return {
		fit: () => calls.push('fit'),
		setSystemKeyboardEnabled: (enabled: boolean) =>
			calls.push(`keyboard:${enabled}`),
		setSelectionModeEnabled: (enabled: boolean) =>
			calls.push(`selection:${enabled}`),
		getSelection: async () => 'selected',
		exitScrollback: ({ requestId }: { requestId?: number } = {}) =>
			calls.push(`exit:${requestId}`),
		sendScrollbackEnterAck: (requestId: number, instanceId: string) =>
			calls.push(`ack:${requestId}:${instanceId}`),
	} as unknown as XtermWebViewHandle;
}

void test('hook runtime creates cores once and behaviorally delegates layout, attach, dependency, and view work', async () => {
	const fixture = createFixture();
	assert.deepEqual(fixture.counts, {
		transport: 1,
		size: 1,
		lifecycle: 1,
		disposer: 1,
	});

	const shell = createShell(fixture.calls);
	const key = createShellTransportKey('connection-a', 7);
	fixture.runtime.updateShell(key, shell);
	fixture.runtime.updateViewModes({
		systemKeyboardEnabled: false,
		selectionModeEnabled: true,
	});
	await fixture.runtime.requestAttach(false, true);
	await fixture.runtime.requestAttach(true, false);
	await fixture.runtime.requestAttach(true, true);
	assert.equal(
		fixture.calls.filter((call) => call === 'lifecycle.attach').length,
		1,
	);
	assert.ok(fixture.calls.includes(`transport.shell:${key}`));
	assert.ok(fixture.calls.includes(`lifecycle.shell:${key}:set`));
	assert.ok(fixture.calls.includes('modes:false:true'));

	const currentEvents: string[] = [];
	fixture.runtime.updateDependencies({
		logger: {
			info: () => {},
			warn: (message) => currentEvents.push(`warn:${message}`),
		},
		router: { back: () => currentEvents.push('back') },
		onRuntimeChanged: (_runtimeKey, instanceId) =>
			currentEvents.push(`runtime:${instanceId}`),
	});
	fixture.getTransportInput().onSendFailure(new Error('send failed'));
	fixture.getLifecycleInput().onRuntimeChanged(null, 'instance-2');
	fixture.runtime.retry();
	assert.deepEqual(currentEvents, [
		'warn:sendData failed',
		'back',
		'runtime:instance-2',
		'back',
	]);
	assert.deepEqual(fixture.oldEvents, []);

	const callsBeforeGuardedView = fixture.calls.length;
	assert.equal(await fixture.runtime.view.getSelection(), '');
	fixture.runtime.view.fit();
	fixture.runtime.view.setSystemKeyboardEnabled(true);
	fixture.runtime.view.setSelectionModeEnabled(true);
	fixture.runtime.view.exitScrollback({ requestId: 1 });
	fixture.runtime.view.sendScrollbackEnterAck(2, 'instance-1');
	assert.equal(fixture.calls.length, callsBeforeGuardedView);
	assert.equal(fixture.runtime.view.getRuntimeKey(), null);
	assert.equal(fixture.runtime.view.getRuntimeInstanceId(), 'instance-1');
	assert.equal(fixture.runtime.view.isCurrentInstance('instance-1'), true);
	fixture.xtermRef.current = createXterm(fixture.calls);
	fixture.runtime.view.fit();
	fixture.runtime.view.setSystemKeyboardEnabled(true);
	fixture.runtime.view.setSelectionModeEnabled(true);
	assert.equal(await fixture.runtime.view.getSelection(), 'selected');
	fixture.runtime.view.exitScrollback({ requestId: 4 });
	fixture.runtime.view.sendScrollbackEnterAck(5, 'instance-2');
	assert.deepEqual(fixture.calls.slice(-5), [
		'fit',
		'keyboard:true',
		'selection:true',
		'exit:4',
		'ack:5:instance-2',
	]);

	await fixture.getSizeInput().resizePty(80, 24);
	assert.ok(fixture.calls.includes('resize:80x24'));
});

void test('hook runtime ordinary and Strict Mode cleanup attempts every disposer despite failure', () => {
	const error = new Error('lifecycle dispose failed');
	const ordinary = createFixture({ lifecycleDisposeError: error });
	const cleanup = ordinary.runtime.setupDisposal();
	cleanup();
	assert.equal(ordinary.deferredTasks.length, 1);
	assert.throws(() => ordinary.deferredTasks.shift()?.(), error);
	assert.deepEqual(ordinary.calls.slice(-3), [
		'lifecycle.dispose',
		'size.dispose',
		'transport.dispose',
	]);

	const strict = createFixture();
	const firstCleanup = strict.runtime.setupDisposal();
	firstCleanup();
	const finalCleanup = strict.runtime.setupDisposal();
	strict.deferredTasks.shift()?.();
	assert.deepEqual(strict.calls, []);
	finalCleanup();
	strict.deferredTasks.shift()?.();
	assert.deepEqual(strict.calls, [
		'lifecycle.dispose',
		'size.dispose',
		'transport.dispose',
	]);
});

void test('replayed pending attach reports failure once through the latest logger', async () => {
	const pending = deferred<void>();
	const fixture = createFixture({ attachPromise: pending.promise });
	const first = fixture.runtime.requestAttach(true, true);
	const currentEvents: string[] = [];
	fixture.runtime.updateDependencies({
		logger: {
			info: () => {},
			warn: (message) => currentEvents.push(message),
		},
		router: { back: () => {} },
		onRuntimeChanged: () => {},
	});
	const replayed = fixture.runtime.requestAttach(true, true);
	const error = new Error('attach failed');
	pending.reject(error);
	await Promise.allSettled([first, replayed]);
	assert.deepEqual(fixture.oldEvents, []);
	assert.deepEqual(currentEvents, ['Failed to attach shell listener']);

	const throwing = deferred<void>();
	const throwingFixture = createFixture({ attachPromise: throwing.promise });
	throwingFixture.runtime.updateDependencies({
		logger: {
			info: () => {},
			warn: () => {
				throw new Error('logger failed');
			},
		},
		router: { back: () => {} },
		onRuntimeChanged: () => {},
	});
	const observed = throwingFixture.runtime.requestAttach(true, true);
	throwing.reject(error);
	await assert.rejects(observed, error);
});
