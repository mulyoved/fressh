import { beforeEach, expect, jest, test } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import React from 'react';
import { create } from 'zustand';
import { type ShellRouteRequest } from '../../src/app/shell/shell-route';
import {
	type ShellSessionControllerHandle,
	type useShellSessionController as UseShellSessionControllerValue,
} from '../../src/lib/shell-controllers/session';

type UseShellSessionController = typeof UseShellSessionControllerValue;

function getShellSessionMountKey(nextRequest: ShellRouteRequest): string {
	return (
		jest.requireActual('../../src/lib/shell-controllers/session') as {
			createShellSessionMountKey(request: ShellRouteRequest): string;
		}
	).createShellSessionMountKey(nextRequest);
}

const mockUseSshStore = create(() => ({
	connections: {} as Record<string, unknown>,
	shells: {} as Record<string, unknown>,
	invalidateShellTransport: jest.fn(
		(_connectionId: string, _channelId: number) => true,
	),
}));
const mockUseAutoConnectStore = create(() => ({
	activeDiagnosticTrace: null as { event(event: unknown): void } | null,
	isAutoConnecting: false,
	isReconnecting: false,
	lastReconnectOutcome: null as {
		status: string;
		destination: 'terminal' | 'hostPage';
	} | null,
}));
const mockFetchQuery = jest.fn<
	(query: { queryKey: string[] }) => Promise<unknown>
>(async () => null);
const mockCreateWorkmuxControlChannel = jest.fn(
	(_input: {
		connection: unknown;
		trace: { event(event: unknown): void };
	}) => ({
		command: jest.fn(async () => ({ success: true, output: '' })),
		operation: jest.fn(async () => ({ success: true, output: '' })),
		scroll: {
			enter: jest.fn(async () => ({ success: true, output: '' })),
			move: jest.fn(async () => ({ success: true, output: '' })),
			exit: jest.fn(async () => ({ success: true, output: '' })),
		},
		prepareDispose: jest.fn(),
		dispose: jest.fn(async () => undefined),
	}),
);

jest.mock('@/lib/ssh-store', () => ({ useSshStore: mockUseSshStore }));
jest.mock('@/lib/auto-connect-store', () => ({
	useAutoConnectStore: mockUseAutoConnectStore,
}));
jest.mock('@/lib/utils', () => ({
	queryClient: { fetchQuery: mockFetchQuery },
}));
jest.mock('@/lib/secrets-manager', () => ({
	secretsManager: {
		connections: { query: { get: (id: string) => ({ queryKey: [id] }) } },
	},
}));
jest.mock('@/lib/workmux-control-channel', () => ({
	createWorkmuxControlChannel: mockCreateWorkmuxControlChannel,
}));

const request: ShellRouteRequest = {
	connectionId: 'connection-1',
	channelId: 7,
	storedConnectionId: 'saved-1',
	agentRoute: {
		connectionId: null,
		session: null,
		windowId: null,
		eventId: null,
		tapToken: null,
	},
	tmuxAttach: { status: 'normal', sessionName: 'main' },
};

const activity = {
	getSnapshot: () => ({
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 0,
	}),
	subscribe: () => () => {},
};
const router = { back: jest.fn(), replace: jest.fn() };
const logger = {
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
};

function SessionHarness({
	onHandle,
	request: nextRequest = request,
	router: nextRouter = router,
	useController,
}: {
	onHandle(handle: ShellSessionControllerHandle): void;
	request?: ShellRouteRequest;
	router?: typeof router;
	useController: UseShellSessionController;
}) {
	// eslint-disable-next-line react-compiler/react-compiler -- The test injects one stable hook after Jest installs its store seams.
	const handle = useController({
		request: nextRequest,
		activity,
		router: nextRouter,
		logger,
	});
	React.useLayoutEffect(() => onHandle(handle), [handle, onHandle]);
	return null;
}

