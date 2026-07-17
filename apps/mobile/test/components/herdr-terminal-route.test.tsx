/* eslint-disable @typescript-eslint/consistent-type-imports, @eslint-react/hooks-extra/no-unnecessary-use-prefix, @eslint-react/no-forward-ref, react-compiler/react-compiler -- Hoisted Jest factories keep native dependencies local and capture component boundary props for route integration assertions. */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import HerdrTerminalRoute from '@/app/herdr/terminal';
import { type HerdrAgent, type HerdrHostState } from '@/lib/herdr/contracts';
import { prepareHerdrHost } from '@/lib/herdr/host-launcher';
import { useHerdrProviderStore } from '@/lib/herdr/provider-store';
import {
	createHerdrTerminalOwner,
	type HerdrRendererPort,
	type HerdrTerminalOwner,
	type HerdrTerminalState,
} from '@/lib/herdr/terminal-owner';
import { useSshStore } from '@/lib/ssh-store';

type XtermProps = {
	onInitialized(instanceId: string): void;
	onInput(input: { str: string; kind: 'typing'; instanceId: string }): void;
	onResize(cols: number, rows: number): void;
	onScrollbackBatch(event: {
		direction: 'up' | 'down';
		pages: number;
		lines: number;
		pageStep: number;
		instanceId: string;
	}): void;
	xtermOptions: { scrollback: number };
	touchScrollConfig: Record<string, unknown>;
};

type KeyboardProps = {
	onSlotPress(item: { type: 'action'; actionId: string }): Promise<void>;
};

type OwnerHarness = HerdrTerminalOwner & {
	publish(state: HerdrTerminalState): void;
	start: jest.Mock;
	retry: jest.Mock;
	takeOver: jest.Mock;
	sendInput: jest.Mock;
	resize: jest.Mock;
	scroll: jest.Mock;
	retire: jest.Mock;
	background: jest.Mock;
};

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockRouter = { replace: mockReplace, back: mockBack };
const mockPrepareHerdrHost = jest.mocked(prepareHerdrHost);
const mockCreateOwner = jest.mocked(createHerdrTerminalOwner);
const mockUseSshStore = jest.mocked(useSshStore);
const mockXtermHandle = {
	clear: jest.fn(),
	write: jest.fn(),
	fit: jest.fn(),
	focus: jest.fn(),
	getSelection: jest.fn(async () => 'selected locally'),
	setSelectionModeEnabled: jest.fn(),
};
let mockXtermProps: XtermProps | null = null;
let mockKeyboardProps: KeyboardProps | null = null;
let mockAppStateListener: ((state: AppStateStatus) => void) | null = null;
let mockFocusCleanup: (() => void) | null = null;
let mockParams = {
	storedConnectionId: 'saved-host',
	connectionId: 'connection-a',
	terminalId: 'terminal-a',
};

const AGENTS: readonly HerdrAgent[] = [
	{
		terminalId: 'terminal-a',
		paneId: 'pane-a',
		workspaceId: 'workspace-a',
		workspaceLabel: 'Fressh',
		tabId: 'tab-a',
		tabLabel: 'Agents',
		label: 'Codex',
		status: 'working',
		cwdBasename: 'fressh',
		order: 0,
	},
	{
		terminalId: 'terminal-b',
		paneId: 'pane-b',
		workspaceId: 'workspace-a',
		workspaceLabel: 'Fressh',
		tabId: 'tab-a',
		tabLabel: 'Agents',
		label: 'Claude',
		status: 'idle',
		cwdBasename: 'fressh',
		order: 1,
	},
];

const HOST: HerdrHostState = {
	storedConnectionId: 'saved-host',
	connectionId: 'connection-a',
	snapshot: { version: '0.7.2', protocol: 1, agents: AGENTS },
};

const connections = {
	'connection-a': { connectionId: 'connection-a' },
	'connection-b': { connectionId: 'connection-b' },
};

jest.mock('@fressh/react-native-uniffi-russh', () => ({}));

jest.mock('expo-clipboard', () => ({
	getStringAsync: jest.fn(async () => ''),
	setStringAsync: jest.fn(async () => {}),
}));

jest.mock('@fressh/react-native-xtermjs-webview', () => {
	const React = jest.requireActual('react') as typeof import('react');
	const { View } = jest.requireActual(
		'react-native',
	) as typeof import('react-native');
	return {
		XtermJsWebView: React.forwardRef((props: XtermProps, ref) => {
			mockXtermProps = props;
			React.useImperativeHandle(ref, () => mockXtermHandle);
			return <View testID="herdr-xterm" />;
		}),
	};
});

