import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
import { type ShellRouteRequest } from '../../app/shell/shell-route';
import { useAutoConnectStore } from '../auto-connect-store';
import { formatConnectionDiagnosticEventFields } from '../connection-diagnostics';
import { getStoredConnectionId } from '../connection-utils';
import { secretsManager } from '../secrets-manager';
import { useSshStore } from '../ssh-store';
import { queryClient } from '../utils';
import { createReplaySafeDisposer } from './controller-core';
import {
	type ShellActivityPort,
	type ShellSessionPorts,
	type ShellSessionSnapshot,
} from './session-contracts';
import { createShellSessionCore } from './session-core';
import { createShellDiagnosticPort } from './session-diagnostics';
import { deriveShellSessionSource } from './session-source';
import {
	createShellTargetOwner,
	type ShellTargetPublication,
} from './session-target-owner';
import {
	createShellTmuxResolutionOwner,
	type ShellTmuxResolution,
} from './session-tmux-resolution';
import {
	createShellTransportOwner,
	type ShellTransportPublication,
} from './session-transport-owner';
import {
	createShellTargetKey,
	createShellTransportKey,
	type ShellTargetKey,
	type ShellTransportKey,
} from './source-keys';

type ShellSessionRouter = {
	back(): void;
	replace(route: { pathname: '/'; params: { editConnectionId: string } }): void;
};

type ShellSessionLogger = {
	info(message: string, details?: unknown): void;
	warn(message: string, error?: unknown): void;
	error(message: string, error?: unknown): void;
};

export type ShellSessionControllerHandle = {
	snapshot: ShellSessionSnapshot;
	ports: ShellSessionPorts;
	identity: {
		transportKey: ShellTransportKey;
		targetKey: ShellTargetKey;
		generation: number;
	};
	tmux: ShellTmuxResolution;
	storedConnectionId?: string;
	invalidateShellTransport(): void;
};

export type UseShellSessionControllerInput = {
	request: ShellRouteRequest;
	activity: ShellActivityPort;
	router: ShellSessionRouter;
	logger: ShellSessionLogger;
};

type TargetCommit = {
	publication: ShellTargetPublication;
	tmux: ShellTmuxResolution;
};

function pairShellSessionGenerations(
	transportGeneration: number,
	targetGeneration: number,
): number {
	const diagonal = transportGeneration + targetGeneration;
	return (diagonal * (diagonal + 1)) / 2 + targetGeneration;
}

export function createShellSessionMountKey(request: ShellRouteRequest): string {
	return JSON.stringify([
		request.connectionId,
		request.channelId,
		request.storedConnectionId ?? null,
		request.tmuxAttach.status,
		request.tmuxAttach.sessionName,
		request.tmuxAttach.status === 'failed'
			? (request.tmuxAttach.failureReason ?? null)
			: null,
		request.agentRoute.connectionId,
		request.agentRoute.session,
		request.agentRoute.windowId,
		request.agentRoute.eventId,
		request.agentRoute.tapToken,
	]);
}