function KeyedSessionHarness({
	onHandle,
	request: nextRequest,
	router: nextRouter,
	useController,
}: {
	onHandle(handle: ShellSessionControllerHandle): void;
	request: ShellRouteRequest;
	router: typeof router;
	useController: UseShellSessionController;
}) {
	return (
		<SessionHarness
			key={getShellSessionMountKey(nextRequest)}
			onHandle={onHandle}
			request={nextRequest}
			router={nextRouter}
			useController={useController}
		/>
	);
}

function getUseShellSessionController(): UseShellSessionController {
	return (
		jest.requireActual('../../src/lib/shell-controllers/session') as {
			useShellSessionController: UseShellSessionController;
		}
	).useShellSessionController;
}

function createConnection(host = 'host-a', connectionId = 'connection-1') {
	return {
		connectionId,
		connectionDetails: { username: 'user', host, port: 22 },
	};
}

function createShell(connectionId = 'connection-1', channelId = 7) {
	return {
		connectionId,
		channelId,
		readBuffer: jest.fn(async () => ({
			chunks: [],
			nextSeq: 0n,
			dropped: false,
		})),
		addListener: jest.fn(async () => 9n),
		removeListener: jest.fn(),
		sendData: jest.fn(async (_bytes: ArrayBuffer) => undefined),
		resizePty: jest.fn(async (_cols: number, _rows: number) => undefined),
	};
}

function deferred<T = void>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

beforeEach(() => {
	mockCreateWorkmuxControlChannel.mockClear();
	mockFetchQuery.mockClear();
	mockFetchQuery.mockResolvedValue(null);
	mockUseSshStore.setState({ connections: {}, shells: {} });
	mockUseAutoConnectStore.setState({
		activeDiagnosticTrace: null,
		isAutoConnecting: false,
		isReconnecting: false,
		lastReconnectOutcome: null,
	});
	router.back.mockClear();
	router.replace.mockClear();
	mockUseSshStore.getState().invalidateShellTransport.mockClear();
});

test('one hook mount owns one session and retires its Workmux channel on unmount', async () => {
	const onHandle = jest.fn<(handle: ShellSessionControllerHandle) => void>();
	const useController = getUseShellSessionController();

	const screen = render(
		<SessionHarness onHandle={onHandle} useController={useController} />,
	);
	expect(onHandle).toHaveBeenCalled();
	expect(mockCreateWorkmuxControlChannel).toHaveBeenCalledTimes(1);

	screen.rerender(
		<SessionHarness onHandle={onHandle} useController={useController} />,
	);
	expect(mockCreateWorkmuxControlChannel).toHaveBeenCalledTimes(1);

	await act(async () => {
		screen.unmount();
		await Promise.resolve();
	});
	const channel = mockCreateWorkmuxControlChannel.mock.results[0]?.value as
		| ReturnType<typeof mockCreateWorkmuxControlChannel>
		| undefined;
	expect(channel?.prepareDispose).toHaveBeenCalledTimes(1);
	expect(channel?.dispose).toHaveBeenCalledWith({ reason: 'unmount' });
});

test('Strict Mode balances every committed Workmux acquisition on unmount', async () => {
	const onHandle = jest.fn<(handle: ShellSessionControllerHandle) => void>();
	const screen = render(
		<React.StrictMode>
			<SessionHarness
				onHandle={onHandle}
				useController={getUseShellSessionController()}
			/>
		</React.StrictMode>,
	);

	await act(async () => {
		screen.unmount();
		await Promise.resolve();
	});

	const channels = mockCreateWorkmuxControlChannel.mock.results.map(
		(result) =>
			result.value as ReturnType<typeof mockCreateWorkmuxControlChannel>,
	);
	expect(channels.length).toBeGreaterThan(0);
	for (const channel of channels) {
		expect(channel.prepareDispose).toHaveBeenCalledTimes(1);
		expect(channel.dispose).toHaveBeenCalledTimes(1);
	}
});