jest.mock('expo-router', () => {
	const React = jest.requireActual('react') as typeof import('react');
	return {
		Stack: { Screen: () => null },
		useFocusEffect: (callback: () => void | (() => void)) => {
			React.useEffect(() => {
				const cleanup = callback();
				mockFocusCleanup = typeof cleanup === 'function' ? cleanup : null;
				return cleanup;
			}, [callback]);
		},
		useLocalSearchParams: () => mockParams,
		useRouter: () => mockRouter,
	};
});

jest.mock('react-native-safe-area-context', () => ({
	useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/app/shell/components/TerminalKeyboard', () => {
	const { View } = jest.requireActual(
		'react-native',
	) as typeof import('react-native');
	return {
		TerminalKeyboard: (props: KeyboardProps) => {
			mockKeyboardProps = props;
			return <View testID="herdr-keyboard" />;
		},
	};
});

jest.mock('@/lib/herdr/host-launcher', () => ({
	prepareHerdrHost: jest.fn(),
}));

jest.mock('@/lib/herdr/terminal-owner', () => {
	const actual = jest.requireActual('@/lib/herdr/terminal-owner') as object;
	return { ...actual, createHerdrTerminalOwner: jest.fn() };
});

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

jest.mock('@/lib/shell-config-store-native', () => {
	const mockShellConfig = jest.requireActual('@/lib/shell-config') as Record<
		string,
		unknown
	>;
	return {
		loadRuntimeShellConfigState: () => ({
			config: (mockShellConfig['getBundledShellConfig'] as () => unknown)(),
			source: 'bundled',
			lastLoadedAt: null,
			lastError: null,
		}),
	};
});

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

function createOwnerHarness(): OwnerHarness {
	let state: HerdrTerminalState = { phase: 'starting', generation: 0 };
	const listeners = new Set<(next: HerdrTerminalState) => void>();
	const harness: OwnerHarness = {
		getState: () => state,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		publish: (next) => {
			state = next;
			for (const listener of listeners) listener(next);
		},
		start: jest.fn(),
		retry: jest.fn(),
		takeOver: jest.fn(),
		sendInput: jest.fn(() => true),
		resize: jest.fn(() => true),
		scroll: jest.fn(() => true),
		retire: jest.fn(async () => {}),
		background: jest.fn(),
	};
	harness.background.mockImplementation(() => {
		harness.publish({ phase: 'backgrounded', generation: 1 });
	});
	return harness;
}

beforeEach(() => {
	jest.clearAllMocks();
	mockXtermProps = null;
	mockKeyboardProps = null;
	mockAppStateListener = null;
	mockFocusCleanup = null;
	mockParams = {
		storedConnectionId: 'saved-host',
		connectionId: 'connection-a',
		terminalId: 'terminal-a',
	};
	useHerdrProviderStore.getState().setHost(HOST);
	mockUseSshStore.getState.mockReturnValue({
		connections,
		connect: jest.fn(),
	} as never);
	mockPrepareHerdrHost.mockResolvedValue(HOST);
	mockCreateOwner.mockImplementation(() => createOwnerHarness());
	jest
		.spyOn(AppState, 'addEventListener')
		.mockImplementation((_type, listener) => {
			mockAppStateListener = listener;
			return { remove: jest.fn() };
		});
});

afterEach(() => {
	useHerdrProviderStore.getState().clearHost();
	jest.restoreAllMocks();
});

async function renderReady() {
	const result = render(<HerdrTerminalRoute />);
	await waitFor(() => expect(mockCreateOwner).toHaveBeenCalledTimes(1));
	await waitFor(() => expect(screen.getByText('Codex')).toBeOnTheScreen());
	return {
		...result,
		owner: mockCreateOwner.mock.results[0]!.value as OwnerHarness,
		renderer: mockCreateOwner.mock.calls[0]![0].renderer as HerdrRendererPort,
	};
}

test('fits initialized xterm before normal start and adapts renderer, input, resize, scroll, and local copy', async () => {
	const { owner, renderer } = await renderReady();
	expect(mockXtermProps?.xtermOptions.scrollback).toBe(0);
	expect(mockXtermProps?.touchScrollConfig).toEqual({
		enabled: true,
		pxPerLine: 10,
		slopPx: 10,
		maxLinesPerFrame: 12,
		flickVelocity: 1.2,
		coalesceMs: 24,
		minFlushMs: 16,
		maxFlushMs: 80,
		maxPagesPerFlush: 12,
		maxExtraLines: 999,
		maxBacklogPages: 50,
		velocityMultiplierEnabled: true,
		velocityThreshold: 0.3,
		velocityBoost: 2.5,
		velocityBoostMax: 20,
		velocitySmoothing: 0.2,
		backlogMultiplierEnabled: true,
		backlogBoostRefPages: 2,
		backlogBoostMax: 2,
		rttEwmaAlpha: 0.2,
		debug: false,
		debugOverlay: false,
		debugTelemetry: false,
		debugTelemetryIntervalMs: 120,
	});

	act(() => mockXtermProps?.onInitialized('xterm-1'));
	expect(mockXtermHandle.fit).toHaveBeenCalledTimes(1);
	expect(owner.start).not.toHaveBeenCalled();
	act(() => mockXtermProps?.onResize(120, 40));
	expect(owner.start).toHaveBeenCalledWith({ cols: 120, rows: 40 });

	renderer.replace(new Uint8Array([1, 2]));
	renderer.append(new Uint8Array([3]));
	expect(mockXtermHandle.clear).toHaveBeenCalledTimes(1);
	expect(mockXtermHandle.write.mock.calls).toEqual([
		[new Uint8Array([1, 2])],
		[new Uint8Array([3])],
	]);

	act(() =>
		mockXtermProps?.onInput({
			str: 'é',
			kind: 'typing',
			instanceId: 'xterm-1',
		}),
	);
	expect(owner.sendInput).toHaveBeenCalledWith(new Uint8Array([0xc3, 0xa9]));
	act(() => mockXtermProps?.onResize(100, 30));
	expect(owner.resize).toHaveBeenCalledWith(100, 30);
	act(() =>
		mockXtermProps?.onScrollbackBatch({
			direction: 'up',
			pages: 0,
			lines: 4,
			pageStep: 1,
			instanceId: 'xterm-1',
		}),
	);
	expect(owner.scroll).toHaveBeenCalledWith('up', 4);

	await act(async () => {
		await mockKeyboardProps?.onSlotPress({
			type: 'action',
			actionId: 'COPY_SELECTION',
		});
	});
	expect(mockXtermHandle.getSelection).toHaveBeenCalledTimes(1);
	expect(Clipboard.setStringAsync).toHaveBeenCalledWith('selected locally');
	expect(owner.sendInput).toHaveBeenCalledTimes(1);
});

test('waits for bounded switch retirement before replacing with next and previous wrapped stable ids', async () => {
	let finishRetire!: () => void;
	const retirement = new Promise<void>((resolve) => {
		finishRetire = resolve;
	});
	const { owner } = await renderReady();
	owner.retire.mockReturnValueOnce(retirement);

	let navigation: Promise<void> | undefined;
	act(() => {
		navigation = mockKeyboardProps?.onSlotPress({
			type: 'action',
			actionId: 'WORKMUX_NAV_NEXT',
		});
	});
	expect(owner.retire).toHaveBeenCalledWith('switch');
	expect(mockReplace).not.toHaveBeenCalled();
	finishRetire();
	await act(async () => navigation);
	expect(mockReplace).toHaveBeenLastCalledWith({
		pathname: '/herdr/terminal',
		params: {
			storedConnectionId: 'saved-host',
			connectionId: 'connection-a',
			terminalId: 'terminal-b',
		},
	});

	mockReplace.mockClear();
	await act(async () => {
		await mockKeyboardProps?.onSlotPress({
			type: 'action',
			actionId: 'WORKMUX_NAV_PREV',
		});
	});
	expect(mockReplace).toHaveBeenLastCalledWith(
		expect.objectContaining({
			params: expect.objectContaining({ terminalId: 'terminal-b' }),
		}),
	);
	expect(JSON.stringify(mockReplace.mock.calls)).not.toMatch(
		/(snapshot|paneId|credential|privateKey)/i,
	);
});

test('backgrounds synchronously and foreground refresh creates a fresh normal owner for the stable target', async () => {
	const { owner } = await renderReady();
	act(() => mockXtermProps?.onInitialized('xterm-1'));
	act(() => mockXtermProps?.onResize(120, 40));
	const refreshed: HerdrHostState = {
		...HOST,
		connectionId: 'connection-b',
		snapshot: {
			...HOST.snapshot,
			agents: [
				{
					...AGENTS[0]!,
					paneId: 'pane-moved',
					workspaceLabel: 'Moved',
				},
			],
		},
	};
	mockPrepareHerdrHost.mockResolvedValue(refreshed);

	act(() => mockAppStateListener?.('background'));
	expect(owner.background).toHaveBeenCalledTimes(1);
	expect(screen.getByText('Terminal paused in background.')).toBeOnTheScreen();
	await act(async () => mockAppStateListener?.('active'));
	await waitFor(() => expect(mockCreateOwner).toHaveBeenCalledTimes(2));
	expect(mockCreateOwner.mock.calls[1]![0].terminalId).toBe('terminal-a');
	const freshOwner = mockCreateOwner.mock.results[1]!.value as OwnerHarness;
	await waitFor(() =>
		expect(freshOwner.start).toHaveBeenCalledWith({ cols: 120, rows: 40 }),
	);
	expect(freshOwner.takeOver).not.toHaveBeenCalled();
	expect(screen.getByText('Moved / Agents')).toBeOnTheScreen();

	act(() =>
		freshOwner.publish({
			phase: 'owned-elsewhere',
			generation: 1,
			reason: 'Owned by another client.',
		}),
	);
	expect(screen.getByRole('button', { name: 'Take Over' })).toBeOnTheScreen();
});

test('focus loss uses synchronous background retirement', async () => {
	const { owner } = await renderReady();
	act(() => mockFocusCleanup?.());
	expect(owner.background).toHaveBeenCalledTimes(1);
});

test('an async restored-host reload cannot install an owner after background', async () => {
	useHerdrProviderStore.getState().clearHost();
	let finishReload!: (host: HerdrHostState) => void;
	mockPrepareHerdrHost.mockReturnValueOnce(
		new Promise<HerdrHostState>((resolve) => {
			finishReload = resolve;
		}),
	);
	render(<HerdrTerminalRoute />);
	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(1));

	act(() => mockAppStateListener?.('background'));
	await act(async () => finishReload(HOST));
	expect(mockCreateOwner).not.toHaveBeenCalled();

	mockPrepareHerdrHost.mockResolvedValue(HOST);
	await act(async () => mockAppStateListener?.('active'));
	await waitFor(() => expect(mockCreateOwner).toHaveBeenCalledTimes(1));
});

