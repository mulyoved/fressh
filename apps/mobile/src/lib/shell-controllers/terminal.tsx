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
import { type ShellTerminalSourcePort } from './session-contracts';
import { type ShellTerminalViewPort } from './terminal-contracts';
import {
	createShellTerminalHookRuntime,
	type ShellTerminalRuntimeRouter,
} from './terminal-hook-runtime';
import { type TerminalLifecycleLogger } from './terminal-lifecycle-core';
import {
	type ShellTerminalTransportPort,
	type TerminalRuntimeKey,
} from './terminal-transport';

export type { ShellTerminalViewPort } from './terminal-contracts';

export type ShellTerminalControllerHandle = {
	xtermRef: RefObject<XtermWebViewHandle | null>;
	ready: boolean;
	hasRendered: boolean;
	runtimeKey: TerminalRuntimeKey | null;
	runtimeInstanceId: string | null;
	transport: ShellTerminalTransportPort;
	view: ShellTerminalViewPort;
	getOutputDiagnostics(): ReturnType<
		ReturnType<typeof createShellTerminalHookRuntime>['getOutputDiagnostics']
	>;
	getLastSize(): TerminalFitSize | null;
	onLoadStart(): void;
	onInitialized(instanceId: string): void;
	onResize(cols: number, rows: number): void;
	waitForSizeAfterFit(): Promise<TerminalFitSize | null>;
	retry(): void;
};

export type ShellTerminalRouter = ShellTerminalRuntimeRouter;

export type UseShellTerminalControllerInput = {
	source: ShellTerminalSourcePort;
	platformOS: string;
	systemKeyboardEnabled: boolean;
	logger: TerminalLifecycleLogger;
	router: ShellTerminalRouter;
};

export function useShellTerminalController({
	source,
	platformOS,
	systemKeyboardEnabled,
	logger,
	router,
}: UseShellTerminalControllerInput): ShellTerminalControllerHandle {
	const xtermRef = useRef<XtermWebViewHandle>(null);
	const [runtime] = useState(() =>
		createShellTerminalHookRuntime({
			xtermRef,
			platformOS,
			dependencies: { logger, router },
		}),
	);
	const { transport, size, lifecycle } = runtime;
	const lifecycleState = useSyncExternalStore(
		lifecycle.subscribe,
		lifecycle.getSnapshot,
		lifecycle.getSnapshot,
	);
	useLayoutEffect(() => {
		runtime.updateDependencies({ logger, router });
	}, [logger, router, runtime]);

	useLayoutEffect(() => {
		runtime.updateSource(source);
	}, [runtime, source]);

	useLayoutEffect(() => {
		runtime.updateViewModes({
			systemKeyboardEnabled,
			selectionModeEnabled: runtime.view.getSelectionModeEnabled(),
		});
	}, [runtime, systemKeyboardEnabled]);

	useEffect(() => {
		void runtime.requestAttach(lifecycleState.ready, source.isAvailable());
	}, [lifecycleState.ready, runtime, source]);

	useEffect(() => runtime.setupDisposal(), [runtime]);

	return useMemo(
		() => ({
			xtermRef,
			ready: lifecycleState.ready,
			hasRendered: lifecycleState.hasRendered,
			runtimeKey: lifecycleState.runtimeKey,
			runtimeInstanceId: lifecycleState.runtimeInstanceId,
			transport,
			view: runtime.view,
			getOutputDiagnostics: runtime.getOutputDiagnostics,
			getLastSize: runtime.getLastSize,
			onLoadStart: lifecycle.handleLoadStart,
			onInitialized: lifecycle.handleInitialized,
			onResize: size.handleResize,
			waitForSizeAfterFit: size.waitForSizeAfterFit,
			retry: runtime.retry,
		}),
		[lifecycle, lifecycleState, runtime, size, transport],
	);
}