test('committed store sources drive readiness and missing-session navigation once', () => {
	mockUseSshStore.setState({
		connections: { 'connection-1': createConnection() },
		shells: { 'connection-1-7': createShell() },
	});
	const onHandle = jest.fn<(handle: ShellSessionControllerHandle) => void>();
	const latest = () => onHandle.mock.calls.at(-1)?.[0];
	const screen = render(
		<SessionHarness
			onHandle={onHandle}
			useController={getUseShellSessionController()}
		/>,
	);

	expect(latest()?.snapshot).toEqual({
		status: 'ready',
		generation: 1,
		storedConnectionId: 'saved-1',
	});

	act(() => {
		mockUseSshStore.setState({ connections: {}, shells: {} });
	});
	expect(latest()?.snapshot).toEqual({
		status: 'leaving',
		generation: 2,
	});
	expect(router.back).toHaveBeenCalledTimes(1);

	act(() => {
		mockUseSshStore.setState({ connections: {}, shells: {} });
	});
	expect(router.back).toHaveBeenCalledTimes(1);
	screen.unmount();
});

test('route identity remounts session ownership while navigation uses the current router', async () => {
	const secondRequest: ShellRouteRequest = {
		...request,
		connectionId: 'connection-2',
		channelId: 8,
		storedConnectionId: 'saved-2',
		tmuxAttach: {
			status: 'failed',
			sessionName: 'route-beta',
			failureReason: 'missing-session',
		},
	};
	const readySecondRequest: ShellRouteRequest = {
		...secondRequest,
		tmuxAttach: { status: 'normal', sessionName: 'route-beta' },
	};
	const firstRouter = { back: jest.fn(), replace: jest.fn() };
	const secondRouter = { back: jest.fn(), replace: jest.fn() };
	mockUseSshStore.setState({
		connections: {
			'connection-1': createConnection('host-a', 'connection-1'),
			'connection-2': createConnection('host-b', 'connection-2'),
		},
		shells: {
			'connection-1-7': createShell('connection-1', 7),
			'connection-2-8': createShell('connection-2', 8),
		},
	});
	const onHandle = jest.fn<(handle: ShellSessionControllerHandle) => void>();
	const latest = () => onHandle.mock.calls.at(-1)?.[0];
	const useController = getUseShellSessionController();
	const screen = render(
		<KeyedSessionHarness
			onHandle={onHandle}
			request={request}
			router={firstRouter}
			useController={useController}
		/>,
	);
	expect(latest()?.snapshot.status).toBe('ready');
	expect(latest()?.tmux.target).toBe('main');
	const firstChannel = mockCreateWorkmuxControlChannel.mock.results[0]
		?.value as ReturnType<typeof mockCreateWorkmuxControlChannel>;

	screen.rerender(
		<KeyedSessionHarness
			onHandle={onHandle}
			request={secondRequest}
			router={secondRouter}
			useController={useController}
		/>,
	);
	expect(latest()?.snapshot).toMatchObject({
		status: 'attach-error',
		sessionName: 'route-beta',
	});
	expect(latest()?.tmux).toEqual({ enabled: false, target: 'route-beta' });
	expect(latest()?.identity.transportKey).toContain('connection-2');

	screen.rerender(
		<KeyedSessionHarness
			onHandle={onHandle}
			request={readySecondRequest}
			router={secondRouter}
			useController={useController}
		/>,
	);
	expect(latest()?.snapshot.status).toBe('ready');
	await act(async () => {
		await Promise.resolve();
	});
	expect(firstChannel.prepareDispose).toHaveBeenCalledTimes(1);

	const replacementRouter = { back: jest.fn(), replace: jest.fn() };
	screen.rerender(
		<KeyedSessionHarness
			onHandle={onHandle}
			request={readySecondRequest}
			router={replacementRouter}
			useController={useController}
		/>,
	);
	act(() => {
		mockUseSshStore.setState({ connections: {}, shells: {} });
	});
	expect(secondRouter.back).not.toHaveBeenCalled();
	expect(replacementRouter.back).toHaveBeenCalledTimes(1);
	expect(
		mockUseSshStore.getState().invalidateShellTransport,
	).not.toHaveBeenCalled();

	await act(async () => {
		screen.unmount();
		await Promise.resolve();
	});
});