test('React effect replay keeps the current owner subscription live', async () => {
	render(
		<React.StrictMode>
			<HerdrTerminalRoute />
		</React.StrictMode>,
	);
	await waitFor(() => expect(mockCreateOwner).toHaveBeenCalled());
	const owner = mockCreateOwner.mock.results.at(-1)!.value as OwnerHarness;
	act(() =>
		owner.publish({
			phase: 'owned-elsewhere',
			generation: 1,
			reason: 'Effect replay owner is live.',
		}),
	);
	await waitFor(() =>
		expect(screen.getByText('Effect replay owner is live.')).toBeOnTheScreen(),
	);
});

test('direct restored routes reload the host and start only when the stable target remains', async () => {
	useHerdrProviderStore.getState().clearHost();
	mockPrepareHerdrHost.mockResolvedValue(HOST);
	await renderReady();
	expect(mockPrepareHerdrHost).toHaveBeenCalledWith(
		expect.objectContaining({ storedConnectionId: 'saved-host' }),
	);
	expect(mockCreateOwner.mock.calls[0]![0].terminalId).toBe('terminal-a');

	useHerdrProviderStore.getState().clearHost();
	mockCreateOwner.mockClear();
	mockPrepareHerdrHost.mockResolvedValue({
		...HOST,
		snapshot: { ...HOST.snapshot, agents: [] },
	});
	render(<HerdrTerminalRoute />);
	await waitFor(() =>
		expect(mockReplace).toHaveBeenCalledWith({
			pathname: '/herdr',
			params: {
				storedConnectionId: 'saved-host',
				connectionId: 'connection-a',
			},
		}),
	);
	expect(mockCreateOwner).not.toHaveBeenCalled();
});

/* eslint-enable @typescript-eslint/consistent-type-imports, @eslint-react/hooks-extra/no-unnecessary-use-prefix, @eslint-react/no-forward-ref, react-compiler/react-compiler */
