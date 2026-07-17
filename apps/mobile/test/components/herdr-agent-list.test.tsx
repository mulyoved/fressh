import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react-native';
import { AppState, type AppStateStatus, Text } from 'react-native';

import HerdrAgentListRoute from '@/app/herdr';
import {
	HerdrAgentListView,
	type HerdrAgentListViewState,
} from '@/app/herdr/HerdrAgentListView';
import { type HerdrAgent, type HerdrHostState } from '@/lib/herdr/contracts';
import { prepareHerdrHost } from '@/lib/herdr/host-launcher';
import { useHerdrProviderStore } from '@/lib/herdr/provider-store';
import { useSshStore } from '@/lib/ssh-store';

const mockPush = jest.fn();
const mockPrepareHerdrHost = jest.mocked(prepareHerdrHost);
const mockUseSshStore = jest.mocked(useSshStore);
let focusEffect: (() => void | (() => void)) | null = null;

const AGENTS: readonly HerdrAgent[] = [
	{
		terminalId: 'terminal-blocked',
		paneId: 'pane-a',
		workspaceId: 'workspace-a',
		workspaceLabel: 'Fressh',
		tabId: 'tab-a',
		tabLabel: 'Agents',
		label: 'Codex',
		status: 'blocked',
		cwdBasename: 'fressh',
		order: 0,
	},
	{
		terminalId: 'terminal-ready',
		paneId: 'pane-b',
		workspaceId: 'workspace-b',
		workspaceLabel: 'Herdr',
		tabId: 'tab-b',
		tabLabel: 'Tests',
		label: 'Claude',
		status: 'done',
		cwdBasename: 'herdr',
		order: 1,
	},
	{
		terminalId: 'terminal-working',
		paneId: 'pane-c',
		workspaceId: 'workspace-a',
		workspaceLabel: 'Fressh',
		tabId: 'tab-c',
		tabLabel: 'Mobile',
		label: 'Gemini',
		status: 'working',
		cwdBasename: null,
		order: 2,
	},
];

const INITIAL_HOST: HerdrHostState = {
	storedConnectionId: 'saved-host',
	connectionId: 'connection-old',
	snapshot: { version: '0.7.2', protocol: 1, agents: AGENTS },
};

const REFRESHED_HOST: HerdrHostState = {
	...INITIAL_HOST,
	connectionId: 'connection-current',
};

jest.mock('@fressh/react-native-uniffi-russh', () => ({}));

/* eslint-disable @typescript-eslint/consistent-type-imports, @eslint-react/hooks-extra/no-unnecessary-use-prefix -- The factory keeps its React type local and implements Expo Router's hook API because Jest hoists mock factories. */
jest.mock('expo-router', () => {
	const React = jest.requireActual('react') as typeof import('react');
	return {
		useFocusEffect: (callback: () => void | (() => void)) => {
			focusEffect = callback;
			React.useEffect(callback, [callback]);
		},
		useLocalSearchParams: () => ({
			storedConnectionId: 'saved-host',
			connectionId: 'connection-old',
		}),
		useRouter: () => ({ push: mockPush }),
	};
});
/* eslint-enable @typescript-eslint/consistent-type-imports, @eslint-react/hooks-extra/no-unnecessary-use-prefix */

jest.mock('@/lib/herdr/host-launcher', () => ({
	prepareHerdrHost: jest.fn(),
}));

jest.mock('@/lib/remote-command-runner', () => ({
	runRemoteTextCommand: jest.fn(),
}));

jest.mock('@/lib/secrets-manager', () => ({
	secretsManager: {
		connections: {
			query: { get: (id: string) => ({ queryKey: ['connections', id] }) },
		},
		keys: {
			utils: {
				getPrivateKey: jest.fn(async () => ({ value: 'private-key' })),
			},
		},
	},
}));

jest.mock('@/lib/ssh-store', () => ({
	useSshStore: Object.assign(jest.fn(), { getState: jest.fn() }),
}));

jest.mock('@/lib/theme', () => {
	const actual = jest.requireActual('@/lib/theme') as {
		darkTheme: { colors: Record<string, string> };
	};
	return { ...actual, useTheme: jest.fn(() => actual.darkTheme) };
});

jest.mock('@/lib/utils', () => ({
	queryClient: { fetchQuery: jest.fn() },
}));

function renderState(state: HerdrAgentListViewState) {
	return render(
		<HerdrAgentListView
			state={state}
			refreshing={false}
			onRefresh={jest.fn()}
			onOpenAgent={jest.fn()}
		/>,
	);
}

beforeEach(() => {
	jest.clearAllMocks();
	focusEffect = null;
	useHerdrProviderStore.getState().clearHost();
	mockUseSshStore.getState.mockReturnValue({
		connections: {},
		connect: jest.fn(),
	} as never);
});

afterEach(() => {
	useHerdrProviderStore.getState().clearHost();
	jest.restoreAllMocks();
});

