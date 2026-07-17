/* eslint-disable @typescript-eslint/consistent-type-imports, @eslint-react/hooks-extra/no-unnecessary-use-prefix, @eslint-react/no-forward-ref, react-compiler/react-compiler -- Hoisted Jest factories keep native dependencies local and capture component boundary props for route integration assertions. */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react-native';
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
	webViewOptions: {
		onLoadStart(): void;
		onError(): void;
		onRenderProcessGone(): void;
		onContentProcessDidTerminate(): void;
	};
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
let mockXtermMountCount = 0;
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
			React.useEffect(() => {
				mockXtermMountCount += 1;
			}, []);
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
	mockPrepareHerdrHost.mockReset();
	mockCreateOwner.mockReset();
	mockUseSshStore.getState.mockReset();
	mockXtermProps = null;
	mockXtermMountCount = 0;
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

function deferred<T>() {
	let resolve!: (value?: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = (value) => onResolve(value as T);
		reject = onReject;
	});
	return { promise, resolve, reject };
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

test('reload starts a fresh baseline generation and rejects stale xterm events', async () => {
	const { owner, renderer } = await renderReady();
	act(() => mockXtermProps?.onInitialized('xterm-1'));
	act(() => mockXtermProps?.onResize(120, 40));
	owner.sendInput.mockClear();
	owner.scroll.mockClear();
	mockXtermHandle.clear.mockClear();
	mockXtermHandle.write.mockClear();

	act(() => mockXtermProps?.webViewOptions.onLoadStart());
	act(() => mockXtermProps?.webViewOptions.onLoadStart());
	expect(owner.retire).toHaveBeenCalledWith('retry');
	renderer.append(new Uint8Array([9]));
	act(() =>
		mockXtermProps?.onInput({
			str: 'stale',
			kind: 'typing',
			instanceId: 'xterm-1',
		}),
	);
	act(() =>
		mockXtermProps?.onScrollbackBatch({
			direction: 'up',
			pages: 0,
			lines: 2,
			pageStep: 1,
			instanceId: 'xterm-1',
		}),
	);
	expect(owner.sendInput).not.toHaveBeenCalled();
	expect(owner.scroll).not.toHaveBeenCalled();
	expect(mockXtermHandle.write).not.toHaveBeenCalled();

	act(() => mockXtermProps?.onInitialized('xterm-2'));
	act(() => mockXtermProps?.onResize(90, 28));
	expect(owner.retry).toHaveBeenCalledWith({ cols: 90, rows: 28 });
	renderer.append(new Uint8Array([10]));
	expect(mockXtermHandle.write).not.toHaveBeenCalled();
	renderer.replace(new Uint8Array([11, 12]));
	renderer.append(new Uint8Array([13]));
	expect(mockXtermHandle.clear).toHaveBeenCalledTimes(1);
	expect(mockXtermHandle.write.mock.calls).toEqual([
		[new Uint8Array([11, 12])],
		[new Uint8Array([13])],
	]);

	act(() =>
		mockXtermProps?.onInput({
			str: 'current',
			kind: 'typing',
			instanceId: 'xterm-2',
		}),
	);
	act(() =>
		mockXtermProps?.onScrollbackBatch({
			direction: 'down',
			pages: 0,
			lines: 3,
			pageStep: 1,
			instanceId: 'xterm-2',
		}),
	);
	expect(owner.sendInput).toHaveBeenCalledWith(
		new TextEncoder().encode('current'),
	);
	expect(owner.scroll).toHaveBeenCalledWith('down', 3);
});

