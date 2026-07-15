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
import { executeSideChannelCommand } from '../ssh-side-channel';
import { useSshStore } from '../ssh-store';
import { queryClient } from '../utils';
import { type WorkmuxControlConnection } from '../workmux-control-channel';
import { createReplaySafeDisposer } from './controller-core';
import {
	type ShellActivityPort,
	type ShellSessionPorts,
	type ShellSessionSnapshot,
	type ShellTerminalListenerRegistration,
	type ShellTerminalSourcePort,
} from './session-contracts';
import { createShellSessionCore } from './session-core';
import { createShellDiagnosticPort } from './session-diagnostics';
import {
	createShellSessionWorkmuxInput,
	createShellSessionWorkmuxOwner,
} from './session-workmux';
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
	tmux: { enabled: boolean; target: string };
	storedConnectionId?: string;
	invalidateShellTransport(): void;
};

export type UseShellSessionControllerInput = {
	request: ShellRouteRequest;
	activity: ShellActivityPort;
	router: ShellSessionRouter;
	logger: ShellSessionLogger;
};

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

function createTerminalSourcePort({
	channelId,
	connectionId,
	generation,
	getCurrentGeneration,
	key,
	shell,
}: {
	channelId: number;
	connectionId: string;
	generation: number;
	getCurrentGeneration(): number;
	key: ShellTransportKey;
	shell:
		| ReturnType<typeof useSshStore.getState>['shells'][`${string}-${number}`]
		| undefined;
}): ShellTerminalSourcePort {
	const registrations = new WeakMap<
		ShellTerminalListenerRegistration,
		{ id: bigint; removed: boolean }
	>();
	const requireCurrent = () => {
		if (getCurrentGeneration() !== generation || shell === undefined) {
			throw new Error('Shell terminal source superseded.');
		}
		return shell;
	};
	return {
		key,
		generation,
		connectionId,
		channelId,
		isAvailable: () =>
			getCurrentGeneration() === generation && shell !== undefined,
		getNativeOutputDiagnostics: () => {
			if (getCurrentGeneration() !== generation || shell === undefined) {
				return null;
			}
			const stats = shell.bufferStats();
			return {
				currentSeq: shell.currentSeq().toString(),
				ringBytesCount: stats.ringBytesCount.toString(),
				usedBytes: stats.usedBytes.toString(),
				headSeq: stats.headSeq.toString(),
				tailSeq: stats.tailSeq.toString(),
				droppedBytesTotal: stats.droppedBytesTotal.toString(),
				chunksCount: stats.chunksCount.toString(),
			};
		},
		readBuffer: async (cursor) => {
			const owner = requireCurrent();
			const result = await owner.readBuffer(cursor);
			requireCurrent();
			return result;
		},
		addListener: async (listener, options) => {
			const owner = requireCurrent();
			const id = await owner.addListener(listener, options);
			if (getCurrentGeneration() !== generation) {
				owner.removeListener(id);
				throw new Error('Shell terminal source superseded.');
			}
			const registration = Object.freeze({ id });
			registrations.set(registration, { id, removed: false });
			return registration;
		},
		removeListener: (registration) => {
			const owned = registrations.get(registration);
			if (!owned || owned.removed || shell === undefined) return;
			owned.removed = true;
			shell.removeListener(owned.id);
		},
		sendData: async (bytes) => {
			const owner = requireCurrent();
			const copied = new Uint8Array(bytes);
			await owner.sendData(copied.buffer as ArrayBuffer);
			requireCurrent();
		},
		resizePty: async (cols, rows) => {
			const owner = requireCurrent();
			await owner.resizePty(cols, rows);
			requireCurrent();
		},
	};
}