test('renders loading, empty, and retryable error states', () => {
	const loading = renderState({ phase: 'loading' });
	expect(screen.getByText('Loading Herdr agents…')).toBeOnTheScreen();
	loading.unmount();

	const emptyRefresh = jest.fn();
	const empty = render(
		<HerdrAgentListView
			state={{ phase: 'empty' }}
			refreshing={false}
			onRefresh={emptyRefresh}
			onOpenAgent={jest.fn()}
		/>,
	);
	expect(
		screen.getByText('No agents in the default Herdr session.'),
	).toBeOnTheScreen();
	fireEvent.press(screen.getByRole('button', { name: 'Refresh' }));
	expect(emptyRefresh).toHaveBeenCalledTimes(1);
	empty.unmount();

	const retry = jest.fn();
	render(
		<HerdrAgentListView
			state={{ phase: 'error', message: 'Snapshot failed.' }}
			refreshing={false}
			onRefresh={retry}
			onOpenAgent={jest.fn()}
		/>,
	);
	expect(screen.getByText('Snapshot failed.')).toBeOnTheScreen();
	fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
	expect(retry).toHaveBeenCalledTimes(1);
});

test('renders grouped agents in provider order and opens stable terminal identity', () => {
	const onOpenAgent = jest.fn();
	const view = render(
		<HerdrAgentListView
			state={{ phase: 'ready', agents: AGENTS }}
			refreshing={false}
			onRefresh={jest.fn()}
			onOpenAgent={onOpenAgent}
		/>,
	);

	const text = screen
		.UNSAFE_getAllByType(Text)
		.map((node) => node.props.children)
		.filter((value): value is string => typeof value === 'string');
	expect(text.indexOf('Needs attention')).toBeLessThan(text.indexOf('Ready'));
	expect(text.indexOf('Ready')).toBeLessThan(text.indexOf('Working'));
	expect(screen.getByText('Codex')).toBeOnTheScreen();
	expect(screen.getByText('Blocked')).toBeOnTheScreen();
	expect(screen.getByText('Fressh / Agents')).toBeOnTheScreen();
	expect(screen.getByText('fressh')).toBeOnTheScreen();

	fireEvent.press(screen.getByTestId('herdr-agent-terminal-blocked'));
	expect(onOpenAgent).toHaveBeenLastCalledWith('terminal-blocked');

	view.rerender(
		<HerdrAgentListView
			state={{
				phase: 'ready',
				agents: [
					{
						...AGENTS[0]!,
						paneId: 'pane-moved',
						workspaceId: 'workspace-new',
						workspaceLabel: 'Moved',
						tabId: 'tab-new',
						tabLabel: 'Current',
					},
				],
			}}
			refreshing={false}
			onRefresh={jest.fn()}
			onOpenAgent={onOpenAgent}
		/>,
	);
	expect(screen.getByText('Moved / Current')).toBeOnTheScreen();
	expect(screen.queryByText('Fressh / Agents')).not.toBeOnTheScreen();
	fireEvent.press(screen.getByTestId('herdr-agent-terminal-blocked'));
	expect(onOpenAgent).toHaveBeenLastCalledWith('terminal-blocked');
});

test('refreshes on first focus, explicit refresh, focus return, and foreground while visible', async () => {
	let appStateListener: ((state: AppStateStatus) => void) | null = null;
	jest
		.spyOn(AppState, 'addEventListener')
		.mockImplementation((_type, listener) => {
			appStateListener = listener;
			return { remove: jest.fn() };
		});
	mockPrepareHerdrHost.mockResolvedValue(REFRESHED_HOST);
	useHerdrProviderStore.getState().setHost(INITIAL_HOST);
	render(<HerdrAgentListRoute />);

	expect(screen.getByText('Loading Herdr agents…')).toBeOnTheScreen();
	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(1));
	await waitFor(() => expect(screen.getByText('Codex')).toBeOnTheScreen());
	expect(useHerdrProviderStore.getState().host).toEqual(REFRESHED_HOST);

	fireEvent.press(screen.getByRole('button', { name: 'Refresh' }));
	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(2));

	await act(async () => {
		focusEffect?.();
	});
	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(3));

	await act(async () => {
		appStateListener?.('active');
	});
	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(4));
});

test('keeps failed refreshes retryable and routes agent presses with current stable ids only', async () => {
	const refreshedAfterRetry: HerdrHostState = {
		...REFRESHED_HOST,
		snapshot: {
			...REFRESHED_HOST.snapshot,
			agents: [AGENTS[0]!],
		},
	};
	mockPrepareHerdrHost
		.mockRejectedValueOnce(new Error('Herdr snapshot failed.'))
		.mockResolvedValueOnce(refreshedAfterRetry);
	useHerdrProviderStore.getState().setHost(INITIAL_HOST);
	render(<HerdrAgentListRoute />);

	await waitFor(() => {
		expect(screen.getByText('Herdr snapshot failed.')).toBeOnTheScreen();
	});
	expect(useHerdrProviderStore.getState().host).toEqual(INITIAL_HOST);
	fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
	await waitFor(() => expect(screen.getByText('Codex')).toBeOnTheScreen());

	fireEvent.press(screen.getByTestId('herdr-agent-terminal-blocked'));
	expect(mockPush).toHaveBeenCalledWith({
		pathname: '/herdr/terminal',
		params: {
			storedConnectionId: 'saved-host',
			connectionId: 'connection-current',
			terminalId: 'terminal-blocked',
		},
	});
	expect(JSON.stringify(mockPush.mock.calls)).not.toMatch(
		/(snapshot|paneId|privateKey|credential)/i,
	);
});
