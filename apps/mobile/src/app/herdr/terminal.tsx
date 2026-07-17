import { type XtermWebViewHandle } from '@fressh/react-native-xtermjs-webview';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Alert, AppState } from 'react-native';

import { type HerdrAgent, type HerdrHostState } from '@/lib/herdr/contracts';
import { prepareHerdrHost } from '@/lib/herdr/host-launcher';
import { createHerdrKeyboardAdapter } from '@/lib/herdr/keyboard-adapter';
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
	const ownerUnsubscribeRef = React.useRef<(() => void) | null>(null);
	const currentHostRef = React.useRef<HerdrHostState | null>(null);
	const initializedRef = React.useRef(false);
	const sizeRef = React.useRef<TerminalSize | null>(null);
	const startedOwnerRef = React.useRef<HerdrTerminalOwner | null>(null);
	const visibleRef = React.useRef(false);
	const suspendedRef = React.useRef(false);
	const mountedRef = React.useRef(true);
	const reconcileGenerationRef = React.useRef(0);
	const navigateAgentRef = React.useRef<
		(direction: 'next' | 'previous') => Promise<void>
	>(async () => {});
	const [shellConfigState] = React.useState(() =>
		loadRuntimeShellConfigState(),
	);
	const [agent, setAgent] = React.useState<HerdrAgent | null>(() => {
		const host = useHerdrProviderStore.getState().host;
		return host && terminalId
			? findHerdrAgent(host.snapshot, terminalId)
			: null;
	});
	const [state, setState] = React.useState<HerdrTerminalViewState>({
		phase: 'reconnecting',
	});

	const maybeStartOwner = React.useCallback(
		(owner: HerdrTerminalOwner | null) => {
			const size = sizeRef.current;
			if (
				!owner ||
				!initializedRef.current ||
				!size ||
				startedOwnerRef.current === owner
			) {
				return;
			}
			startedOwnerRef.current = owner;
			owner.start(size);
		},
		[],
	);

	const goToList = React.useCallback(
		(host: HerdrHostState | null) => {
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
		[routeConnectionId, router, storedConnectionId],
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

			ownerUnsubscribeRef.current?.();
			const owner = createHerdrTerminalOwner({
				terminalId: nextAgent.terminalId,
				connection,
				renderer: {
					replace(bytes) {
						xtermRef.current?.clear();
						xtermRef.current?.write(bytes);
					},
					append(bytes) {
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
			ownerUnsubscribeRef.current = owner.subscribe((nextState) => {
				if (mountedRef.current && ownerRef.current === owner) {
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
					generation !== reconcileGenerationRef.current
				) {
					return;
				}
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
			if (!terminalId) return;
			let host =
				currentHostRef.current ?? useHerdrProviderStore.getState().host;
			let target = host
				? nextHerdrTerminalId(host.snapshot.agents, terminalId, direction)
				: null;
			if (!target) {
				try {
					const refreshed = await prepareHost();
					useHerdrProviderStore.getState().setHost(refreshed);
					currentHostRef.current = refreshed;
					host = refreshed;
					target = nextHerdrTerminalId(
						refreshed.snapshot.agents,
						terminalId,
						direction,
					);
				} catch {
					setState({
						phase: 'error',
						generation: 0,
						kind: 'transport',
						reason: 'Unable to refresh Herdr agents.',
					});
					return;
				}
			}
			if (!host || !target) {
				goToList(host);
				return;
			}
			const owner = ownerRef.current;
			if (owner) await owner.retire('switch');
			router.replace({
				pathname: '/herdr/terminal',
				params: {
					storedConnectionId: host.storedConnectionId,
					connectionId: host.connectionId,
					terminalId: target,
				},
			});
		},
		[goToList, prepareHost, router, terminalId],
	);
	navigateAgentRef.current = navigateAgent;

	const [keyboardAdapter] = React.useState(() =>
		createHerdrKeyboardAdapter({
			shellConfigState,
			terminalInput: {
				sendInput: (bytes) => ownerRef.current?.sendInput(bytes) ?? false,
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
	React.useSyncExternalStore(
		keyboardAdapter.subscribe,
		keyboardAdapter.getSnapshot,
		keyboardAdapter.getSnapshot,
	);

	const backgroundOwner = React.useCallback(() => {
		suspendedRef.current = true;
		const owner = ownerRef.current;
		if (!owner) return;
		owner.background();
	}, []);

	useFocusEffect(
		React.useCallback(() => {
			visibleRef.current = true;
			const reacquiring = suspendedRef.current;
			suspendedRef.current = false;
			void reconcile(reacquiring);
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
			if (suspendedRef.current && visibleRef.current) {
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
			reconcileGenerationRef.current += 1;
			ownerUnsubscribeRef.current?.();
			void ownerRef.current?.retire('unmount');
		};
	}, []);

	const handleInitialized = React.useCallback(
		(_instanceId: string) => {
			initializedRef.current = true;
			xtermRef.current?.fit();
			maybeStartOwner(ownerRef.current);
		},
		[maybeStartOwner],
	);
	const handleResize = React.useCallback(
		(cols: number, rows: number) => {
			if (!Number.isSafeInteger(cols) || cols <= 0) return;
			if (!Number.isSafeInteger(rows) || rows <= 0) return;
			sizeRef.current = { cols, rows };
			const owner = ownerRef.current;
			if (startedOwnerRef.current === owner && owner) owner.resize(cols, rows);
			else maybeStartOwner(owner);
		},
		[maybeStartOwner],
	);
	const handleRetry = React.useCallback(() => {
		const owner = ownerRef.current;
		const size = sizeRef.current;
		if (owner && size) owner.retry(size);
		else void reconcile(true);
	}, [reconcile]);
	const handleTakeOver = React.useCallback(() => {
		const owner = ownerRef.current;
		const size = sizeRef.current;
		if (owner && size) owner.takeOver(size);
	}, []);
	const handleBack = React.useCallback(async () => {
		const owner = ownerRef.current;
		if (owner) await owner.retire('back');
		goToList(currentHostRef.current);
	}, [goToList]);

	return (
		<HerdrTerminalView
			agent={agent}
			state={state}
			xtermRef={xtermRef}
			keyboardProps={keyboardAdapter.getTerminalKeyboardProps()}
			onInitialized={handleInitialized}
			onInput={({ str }) => {
				ownerRef.current?.sendInput(textEncoder.encode(str));
			}}
			onResize={handleResize}
			onScrollbackBatch={({ direction, lines }) => {
				if (lines > 0) ownerRef.current?.scroll(direction, lines);
			}}
			onSelectionModeChange={keyboardAdapter.setSelectionModeEnabled}
			onTakeOver={handleTakeOver}
			onRetry={handleRetry}
			onBack={() => void handleBack()}
		/>
	);
}