test('renderer failure before activation synchronously retires once and rejects every stale callback', async () => {
	const { owner, renderer } = await renderReady();
	const failedRenderer = mockXtermProps!;

	act(() => failedRenderer.webViewOptions.onError());
	expect(owner.retire).toHaveBeenCalledTimes(1);
	expect(owner.retire).toHaveBeenCalledWith('failure');
	expect(
		screen.getByText('Terminal renderer stopped. Retry to reconnect.'),
	).toBeOnTheScreen();

	act(() => failedRenderer.webViewOptions.onRenderProcessGone());
	act(() => failedRenderer.webViewOptions.onContentProcessDidTerminate());
	act(() =>
		owner.publish({
			phase: 'active',
			generation: 1,
		}),
	);
	act(() => failedRenderer.onInitialized('stale-before-start'));
	act(() => failedRenderer.onResize(120, 40));
	act(() =>
		failedRenderer.onInput({
			str: 'stale',
			kind: 'typing',
			instanceId: 'stale-before-start',
		}),
	);
	renderer.replace(new Uint8Array([1]));

	expect(owner.retire).toHaveBeenCalledTimes(1);
	expect(owner.start).not.toHaveBeenCalled();
	expect(owner.sendInput).not.toHaveBeenCalled();
	expect(mockXtermHandle.write).not.toHaveBeenCalled();
	expect(
		screen.getByText('Terminal renderer stopped. Retry to reconnect.'),
	).toBeOnTheScreen();
	expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
});

test('renderer Retry remounts, reconciles after retirement, and gates the fresh owner on a full baseline', async () => {
	const retirement = deferred<void>();
	const { owner, renderer } = await renderReady();
	act(() => mockXtermProps?.onInitialized('xterm-1'));
	act(() => mockXtermProps?.onResize(120, 40));
	renderer.replace(new Uint8Array([1]));
	owner.sendInput.mockClear();
	mockXtermHandle.clear.mockClear();
	mockXtermHandle.write.mockClear();
	owner.retire.mockReturnValueOnce(retirement.promise);
	const failedRenderer = mockXtermProps!;

	act(() => failedRenderer.webViewOptions.onRenderProcessGone());
	act(() =>
		failedRenderer.onInput({
			str: 'stale-active',
			kind: 'typing',
			instanceId: 'xterm-1',
		}),
	);
	renderer.append(new Uint8Array([2]));
	expect(owner.sendInput).not.toHaveBeenCalled();
	expect(mockXtermHandle.write).not.toHaveBeenCalled();

	fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
	await waitFor(() => expect(mockXtermMountCount).toBe(2));
	expect(mockPrepareHerdrHost).not.toHaveBeenCalled();

	await act(async () => retirement.resolve());
	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(1));
	await waitFor(() => expect(mockCreateOwner).toHaveBeenCalledTimes(2));
	const freshOwner = mockCreateOwner.mock.results[1]!.value as OwnerHarness;
	const freshRenderer = mockCreateOwner.mock.calls[1]![0]
		.renderer as HerdrRendererPort;
	const replacementRenderer = mockXtermProps!;

	act(() => failedRenderer.webViewOptions.onError());
	act(() => failedRenderer.onInitialized('stale-after-retry'));
	act(() => failedRenderer.onResize(200, 60));
	expect(freshOwner.retire).not.toHaveBeenCalled();
	expect(freshOwner.start).not.toHaveBeenCalled();

	act(() => replacementRenderer.onInitialized('xterm-2'));
	act(() => replacementRenderer.onResize(90, 28));
	expect(freshOwner.start).toHaveBeenCalledWith({ cols: 90, rows: 28 });
	act(() =>
		replacementRenderer.onInput({
			str: 'too-early',
			kind: 'typing',
			instanceId: 'xterm-2',
		}),
	);
	freshRenderer.append(new Uint8Array([3]));
	expect(freshOwner.sendInput).not.toHaveBeenCalled();
	expect(mockXtermHandle.write).not.toHaveBeenCalled();

	freshRenderer.replace(new Uint8Array([4]));
	act(() =>
		replacementRenderer.onInput({
			str: 'current',
			kind: 'typing',
			instanceId: 'xterm-2',
		}),
	);
	expect(mockXtermHandle.write).toHaveBeenCalledWith(new Uint8Array([4]));
	expect(freshOwner.sendInput).toHaveBeenCalledWith(
		new TextEncoder().encode('current'),
	);
});