test('terminal source capabilities rotate safely while unrelated state keeps ports stable', async () => {
	const firstShell = createShell();
	mockUseSshStore.setState({
		connections: { 'connection-1': createConnection() },
		shells: { 'connection-1-7': firstShell },
	});
	const onHandle = jest.fn<(handle: ShellSessionControllerHandle) => void>();
	const latest = () => onHandle.mock.calls.at(-1)?.[0];
	const screen = render(
		<SessionHarness
			onHandle={onHandle}
			useController={getUseShellSessionController()}
		/>,
	);
	const firstPorts = latest()?.ports;
	const firstTerminalPort = firstPorts?.terminalSource;
	const adapter = firstTerminalPort;

	expect(adapter).not.toBe(firstShell);
	expect(adapter).not.toHaveProperty('close');
	await adapter?.sendData(new Uint8Array([1, 2, 3]));
	await adapter?.resizePty(80, 24);
	await adapter?.readBuffer({ mode: 'head' });
	const listener = await adapter?.addListener(jest.fn(), {
		cursor: { mode: 'live' },
	});
	expect(firstShell.sendData).toHaveBeenCalledWith(expect.any(ArrayBuffer));
	expect(firstShell.resizePty).toHaveBeenCalledWith(80, 24);
	expect(firstShell.readBuffer).toHaveBeenCalledTimes(1);
	expect(firstShell.addListener).toHaveBeenCalledTimes(1);

	const traceEvent = jest.fn();
	act(() => {
		mockUseAutoConnectStore.setState({
			activeDiagnosticTrace: { event: traceEvent },
		});
	});
	expect(latest()?.ports).toBe(firstPorts);
	const retainedWorkmuxInput =
		mockCreateWorkmuxControlChannel.mock.calls[0]?.[0];

	const replacementShell = createShell();
	act(() => {
		mockUseSshStore.setState({
			shells: { 'connection-1-7': replacementShell },
		});
	});
	expect(latest()?.identity.generation).toBe(1);
	expect(latest()?.ports.terminalSource).not.toBe(firstTerminalPort);
	await expect(adapter?.sendData(new Uint8Array([4, 5, 6]))).rejects.toThrow(
		'superseded',
	);
	await expect(adapter?.resizePty(120, 40)).rejects.toThrow('superseded');
	await expect(adapter?.readBuffer({ mode: 'head' })).rejects.toThrow(
		'superseded',
	);
	await expect(
		adapter?.addListener(jest.fn(), { cursor: { mode: 'live' } }),
	).rejects.toThrow('superseded');
	if (listener) adapter?.removeListener(listener);
	expect(firstShell.sendData).toHaveBeenCalledTimes(1);
	expect(firstShell.resizePty).toHaveBeenCalledTimes(1);
	expect(firstShell.readBuffer).toHaveBeenCalledTimes(1);
	expect(firstShell.addListener).toHaveBeenCalledTimes(1);
	expect(firstShell.removeListener).toHaveBeenCalledWith(9n);
	expect(latest()?.ports.terminalSource).not.toBe(replacementShell);
	expect(mockCreateWorkmuxControlChannel).toHaveBeenCalledTimes(1);
	retainedWorkmuxInput?.trace.event({ kind: 'retained-after-shell-rotation' });
	expect(traceEvent).toHaveBeenCalledTimes(1);
	expect(traceEvent).toHaveBeenCalledWith({
		kind: 'retained-after-shell-rotation',
	});
	screen.unmount();
});