export function useShellSessionController({
	request,
	activity,
	router,
	logger,
}: UseShellSessionControllerInput): ShellSessionControllerHandle {
	const { connectionId, channelId } = request;
	const shell = useSshStore(
		(state) => state.shells[`${connectionId}-${channelId}` as const],
	);
	const connection = useSshStore((state) => state.connections[connectionId]);
	const activeDiagnosticTrace = useAutoConnectStore(
		(state) => state.activeDiagnosticTrace,
	);
	const isAutoConnecting = useAutoConnectStore(
		(state) => state.isAutoConnecting,
	);
	const isReconnecting = useAutoConnectStore((state) => state.isReconnecting);
	const lastReconnectOutcome = useAutoConnectStore(
		(state) => state.lastReconnectOutcome,
	);
	const transportKey = useMemo(
		() => createShellTransportKey(connectionId, channelId),
		[channelId, connectionId],
	);
	const storedConnectionId =
		request.storedConnectionId ??
		(connection
			? getStoredConnectionId(connection.connectionDetails)
			: undefined);
	const initialTmux = useMemo<ShellTmuxResolution>(
		() => ({
			enabled: false,
			target: request.tmuxAttach.sessionName?.trim() || 'main',
		}),
		[request.tmuxAttach.sessionName],
	);
	const initialTargetKey = useMemo(
		() => createShellTargetKey(transportKey, initialTmux.target),
		[initialTmux.target, transportKey],
	);
	const activeDiagnosticTraceRef = useRef(activeDiagnosticTrace);
	const targetGenerationRef = useRef(0);
	const routerRef = useRef(router);
	const loggerRef = useRef(logger);
	const reconnectingRef = useRef(false);
	const [core] = useState(() =>
		createShellSessionCore({
			request,
			navigate: {
				back: () => routerRef.current.back(),
				editHost: (editConnectionId) =>
					routerRef.current.replace({
						pathname: '/',
						params: { editConnectionId },
					}),
			},
		}),
	);
	const [transportOwner] = useState(() =>
		createShellTransportOwner({
			channelId,
			connectionId,
			key: transportKey,
			shell,
		}),
	);
	const [transport, setTransport] = useState<ShellTransportPublication>(() =>
		transportOwner.getPublication(),
	);
	const [targetOwner] = useState(() =>
		createShellTargetOwner({
			createDiagnostics: (generation) => {
				targetGenerationRef.current = generation;
				return createShellDiagnosticPort({
					generation,
					getCurrentGeneration: () => targetGenerationRef.current,
					getActiveTrace: () => activeDiagnosticTraceRef.current,
					getEventDetails: (event) => {
						const state = useSshStore.getState();
						const storeKey = `${connectionId}-${channelId}` as const;
						return {
							connectionId,
							channelId,
							kind: event.kind,
							fields: formatConnectionDiagnosticEventFields(event),
							message: (event as { message?: unknown }).message,
							hasConnection: Boolean(state.connections[connectionId]),
							hasShell: Boolean(state.shells[storeKey]),
							connectionCount: Object.keys(state.connections).length,
							shellCount: Object.keys(state.shells).length,
						};
					},
					logger,
				});
			},
			source: { key: initialTargetKey, connection: connection ?? null },
		}),
	);
	const [target, setTarget] = useState<TargetCommit>(() => ({
		publication: targetOwner.getPublication(),
		tmux: initialTmux,
	}));
	const resolvedTmuxRef = useRef(initialTmux);
	const [tmuxOwner] = useState(() =>
		createShellTmuxResolutionOwner({
			initialTarget: initialTmux.target,
			load: async (id) => {
				const entry = await queryClient.fetchQuery(
					secretsManager.connections.query.get(id),
				);
				return entry?.value ?? null;
			},
			warn: (message, error) => loggerRef.current.warn(message, error),
		}),
	);
	const resolvedTmux = useSyncExternalStore(
		tmuxOwner.subscribe,
		tmuxOwner.getSnapshot,
		tmuxOwner.getSnapshot,
	);
	const snapshot = useSyncExternalStore(
		core.subscribe,
		core.getSnapshot,
		core.getSnapshot,
	);
	const [lifecycle] = useState(() =>
		createReplaySafeDisposer(() => {
			targetGenerationRef.current += 1;
			core.invalidate('unmount');
			core.dispose();
			tmuxOwner.dispose();
			transportOwner.dispose();
			targetOwner.dispose(reconnectingRef.current ? 'reconnect' : 'unmount');
		}),
	);
	useLayoutEffect(() => lifecycle.setup(), [lifecycle]);

	useLayoutEffect(() => {
		routerRef.current = router;
		loggerRef.current = logger;
		activeDiagnosticTraceRef.current = activeDiagnosticTrace;
		reconnectingRef.current = isReconnecting;
	}, [activeDiagnosticTrace, isReconnecting, logger, router]);

	useLayoutEffect(
		() =>
			targetOwner.subscribe(() => {
				setTarget({
					publication: targetOwner.getPublication(),
					tmux: resolvedTmuxRef.current,
				});
			}),
		[targetOwner],
	);

	useLayoutEffect(() => {
		const next = transportOwner.update(shell);
		setTransport((current) => (current === next ? current : next));
	}, [shell, transportOwner]);

	useLayoutEffect(() => {
		targetOwner.activate();
		resolvedTmuxRef.current = resolvedTmux;
		const nextKey = createShellTargetKey(transportKey, resolvedTmux.target);
		const targetKeyChanged = targetOwner.getPublication().key !== nextKey;
		targetOwner.update({
			key: nextKey,
			connection: connection ?? null,
		});
		if (!targetKeyChanged) {
			setTarget((current) =>
				current.tmux.enabled === resolvedTmux.enabled &&
				current.tmux.target === resolvedTmux.target
					? current
					: { ...current, tmux: resolvedTmux },
			);
		}
	}, [connection, resolvedTmux, targetOwner, transportKey]);

	useLayoutEffect(() => {
		core.reconcile(
			deriveShellSessionSource({
				connectionPresent: connection !== undefined,
				shellPresent: shell !== undefined,
				isAutoConnecting,
				isReconnecting,
				lastReconnectDestination: lastReconnectOutcome?.destination ?? null,
				...(storedConnectionId ? { storedConnectionId } : {}),
			}),
		);
	}, [
		connection,
		core,
		isAutoConnecting,
		isReconnecting,
		lastReconnectOutcome,
		shell,
		storedConnectionId,
	]);

	useEffect(() => {
		tmuxOwner.resolve(storedConnectionId);
		return () => tmuxOwner.invalidate('source-change');
	}, [storedConnectionId, tmuxOwner]);

	const ports = useMemo<ShellSessionPorts>(
		() => ({
			terminalSource: transport.port,
			hostCommands: target.publication.hostCommands,
			workmux: target.publication.workmux,
			diagnostics: target.publication.diagnostics,
			activity,
		}),
		[activity, target.publication, transport.port],
	);

	return useMemo(
		() => ({
			snapshot,
			ports,
			identity: {
				transportKey,
				targetKey: target.publication.key,
				generation: pairShellSessionGenerations(
					transport.generation,
					target.publication.generation,
				),
			},
			tmux: target.tmux,
			...(storedConnectionId ? { storedConnectionId } : {}),
			invalidateShellTransport: () => {
				core.invalidate('source-change');
				useSshStore
					.getState()
					.invalidateShellTransport(connectionId, channelId);
			},
		}),
		[
			channelId,
			connectionId,
			core,
			ports,
			snapshot,
			storedConnectionId,
			target,
			transport,
			transportKey,
		],
	);
}
