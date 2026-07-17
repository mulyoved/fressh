import {
	createTerminalLifecycleController,
	type TerminalLifecycleShell,
} from '../../src/lib/shell-controllers/terminal-lifecycle-core';

type Deferred<T> = {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
};

export function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

export function createHarness(
	platformOS: 'android' | 'ios' = 'android',
	hooks: {
		onInfo?(message: string): void;
		onWarn?(message: string): void;
		onSizeInvalidate?(reason: string): void;
		onTransportClear?(): void;
		onRuntimeChanged?(
			runtimeKey: string | null,
			instanceId: string | null,
		): void;
	} = {},
) {
	const writes: number[][][] = [];
	const calls: string[] = [];
	const runtimeChanges: {
		runtimeKey: string | null;
		instanceId: string | null;
	}[] = [];
	const transportCalls: string[] = [];
	const sizeCalls: string[] = [];
	const xtermDiagnostics = {
		webViewInstanceId: 'bridge-instance-1',
		rnQueuedMessages: 3,
		rnQueuedBytes: 30,
		rnFlushes: 1,
		rnSentMessages: 2,
		rnSentBytes: 20,
		webViewReceivedMessages: 2,
		webViewReceivedBytes: 20,
		webViewCompletedWrites: 2,
	};
	let systemKeyboardEnabled = platformOS === 'android';
	let selectionModeEnabled = false;
	let nextListenerId = 1n;
	type TestShell = TerminalLifecycleShell & {
		readModes: string[];
		listenerCursors: unknown[];
		removedListenerIds: bigint[];
		listeners: Map<
			bigint,
			Parameters<TerminalLifecycleShell['addListener']>[0]
		>;
	};

	const createShell = (connectionId: string, channelId: number) => {
		const shell: TestShell = {
			connectionId,
			channelId,
			readModes: [] as string[],
			listenerCursors: [] as unknown[],
			removedListenerIds: [] as bigint[],
			listeners: new Map(),
			readBuffer(cursor: { mode: string }) {
				this.readModes.push(cursor.mode);
				return {
					chunks: [
						{
							seq: 1n,
							tMs: 1,
							stream: 'stdout' as const,
							bytes: new Uint8Array([1, 2]).buffer,
						},
					],
					nextSeq: 9n,
				};
			},
			addListener(
				listener: Parameters<TerminalLifecycleShell['addListener']>[0],
				options: Parameters<TerminalLifecycleShell['addListener']>[1],
			) {
				const id = nextListenerId++;
				this.listenerCursors.push(options.cursor);
				this.listeners.set(id, listener);
				return id;
			},
			removeListener(id: bigint) {
				this.removedListenerIds.push(id);
				this.listeners.delete(id);
			},
		};
		return shell;
	};

	const xterm = {
		getOutputDiagnostics: () => ({ ...xtermDiagnostics }),
		write: (bytes: Uint8Array) => {
			calls.push(`write:${Array.from(bytes)}`);
		},
		writeMany: (chunks: Uint8Array[]) => {
			writes.push(chunks.map((chunk) => Array.from(chunk)));
		},
		flush: () => {
			calls.push('flush');
		},
		focus: () => {
			calls.push('focus');
		},
		setSystemKeyboardEnabled: (enabled: boolean) => {
			calls.push(`keyboard:${enabled}`);
		},
		setSelectionModeEnabled: (enabled: boolean) => {
			calls.push(`selection:${enabled}`);
		},
	};
	let currentXterm: typeof xterm | null = xterm;
	const transport = {
		setRuntimeInstance: (id: string) => transportCalls.push(`set:${id}`),
		clearRuntime: () => {
			transportCalls.push('clear');
			hooks.onTransportClear?.();
		},
		invalidate: (reason: string) => transportCalls.push(`invalidate:${reason}`),
	};
	const size = {
		invalidate: (reason: string) => {
			sizeCalls.push(`invalidate:${reason}`);
			hooks.onSizeInvalidate?.(reason);
		},
	};
	const core = createTerminalLifecycleController({
		getXterm: () => currentXterm,
		transport,
		size,
		platformOS,
		logger: {
			info: (message) => {
				calls.push(`info:${message}`);
				hooks.onInfo?.(message);
			},
			warn: (message) => {
				calls.push(`warn:${message}`);
				hooks.onWarn?.(message);
			},
		},
	});
	let observedRuntimeKey: string | null = null;
	let observedInstanceId: string | null = null;
	core.subscribe(() => {
		const snapshot = core.getSnapshot();
		if (
			snapshot.runtimeKey === observedRuntimeKey &&
			snapshot.runtimeInstanceId === observedInstanceId
		)
			return;
		observedRuntimeKey = snapshot.runtimeKey;
		observedInstanceId = snapshot.runtimeInstanceId;
		runtimeChanges.push({
			runtimeKey: snapshot.runtimeKey,
			instanceId: snapshot.runtimeInstanceId,
		});
		hooks.onRuntimeChanged?.(snapshot.runtimeKey, snapshot.runtimeInstanceId);
	});
	const shellA = createShell('connection-a', 7);
	const shellB = createShell('connection-b', 8);
	return {
		core,
		shellA,
		shellB,
		xterm,
		writes,
		calls,
		runtimeChanges,
		transportCalls,
		sizeCalls,
		setXterm(nextXterm: typeof xterm | null) {
			currentXterm = nextXterm;
		},
		setModes(system: boolean, selection: boolean) {
			systemKeyboardEnabled = system;
			selectionModeEnabled = selection;
			core.setViewModes({ systemKeyboardEnabled, selectionModeEnabled });
		},
	};
}
