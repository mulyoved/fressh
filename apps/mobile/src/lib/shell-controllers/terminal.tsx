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
import { type ShellTransportKey } from './source-keys';
import {
	createShellTerminalHookRuntime,
	type ShellTerminalRuntimeRouter,
	type ShellTerminalRuntimeView,
} from './terminal-hook-runtime';
import { type TerminalLifecycleLogger } from './terminal-lifecycle-core';
import {
	type ShellTerminalTransportPort,
	type TerminalRuntimeKey,
} from './terminal-transport';

export type ShellTerminalViewPort = ShellTerminalRuntimeView;

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

export type ShellTerminalRouter = ShellTerminalRuntimeRouter;

export type UseShellTerminalControllerInput = {
	shell: SshShell | null | undefined;
	transportKey: ShellTransportKey | null;
	platformOS: string;
	systemKeyboardEnabled: boolean;
	selectionModeEnabled: boolean;
	logger: TerminalLifecycleLogger;
	router: ShellTerminalRouter;
	onRuntimeChanged(
		runtimeKey: TerminalRuntimeKey | null,
		instanceId: string | null,
	): void;
};

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
	const [runtime] = useState(() =>
		createShellTerminalHookRuntime({
			xtermRef,
			platformOS,
			dependencies: { logger, router, onRuntimeChanged },
		}),
	);
	const { transport, size, lifecycle } = runtime;
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
		runtime.updateDependencies({ logger, router, onRuntimeChanged });
	}, [logger, onRuntimeChanged, router, runtime]);

	useLayoutEffect(() => {
		runtime.updateShell(transportKey, shell);
	}, [runtime, shell, transportKey]);

	useLayoutEffect(() => {
		runtime.updateViewModes({
			systemKeyboardEnabled,
			selectionModeEnabled,
		});
	}, [runtime, selectionModeEnabled, systemKeyboardEnabled]);

	useEffect(() => {
		void runtime
			.requestAttach(lifecycleState.ready, Boolean(shell))
			.catch((error) => {
				try {
					logger.warn('Failed to attach shell listener', error);
				} catch {
					// An attach failure is already represented by the missing listener.
				}
			});
	}, [lifecycleState.ready, logger, runtime, shell]);

	useEffect(() => runtime.setupDisposal(), [runtime]);

	return useMemo(
		() => ({
			xtermRef,
			ready: lifecycleState.ready,
			hasRendered: lifecycleState.hasRendered,
			runtimeKey: lifecycleState.runtimeKey,
			lastSize: sizeState.lastSize,
			transport,
			view: runtime.view,
			onLoadStart: lifecycle.handleLoadStart,
			onInitialized: lifecycle.handleInitialized,
			onResize: size.handleResize,
			waitForSizeAfterFit: size.waitForSizeAfterFit,
			retry: runtime.retry,
		}),
		[lifecycle, lifecycleState, runtime, size, sizeState, transport],
	);
}
