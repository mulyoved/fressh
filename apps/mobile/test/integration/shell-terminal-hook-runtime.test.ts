import assert from 'node:assert/strict';
import test from 'node:test';
// eslint-disable-next-line import/consistent-type-specifier-style -- Avoid evaluating the React Native WebView package in Node tests.
import type { XtermWebViewHandle } from '@fressh/react-native-xtermjs-webview';
import { createReplaySafeDisposer } from '../../src/lib/shell-controllers/controller-core';
import {
	type ShellTerminalListenerRegistration,
	type ShellTerminalSourcePort,
} from '../../src/lib/shell-controllers/session-contracts';
import {
	createShellTerminalSourcePort,
	type ShellTerminalNativeSource,
} from '../../src/lib/shell-controllers/session-terminal-source';
import { createShellTransportKey } from '../../src/lib/shell-controllers/source-keys';
import {
	createShellTerminalHookRuntime,
	type TerminalHookRuntimeFactories,
} from '../../src/lib/shell-controllers/terminal-hook-runtime';
import { type TerminalLifecycleController } from '../../src/lib/shell-controllers/terminal-lifecycle-core';
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
	let sizeInput: CreateTerminalSizeControllerInput | undefined;
	let lifecycleSnapshot = {
		ready: false,
		hasRendered: false,
		runtimeKey: null,
		runtimeInstanceId: null,
	};
	let sizeSnapshot: { lastSize: { cols: number; rows: number } | null } = {
		lastSize: null,
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
		getSnapshot: () => sizeSnapshot,
		subscribe: () => () => {},
		invalidate: () => {},
		dispose: () => calls.push('size.dispose'),
		handleResize: (cols, rows) => {
			sizeSnapshot = { lastSize: { cols, rows } };
		},
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
		getOutputDiagnostics: () => null,
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
			void input;
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
		getSizeInput: () => {
			assert.ok(sizeInput);
			return sizeInput;
		},
		setReady: (ready: boolean) => {
			lifecycleSnapshot = { ...lifecycleSnapshot, ready };
		},
	};
}

function createShell(
	calls: string[],
	options: {
		generation?: number;
		sendData?: ShellTerminalSourcePort['sendData'];
		resizePty?: ShellTerminalSourcePort['resizePty'];
	} = {},
): ShellTerminalSourcePort {
	const key = createShellTransportKey('connection-a', 7);
	return {
		key,
		generation: options.generation ?? 0,
		connectionId: 'connection-a',
		channelId: 7,
		isAvailable: () => true,
		getNativeOutputDiagnostics: () => null,
		readBuffer: async () => ({ chunks: [], nextSeq: 0n }),
		addListener: async () =>
			Object.freeze({}) as ShellTerminalListenerRegistration,
		removeListener: () => {},
		sendData:
			options.sendData ??
			(async (buffer) => {
				calls.push(`send:${buffer.join(',')}`);
			}),
		resizePty:
			options.resizePty ??
			(async (cols, rows) => {
				calls.push(`resize:${cols}x${rows}`);
			}),
	} satisfies ShellTerminalSourcePort;
}

function createXterm(calls: string[]): XtermWebViewHandle {
	return {
		write: (bytes: Uint8Array) => calls.push(`write:${bytes.join(',')}`),
		writeMany: (chunks: Uint8Array[]) =>
			calls.push(`writeMany:${chunks.length}`),
		flush: () => calls.push('flush'),
		focus: () => calls.push('focus'),
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

void test('hook runtime publishes controller ports and behaviorally delegates layout, attach, dependency, and view work', async () => {
	const fixture = createFixture();
	assert.deepEqual(fixture.counts, {
		transport: 1,
		size: 1,
		lifecycle: 1,
		disposer: 1,
	});

	const shell = createShell(fixture.calls);
	const key = createShellTransportKey('connection-a', 7);
	fixture.runtime.updateSource(shell);
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
	});
	fixture.getTransportInput().onSendFailure(new Error('send failed'));
	fixture.runtime.retry();
	assert.deepEqual(currentEvents, ['warn:sendData failed', 'back', 'back']);
	assert.deepEqual(fixture.oldEvents, []);

	const callsBeforeGuardedView = fixture.calls.length;
	assert.equal(await fixture.runtime.view.getSelection(), '');
	fixture.runtime.view.fit();
	fixture.runtime.view.setSystemKeyboardEnabled(true);
	fixture.runtime.view.setSelectionModeEnabled(true);
	fixture.runtime.view.exitScrollback({ requestId: 1 });
	fixture.runtime.view.sendScrollbackEnterAck(2, 'instance-1');
	assert.deepEqual(fixture.calls.slice(callsBeforeGuardedView), [
		'modes:true:true',
		'modes:true:true',
	]);
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
	assert.deepEqual(fixture.calls.slice(-7), [
		'fit',
		'modes:true:true',
		'keyboard:true',
		'modes:true:true',
		'selection:true',
		'exit:4',
		'ack:5:instance-2',
	]);

	await fixture.getSizeInput().resizePty(80, 24);
	assert.ok(fixture.calls.includes('resize:80x24'));
});

