import { type XtermWebViewHandle } from '@fressh/react-native-xtermjs-webview';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Alert, AppState } from 'react-native';

import { type HerdrAgent, type HerdrHostState } from '@/lib/herdr/contracts';
import { prepareHerdrHost } from '@/lib/herdr/host-launcher';
import {
	createHerdrKeyboardAdapter,
	type HerdrKeyboardAdapter,
} from '@/lib/herdr/keyboard-adapter';
import { useHerdrProviderStore } from '@/lib/herdr/provider-store';
import {
	findHerdrAgent,
	loadHerdrSnapshot,
	nextHerdrTerminalId,
} from '@/lib/herdr/snapshot';
import {
	createHerdrTerminalOwner,
	type HerdrTerminalOwner,
} from '@/lib/herdr/terminal-owner';
import { rootLogger } from '@/lib/logger';
import { runRemoteTextCommand } from '@/lib/remote-command-runner';
import { secretsManager } from '@/lib/secrets-manager';
import { loadRuntimeShellConfigState } from '@/lib/shell-config-store-native';
import { useSshStore } from '@/lib/ssh-store';
import { queryClient } from '@/lib/utils';
import {
	HerdrTerminalView,
	type HerdrTerminalViewState,
} from './HerdrTerminalView';

const logger = rootLogger.extend('HerdrTerminalRoute');
const textEncoder = new TextEncoder();

function routeParam(value: string | string[] | undefined): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

type TerminalSize = Readonly<{ cols: number; rows: number }>;
type RendererPhase = 'blocked' | 'awaiting-baseline' | 'active';
type RetryRecovery = 'owner' | 'renderer' | 'transport';
type RouteOperation = Readonly<{ generation: number; routeIdentity: string }>;
type RendererRecovery = Readonly<{
	retirement: Promise<void>;
}>;

