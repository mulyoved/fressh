// eslint-disable-next-line import/consistent-type-specifier-style -- Keep the Node-testable hook runtime free of React Native WebView evaluation.
import type { XtermWebViewHandle } from '@fressh/react-native-xtermjs-webview';
import {
	createReplaySafeDisposer,
	type ReplaySafeDisposer,
} from './controller-core';
import { type ShellTerminalSourcePort } from './session-contracts';
import { type ShellTerminalViewPort } from './terminal-contracts';
import {
	createTerminalLifecycleController,
	type CreateTerminalLifecycleControllerInput,
	type TerminalLifecycleController,
	type TerminalLifecycleLogger,
	type TerminalLifecycleShell,
} from './terminal-lifecycle-core';
import { type TerminalOutputDiagnosticSnapshot } from './terminal-output-diagnostics';
import {
	createTerminalSizeController,
	type CreateTerminalSizeControllerInput,
	type TerminalSizeController,
} from './terminal-size-core';
import {
	createShellTerminalTransport,
	type ShellTerminalTransportController,
} from './terminal-transport';

export type ShellTerminalRuntimeRef = {
	current: XtermWebViewHandle | null;
};

export type ShellTerminalRuntimeRouter = {
	back(): void;
};

export type ShellTerminalRuntimeDependencies = {
	logger: TerminalLifecycleLogger;
	router: ShellTerminalRuntimeRouter;
};

export type TerminalHookRuntimeFactories = {
	createTransport(
		input: Parameters<typeof createShellTerminalTransport>[0],
	): ShellTerminalTransportController;
	createSize(input: CreateTerminalSizeControllerInput): TerminalSizeController;
	createLifecycle(
		input: CreateTerminalLifecycleControllerInput,
	): TerminalLifecycleController;
	createDisposer(
		dispose: () => void,
		defer: (task: () => void) => void,
	): ReplaySafeDisposer;
};

const defaultFactories: TerminalHookRuntimeFactories = {
	createTransport: createShellTerminalTransport,
	createSize: createTerminalSizeController,
	createLifecycle: createTerminalLifecycleController,
	createDisposer: (dispose, defer) => createReplaySafeDisposer(dispose, defer),
};

export function disposeTerminalControllerCores(cores: {
	lifecycle: Pick<TerminalLifecycleController, 'dispose'>;
	size: Pick<TerminalSizeController, 'dispose'>;
	transport: Pick<ShellTerminalTransportController, 'dispose'>;
}): void {
	let hasError = false;
	let firstError: unknown;
	for (const dispose of [
		cores.lifecycle.dispose,
		cores.size.dispose,
		cores.transport.dispose,
	]) {
		try {
			dispose();
		} catch (error) {
			if (!hasError) {
				hasError = true;
				firstError = error;
			}
		}
	}
	if (hasError) throw firstError;
}

export type ShellTerminalHookRuntime = {
	transport: ShellTerminalTransportController;
	size: TerminalSizeController;
	lifecycle: TerminalLifecycleController;
	view: ShellTerminalViewPort;
	getOutputDiagnostics(): TerminalOutputDiagnosticSnapshot | null;
	getLastSize(): ReturnType<TerminalSizeController['getSnapshot']>['lastSize'];
	updateDependencies(dependencies: ShellTerminalRuntimeDependencies): void;
	updateSource(source: ShellTerminalSourcePort): void;
	updateViewModes(modes: {
		systemKeyboardEnabled: boolean;
		selectionModeEnabled: boolean;
	}): void;
	requestAttach(ready: boolean, hasShell: boolean): Promise<void>;
	setupDisposal(): () => void;
	retry(): void;
};

