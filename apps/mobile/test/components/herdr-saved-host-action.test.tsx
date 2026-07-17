import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react-native';
import { Text } from 'react-native';

import { ConnectionRow } from '@/app/(tabs)/index';
import { type StoredConnectionEntry } from '@/lib/connection-storage';
import { type HerdrHostState } from '@/lib/herdr/contracts';
import { prepareHerdrHost } from '@/lib/herdr/host-launcher';
import { useHerdrProviderStore } from '@/lib/herdr/provider-store';
import { secretsManager } from '@/lib/secrets-manager';
import { useSshStore } from '@/lib/ssh-store';

const mockPush = jest.fn();
const mockRefetch = jest.fn(async () => undefined);
const mockPrepareHerdrHost = jest.mocked(prepareHerdrHost);
const mockUseSshStore = jest.mocked(useSshStore);

const SAVED_ENTRY: StoredConnectionEntry = {
	id: 'saved-host',
	metadata: {
		priority: 0,
		createdAtMs: 1,
		modifiedAtMs: 1,
	},
	value: {
		host: 'host.example.com',
		port: 22,
		username: 'muly',
		security: { type: 'key', keyId: 'key-1' },
		useTmux: true,
		tmuxSessionName: 'main',
		autoConnect: false,
	},
};

const HOST: HerdrHostState = {
	storedConnectionId: 'saved-host',
	connectionId: 'connection-1',
	snapshot: { version: '0.7.2', protocol: 1, agents: [] },
};

jest.mock('@fressh/react-native-uniffi-russh', () => ({}));

jest.mock('@tanstack/react-query', () => ({
	useQuery: jest.fn((options: { queryKey: readonly string[] }) => {
		if (options.queryKey.length === 2) {
			return { data: SAVED_ENTRY };
		}
		return { data: [SAVED_ENTRY], refetch: mockRefetch };
	}),
}));

/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- Hoisted mocks implement the named hook APIs consumed by the component. */
jest.mock('expo-router', () => ({
	useLocalSearchParams: () => ({}),
	useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/components/form-components', () => ({
	useAppForm: jest.fn(),
	useFieldContext: jest.fn(),
}));

jest.mock('@/components/key-manager/KeyPickerSheet', () => ({
	KeyPickerSheet: () => null,
}));

jest.mock('@/lib/herdr/host-launcher', () => ({
	prepareHerdrHost: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
	rootLogger: {
		extend: () => ({ info: jest.fn(), warn: jest.fn() }),
	},
}));

jest.mock('@/lib/query-fns', () => ({ useSshConnMutation: jest.fn() }));

jest.mock('@/lib/remote-command-runner', () => ({
	runRemoteTextCommand: jest.fn(),
}));