test('stale tmux resolution is ignored and real connection or target changes replace Workmux', async () => {
	const pending = new Map<
		string,
		{ resolve(value: unknown): void; promise: Promise<unknown> }
	>();
	mockFetchQuery.mockImplementation(({ queryKey }) => {
		const id = queryKey[0] ?? '';
		let resolve!: (value: unknown) => void;
		const promise = new Promise<unknown>((nextResolve) => {
			resolve = nextResolve;
		});
		pending.set(id, { resolve, promise });
		return promise;
	});
	const requestWithoutStoredId = { ...request, storedConnectionId: undefined };
	mockUseSshStore.setState({
		connections: { 'connection-1': createConnection('host-a') },
		shells: { 'connection-1-7': createShell() },
	});
	const onHandle = jest.fn<(handle: ShellSessionControllerHandle) => void>();
	const latest = () => onHandle.mock.calls.at(-1)?.[0];
	const screen = render(
		<SessionHarness
			onHandle={onHandle}
			request={requestWithoutStoredId}
			useController={getUseShellSessionController()}
		/>,
	);
	expect(pending.has('user-host-a-22')).toBe(true);

	await act(async () => {
		mockUseSshStore.setState({
			connections: { 'connection-1': createConnection('host-b') },
		});
		await Promise.resolve();
		await Promise.resolve();
	});
	expect(mockCreateWorkmuxControlChannel).toHaveBeenCalledTimes(2);
	expect(pending.has('user-host-b-22')).toBe(true);

	await act(async () => {
		pending.get('user-host-b-22')?.resolve({
			value: { useTmux: true, tmuxSessionName: 'beta' },
		});
		await Promise.resolve();
		await Promise.resolve();
	});
	expect(latest()?.tmux).toEqual({ enabled: true, target: 'beta' });
	expect(mockCreateWorkmuxControlChannel).toHaveBeenCalledTimes(3);
	const targetAfterCurrentResolution = latest()?.identity.targetKey;

	await act(async () => {
		pending.get('user-host-a-22')?.resolve({
			value: { useTmux: true, tmuxSessionName: 'stale-alpha' },
		});
		await Promise.resolve();
	});
	expect(latest()?.identity.targetKey).toBe(targetAfterCurrentResolution);
	expect(latest()?.tmux).toEqual({ enabled: true, target: 'beta' });
	expect(mockCreateWorkmuxControlChannel).toHaveBeenCalledTimes(3);
	screen.unmount();
});

test('reconnect cleanup retires Workmux without invalidating SSH resources', async () => {
	const onHandle = jest.fn<(handle: ShellSessionControllerHandle) => void>();
	const screen = render(
		<SessionHarness
			onHandle={onHandle}
			useController={getUseShellSessionController()}
		/>,
	);
	act(() => {
		mockUseAutoConnectStore.setState({ isReconnecting: true });
	});
	await act(async () => {
		screen.unmount();
		await Promise.resolve();
	});
	const channel = mockCreateWorkmuxControlChannel.mock.results[0]?.value as
		| ReturnType<typeof mockCreateWorkmuxControlChannel>
		| undefined;
	expect(channel?.dispose).toHaveBeenCalledWith({ reason: 'reconnect' });
	expect(
		mockUseSshStore.getState().invalidateShellTransport,
	).not.toHaveBeenCalled();
});

test('diagnostics follow the committed trace and explicit invalidation uses the store boundary', () => {
	mockUseSshStore.setState({
		connections: { 'connection-1': createConnection() },
		shells: { 'connection-1-7': createShell() },
	});
	const onHandle = jest.fn<(handle: ShellSessionControllerHandle) => void>();
	const latest = () => onHandle.mock.calls.at(-1)?.[0];
	const screen = render(
		<SessionHarness
			onHandle={onHandle}
			useController={getUseShellSessionController()}
		/>,
	);
	const traceEvent = jest.fn();
	act(() => {
		mockUseAutoConnectStore.setState({
			activeDiagnosticTrace: { event: traceEvent },
		});
	});
	const channelInput = mockCreateWorkmuxControlChannel.mock.calls[0]?.[0];
	channelInput?.trace.event({ kind: 'test-event' });
	expect(traceEvent).toHaveBeenCalledWith({ kind: 'test-event' });

	act(() => latest()?.invalidateShellTransport());
	expect(
		mockUseSshStore.getState().invalidateShellTransport,
	).toHaveBeenCalledWith('connection-1', 7);
	expect(latest()?.snapshot.status).toBe('leaving');
	screen.unmount();
});