test('renderer Retry owns foreground reconciliation until pending retirement settles', async () => {
	const retirement = deferred<void>();
	const { owner } = await renderReady();
	owner.retire.mockReturnValueOnce(retirement.promise);
	const failedRenderer = mockXtermProps!;

	act(() => failedRenderer.webViewOptions.onError());
	const retry = screen.getByRole('button', { name: 'Retry' });
	fireEvent.press(retry);
	fireEvent.press(retry);
	await waitFor(() => expect(mockXtermMountCount).toBe(2));

	act(() => mockAppStateListener?.('background'));
	act(() => mockAppStateListener?.('active'));
	act(() => mockAppStateListener?.('active'));
	expect(mockPrepareHerdrHost).not.toHaveBeenCalled();
	expect(mockCreateOwner).toHaveBeenCalledTimes(1);
	expect(owner.retire).toHaveBeenCalledTimes(1);

	await act(async () => retirement.resolve());
	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(1));
	await waitFor(() => expect(mockCreateOwner).toHaveBeenCalledTimes(2));
	expect(mockXtermMountCount).toBe(2);
	expect(owner.retire).toHaveBeenCalledTimes(1);
});

test('foreground clears renderer-failure suspension without bypassing Retry recovery', async () => {
	const retirement = deferred<void>();
	const { owner } = await renderReady();
	owner.retire.mockReturnValueOnce(retirement.promise);
	const failedRenderer = mockXtermProps!;

	act(() => failedRenderer.webViewOptions.onError());
	act(() => mockAppStateListener?.('background'));
	act(() => mockAppStateListener?.('active'));
	act(() => mockAppStateListener?.('active'));
	expect(mockPrepareHerdrHost).not.toHaveBeenCalled();
	expect(
		screen.getByText('Terminal renderer stopped. Retry to reconnect.'),
	).toBeOnTheScreen();

	fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
	await waitFor(() => expect(mockXtermMountCount).toBe(2));
	expect(mockPrepareHerdrHost).not.toHaveBeenCalled();

	await act(async () => retirement.resolve());
	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(1));
	await waitFor(() => expect(mockCreateOwner).toHaveBeenCalledTimes(2));
	const freshOwner = mockCreateOwner.mock.results[1]!.value as OwnerHarness;
	const replacementRenderer = mockXtermProps!;
	act(() => replacementRenderer.onInitialized('xterm-2'));
	act(() => replacementRenderer.onResize(90, 28));
	expect(freshOwner.start).toHaveBeenCalledWith({ cols: 90, rows: 28 });
});

test('foreground resumes the same renderer recovery when background cancels its reconciliation', async () => {
	const refresh = deferred<HerdrHostState>();
	const { owner } = await renderReady();
	owner.retire.mockReturnValueOnce(Promise.resolve());
	mockPrepareHerdrHost
		.mockReturnValueOnce(refresh.promise)
		.mockResolvedValueOnce(HOST);
	const failedRenderer = mockXtermProps!;

	act(() => failedRenderer.webViewOptions.onError());
	fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(1));

	act(() => mockAppStateListener?.('background'));
	act(() => mockAppStateListener?.('active'));
	act(() => mockAppStateListener?.('active'));
	await act(async () => refresh.resolve(HOST));

	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(2));
	await waitFor(() => expect(mockCreateOwner).toHaveBeenCalledTimes(2));
	expect(owner.retire).toHaveBeenCalledTimes(1);
	expect(mockXtermMountCount).toBe(2);
});

