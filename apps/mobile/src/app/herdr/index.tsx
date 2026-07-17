import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { AppState } from 'react-native';

import { type HerdrHostState } from '@/lib/herdr/contracts';
import { prepareHerdrHost } from '@/lib/herdr/host-launcher';
import { useHerdrProviderStore } from '@/lib/herdr/provider-store';
import { loadHerdrSnapshot } from '@/lib/herdr/snapshot';
import { runRemoteTextCommand } from '@/lib/remote-command-runner';
import { secretsManager } from '@/lib/secrets-manager';
import { useSshStore } from '@/lib/ssh-store';
import { queryClient } from '@/lib/utils';
import {
	HerdrAgentListView,
	type HerdrAgentListViewState,
} from './HerdrAgentListView';

function routeParam(value: string | string[] | undefined): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

export default function HerdrAgentListRoute() {
	const router = useRouter();
	const params = useLocalSearchParams<{
		storedConnectionId?: string | string[];
		connectionId?: string | string[];
	}>();
	const storedConnectionId = routeParam(params.storedConnectionId);
	const connectionId = routeParam(params.connectionId);
	const initialHost = useHerdrProviderStore.getState().host;
	const [currentHost, setCurrentHost] = React.useState<HerdrHostState | null>(
		initialHost?.storedConnectionId === storedConnectionId ? initialHost : null,
	);
	const [state, setState] = React.useState<HerdrAgentListViewState>({
		phase: 'loading',
	});
	const [refreshing, setRefreshing] = React.useState(false);
	const visible = React.useRef(false);
	const refreshGeneration = React.useRef(0);
	const refreshAbortController = React.useRef<AbortController | null>(null);

	const refresh = React.useCallback(async () => {
		if (!storedConnectionId || !connectionId) {
			setState({
				phase: 'error',
				message: 'This Herdr link is incomplete.',
			});
			return;
		}

		const generation = refreshGeneration.current + 1;
		refreshGeneration.current = generation;
		refreshAbortController.current?.abort(new Error('Herdr refresh replaced.'));
		const abortController = new AbortController();
		refreshAbortController.current = abortController;
		setRefreshing(true);
		setState((previous) =>
			previous.phase === 'ready' || previous.phase === 'empty'
				? previous
				: { phase: 'loading' },
		);

		try {
			const host = await prepareHerdrHost({
				storedConnectionId,
				ports: {
					getSavedConnection: (savedId) =>
						queryClient.fetchQuery(
							secretsManager.connections.query.get(savedId),
						),
					getPrivateKey: async (keyId) =>
						(await secretsManager.keys.utils.getPrivateKey(keyId)).value,
					getConnections: () => useSshStore.getState().connections,
					connect: useSshStore.getState().connect,
					loadSnapshot: (connection) =>
						loadHerdrSnapshot({
							run: (command) => runRemoteTextCommand({ connection, command }),
						}),
				},
				abortSignal: abortController.signal,
			});
			if (
				abortController.signal.aborted ||
				generation !== refreshGeneration.current
			) {
				return;
			}
			useHerdrProviderStore.getState().setHost(host);
			setCurrentHost(host);
			setState(
				host.snapshot.agents.length === 0
					? { phase: 'empty' }
					: { phase: 'ready', agents: host.snapshot.agents },
			);
		} catch (error) {
			if (
				abortController.signal.aborted ||
				generation !== refreshGeneration.current
			) {
				return;
			}
			setState({
				phase: 'error',
				message:
					error instanceof Error
						? error.message
						: 'Unable to refresh Herdr agents.',
			});
		} finally {
			if (generation === refreshGeneration.current) {
				setRefreshing(false);
			}
		}
	}, [connectionId, storedConnectionId]);

	useFocusEffect(
		React.useCallback(() => {
			visible.current = true;
			void refresh();
			return () => {
				visible.current = false;
				refreshAbortController.current?.abort(
					new Error('Herdr list lost focus.'),
				);
			};
		}, [refresh]),
	);

	React.useEffect(() => {
		// eslint-disable-next-line @eslint-react/web-api/no-leaked-event-listener -- React Native AppState cleans up via subscription.remove()
		const subscription = AppState.addEventListener('change', (nextState) => {
			if (nextState === 'active' && visible.current) void refresh();
		});
		return () => subscription.remove();
	}, [refresh]);

	const openAgent = React.useCallback(
		(terminalId: string) => {
			if (!currentHost) return;
			router.push({
				pathname: '/herdr/terminal',
				params: {
					storedConnectionId: currentHost.storedConnectionId,
					connectionId: currentHost.connectionId,
					terminalId,
				},
			});
		},
		[currentHost, router],
	);

	return (
		<HerdrAgentListView
			state={state}
			refreshing={refreshing}
			onRefresh={() => void refresh()}
			onOpenAgent={openAgent}
		/>
	);
}