export default function HerdrTerminalRoute() {
	const router = useRouter();
	const params = useLocalSearchParams<{
		storedConnectionId?: string | string[];
		connectionId?: string | string[];
		terminalId?: string | string[];
	}>();
	const storedConnectionId = routeParam(params.storedConnectionId);
	const routeConnectionId = routeParam(params.connectionId);
	const terminalId = routeParam(params.terminalId);
	const xtermRef = React.useRef<XtermWebViewHandle | null>(null);
	const ownerRef = React.useRef<HerdrTerminalOwner | null>(null);
	const keyboardAdapterRef = React.useRef<HerdrKeyboardAdapter | null>(null);
	const ownerUnsubscribeRef = React.useRef<(() => void) | null>(null);
	const currentHostRef = React.useRef<HerdrHostState | null>(null);
	const currentXtermInstanceIdRef = React.useRef<string | null>(null);
	const initializedRef = React.useRef(false);
	const sizeRef = React.useRef<TerminalSize | null>(null);
	const startedOwnerRef = React.useRef<HerdrTerminalOwner | null>(null);
	const startAdmittedOwnerRef = React.useRef<HerdrTerminalOwner | null>(null);
	const rendererPhaseRef = React.useRef<RendererPhase>('blocked');
	const reloadOwnerRef = React.useRef<HerdrTerminalOwner | null>(null);
	const retryRecoveryRef = React.useRef<RetryRecovery>('transport');
	const recoveringTransportRef = React.useRef(false);
	const recoveringRendererRef = React.useRef(false);
	const rendererGenerationRef = React.useRef(0);
	const failedRendererGenerationRef = React.useRef<number | null>(null);
	const rendererRecoveryRef = React.useRef<RendererRecovery | null>(null);
	const visibleRef = React.useRef(false);
	const suspendedRef = React.useRef(false);
	const mountedRef = React.useRef(true);
	const reconcileGenerationRef = React.useRef(0);
	const routeOperationGenerationRef = React.useRef(0);
	const navigateAgentRef = React.useRef<
		(direction: 'next' | 'previous') => Promise<void>
	>(async () => {});
	const [shellConfigState] = React.useState(() =>
		loadRuntimeShellConfigState(),
	);
	const [agent, setAgent] = React.useState<HerdrAgent | null>(() => {
		const host = useHerdrProviderStore.getState().host;
		return host?.storedConnectionId === storedConnectionId && terminalId
			? findHerdrAgent(host.snapshot, terminalId)
			: null;
	});
	const [state, setState] = React.useState<HerdrTerminalViewState>({
		phase: 'reconnecting',
	});
	const [rendererGeneration, setRendererGeneration] = React.useState(0);
	const routeIdentity = JSON.stringify([
		storedConnectionId,
		routeConnectionId,
		terminalId,
	]);
	const routeIdentityRef = React.useRef(routeIdentity);
	routeIdentityRef.current = routeIdentity;
	const previousRouteIdentityRef = React.useRef(routeIdentity);
	const invalidateRouteOperations = React.useCallback(() => {
		routeOperationGenerationRef.current += 1;
	}, []);
	const beginRouteOperation = React.useCallback((): RouteOperation => {
		return {
			generation: ++routeOperationGenerationRef.current,
			routeIdentity: routeIdentityRef.current,
		};
	}, []);
	const isRouteOperationCurrent = React.useCallback(
		(operation: RouteOperation): boolean =>
			mountedRef.current &&
			visibleRef.current &&
			!suspendedRef.current &&
			operation.generation === routeOperationGenerationRef.current &&
			operation.routeIdentity === routeIdentityRef.current,
		[],
	);

	React.useEffect(() => {
		if (previousRouteIdentityRef.current === routeIdentity) return;
		previousRouteIdentityRef.current = routeIdentity;
		keyboardAdapterRef.current?.invalidatePending();
		invalidateRouteOperations();
	}, [invalidateRouteOperations, routeIdentity]);

	const maybeStartOwner = React.useCallback(
		(owner: HerdrTerminalOwner | null) => {
			const size = sizeRef.current;
			if (
				!owner ||
				ownerRef.current !== owner ||
				startAdmittedOwnerRef.current !== owner ||
				!mountedRef.current ||
				!visibleRef.current ||
				suspendedRef.current ||
				!initializedRef.current ||
				!size ||
				startedOwnerRef.current === owner
			) {
				return;
			}
			startedOwnerRef.current = owner;
			rendererPhaseRef.current = 'awaiting-baseline';
			if (reloadOwnerRef.current === owner) {
				reloadOwnerRef.current = null;
				owner.retry(size);
			} else {
				owner.start(size);
			}
		},
		[],
	);

	const goToList = React.useCallback(
		(host: HerdrHostState | null) => {
			invalidateRouteOperations();
			if (!storedConnectionId) {
				router.replace('/herdr');
				return;
			}
			router.replace({
				pathname: '/herdr',
				params: {
					storedConnectionId,
					connectionId: host?.connectionId ?? routeConnectionId ?? '',
				},
			});
		},
		[invalidateRouteOperations, routeConnectionId, router, storedConnectionId],
	);

	const prepareHost = React.useCallback(async () => {
		if (!storedConnectionId) {
			throw new Error('This Herdr terminal link is incomplete.');
		}
		return prepareHerdrHost({
			storedConnectionId,
			ports: {
				getSavedConnection: (savedId) =>
					queryClient.fetchQuery(secretsManager.connections.query.get(savedId)),
				getPrivateKey: async (keyId) =>
					(await secretsManager.keys.utils.getPrivateKey(keyId)).value,
				getConnections: () => useSshStore.getState().connections,
				connect: useSshStore.getState().connect,
				loadSnapshot: (connection) =>
					loadHerdrSnapshot({
						run: (command) => runRemoteTextCommand({ connection, command }),
					}),
			},
		});
	}, [storedConnectionId]);

	const installOwner = React.useCallback(
		(host: HerdrHostState, nextAgent: HerdrAgent) => {
			const connection = useSshStore.getState().connections[host.connectionId];
			if (!connection) {
				throw new Error('SSH connection unavailable.');
			}

			keyboardAdapterRef.current?.invalidatePending();
			const previousOwner = ownerRef.current;
			startAdmittedOwnerRef.current = null;
			reloadOwnerRef.current = null;
			ownerUnsubscribeRef.current?.();
			if (previousOwner) void previousOwner.retire('failure');
			let owner: HerdrTerminalOwner;
			owner = createHerdrTerminalOwner({
				terminalId: nextAgent.terminalId,
				connection,
				renderer: {
					replace(bytes) {
						if (
							ownerRef.current !== owner ||
							!initializedRef.current ||
							currentXtermInstanceIdRef.current === null ||
							rendererPhaseRef.current === 'blocked'
						) {
							return;
						}
						xtermRef.current?.clear();
						xtermRef.current?.write(bytes);
						rendererPhaseRef.current = 'active';
					},
					append(bytes) {
						if (
							ownerRef.current !== owner ||
							!initializedRef.current ||
							currentXtermInstanceIdRef.current === null ||
							rendererPhaseRef.current !== 'active'
						) {
							return;
						}
						xtermRef.current?.write(bytes);
					},
				},
				logger: {
					debug: (message, metadata) => logger.debug(message, metadata),
					warn: (message, metadata) => logger.warn(message, metadata),
				},
			});
			ownerRef.current = owner;
			startedOwnerRef.current = null;
			if (mountedRef.current && visibleRef.current && !suspendedRef.current) {
				startAdmittedOwnerRef.current = owner;
			}
			rendererPhaseRef.current = 'blocked';
			retryRecoveryRef.current = 'owner';
			ownerUnsubscribeRef.current = owner.subscribe((nextState) => {
				if (mountedRef.current && ownerRef.current === owner) {
					if (nextState.phase === 'error') {
						retryRecoveryRef.current =
							nextState.kind === 'transport' ? 'transport' : 'owner';
					}
					setState(nextState);
				}
			});
			currentHostRef.current = host;
			setAgent(nextAgent);
			setState(owner.getState());
			maybeStartOwner(owner);
		},
		[maybeStartOwner],
	);

	const reconcile = React.useCallback(
		async (forceRefresh: boolean) => {
			const generation = reconcileGenerationRef.current + 1;
			reconcileGenerationRef.current = generation;
			setState({ phase: 'reconnecting' });
			if (!storedConnectionId || !terminalId) {
				retryRecoveryRef.current = 'transport';
				setState({
					phase: 'error',
					generation: 0,
					kind: 'transport',
					reason: 'This Herdr terminal link is incomplete.',
				});
				return;
			}

			try {
				let host = useHerdrProviderStore.getState().host;
				const registered = host
					? useSshStore.getState().connections[host.connectionId]
					: null;
				const cachedTarget = host
					? findHerdrAgent(host.snapshot, terminalId)
					: null;
				if (
					forceRefresh ||
					!host ||
					host.storedConnectionId !== storedConnectionId ||
					!registered ||
					!cachedTarget
				) {
					host = await prepareHost();
				}
				if (
					!mountedRef.current ||
					!visibleRef.current ||
					suspendedRef.current ||
					generation !== reconcileGenerationRef.current
				) {
					return;
				}
				useHerdrProviderStore.getState().setHost(host);
				currentHostRef.current = host;
				const nextAgent = findHerdrAgent(host.snapshot, terminalId);
				if (!nextAgent) {
					goToList(host);
					return;
				}
				installOwner(host, nextAgent);
			} catch (error) {
				if (
					!mountedRef.current ||
					!visibleRef.current ||
					suspendedRef.current ||
					generation !== reconcileGenerationRef.current
				) {
					return;
				}
				retryRecoveryRef.current = 'transport';
				setState({
					phase: 'error',
					generation: 0,
					kind: 'transport',
					reason:
						error instanceof Error
							? error.message
							: 'Unable to open the Herdr terminal.',
				});
			}
		},
		[goToList, installOwner, prepareHost, storedConnectionId, terminalId],
	);

	const navigateAgent = React.useCallback(
		async (direction: 'next' | 'previous') => {
			const operation = beginRouteOperation();
			if (!terminalId) return;
			let host =
				currentHostRef.current ?? useHerdrProviderStore.getState().host;
			let target = host
				? nextHerdrTerminalId(host.snapshot.agents, terminalId, direction)
				: null;
			if (!target) {
				try {
					const refreshed = await prepareHost();
					if (!isRouteOperationCurrent(operation)) return;
					useHerdrProviderStore.getState().setHost(refreshed);
					currentHostRef.current = refreshed;
					host = refreshed;
					target = nextHerdrTerminalId(
						refreshed.snapshot.agents,
						terminalId,
						direction,
					);
				} catch {
					if (!isRouteOperationCurrent(operation)) return;
					setState({
						phase: 'error',
						generation: 0,
						kind: 'transport',
						reason: 'Unable to refresh Herdr agents.',
					});
					return;
				}
			}
			if (!isRouteOperationCurrent(operation)) return;
			if (!host || !target) {
				goToList(host);
				return;
			}
			const owner = ownerRef.current;
			if (owner) {
				startAdmittedOwnerRef.current = null;
				reloadOwnerRef.current = null;
				rendererPhaseRef.current = 'blocked';
				await owner.retire('switch');
				if (!isRouteOperationCurrent(operation) || ownerRef.current !== owner) {
					return;
				}
			}
			if (!isRouteOperationCurrent(operation)) return;
			router.replace({
				pathname: '/herdr/terminal',
				params: {
					storedConnectionId: host.storedConnectionId,
					connectionId: host.connectionId,
					terminalId: target,
				},
			});
		},
		[
			beginRouteOperation,
			goToList,
			isRouteOperationCurrent,
			prepareHost,
			router,
			terminalId,
		],
	);
	navigateAgentRef.current = navigateAgent;

	const [keyboardAdapter] = React.useState(() =>
		createHerdrKeyboardAdapter({
			shellConfigState,
			terminalInput: {
				captureSender: () => {
					const owner = ownerRef.current;
					if (!owner || rendererPhaseRef.current !== 'active') return null;
					return (bytes) =>
						ownerRef.current === owner &&
						rendererPhaseRef.current === 'active' &&
						mountedRef.current &&
						visibleRef.current &&
						!suspendedRef.current &&
						owner.sendInput(bytes);
				},
			},
			clipboard: {
				readText: () => Clipboard.getStringAsync(),
				writeText: async (text) => {
					await Clipboard.setStringAsync(text);
				},
			},
			terminalView: {
				getSelection: () =>
					xtermRef.current?.getSelection() ?? Promise.resolve(''),
				fit: () => xtermRef.current?.fit(),
				setSelectionModeEnabled: (enabled) =>
					xtermRef.current?.setSelectionModeEnabled(enabled),
			},
			agentNavigation: {
				previous: () => navigateAgentRef.current('previous'),
				next: () => navigateAgentRef.current('next'),
			},
			showFeedback: (message) => Alert.alert('Herdr', message),
		}),
	);
	keyboardAdapterRef.current = keyboardAdapter;
	React.useSyncExternalStore(
		keyboardAdapter.subscribe,
		keyboardAdapter.getSnapshot,
		keyboardAdapter.getSnapshot,
	);

	const backgroundOwner = React.useCallback(() => {
		keyboardAdapterRef.current?.invalidatePending();
		suspendedRef.current = true;
		reconcileGenerationRef.current += 1;
		invalidateRouteOperations();
		startAdmittedOwnerRef.current = null;
		rendererPhaseRef.current = 'blocked';
		const owner = ownerRef.current;
		if (!owner) return;
		owner.background();
	}, [invalidateRouteOperations]);

	useFocusEffect(
		React.useCallback(() => {
			visibleRef.current = true;
			const reacquiring = suspendedRef.current;
			suspendedRef.current = false;
			if (
				!reacquiring ||
				retryRecoveryRef.current !== 'renderer' ||
				failedRendererGenerationRef.current === null
			) {
				void reconcile(reacquiring);
			}
			return () => {
				visibleRef.current = false;
				backgroundOwner();
			};
		}, [backgroundOwner, reconcile]),
	);

	React.useEffect(() => {
		// eslint-disable-next-line @eslint-react/web-api/no-leaked-event-listener -- React Native AppState cleans up via subscription.remove()
		const subscription = AppState.addEventListener('change', (nextState) => {
			const active = nextState === 'active';
			if (!active) {
				backgroundOwner();
				return;
			}
			if (
				suspendedRef.current &&
				visibleRef.current &&
				(retryRecoveryRef.current !== 'renderer' ||
					failedRendererGenerationRef.current === null)
			) {
				suspendedRef.current = false;
				void reconcile(true);
			}
		});
		return () => subscription.remove();
	}, [backgroundOwner, reconcile]);

	React.useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			keyboardAdapterRef.current?.invalidatePending();
			reconcileGenerationRef.current += 1;
			invalidateRouteOperations();
			startAdmittedOwnerRef.current = null;
			reloadOwnerRef.current = null;
			ownerUnsubscribeRef.current?.();
			void ownerRef.current?.retire('unmount');
		};
	}, [invalidateRouteOperations]);

	const handleLoadStart = React.useCallback((generation: number) => {
		if (generation !== rendererGenerationRef.current) return;
		keyboardAdapterRef.current?.invalidatePending();
		const owner = ownerRef.current;
		const restarting = currentXtermInstanceIdRef.current !== null;
		const wasAdmitted = startAdmittedOwnerRef.current === owner;
		currentXtermInstanceIdRef.current = null;
		initializedRef.current = false;
		sizeRef.current = null;
		startedOwnerRef.current = null;
		rendererPhaseRef.current = 'blocked';
		if (restarting) {
			startAdmittedOwnerRef.current = null;
			reloadOwnerRef.current = owner;
			if (
				owner &&
				wasAdmitted &&
				mountedRef.current &&
				visibleRef.current &&
				!suspendedRef.current &&
				!recoveringTransportRef.current
			) {
				startAdmittedOwnerRef.current = owner;
			}
			if (owner) void owner.retire('retry');
		}
	}, []);
	const handleInitialized = React.useCallback(
		(generation: number, instanceId: string) => {
			if (generation !== rendererGenerationRef.current) return;
			currentXtermInstanceIdRef.current = instanceId;
			initializedRef.current = true;
			xtermRef.current?.fit();
			maybeStartOwner(ownerRef.current);
		},
		[maybeStartOwner],
	);
	const handleResize = React.useCallback(
		(generation: number, cols: number, rows: number) => {
			if (generation !== rendererGenerationRef.current) return;
			if (!Number.isSafeInteger(cols) || cols <= 0) return;
			if (!Number.isSafeInteger(rows) || rows <= 0) return;
			sizeRef.current = { cols, rows };
			const owner = ownerRef.current;
			if (
				owner &&
				startAdmittedOwnerRef.current === owner &&
				visibleRef.current &&
				!suspendedRef.current
			) {
				if (startedOwnerRef.current === owner) owner.resize(cols, rows);
				else maybeStartOwner(owner);
			}
		},
		[maybeStartOwner],
	);
	const handleRendererFailure = React.useCallback(
		(generation: number) => {
			if (
				generation !== rendererGenerationRef.current ||
				failedRendererGenerationRef.current === generation
			) {
				return;
			}
			failedRendererGenerationRef.current = generation;
			keyboardAdapterRef.current?.invalidatePending();
			reconcileGenerationRef.current += 1;
			invalidateRouteOperations();
			currentXtermInstanceIdRef.current = null;
			initializedRef.current = false;
			sizeRef.current = null;
			startAdmittedOwnerRef.current = null;
			startedOwnerRef.current = null;
			reloadOwnerRef.current = null;
			rendererPhaseRef.current = 'blocked';
			const owner = ownerRef.current;
			ownerRef.current = null;
			ownerUnsubscribeRef.current?.();
			ownerUnsubscribeRef.current = null;
			const priorRetirement = rendererRecoveryRef.current?.retirement;
			const currentRetirement = owner
				? owner.retire('failure').catch(() => undefined)
				: Promise.resolve();
			rendererRecoveryRef.current = {
				retirement: Promise.all([priorRetirement, currentRetirement]).then(
					() => undefined,
				),
			};
			retryRecoveryRef.current = 'renderer';
			setState({
				phase: 'error',
				generation: 0,
				kind: 'transport',
				reason: 'Terminal renderer stopped. Retry to reconnect.',
			});
		},
		[invalidateRouteOperations],
	);
	const recoverRenderer = React.useCallback(async () => {
		const recovery = rendererRecoveryRef.current;
		if (!recovery || recoveringRendererRef.current) return;
		recoveringRendererRef.current = true;
		keyboardAdapterRef.current?.invalidatePending();
		const nextGeneration = rendererGenerationRef.current + 1;
		rendererGenerationRef.current = nextGeneration;
		failedRendererGenerationRef.current = null;
		setRendererGeneration(nextGeneration);
		setState({ phase: 'reconnecting' });
		try {
			await recovery.retirement;
			if (
				rendererRecoveryRef.current !== recovery ||
				!mountedRef.current ||
				!visibleRef.current ||
				suspendedRef.current
			) {
				return;
			}
			rendererRecoveryRef.current = null;
			await reconcile(true);
		} finally {
			recoveringRendererRef.current = false;
		}
	}, [reconcile]);
	const recoverTransport = React.useCallback(async () => {
		if (recoveringTransportRef.current) return;
		keyboardAdapterRef.current?.invalidatePending();
		recoveringTransportRef.current = true;
		reconcileGenerationRef.current += 1;
		startAdmittedOwnerRef.current = null;
		reloadOwnerRef.current = null;
		rendererPhaseRef.current = 'blocked';
		setState({ phase: 'reconnecting' });
		const owner = ownerRef.current;
		ownerUnsubscribeRef.current?.();
		ownerUnsubscribeRef.current = null;
		startedOwnerRef.current = null;
		try {
			if (owner) await owner.retire('failure');
			if (
				!mountedRef.current ||
				!visibleRef.current ||
				suspendedRef.current ||
				ownerRef.current !== owner
			) {
				return;
			}
			await reconcile(true);
		} finally {
			recoveringTransportRef.current = false;
		}
	}, [reconcile]);
	const handleRetry = React.useCallback(() => {
		keyboardAdapterRef.current?.invalidatePending();
		if (retryRecoveryRef.current === 'renderer') {
			void recoverRenderer();
			return;
		}
		const owner = ownerRef.current;
		const size = sizeRef.current;
		const host = currentHostRef.current;
		const registered = host
			? useSshStore.getState().connections[host.connectionId]
			: null;
		if (
			owner &&
			startAdmittedOwnerRef.current === owner &&
			visibleRef.current &&
			!suspendedRef.current &&
			size &&
			registered &&
			retryRecoveryRef.current === 'owner'
		) {
			rendererPhaseRef.current = 'awaiting-baseline';
			owner.retry(size);
			return;
		}
		void recoverTransport();
	}, [recoverRenderer, recoverTransport]);
	const handleTakeOver = React.useCallback(() => {
		keyboardAdapterRef.current?.invalidatePending();
		const owner = ownerRef.current;
		const size = sizeRef.current;
		if (
			owner &&
			startAdmittedOwnerRef.current === owner &&
			visibleRef.current &&
			!suspendedRef.current &&
			size
		) {
			rendererPhaseRef.current = 'awaiting-baseline';
			owner.takeOver(size);
		}
	}, []);
	const handleBack = React.useCallback(async () => {
		keyboardAdapterRef.current?.invalidatePending();
		const operation = beginRouteOperation();
		const owner = ownerRef.current;
		startAdmittedOwnerRef.current = null;
		reloadOwnerRef.current = null;
		rendererPhaseRef.current = 'blocked';
		if (owner) {
			await owner.retire('back');
			if (!isRouteOperationCurrent(operation) || ownerRef.current !== owner) {
				return;
			}
		}
		if (!isRouteOperationCurrent(operation)) return;
		goToList(currentHostRef.current);
	}, [beginRouteOperation, goToList, isRouteOperationCurrent]);

	return (
		<HerdrTerminalView
			agent={agent}
			state={state}
			rendererGeneration={rendererGeneration}
			xtermRef={xtermRef}
			keyboardProps={keyboardAdapter.getTerminalKeyboardProps()}
			onLoadStart={() => handleLoadStart(rendererGeneration)}
			onRendererFailure={() => handleRendererFailure(rendererGeneration)}
			onInitialized={(instanceId) =>
				handleInitialized(rendererGeneration, instanceId)
			}
			onInput={({ str, instanceId }) => {
				if (rendererGeneration !== rendererGenerationRef.current) return;
				if (instanceId !== currentXtermInstanceIdRef.current) return;
				if (rendererPhaseRef.current !== 'active') return;
				keyboardAdapter.invalidatePending();
				ownerRef.current?.sendInput(textEncoder.encode(str));
			}}
			onResize={(cols, rows) => handleResize(rendererGeneration, cols, rows)}
			onScrollbackBatch={({ direction, lines, instanceId }) => {
				if (rendererGeneration !== rendererGenerationRef.current) return;
				if (instanceId !== currentXtermInstanceIdRef.current) return;
				if (rendererPhaseRef.current !== 'active') return;
				if (lines > 0) ownerRef.current?.scroll(direction, lines);
			}}
			onSelectionModeChange={(enabled) => {
				if (rendererGeneration !== rendererGenerationRef.current) return;
				keyboardAdapter.setSelectionModeEnabled(enabled);
			}}
			onTakeOver={handleTakeOver}
			onRetry={handleRetry}
			onBack={() => void handleBack()}
		/>
	);
}