test('background before first xterm readiness never starts the suspended owner', async () => {
	const { owner } = await renderReady();
	expect(owner.start).not.toHaveBeenCalled();

	act(() => mockAppStateListener?.('background'));
	expect(owner.background).toHaveBeenCalledTimes(1);
	act(() => mockXtermProps?.onInitialized('xterm-late'));
	act(() => mockXtermProps?.onResize(120, 40));

	expect(owner.start).not.toHaveBeenCalled();
	expect(owner.retry).not.toHaveBeenCalled();
});

test('background invalidates a pending clipboard paste before it can reach an owner', async () => {
	const clipboard = deferred<string>();
	jest.mocked(Clipboard.getStringAsync).mockReturnValueOnce(clipboard.promise);
	const { owner } = await renderReady();
	owner.sendInput.mockClear();
	let paste: Promise<void> | undefined;

	act(() => {
		paste = mockKeyboardProps?.onSlotPress({
			type: 'action',
			actionId: 'PASTE_CLIPBOARD',
		});
	});
	act(() => mockAppStateListener?.('background'));
	await act(async () => clipboard.resolve('must not be sent'));
	await act(async () => paste);

	expect(owner.sendInput).not.toHaveBeenCalled();
});

test('a newer Work operation invalidates a pending paste before switching agents', async () => {
	const clipboard = deferred<string>();
	jest.mocked(Clipboard.getStringAsync).mockReturnValueOnce(clipboard.promise);
	const { owner } = await renderReady();
	owner.sendInput.mockClear();
	let paste: Promise<void> | undefined;

	act(() => {
		paste = mockKeyboardProps?.onSlotPress({
			type: 'action',
			actionId: 'PASTE_CLIPBOARD',
		});
	});
	await act(async () => {
		await mockKeyboardProps?.onSlotPress({
			type: 'action',
			actionId: 'WORKMUX_NAV_NEXT',
		});
	});
	await act(async () => clipboard.resolve('must not cross the switch'));
	await act(async () => paste);

	expect(owner.sendInput).not.toHaveBeenCalled();
	expect(mockReplace).toHaveBeenCalledWith(
		expect.objectContaining({
			params: expect.objectContaining({ terminalId: 'terminal-b' }),
		}),
	);
});

test('reload followed by background rejects replacement-document readiness', async () => {
	const { owner } = await renderReady();
	act(() => mockXtermProps?.onInitialized('xterm-1'));
	act(() => mockXtermProps?.onResize(120, 40));
	owner.start.mockClear();
	owner.retry.mockClear();

	act(() => mockXtermProps?.webViewOptions.onLoadStart());
	act(() => mockAppStateListener?.('background'));
	act(() => mockXtermProps?.onInitialized('xterm-2'));
	act(() => mockXtermProps?.onResize(90, 28));

	expect(owner.start).not.toHaveBeenCalled();
	expect(owner.retry).not.toHaveBeenCalled();
});

test('Take Over and owner-local Retry invoke only their exact normal owner actions', async () => {
	const { owner } = await renderReady();
	act(() => mockXtermProps?.onInitialized('xterm-1'));
	act(() => mockXtermProps?.onResize(120, 40));

	act(() =>
		owner.publish({
			phase: 'owned-elsewhere',
			generation: 1,
			reason: 'Owned by another client.',
		}),
	);
	fireEvent.press(screen.getByRole('button', { name: 'Take Over' }));
	expect(owner.takeOver).toHaveBeenCalledWith({ cols: 120, rows: 40 });
	expect(owner.retry).not.toHaveBeenCalled();

	act(() =>
		owner.publish({
			phase: 'error',
			generation: 2,
			kind: 'synchronization',
			reason: 'Output lost synchronization.',
		}),
	);
	fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
	expect(owner.retry).toHaveBeenCalledWith({ cols: 120, rows: 40 });
	expect(owner.takeOver).toHaveBeenCalledTimes(1);
	expect(mockPrepareHerdrHost).not.toHaveBeenCalled();
});