function createWorkmuxInput({
	key,
	connection,
	diagnostics,
}: {
	key: ShellTargetKey;
	connection: WorkmuxControlConnection | null;
	diagnostics: ReturnType<typeof createShellDiagnosticPort>;
}) {
	return createShellSessionWorkmuxInput({
		key,
		connection,
		diagnostics,
	});
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
	const initialTarget = request.tmuxAttach.sessionName?.trim() || 'main';
	const [tmux, setTmux] = useState(() => ({
		enabled: false,
		target: initialTarget,
	}));
	const tmuxQueryGenerationRef = useRef(0);
	const transportKey = useMemo(
		() => createShellTransportKey(connectionId, channelId),
		[channelId, connectionId],
	);
	const targetKey = useMemo(
		() => createShellTargetKey(transportKey, tmux.target),
		[tmux.target, transportKey],
	);
	const storedConnectionId =
		request.storedConnectionId ??
		(connection
			? getStoredConnectionId(connection.connectionDetails)
			: undefined);
	const activeDiagnosticTraceRef = useRef(activeDiagnosticTrace);
	const [sourceGeneration, setSourceGeneration] = useState(0);
	const sourceGenerationRef = useRef(0);
	const [workmuxGeneration, setWorkmuxGeneration] = useState(0);
	const workmuxGenerationRef = useRef(0);
	const routerRef = useRef(router);
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
	const diagnostics = useMemo(
		() =>
			createShellDiagnosticPort({
				generation: workmuxGeneration,
				getCurrentGeneration: () => workmuxGenerationRef.current,
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
			}),
		[channelId, connectionId, logger, workmuxGeneration],
	);
	const [workmuxOwner] = useState(() =>
		createShellSessionWorkmuxOwner(
			createWorkmuxInput({
				key: targetKey,
				connection: (connection ?? null) as WorkmuxControlConnection | null,
				diagnostics,
			}),
			{ deferActivation: true },
		),
	);
	const reconnectingRef = useRef(false);
	const [lifecycle] = useState(() =>
		createReplaySafeDisposer(() => {
			sourceGenerationRef.current += 1;
			workmuxGenerationRef.current += 1;
			core.invalidate('unmount');
			core.dispose();
			workmuxOwner.dispose(reconnectingRef.current ? 'reconnect' : 'unmount');
		}),
	);
	const snapshot = useSyncExternalStore(
		core.subscribe,
		core.getSnapshot,
		core.getSnapshot,
	);
	const sourceIdentityRef = useRef({ connection, shell, targetKey });
	const terminalSource = useMemo(
		() =>
			createTerminalSourcePort({
				channelId,
				connectionId,
				generation: sourceGeneration,
				getCurrentGeneration: () => sourceGenerationRef.current,
				key: transportKey,
				shell,
			}),
		[channelId, connectionId, shell, sourceGeneration, transportKey],
	);
	const ports = useMemo<ShellSessionPorts>(
		() => ({
			terminalSource,
			hostCommands: {
				key: targetKey,
				run: async (command, timeoutMs) => {
					if (sourceGenerationRef.current !== sourceGeneration) {
						return { status: 'superseded' };
					}
					if (!connection) return { status: 'unavailable' };
					try {
						const result = await executeSideChannelCommand(
							connection,
							command,
							timeoutMs,
						);
						if (sourceGenerationRef.current !== sourceGeneration) {
							return { status: 'superseded' };
						}
						if (!result.success) {
							return {
								status: 'failed',
								failure: {
									message:
										result.error || result.output || 'Host command failed.',
								},
								output: result.output,
							};
						}
						return {
							status: 'completed',
							output: result.output,
							...(result.issueUrl ? { issueUrl: result.issueUrl } : {}),
						};
					} catch (error) {
						if (sourceGenerationRef.current !== sourceGeneration) {
							return { status: 'superseded' };
						}
						return {
							status: 'failed',
							failure: {
								message: error instanceof Error ? error.message : String(error),
							},
						};
					}
				},
			},
			workmux: workmuxOwner.getPort(),
			diagnostics,
			activity,
		}),
		[
			activity,
			connection,
			diagnostics,
			sourceGeneration,
			targetKey,
			terminalSource,
			workmuxOwner,
		],
	);

	useLayoutEffect(() => lifecycle.setup(), [lifecycle]);

	useLayoutEffect(() => {
		routerRef.current = router;
	}, [router]);

	useLayoutEffect(() => {
		workmuxOwner.activate();
		activeDiagnosticTraceRef.current = activeDiagnosticTrace;
		reconnectingRef.current = isReconnecting;
		const previousIdentity = sourceIdentityRef.current;
		const connectionChanged = previousIdentity.connection !== connection;
		const targetChanged = previousIdentity.targetKey !== targetKey;
		const sourceChanged =
			connectionChanged || previousIdentity.shell !== shell || targetChanged;
		if (sourceChanged) {
			const nextGeneration = sourceGenerationRef.current + 1;
			sourceGenerationRef.current = nextGeneration;
			if (connectionChanged || targetChanged) {
				const nextWorkmuxGeneration = workmuxGenerationRef.current + 1;
				workmuxGenerationRef.current = nextWorkmuxGeneration;
				const nextDiagnostics = createShellDiagnosticPort({
					generation: nextWorkmuxGeneration,
					getCurrentGeneration: () => workmuxGenerationRef.current,
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
				workmuxOwner.replace(
					createWorkmuxInput({
						key: targetKey,
						connection: (connection ?? null) as WorkmuxControlConnection | null,
						diagnostics: nextDiagnostics,
					}),
				);
				void workmuxOwner.drain().then(() => {
					if (sourceGenerationRef.current === nextGeneration) {
						setSourceGeneration(nextGeneration);
					}
					if (workmuxGenerationRef.current === nextWorkmuxGeneration) {
						setWorkmuxGeneration(nextWorkmuxGeneration);
					}
				});
			} else {
				setSourceGeneration(nextGeneration);
			}
			sourceIdentityRef.current = { connection, shell, targetKey };
		}
		core.reconcile({
			connectionPresent: connection !== undefined,
			shellPresent: shell !== undefined,
			isAutoConnecting,
			isReconnecting,
			lastReconnectOutcome,
			...(storedConnectionId ? { storedConnectionId } : {}),
		});
	}, [
		activeDiagnosticTrace,
		channelId,
		connection,
		connectionId,
		core,
		diagnostics,
		isAutoConnecting,
		isReconnecting,
		lastReconnectOutcome,
		logger,
		shell,
		storedConnectionId,
		targetKey,
		workmuxOwner,
	]);

	useEffect(() => {
		const generation = tmuxQueryGenerationRef.current + 1;
		tmuxQueryGenerationRef.current = generation;
		if (!storedConnectionId) return undefined;
		void queryClient
			.fetchQuery(secretsManager.connections.query.get(storedConnectionId))
			.then((entry) => {
				if (tmuxQueryGenerationRef.current !== generation) return;
				const details = entry?.value;
				if (!details) return;
				const enabled = details.useTmux ?? true;
				setTmux((current) => {
					const target = enabled
						? details.tmuxSessionName?.trim() || 'main'
						: current.target;
					return current.enabled === enabled && current.target === target
						? current
						: { enabled, target };
				});
			})
			.catch((error) => {
				if (tmuxQueryGenerationRef.current === generation) {
					logger.warn('Failed to load tmux session info', error);
				}
			});
		return () => {
			if (tmuxQueryGenerationRef.current === generation) {
				tmuxQueryGenerationRef.current += 1;
			}
		};
	}, [logger, storedConnectionId]);

	return useMemo(
		() => ({
			snapshot,
			ports,
			identity: { transportKey, targetKey, generation: sourceGeneration },
			tmux,
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
			sourceGeneration,
			storedConnectionId,
			targetKey,
			tmux,
			transportKey,
		],
	);
}
