import { type SshShell } from '@fressh/react-native-uniffi-russh';
import { type XtermWebViewHandle } from '@fressh/react-native-xtermjs-webview';
import {
	type RefObject,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
import { type TerminalFitSize } from '../terminal-fit-runner';
import { createReplaySafeDisposer } from './controller-core';
import { type ShellTransportKey } from './source-keys';
import {
	createTerminalLifecycleController,
	type TerminalLifecycleLogger,
} from './terminal-lifecycle-core';
import { createTerminalSizeController } from './terminal-size-core';
import {
	createShellTerminalTransport,
	type ShellTerminalTransportController,
	type ShellTerminalTransportPort,
	type TerminalRuntimeKey,
} from './terminal-transport';

export type ShellTerminalViewPort = {
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

export type ShellTerminalControllerHandle = {
	xtermRef: RefObject<XtermWebViewHandle | null>;
	ready: boolean;
	hasRendered: boolean;
	runtimeKey: TerminalRuntimeKey | null;
	lastSize: TerminalFitSize | null;
	transport: ShellTerminalTransportPort;
	view: ShellTerminalViewPort;
	onLoadStart(): void;
	onInitialized(instanceId: string): void;
	onResize(cols: number, rows: number): void;
	waitForSizeAfterFit(): Promise<TerminalFitSize | null>;
	retry(): void;
};

export type ShellTerminalRouter = {
	back(): void;
};

export type UseShellTerminalControllerInput = {
	shell: SshShell | null | undefined;
	transportKey: ShellTransportKey | null;
	platformOS: string;
	systemKeyboardEnabled: boolean;
	selectionModeEnabled: boolean;
	logger: TerminalLifecycleLogger;
	router: ShellTerminalRouter;
	onRuntimeChanged(runtimeKey: TerminalRuntimeKey | null): void;
};

type CurrentDependencies = Pick<
	UseShellTerminalControllerInput,
	'logger' | 'router' | 'onRuntimeChanged'
>;

export function useShellTerminalController({
	shell,
	transportKey,
	platformOS,
	systemKeyboardEnabled,
	selectionModeEnabled,
	logger,
	router,
	onRuntimeChanged,
}: UseShellTerminalControllerInput): ShellTerminalControllerHandle {
	const xtermRef = useRef<XtermWebViewHandle>(null);
	const shellRef = useRef<SshShell | null>(shell ?? null);
	const dependenciesRef = useRef<CurrentDependencies>({
		logger,
		router,
		onRuntimeChanged,
	});

	const [controllers] = useState(() => {
		const currentLogger: TerminalLifecycleLogger = {
			info: (message, details) =>
				dependenciesRef.current.logger.info(message, details),
			warn: (message, error) =>
				dependenciesRef.current.logger.warn(message, error),
		};
		const transport = createShellTerminalTransport({
			onSendFailure: (error) => {
				try {
					dependenciesRef.current.logger.warn('sendData failed', error);
				} finally {
					dependenciesRef.current.router.back();
				}
			},
		});
		const size = createTerminalSizeController({
			setTimeout: (task, delayMs) => setTimeout(task, delayMs),
			clearTimeout: (timer) =>
				clearTimeout(timer as ReturnType<typeof setTimeout>),
			resizePty: async (cols, rows) => {
				await shellRef.current?.resizePty(cols, rows);
			},
			warn: (message, error) => currentLogger.warn(message, error),
		});
		const lifecycle = createTerminalLifecycleController({
			getXterm: () => xtermRef.current,
			transport,
			size,
			platformOS,
			logger: currentLogger,
			onRuntimeChanged: (runtimeKey) =>
				dependenciesRef.current.onRuntimeChanged(runtimeKey),
		});
		const lifecycleDisposer = createReplaySafeDisposer(() => {
			lifecycle.dispose();
			size.dispose();
			transport.dispose();
		});
		return { transport, size, lifecycle, lifecycleDisposer };
	});

	const { transport, size, lifecycle, lifecycleDisposer } = controllers;
	const lifecycleState = useSyncExternalStore(
		lifecycle.subscribe,
		lifecycle.getSnapshot,
		lifecycle.getSnapshot,
	);
	const sizeState = useSyncExternalStore(
		size.subscribe,
		size.getSnapshot,
		size.getSnapshot,
	);

	useLayoutEffect(() => {
		dependenciesRef.current = { logger, router, onRuntimeChanged };
	}, [logger, onRuntimeChanged, router]);

	useLayoutEffect(() => {
		shellRef.current = shell ?? null;
		if (shell && transportKey) {
			transport.setShell(transportKey, async (bytes) => {
				const currentShell = shellRef.current;
				if (!currentShell) return;
				const copied = new Uint8Array(bytes);
				await currentShell.sendData(copied.buffer as ArrayBuffer);
			});
		} else {
			transport.clearShell();
		}
		lifecycle.setShell(transportKey, shell);
	}, [lifecycle, shell, transport, transportKey]);

	useLayoutEffect(() => {
		lifecycle.setViewModes({
			systemKeyboardEnabled,
			selectionModeEnabled,
		});
	}, [lifecycle, selectionModeEnabled, systemKeyboardEnabled]);

	useEffect(() => {
		void lifecycle.attach().catch((error) => {
			try {
				dependenciesRef.current.logger.warn(
					'Failed to attach shell listener',
					error,
				);
			} catch {
				// An attach failure is already represented by the missing listener.
			}
		});
	}, [lifecycle, lifecycleState.ready, shell]);

	useEffect(() => lifecycleDisposer.setup(), [lifecycleDisposer]);

	const view = useMemo<ShellTerminalViewPort>(
		() => ({
			getRuntimeKey: lifecycle.getRuntimeKey,
			getRuntimeInstanceId: lifecycle.getRuntimeInstanceId,
			isCurrentInstance: lifecycle.isCurrentInstance,
			fit: () => xtermRef.current?.fit(),
			setSystemKeyboardEnabled: (enabled) =>
				xtermRef.current?.setSystemKeyboardEnabled(enabled),
			setSelectionModeEnabled: (enabled) =>
				xtermRef.current?.setSelectionModeEnabled(enabled),
			getSelection: () =>
				xtermRef.current?.getSelection() ?? Promise.resolve(''),
			exitScrollback: (message) => xtermRef.current?.exitScrollback(message),
			sendScrollbackEnterAck: (requestId, instanceId) =>
				xtermRef.current?.sendScrollbackEnterAck(requestId, instanceId),
		}),
		[lifecycle],
	);

	return useMemo(
		() => ({
			xtermRef,
			ready: lifecycleState.ready,
			hasRendered: lifecycleState.hasRendered,
			runtimeKey: lifecycleState.runtimeKey,
			lastSize: sizeState.lastSize,
			transport: transport as ShellTerminalTransportController,
			view,
			onLoadStart: lifecycle.handleLoadStart,
			onInitialized: lifecycle.handleInitialized,
			onResize: size.handleResize,
			waitForSizeAfterFit: size.waitForSizeAfterFit,
			retry: () => dependenciesRef.current.router.back(),
		}),
		[lifecycle, lifecycleState, size, sizeState, transport, view],
	);
}