void test('terminal runtime owns current size and applied selection state', () => {
	const fixture = createFixture();
	fixture.runtime.size.handleResize(91, 27);
	fixture.runtime.view.setSelectionModeEnabled(true);

	assert.deepEqual(fixture.runtime.getLastSize(), { cols: 91, rows: 27 });
	assert.equal(fixture.runtime.view.getSelectionModeEnabled(), true);
});

void test('retired terminal view ports are inert', async () => {
	const fixture = createFixture();
	fixture.xtermRef.current = createXterm(fixture.calls);
	const view = fixture.runtime.view as typeof fixture.runtime.view & {
		getSelectionModeEnabled?(): boolean;
	};
	fixture.runtime.view.setSelectionModeEnabled(true);
	const cleanup = fixture.runtime.setupDisposal();
	cleanup();
	fixture.deferredTasks.shift()?.();
	const callsAfterDispose = [...fixture.calls];

	fixture.runtime.view.fit();
	fixture.runtime.view.setSystemKeyboardEnabled(true);
	fixture.runtime.view.setSelectionModeEnabled(true);
	fixture.runtime.view.exitScrollback({ requestId: 9 });
	fixture.runtime.view.sendScrollbackEnterAck(10, 'retired-instance');

	assert.deepEqual(fixture.calls, callsAfterDispose);
	assert.equal(fixture.runtime.view.getRuntimeKey(), null);
	assert.equal(fixture.runtime.view.getRuntimeInstanceId(), null);
	assert.equal(view.getSelectionModeEnabled?.(), false);
	assert.equal(await fixture.runtime.view.getSelection(), '');
});

void test('same-key shell replacement stales delayed transport work before redirecting sends', async () => {
	const shellAFirstSend = deferred<void>();
	const shellACalls: number[][] = [];
	const shellBCalls: number[][] = [];
	const shellA = createShell([], {
		sendData: async (buffer) => {
			shellACalls.push(Array.from(buffer));
			if (shellACalls.length === 1) await shellAFirstSend.promise;
		},
	});
	const shellB = createShell([], {
		generation: 1,
		sendData: async (buffer) => {
			shellBCalls.push(Array.from(buffer));
		},
	});
	const runtime = createShellTerminalHookRuntime({
		xtermRef: { current: null },
		platformOS: 'android',
		dependencies: {
			logger: { info: () => {}, warn: () => {} },
			router: { back: () => {} },
		},
	});
	runtime.updateSource(shellA);
	runtime.transport.setRuntimeInstance('runtime-1');
	const staleLease = runtime.transport.captureLease();
	assert.ok(staleLease);
	const staleBatch = runtime.transport.sendBatch(
		staleLease,
		[new Uint8Array([1]), new Uint8Array([2])],
		{ interSegmentDelayMs: 1 },
	);
	await Promise.resolve();
	assert.deepEqual(shellACalls, [[1]]);

	runtime.updateSource(shellB);
	assert.equal(runtime.transport.isLeaseCurrent(staleLease), false);
	shellAFirstSend.resolve();
	await staleBatch;
	assert.deepEqual(shellACalls, [[1]]);
	assert.deepEqual(shellBCalls, []);

	const replacementLease = runtime.transport.captureLease();
	assert.ok(replacementLease);
	await runtime.transport.sendBatch(replacementLease, [new Uint8Array([3])]);
	assert.deepEqual(shellBCalls, [[3]]);

	const sameObjectLease = runtime.transport.captureLease();
	assert.ok(sameObjectLease);
	runtime.updateSource(shellB);
	assert.equal(runtime.transport.isLeaseCurrent(sameObjectLease), true);
	runtime.lifecycle.dispose();
	runtime.size.dispose();
	runtime.transport.dispose();
});