jest.mock('@/lib/secrets-manager', () => ({
	connectionDetailsSchema: {},
	secretsManager: {
		connections: {
			query: {
				get: (id: string) => ({ queryKey: ['connections', id] }),
				list: { queryKey: ['connections'] },
			},
			utils: {
				deleteConnection: jest.fn(async () => undefined),
				upsertConnection: jest.fn(async () => undefined),
			},
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

jest.mock('@/lib/tailscale-recovery-ui-store', () => ({
	useTailscaleRecoveryUiStore: jest.fn(),
}));

jest.mock('@/lib/TailscaleRecoveryPanel', () => ({
	TailscaleRecoveryPanel: () => null,
}));

jest.mock('@/lib/theme', () => {
	const actual = jest.requireActual('@/lib/theme') as {
		darkTheme: { colors: Record<string, string> };
	};
	return { ...actual, useTheme: jest.fn(() => actual.darkTheme) };
});

jest.mock('@/lib/useBottomTabSpacing', () => ({
	useBottomTabSpacing: () => 0,
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */

jest.mock('@/lib/utils', () => ({
	queryClient: { fetchQuery: jest.fn() },
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function renderRow(onFillForm = jest.fn()) {
	return {
		onFillForm,
		...render(<ConnectionRow id="saved-host" onFillForm={onFillForm} />),
	};
}

function openActions() {
	fireEvent.press(screen.getByText('⋯'));
}

beforeEach(() => {
	jest.clearAllMocks();
	useHerdrProviderStore.getState().clearHost();
	mockUseSshStore.getState.mockReturnValue({
		connections: {},
		connect: jest.fn(),
	} as never);
});

afterEach(() => {
	useHerdrProviderStore.getState().clearHost();
});

test('opens Herdr before the existing actions and publishes only after launch succeeds', async () => {
	const launch = deferred<HerdrHostState>();
	mockPrepareHerdrHost.mockReturnValueOnce(launch.promise);
	renderRow();

	openActions();
	const visibleText = screen
		.UNSAFE_getAllByType(Text)
		.map((node) => node.props.children)
		.filter((value): value is string => typeof value === 'string');
	expect(visibleText.indexOf('Open Herdr')).toBeLessThan(
		visibleText.indexOf('Rename'),
	);
	expect(visibleText.indexOf('Open Herdr')).toBeLessThan(
		visibleText.indexOf('Delete'),
	);

	fireEvent.press(screen.getByText('Open Herdr'));
	expect(screen.queryByText('Connection Actions')).not.toBeOnTheScreen();
	expect(screen.getByText('Opening Herdr…')).toBeOnTheScreen();
	expect(useHerdrProviderStore.getState().host).toBeNull();
	expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(1);
	const launchInput = mockPrepareHerdrHost.mock.calls[0]?.[0];
	expect(launchInput?.storedConnectionId).toBe('saved-host');
	expect(launchInput?.abortSignal).toBeInstanceOf(AbortSignal);
	expect(Object.keys(launchInput?.ports ?? {}).sort()).toEqual([
		'connect',
		'getConnections',
		'getPrivateKey',
		'getSavedConnection',
		'loadSnapshot',
	]);

	await act(async () => launch.resolve(HOST));
	expect(useHerdrProviderStore.getState().host).toEqual(HOST);
	expect(mockPush).toHaveBeenCalledWith({
		pathname: '/herdr',
		params: {
			storedConnectionId: 'saved-host',
			connectionId: 'connection-1',
		},
	});
});

test('keeps launch failures on the host screen and offers an explicit retry', async () => {
	const previousHost: HerdrHostState = {
		...HOST,
		storedConnectionId: 'previous-host',
		connectionId: 'previous-connection',
	};
	useHerdrProviderStore.getState().setHost(previousHost);
	mockPrepareHerdrHost
		.mockRejectedValueOnce(new Error('Herdr is unavailable.'))
		.mockResolvedValueOnce(HOST);
	renderRow();

	openActions();
	fireEvent.press(screen.getByText('Open Herdr'));
	await waitFor(() => {
		expect(screen.getByText('Herdr is unavailable.')).toBeOnTheScreen();
	});
	expect(screen.getByText('Retry Open Herdr')).toBeOnTheScreen();
	expect(useHerdrProviderStore.getState().host).toEqual(previousHost);
	expect(mockPush).not.toHaveBeenCalled();

	fireEvent.press(screen.getByText('Retry Open Herdr'));
	await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
	expect(useHerdrProviderStore.getState().host).toEqual(HOST);
});

test('preserves row fill, Rename, Delete, and Cancel behavior', async () => {
	const onFillForm = jest.fn();
	renderRow(onFillForm);

	fireEvent.press(screen.getByText('muly@host.example.com'));
	expect(onFillForm).toHaveBeenCalledWith(SAVED_ENTRY.value);

	openActions();
	fireEvent.press(screen.getByText('Rename'));
	expect(screen.getByText('Rename Connection')).toBeOnTheScreen();
	fireEvent.press(screen.getByText('Cancel'));
	expect(screen.queryByText('Rename Connection')).not.toBeOnTheScreen();

	openActions();
	fireEvent.press(screen.getByText('Cancel'));
	expect(screen.queryByText('Connection Actions')).not.toBeOnTheScreen();

	openActions();
	fireEvent.press(screen.getByText('Delete'));
	await waitFor(() => {
		expect(
			secretsManager.connections.utils.deleteConnection,
		).toHaveBeenCalledWith('saved-host');
		expect(mockRefetch).toHaveBeenCalledTimes(1);
	});
});
