// eslint-disable-next-line import/consistent-type-specifier-style -- Keep the Node-testable hook runtime free of React Native evaluation.
import type { SshShell } from '@fressh/react-native-uniffi-russh';
// eslint-disable-next-line import/consistent-type-specifier-style -- Keep the Node-testable hook runtime free of React Native WebView evaluation.
import type { XtermWebViewHandle } from '@fressh/react-native-xtermjs-webview';
import {
	createReplaySafeDisposer,
	type ReplaySafeDisposer,
} from './controller-core';
import { type ShellTransportKey } from './source-keys';
import {
	createTerminalLifecycleController,
	type CreateTerminalLifecycleControllerInput,
	type TerminalLifecycleController,
	type TerminalLifecycleLogger,
} from './terminal-lifecycle-core';
import {
	createTerminalSizeController,
	type CreateTerminalSizeControllerInput,
	type TerminalSizeController,
} from './terminal-size-core';
import {
	createShellTerminalTransport,
	type ShellTerminalTransportController,
	type TerminalRuntimeKey,
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
	onRuntimeChanged(
		runtimeKey: TerminalRuntimeKey | null,
		instanceId: string | null,
	): void;
};

export type ShellTerminalRuntimeView = {
	getRuntimeKey(): TerminalRuntimeKey | null;
	getRuntimeInstanceId(): string | null;
	isCurrentInstance(instanceId: string): boolean;
	fit(): void;
	setSystemKeyboardEnabled(enabled: boolean): void;
	setSelectionModeEnabled(enabled: boolean): void;
	getSelection(): Promise<string>;
	exitScrollback(message: { requestId: number; instanceId?: string }): void;
	sendScrollbackEnterAck(requestId: number, instanceId: string): void;
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
	view: ShellTerminalRuntimeView;
	updateDependencies(dependencies: ShellTerminalRuntimeDependencies): void;
	updateShell(
		transportKey: ShellTransportKey | null,
		shell: SshShell | null | undefined,
	): void;
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
	let shell: SshShell | null = null;
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
			await shell?.resizePty(cols, rows);
		},
		warn: currentLogger.warn,
	});
	const lifecycle = factories.createLifecycle({
		getXterm: () => input.xtermRef.current,
		transport,
		size,
		platformOS: input.platformOS,
		logger: currentLogger,
		onRuntimeChanged: (runtimeKey, instanceId) =>
			dependencies.onRuntimeChanged(runtimeKey, instanceId),
	});
	const disposer = factories.createDisposer(
		() => disposeTerminalControllerCores({ lifecycle, size, transport }),
		input.deferDisposal ?? queueMicrotask,
	);
	const sendCurrentShell = async (
		bytes: Uint8Array<ArrayBufferLike>,
	): Promise<void> => {
		if (!shell) return;
		const copied = new Uint8Array(bytes);
		await shell.sendData(copied.buffer as ArrayBuffer);
	};
	const view: ShellTerminalRuntimeView = {
		getRuntimeKey: lifecycle.getRuntimeKey,
		getRuntimeInstanceId: lifecycle.getRuntimeInstanceId,
		isCurrentInstance: lifecycle.isCurrentInstance,
		fit: () => input.xtermRef.current?.fit(),
		setSystemKeyboardEnabled: (enabled) =>
			input.xtermRef.current?.setSystemKeyboardEnabled(enabled),
		setSelectionModeEnabled: (enabled) =>
			input.xtermRef.current?.setSelectionModeEnabled(enabled),
		getSelection: () =>
			input.xtermRef.current?.getSelection() ?? Promise.resolve(''),
		exitScrollback: (message) =>
			input.xtermRef.current?.exitScrollback(message),
		sendScrollbackEnterAck: (requestId, instanceId) =>
			input.xtermRef.current?.sendScrollbackEnterAck(requestId, instanceId),
	};

	return {
		transport,
		size,
		lifecycle,
		view,
		updateDependencies: (nextDependencies) => {
			dependencies = nextDependencies;
		},
		updateShell: (transportKey, nextShell) => {
			shell = nextShell ?? null;
			if (shell && transportKey) {
				transport.setShell(transportKey, sendCurrentShell);
			} else {
				transport.clearShell();
			}
			lifecycle.setShell(transportKey, shell);
		},
		updateViewModes: lifecycle.setViewModes,
		requestAttach: (ready, hasShell) =>
			ready && hasShell ? lifecycle.attach() : Promise.resolve(),
		setupDisposal: disposer.setup,
		retry: () => dependencies.router.back(),
	};
}