test('transport Retry retires the dead owner and reconnects without takeover', async () => {
	const { owner } = await renderReady();
	act(() => mockXtermProps?.onInitialized('xterm-1'));
	act(() => mockXtermProps?.onResize(120, 40));
	act(() =>
		owner.publish({
			phase: 'error',
			generation: 1,
			kind: 'transport',
			reason: 'SSH transport failed.',
		}),
	);

	fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
	await waitFor(() => expect(owner.retire).toHaveBeenCalledWith('failure'));
	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(1));
	await waitFor(() => expect(mockCreateOwner).toHaveBeenCalledTimes(2));
	expect(owner.retry).not.toHaveBeenCalled();
	expect(owner.takeOver).not.toHaveBeenCalled();
	const freshOwner = mockCreateOwner.mock.results[1]!.value as OwnerHarness;
	expect(freshOwner.takeOver).not.toHaveBeenCalled();
});

test('resize cannot restart the old owner during bounded transport retirement', async () => {
	let finishRetirement!: () => void;
	const retirement = new Promise<void>((resolve) => {
		finishRetirement = resolve;
	});
	const { owner } = await renderReady();
	act(() => mockXtermProps?.onInitialized('xterm-1'));
	act(() => mockXtermProps?.onResize(120, 40));
	owner.start.mockClear();
	owner.retry.mockClear();
	owner.retire.mockReturnValueOnce(retirement);
	act(() =>
		owner.publish({
			phase: 'error',
			generation: 1,
			kind: 'transport',
			reason: 'SSH transport failed.',
		}),
	);

	fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
	await waitFor(() => expect(owner.retire).toHaveBeenCalledWith('failure'));
	act(() => mockXtermProps?.onResize(100, 32));
	expect(owner.start).not.toHaveBeenCalled();
	expect(owner.retry).not.toHaveBeenCalled();

	finishRetirement();
	await act(async () => retirement);
	await waitFor(() => expect(mockCreateOwner).toHaveBeenCalledTimes(2));
});

test('reconciliation Retry reconnects through prepareHerdrHost instead of retrying the old owner', async () => {
	const { owner } = await renderReady();
	act(() => mockXtermProps?.onInitialized('xterm-1'));
	act(() => mockXtermProps?.onResize(120, 40));
	mockPrepareHerdrHost.mockRejectedValueOnce(new Error('Reload failed.'));
	act(() => mockAppStateListener?.('background'));
	await act(async () => mockAppStateListener?.('active'));
	await waitFor(() =>
		expect(screen.getByText('Reload failed.')).toBeOnTheScreen(),
	);

	mockPrepareHerdrHost.mockResolvedValueOnce(HOST);
	fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
	await waitFor(() => expect(owner.retire).toHaveBeenCalledWith('failure'));
	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(2));
	await waitFor(() => expect(mockCreateOwner).toHaveBeenCalledTimes(2));
	expect(owner.retry).not.toHaveBeenCalled();
	expect(owner.takeOver).not.toHaveBeenCalled();
});