void test('source replacement completes listener retirement after two immediate native failures without revisiting the old port', async () => {
	let generation = 1;
	let removalAttempts = 0;
	const nativeSource = {
		bufferStats: () => ({
			ringBytesCount: 0n,
			usedBytes: 0n,
			headSeq: 0n,
			tailSeq: 0n,
			droppedBytesTotal: 0n,
			chunksCount: 0n,
		}),
		currentSeq: () => 0n,
		readBuffer: async () => ({ chunks: [], nextSeq: 0n }),
		addListener: async () => 81n,
		removeListener: () => {
			removalAttempts += 1;
			if (removalAttempts <= 2) throw new Error('native removal failed');
		},
		sendData: async () => {},
		resizePty: async () => {},
	} satisfies ShellTerminalNativeSource;
	const source = createShellTerminalSourcePort({
		channelId: 7,
		connectionId: 'connection-a',
		generation,
		getCurrentGeneration: () => generation,
		key: createShellTransportKey('connection-a', 7),
		shell: nativeSource,
	});
	const calls: string[] = [];
	const runtime = createShellTerminalHookRuntime({
		xtermRef: { current: createXterm(calls) },
		platformOS: 'android',
		dependencies: {
			logger: { info: () => {}, warn: () => {} },
			router: { back: () => {} },
		},
	});
	runtime.updateSource(source);
	runtime.lifecycle.handleInitialized('runtime-1');
	await runtime.requestAttach(true, true);

	generation += 1;
	runtime.updateSource(createShell([], { generation }));

	assert.equal(removalAttempts, 2);
	await Promise.resolve();
	assert.equal(removalAttempts, 3);
	runtime.updateSource(createShell([], { generation: generation + 1 }));
	runtime.lifecycle.dispose();
	runtime.size.dispose();
	runtime.transport.dispose();
	await Promise.resolve();
	assert.equal(removalAttempts, 3);
});

void test('hook runtime ordinary and Strict Mode cleanup attempts every disposer despite failure', () => {
	const error = new Error('lifecycle dispose failed');
	const ordinary = createFixture({ lifecycleDisposeError: error });
	const cleanupEvents: string[] = [];
	ordinary.runtime.updateDependencies({
		logger: {
			info: () => {},
			warn: (message) => cleanupEvents.push(message),
		},
		router: { back: () => {} },
	});
	const cleanup = ordinary.runtime.setupDisposal();
	cleanup();
	assert.equal(ordinary.deferredTasks.length, 1);
	assert.doesNotThrow(() => ordinary.deferredTasks.shift()?.());
	assert.deepEqual(ordinary.calls.slice(-3), [
		'lifecycle.dispose',
		'size.dispose',
		'transport.dispose',
	]);
	assert.deepEqual(cleanupEvents, ['Failed to dispose terminal controllers']);

	const throwingLogger = createFixture({ lifecycleDisposeError: error });
	throwingLogger.runtime.updateDependencies({
		logger: {
			info: () => {},
			warn: () => {
				throw new Error('logger failed');
			},
		},
		router: { back: () => {} },
	});
	const throwingCleanup = throwingLogger.runtime.setupDisposal();
	throwingCleanup();
	assert.doesNotThrow(() => throwingLogger.deferredTasks.shift()?.());
	assert.deepEqual(throwingLogger.calls, [
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
	});
	const observed = throwingFixture.runtime.requestAttach(true, true);
	throwing.reject(error);
	await assert.rejects(observed, error);
});