test('source replacement suppresses retiring diagnostics and delivers successor diagnostics', async () => {
	mockUseSshStore.setState({
		connections: { 'connection-1': createConnection('host-a') },
		shells: { 'connection-1-7': createShell() },
	});
	const traceEvent = jest.fn();
	mockUseAutoConnectStore.setState({
		activeDiagnosticTrace: { event: traceEvent },
	});
	const screen = render(
		<SessionHarness
			onHandle={() => {}}
			useController={getUseShellSessionController()}
		/>,
	);
	const retiringInput = mockCreateWorkmuxControlChannel.mock.calls[0]?.[0];

	await act(async () => {
		mockUseSshStore.setState({
			connections: { 'connection-1': createConnection('host-b') },
		});
		await Promise.resolve();
		await Promise.resolve();
	});

	const successorInput = mockCreateWorkmuxControlChannel.mock.calls[1]?.[0];
	expect(successorInput).toBeDefined();
	retiringInput?.trace.event({ kind: 'retiring-event' });
	successorInput?.trace.event({ kind: 'successor-event' });

	expect(traceEvent).toHaveBeenCalledTimes(1);
	expect(traceEvent).toHaveBeenCalledWith({ kind: 'successor-event' });
	screen.unmount();
});

test('shell rotation during retirement publishes the successor without replacing the newest terminal source', async () => {
	const firstShell = createShell();
	mockUseSshStore.setState({
		connections: { 'connection-1': createConnection('host-a') },
		shells: { 'connection-1-7': firstShell },
	});
	const traceEvent = jest.fn();
	mockUseAutoConnectStore.setState({
		activeDiagnosticTrace: { event: traceEvent },
	});
	const onHandle = jest.fn<(handle: ShellSessionControllerHandle) => void>();
	const latest = () => onHandle.mock.calls.at(-1)?.[0];
	const screen = render(
		<SessionHarness
			onHandle={onHandle}
			useController={getUseShellSessionController()}
		/>,
	);
	const predecessor = latest()?.ports.workmux;
	const firstTerminalSource = latest()?.ports.terminalSource;
	const cleanupStarted = deferred();
	const releaseCleanup = deferred();
	predecessor?.registerBeforeDispose('deferred-test', async () => {
		cleanupStarted.resolve();
		await releaseCleanup.promise;
	});
	const predecessorInput = mockCreateWorkmuxControlChannel.mock.calls[0]?.[0];

	act(() => {
		mockUseSshStore.setState({
			connections: { 'connection-1': createConnection('host-b') },
		});
	});
	await cleanupStarted.promise;
	expect(mockCreateWorkmuxControlChannel).toHaveBeenCalledTimes(1);
	await expect(predecessor?.command(['stale'])).resolves.toEqual({
		status: 'superseded',
	});

	const newestShell = createShell();
	act(() => {
		mockUseSshStore.setState({
			shells: { 'connection-1-7': newestShell },
		});
	});
	const newestTerminalSource = latest()?.ports.terminalSource;
	expect(newestTerminalSource).not.toBe(firstTerminalSource);

	await act(async () => {
		releaseCleanup.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});

	const successor = latest()?.ports.workmux;
	const successorInput = mockCreateWorkmuxControlChannel.mock.calls[1]?.[0];
	expect(successorInput).toBeDefined();
	expect(successor).not.toBe(predecessor);
	expect(latest()?.ports.terminalSource).toBe(newestTerminalSource);
	await expect(successor?.command(['current'])).resolves.toEqual({
		status: 'completed',
	});
	predecessorInput?.trace.event({ kind: 'retiring-event' });
	successorInput?.trace.event({ kind: 'successor-event' });
	expect(traceEvent).toHaveBeenCalledTimes(1);
	expect(traceEvent).toHaveBeenCalledWith({ kind: 'successor-event' });
	screen.unmount();
});