test('Retry reconnects when the registered SSH connection disappeared', async () => {
	const { owner } = await renderReady();
	act(() => mockXtermProps?.onInitialized('xterm-1'));
	act(() => mockXtermProps?.onResize(120, 40));
	act(() =>
		owner.publish({
			phase: 'error',
			generation: 1,
			kind: 'synchronization',
			reason: 'Output lost synchronization.',
		}),
	);
	mockUseSshStore.getState.mockReturnValue({
		connections: {},
		connect: jest.fn(),
	} as never);

	fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
	await waitFor(() => expect(owner.retire).toHaveBeenCalledWith('failure'));
	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(1));
	expect(owner.retry).not.toHaveBeenCalled();
	expect(owner.takeOver).not.toHaveBeenCalled();
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

test('focus loss invalidates a pending Work refresh without late store, state, or navigation', async () => {
	useHerdrProviderStore.getState().clearHost();
	const initialReload = deferred<HerdrHostState>();
	const workRefresh = deferred<HerdrHostState>();
	mockPrepareHerdrHost
		.mockReturnValueOnce(initialReload.promise)
		.mockReturnValueOnce(workRefresh.promise);
	render(<HerdrTerminalRoute />);
	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(1));
	const setHost = jest.spyOn(useHerdrProviderStore.getState(), 'setHost');
	setHost.mockClear();

	let navigation: Promise<void> | undefined;
	act(() => {
		navigation = mockKeyboardProps?.onSlotPress({
			type: 'action',
			actionId: 'WORKMUX_NAV_NEXT',
		});
	});
	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(2));
	act(() => mockFocusCleanup?.());
	await act(async () => workRefresh.resolve(HOST));
	await act(async () => navigation);

	expect(setHost).not.toHaveBeenCalled();
	expect(useHerdrProviderStore.getState().host).toBeNull();
	expect(mockReplace).not.toHaveBeenCalled();
	expect(
		screen.queryByText('Unable to refresh Herdr agents.'),
	).not.toBeOnTheScreen();
});

test('unmount invalidates a resolved pending Work refresh without late publication', async () => {
	useHerdrProviderStore.getState().clearHost();
	const initialReload = deferred<HerdrHostState>();
	const workRefresh = deferred<HerdrHostState>();
	mockPrepareHerdrHost
		.mockReturnValueOnce(initialReload.promise)
		.mockReturnValueOnce(workRefresh.promise);
	const { unmount } = render(<HerdrTerminalRoute />);
	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(1));

	let navigation: Promise<void> | undefined;
	act(() => {
		navigation = mockKeyboardProps?.onSlotPress({
			type: 'action',
			actionId: 'WORKMUX_NAV_NEXT',
		});
	});
	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(2));
	unmount();
	await act(async () => workRefresh.resolve(HOST));
	await act(async () => navigation);

	expect(useHerdrProviderStore.getState().host).toBeNull();
	expect(mockReplace).not.toHaveBeenCalled();
});

test('background invalidates a pending Work retirement before route replacement', async () => {
	const retirement = deferred<void>();
	const { owner } = await renderReady();
	owner.retire.mockReturnValueOnce(retirement.promise);

	let navigation: Promise<void> | undefined;
	act(() => {
		navigation = mockKeyboardProps?.onSlotPress({
			type: 'action',
			actionId: 'WORKMUX_NAV_NEXT',
		});
	});
	await waitFor(() => expect(owner.retire).toHaveBeenCalledWith('switch'));
	act(() => mockAppStateListener?.('background'));
	await act(async () => retirement.resolve());
	await act(async () => navigation);

	expect(mockReplace).not.toHaveBeenCalled();
});