export function createShellTerminalHookRuntime(input: {
	xtermRef: ShellTerminalRuntimeRef;
	platformOS: string;
	dependencies: ShellTerminalRuntimeDependencies;
	factories?: TerminalHookRuntimeFactories;
	deferDisposal?(task: () => void): void;
}): ShellTerminalHookRuntime {
	const factories = input.factories ?? defaultFactories;
	let dependencies = input.dependencies;
	let source: ShellTerminalSourcePort | null = null;
	let active = true;
	let viewModes = {
		systemKeyboardEnabled: input.platformOS === 'android',
		selectionModeEnabled: false,
	};
	const observedAttachPromises = new WeakSet<Promise<void>>();
	const currentLogger: TerminalLifecycleLogger = {
		info: (message, details) => dependencies.logger.info(message, details),
		warn: (message, error) => dependencies.logger.warn(message, error),
	};
	const transport = factories.createTransport({
		onSendFailure: (error) => {
			try {
				dependencies.logger.warn('sendData failed', error);
			} finally {
				dependencies.router.back();
			}
		},
	});
	const size = factories.createSize({
		setTimeout: (task, delayMs) => setTimeout(task, delayMs),
		clearTimeout: (timer) =>
			clearTimeout(timer as ReturnType<typeof setTimeout>),
		resizePty: async (cols, rows) => {
			await source?.resizePty(cols, rows);
		},
		warn: currentLogger.warn,
	});
	const lifecycle = factories.createLifecycle({
		getXterm: () => input.xtermRef.current,
		transport,
		size,
		platformOS: input.platformOS,
		logger: currentLogger,
	});
	const disposer = factories.createDisposer(() => {
		active = false;
		source = null;
		try {
			disposeTerminalControllerCores({ lifecycle, size, transport });
		} catch (error) {
			try {
				dependencies.logger.warn(
					'Failed to dispose terminal controllers',
					error,
				);
			} catch {
				// Deferred production cleanup must never escape a microtask.
			}
		}
	}, input.deferDisposal ?? queueMicrotask);
	const sendCurrentSource = async (
		bytes: Uint8Array<ArrayBufferLike>,
	): Promise<void> => {
		if (!active || !source) return;
		await source.sendData(bytes);
	};
	const view: ShellTerminalViewPort = {
		getRuntimeKey: () => (active ? lifecycle.getRuntimeKey() : null),
		getRuntimeInstanceId: () =>
			active ? lifecycle.getRuntimeInstanceId() : null,
		getSelectionModeEnabled: () => active && viewModes.selectionModeEnabled,
		isCurrentInstance: (instanceId) =>
			active && lifecycle.isCurrentInstance(instanceId),
		fit: () => {
			if (active) input.xtermRef.current?.fit();
		},
		setSystemKeyboardEnabled: (enabled) => {
			if (!active) return;
			viewModes = { ...viewModes, systemKeyboardEnabled: enabled };
			lifecycle.setViewModes(viewModes);
			input.xtermRef.current?.setSystemKeyboardEnabled(enabled);
		},
		setSelectionModeEnabled: (enabled) => {
			if (!active) return;
			viewModes = { ...viewModes, selectionModeEnabled: enabled };
			lifecycle.setViewModes(viewModes);
			input.xtermRef.current?.setSelectionModeEnabled(enabled);
		},
		getSelection: () =>
			active
				? (input.xtermRef.current?.getSelection() ?? Promise.resolve(''))
				: Promise.resolve(''),
		exitScrollback: (message) => {
			if (active) input.xtermRef.current?.exitScrollback(message);
		},
		sendScrollbackEnterAck: (requestId, instanceId) => {
			if (active)
				input.xtermRef.current?.sendScrollbackEnterAck(requestId, instanceId);
		},
	};
	const observeAttachFailure = (promise: Promise<void>): Promise<void> => {
		if (observedAttachPromises.has(promise)) return promise;
		observedAttachPromises.add(promise);
		void promise.catch((error) => {
			try {
				dependencies.logger.warn('Failed to attach shell listener', error);
			} catch {
				// Attach ownership is already represented by the rejected promise.
			}
		});
		return promise;
	};
	const createLifecycleSource = (
		owner: ShellTerminalSourcePort,
	): TerminalLifecycleShell => {
		const registrations = new Map<
			bigint,
			Awaited<ReturnType<ShellTerminalSourcePort['addListener']>>
		>();
		return {
			connectionId: owner.connectionId,
			channelId: owner.channelId,
			getNativeOutputDiagnostics: () => owner.getNativeOutputDiagnostics(),
			readBuffer: (cursor) => owner.readBuffer(cursor),
			addListener: async (listener, options) => {
				const registration = await owner.addListener(listener, options);
				registrations.set(registration.id, registration);
				return registration.id;
			},
			removeListener: (id) => {
				const registration = registrations.get(id);
				if (!registration) return;
				registrations.delete(id);
				owner.removeListener(registration);
			},
		};
	};

	return {
		transport,
		size,
		lifecycle,
		view,
		getOutputDiagnostics: () =>
			active ? (lifecycle.getOutputDiagnostics?.() ?? null) : null,
		getLastSize: () => (active ? size.getSnapshot().lastSize : null),
		updateDependencies: (nextDependencies) => {
			if (!active) return;
			dependencies = nextDependencies;
		},
		updateSource: (nextSource) => {
			if (!active) return;
			if (source === nextSource) return;
			const clearedForReplacement = source !== null;
			if (clearedForReplacement) transport.clearShell();
			source = nextSource;
			const lifecycleSource = createLifecycleSource(source);
			if (source.isAvailable()) {
				transport.setShell(source.key, sendCurrentSource);
			} else if (!clearedForReplacement) {
				transport.clearShell();
			}
			lifecycle.setShell(
				source.key,
				source.isAvailable() ? lifecycleSource : null,
			);
		},
		updateViewModes: (nextViewModes) => {
			if (!active) return;
			viewModes = { ...nextViewModes };
			lifecycle.setViewModes(viewModes);
		},
		requestAttach: (ready, hasShell) => {
			if (!active || !ready || !hasShell) return Promise.resolve();
			try {
				return observeAttachFailure(lifecycle.attach());
			} catch (error) {
				return observeAttachFailure(Promise.reject(error));
			}
		},
		setupDisposal: disposer.setup,
		retry: () => {
			if (active) dependencies.router.back();
		},
	};
}