test('a newer Back action supersedes a pending Work retirement', async () => {
	const retirement = deferred<void>();
	const { owner } = await renderReady();
	owner.retire
		.mockReturnValueOnce(retirement.promise)
		.mockReturnValueOnce(Promise.resolve());

	let workNavigation: Promise<void> | undefined;
	act(() => {
		workNavigation = mockKeyboardProps?.onSlotPress({
			type: 'action',
			actionId: 'WORKMUX_NAV_NEXT',
		});
	});
	await waitFor(() => expect(owner.retire).toHaveBeenCalledWith('switch'));
	act(() =>
		owner.publish({
			phase: 'error',
			generation: 1,
			kind: 'closed',
			reason: 'Terminal closed.',
		}),
	);
	fireEvent.press(screen.getByRole('button', { name: 'Back' }));
	await waitFor(() => expect(owner.retire).toHaveBeenCalledWith('back'));
	await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
	expect(mockReplace).toHaveBeenLastCalledWith({
		pathname: '/herdr',
		params: {
			storedConnectionId: 'saved-host',
			connectionId: 'connection-a',
		},
	});

	await act(async () => retirement.resolve());
	await act(async () => workNavigation);
	expect(mockReplace).toHaveBeenCalledTimes(1);
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

test('foreground readiness cannot restart the old owner before refreshed owner installation', async () => {
	let finishRefresh!: (host: HerdrHostState) => void;
	const refresh = new Promise<HerdrHostState>((resolve) => {
		finishRefresh = resolve;
	});
	const { owner } = await renderReady();
	act(() => mockXtermProps?.onInitialized('xterm-1'));
	act(() => mockXtermProps?.onResize(120, 40));
	owner.start.mockClear();
	owner.retry.mockClear();

	act(() => mockXtermProps?.webViewOptions.onLoadStart());
	mockPrepareHerdrHost.mockReturnValueOnce(refresh);
	act(() => mockAppStateListener?.('background'));
	act(() => mockAppStateListener?.('active'));
	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(1));
	act(() => mockXtermProps?.onInitialized('xterm-2'));
	act(() => mockXtermProps?.onResize(88, 26));

	expect(owner.start).not.toHaveBeenCalled();
	expect(owner.retry).not.toHaveBeenCalled();
	await act(async () => finishRefresh(HOST));
	await waitFor(() => expect(mockCreateOwner).toHaveBeenCalledTimes(2));
	const freshOwner = mockCreateOwner.mock.results[1]!.value as OwnerHarness;
	await waitFor(() =>
		expect(freshOwner.start).toHaveBeenCalledWith({ cols: 88, rows: 26 }),
	);
	expect(freshOwner.retry).not.toHaveBeenCalled();
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

test('a rejected restored-host reload cannot publish an error after background', async () => {
	useHerdrProviderStore.getState().clearHost();
	let failReload!: (error: Error) => void;
	mockPrepareHerdrHost.mockReturnValueOnce(
		new Promise<HerdrHostState>((_resolve, reject) => {
			failReload = reject;
		}),
	);
	render(<HerdrTerminalRoute />);
	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(1));

	act(() => mockAppStateListener?.('background'));
	await act(async () => failReload(new Error('Must remain hidden.')));
	expect(screen.queryByText('Must remain hidden.')).not.toBeOnTheScreen();
	expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeOnTheScreen();
});

test('a rejected restored-host reload cannot publish an error after focus loss', async () => {
	useHerdrProviderStore.getState().clearHost();
	let failReload!: (error: Error) => void;
	mockPrepareHerdrHost.mockReturnValueOnce(
		new Promise<HerdrHostState>((_resolve, reject) => {
			failReload = reject;
		}),
	);
	render(<HerdrTerminalRoute />);
	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(1));

	act(() => mockFocusCleanup?.());
	await act(async () => failReload(new Error('Must remain unfocused.')));
	expect(screen.queryByText('Must remain unfocused.')).not.toBeOnTheScreen();
	expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeOnTheScreen();
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

test('does not present an agent cached for a different stored connection', async () => {
	useHerdrProviderStore.getState().setHost({
		...HOST,
		storedConnectionId: 'different-saved-host',
	});
	let finishReload!: (host: HerdrHostState) => void;
	mockPrepareHerdrHost.mockReturnValueOnce(
		new Promise<HerdrHostState>((resolve) => {
			finishReload = resolve;
		}),
	);
	render(<HerdrTerminalRoute />);
	await waitFor(() => expect(mockPrepareHerdrHost).toHaveBeenCalledTimes(1));
	expect(screen.queryByText('Codex')).not.toBeOnTheScreen();
	expect(screen.getByText('Herdr terminal')).toBeOnTheScreen();

	await act(async () => finishReload(HOST));
	await waitFor(() => expect(screen.getByText('Codex')).toBeOnTheScreen());
});

/* eslint-enable @typescript-eslint/consistent-type-imports, @eslint-react/hooks-extra/no-unnecessary-use-prefix, @eslint-react/no-forward-ref, react-compiler/react-compiler */
