/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- Module mocks must preserve the production hook export names. */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import React from 'react';

type ModalCommands = {
	toggleCommandMenu(): void;
	openCommander(): void;
	openSkillSelector(): void;
	openBrowserActions(): void;
	openFeatureRequest(): void;
	openWisprTextEditor(): void;
	openConfigurator(): void;
	closeCommandMenu(): void;
};

const mockEvents: string[] = [];
type KeyboardInput = {
	modalCommands: ModalCommands;
	activity: unknown;
	scrollbackInput: unknown;
	terminalView: unknown;
	remoteTarget: { workmuxControlChannel: unknown };
};
const mockKeyboardInputs: KeyboardInput[] = [];
const mockSessionInputs: Record<string, unknown>[] = [];
const mockNotificationInputs: Record<string, unknown>[] = [];
const mockBrowserInputs: Record<string, unknown>[] = [];
const mockScrollbackInputs: Record<string, unknown>[] = [];
const mockTerminalInputs: Record<string, unknown>[] = [];
const mockXtermProps: Record<string, unknown>[] = [];
const mockTerminalKeyboardProps: Record<string, unknown>[] = [];
const mockCommandMenuProps: Record<string, unknown>[] = [];
const mockDetectedPickerProps: Record<string, unknown>[] = [];
const mockTextEntryProps: Record<string, unknown>[] = [];
let mockMenuOpen = false;

const mockActivityController = {};

const mockActivitySnapshot = {
	focused: true,
	appState: 'active',
	appActive: true,
	interactive: true,
	generation: 1,
};
const mockActivityPort = {
	getSnapshot: () => mockActivitySnapshot,
	subscribe: () => () => {},
};
const mockHostCommands = {};
const mockWorkmux = {};
const mockTerminalSource = {
	isAvailable: () => true,
	resizePty: jest.fn(),
};
const initialRouteRequest = {
	connectionId: 'connection-v1',
	channelId: 101,
	agentRoute: {
		connectionId: 'agent-connection-v1',
		session: 'agent-session-v1',
		windowId: 'agent-window-v1',
		eventId: 'agent-event-v1',
		tapToken: 'agent-token-v1',
	},
};
const nextRouteRequest = {
	connectionId: 'connection-v2',
	channelId: 202,
	agentRoute: {
		connectionId: 'agent-connection-v2',
		session: 'agent-session-v2',
		windowId: 'agent-window-v2',
		eventId: 'agent-event-v2',
		tapToken: 'agent-token-v2',
	},
};
const initialSessionMarkers = {
	transportKey: 'transport-v1',
	targetKey: 'target-v1',
	storedConnectionId: 'stored-v1',
	tmuxEnabled: true,
	tmuxTarget: 'tmux-v1',
};
const nextSessionMarkers = {
	transportKey: 'transport-v2',
	targetKey: 'target-v2',
	storedConnectionId: 'stored-v2',
	tmuxEnabled: false,
	tmuxTarget: 'tmux-v2',
};
let mockRouteRequest = initialRouteRequest;
let mockSessionMarkers = initialSessionMarkers;
const mockCommandMenu = {
	get open() {
		return mockMenuOpen;
	},
	onOpen: () => {
		mockMenuOpen = true;
		mockEvents.push('open-menu');
	},
	onClose: () => {
		mockMenuOpen = false;
		mockEvents.push('close-menu');
	},
};
const mockSimpleModals = {
	getSnapshot: () => ({ commandMenu: mockMenuOpen, textEntry: false }),
	commandMenu: mockCommandMenu,
	commander: {
		open: false,
		onOpen: () => mockEvents.push('open-commander'),
		onClose: () => mockEvents.push('close-commander'),
	},
	textEntry: { open: false, onOpen: jest.fn(), onClose: jest.fn() },
	configure: {
		open: false,
		onOpen: () => mockEvents.push('open-config'),
		onClose: jest.fn(),
	},
};
const mockBrowserActions = {
	invalidateHostUrlReads: () => mockEvents.push('invalidate-browser'),
	close: () => mockEvents.push('close-browser'),
	open: () => mockEvents.push('open-browser'),
	resolveCurrentGitHubRepository: jest.fn(),
	browserActionsProps: {
		onOpenDiff: jest.fn(),
		onOpenUrlSlot: jest.fn(),
		onEditUrlSlot: jest.fn(),
	},
	detectedOpenPickerProps: {
		open: true,
		candidates: [{ id: 'detected-candidate' }],
		onClose: jest.fn(),
		onSelect: jest.fn(),
	},
	hostUrlProps: {
		open: false,
		slotLabel: '',
		initialValue: '',
		mode: 'open',
		isSubmitting: false,
		error: null,
		onClose: jest.fn(),
		onSubmit: jest.fn(),
	},
};
const mockFeatureRequest = {
	open: () => mockEvents.push('open-feature'),
	markSourceStale: jest.fn(),
	modalProps: {},
};
const mockWispr = {
	openTextEditor: () => mockEvents.push('open-wispr'),
	textEntryProps: {
		onClose: () => mockEvents.push('close-wispr'),
	},
};
const mockSkillSelector = {
	open: () => mockEvents.push('open-skill'),
	close: () => mockEvents.push('close-skill'),
	modalProps: {},
};
const mockKeyboardHandle = {
	terminalKeyboardProps: { keyboard: null, marker: 'terminal-keyboard' },
	commandMenuProps: { entries: [], marker: 'command-menu' },
	commanderProps: {},
	textEntryProps: {},
	configureProps: {},
	flash: { name: null, opacity: {} },
	onSelectionChanged: jest.fn(),
	onSelectionModeChange: jest.fn(),
	onWebViewInput: jest.fn(),
};
const mockTerminal = {
	runtimeInstanceId: null,
	transport: {},
	view: {
		fit: jest.fn(),
		getRuntimeKey: () => null,
		getRuntimeInstanceId: () => null,
	},
	xtermRef: { current: null },
	onLoadStart: jest.fn(),
	onResize: jest.fn(),
	onInitialized: jest.fn(),
	retry: jest.fn(),
	hasRendered: true,
	getLastSize: () => null,
	waitForSizeAfterFit: jest.fn(),
};

const mockScrollback = {
	input: { sendSegments: jest.fn() },
	xtermProps: { onScrollbackModeChange: jest.fn() },
	visible: false,
	jumpToLive: jest.fn(),
};

jest.mock('@fressh/react-native-xtermjs-webview', () => ({
	XtermJsWebView: (props: Record<string, unknown>) => {
		mockXtermProps.push(props);
		return null;
	},
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-constants', () => ({
	__esModule: true,
	default: { expoConfig: { extra: {} } },
}));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
jest.mock('expo-router', () => ({
	Stack: { Screen: () => null },
	useFocusEffect: (effect: () => void | (() => void)) => {
		const mockReact = jest.requireActual('react') as Record<
			string,
			(
				nextEffect: () => void | (() => void),
				dependencies: readonly unknown[],
			) => void
		>;
		const mockUseEffect = mockReact['useEffect'];
		if (!mockUseEffect) throw new Error('React.useEffect is unavailable');
		mockUseEffect(effect, [effect]);
	},
	useLocalSearchParams: () => ({}),
	useRouter: () => ({ back: jest.fn(), replace: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
	useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/lib/detected-open-actions', () => ({
	runDetectedOpenCallback: jest.fn(),
}));
jest.mock('@/lib/keyboard-actions', () => ({ HANDLE_DEV_SERVER_URL: '' }));
jest.mock('@/lib/logger', () => ({
	rootLogger: {
		extend: () => ({
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
		}),
	},
}));
jest.mock('@/lib/lucide-utils', () => ({ resolveLucideIcon: () => null }));
jest.mock('@/lib/preferences', () => ({
	preferences: {
		workmuxNavScope: {
			useWorkmuxNavScopePref: () => ['active'],
			set: jest.fn(),
		},
	},
}));
jest.mock('@/lib/scroll-trace', () => ({
	configureScrollTraceEnabled: jest.fn(),
	emitScrollTrace: jest.fn(),
	isScrollTraceEnabled: () => false,
}));
jest.mock('@/lib/shell-config-store-native', () => ({
	loadRuntimeShellConfigState: () => ({}),
	reloadRuntimeShellConfigFromRemote: jest.fn(),
}));
jest.mock('@/lib/shell-controllers/activity', () => ({
	useShellActivityController: () => mockActivityController,
}));
jest.mock('@/lib/shell-controllers/browser-actions', () => ({
	useBrowserActionsController: (input: Record<string, unknown>) => {
		mockBrowserInputs.push(input);
		return mockBrowserActions;
	},
}));
jest.mock('@/lib/shell-controllers/feature-request', () => ({
	useFeatureRequestController: () => mockFeatureRequest,
}));
jest.mock('@/lib/shell-controllers/keyboard', () => ({
	useShellKeyboardController: (input: KeyboardInput) => {
		mockKeyboardInputs.push(input);
		return mockKeyboardHandle;
	},
}));
jest.mock('@/lib/shell-controllers/modal-arbiter', () => ({
	createShellModalArbiter: () => ({ register: () => () => {} }),
}));
jest.mock('@/lib/shell-controllers/notifications', () => ({
	useShellNotificationsController: (input: Record<string, unknown>) => {
		mockNotificationInputs.push(input);
	},
}));
jest.mock('@/lib/shell-controllers/scrollback', () => ({
	useShellScrollbackController: (input: Record<string, unknown>) => {
		mockScrollbackInputs.push(input);
		return mockScrollback;
	},
}));
jest.mock('@/lib/shell-controllers/session', () => ({
	createShellSessionMountKey: () => 'session',
	useShellSessionController: (input: Record<string, unknown>) => {
		mockSessionInputs.push(input);
		return {
			snapshot: { status: 'ready' },
			ports: {
				activity: mockActivityPort,
				hostCommands: mockHostCommands,
				terminalSource: mockTerminalSource,
				workmux: mockWorkmux,
			},
			identity: {
				transportKey: mockSessionMarkers.transportKey,
				targetKey: mockSessionMarkers.targetKey,
				generation: 1,
			},
			tmux: {
				enabled: mockSessionMarkers.tmuxEnabled,
				target: mockSessionMarkers.tmuxTarget,
			},
			storedConnectionId: mockSessionMarkers.storedConnectionId,
			invalidateShellTransport: jest.fn(),
		};
	},
}));
jest.mock('@/lib/shell-controllers/simple-modals', () => ({
	useShellSimpleModals: () => mockSimpleModals,
}));
jest.mock('@/lib/shell-controllers/skill-selector', () => ({
	useSkillSelectorController: () => mockSkillSelector,
}));
jest.mock('@/lib/shell-controllers/terminal', () => ({
	useShellTerminalController: (input: Record<string, unknown>) => {
		mockTerminalInputs.push(input);
		return mockTerminal;
	},
}));
jest.mock('@/lib/shell-controllers/wispr', () => ({
	useShellWisprController: () => mockWispr,
}));
jest.mock('@/lib/terminal-fit-runner', () => ({
	createManualTerminalFitRunner: () => ({
		run: jest.fn(),
		cancelCurrent: jest.fn(),
	}),
}));
jest.mock('@/lib/theme', () => ({
	useTheme: () => ({
		colors: {
			background: '#000',
			textPrimary: '#fff',
			textSecondary: '#aaa',
			primary: '#00f',
			overlay: '#000',
			surface: '#111',
			border: '#222',
		},
	}),
}));
jest.mock('@/lib/use-connection-debug-command', () => ({
	useConnectionDebugCommand: () => jest.fn(),
}));
jest.mock('@/lib/workmux-copy', () => ({
	getWorkmuxAttachErrorCopy: () => ({ title: '', body: '' }),
}));
jest.mock('@/app/shell/shell-route', () => ({
	parseShellRoute: () => ({
		status: 'valid',
		request: mockRouteRequest,
	}),
}));
jest.mock('@/app/shell/shell-touch-scroll', () => ({
	resolveShellTouchScrollPolicy: () => ({
		xtermScrollback: 1000,
		touchScrollConfig: {},
	}),
}));

jest.mock('@/app/shell/components/BrowserActionsModal', () => ({
	BrowserActionsModal: () => null,
}));
jest.mock('@/app/shell/components/CommandMenuModal', () => ({
	CommandMenuModal: (props: Record<string, unknown>) => {
		mockCommandMenuProps.push(props);
		return null;
	},
}));
jest.mock('@/app/shell/components/ConfigureModal', () => ({
	ConfigureModal: () => null,
}));
jest.mock('@/app/shell/components/DetectedOpenPickerModal', () => ({
	DetectedOpenPickerModal: (props: Record<string, unknown>) => {
		mockDetectedPickerProps.push(props);
		return null;
	},
}));
jest.mock('@/app/shell/components/FeatureRequestModal', () => ({
	FeatureRequestModal: () => null,
}));
jest.mock('@/app/shell/components/HostUrlModal', () => ({
	HostUrlModal: () => null,
}));
jest.mock('@/app/shell/components/ShellRouteErrorScreen', () => ({
	ShellRouteErrorScreen: () => null,
}));
jest.mock('@/app/shell/components/SkillSelectorModal', () => ({
	SkillSelectorModal: () => null,
}));
jest.mock('@/app/shell/components/TerminalCommanderModal', () => ({
	TerminalCommanderModal: () => null,
}));
jest.mock('@/app/shell/components/TerminalKeyboard', () => ({
	TerminalKeyboard: (props: Record<string, unknown>) => {
		mockTerminalKeyboardProps.push(props);
		return null;
	},
}));
jest.mock('@/app/shell/components/TextEntryModal', () => ({
	TextEntryModal: (props: Record<string, unknown>) => {
		mockTextEntryProps.push(props);
		return null;
	},
}));

beforeEach(() => {
	jest.useFakeTimers();
	mockEvents.length = 0;
	mockKeyboardInputs.length = 0;
	mockSessionInputs.length = 0;
	mockNotificationInputs.length = 0;
	mockBrowserInputs.length = 0;
	mockScrollbackInputs.length = 0;
	mockTerminalInputs.length = 0;
	mockXtermProps.length = 0;
	mockTerminalKeyboardProps.length = 0;
	mockCommandMenuProps.length = 0;
	mockDetectedPickerProps.length = 0;
	mockTextEntryProps.length = 0;
	mockMenuOpen = false;
	mockRouteRequest = initialRouteRequest;
	mockSessionMarkers = initialSessionMarkers;
});

afterEach(() => {
	jest.useRealTimers();
});

test('ShellDetail supplies modal commands with exact ordering and real destinations', async () => {
	const TabsShellDetail = (
		jest.requireActual('@/app/shell/detail') as {
			default: React.ComponentType;
		}
	).default;
	const screen = render(<TabsShellDetail />);
	await act(async () => {
		jest.runAllTimers();
		await Promise.resolve();
	});
	const commands = mockKeyboardInputs.at(-1)?.modalCommands;
	expect(commands).toBeDefined();
	if (!commands) return;

	act(() => commands.toggleCommandMenu());
	expect(mockEvents.splice(0)).toEqual([
		'invalidate-browser',
		'close-commander',
		'close-browser',
		'close-skill',
		'close-wispr',
		'open-menu',
	]);
	act(() => commands.toggleCommandMenu());
	expect(mockEvents.splice(0)).toEqual([
		'invalidate-browser',
		'close-commander',
		'close-browser',
		'close-skill',
		'close-wispr',
		'close-menu',
	]);

	act(() => commands.openCommander());
	expect(mockEvents.splice(0)).toEqual([
		'invalidate-browser',
		'close-menu',
		'close-browser',
		'close-skill',
		'close-wispr',
		'open-commander',
	]);

	act(() => {
		commands.openSkillSelector();
		commands.openBrowserActions();
		commands.openFeatureRequest();
		commands.openWisprTextEditor();
	});
	expect(mockEvents.splice(0)).toEqual([
		'open-skill',
		'open-browser',
		'open-feature',
		'open-wispr',
	]);

	act(() => commands.openConfigurator());
	expect(mockEvents.splice(0)).toEqual([
		'invalidate-browser',
		'close-skill',
		'close-browser',
		'open-config',
	]);
	act(() => commands.closeCommandMenu());
	expect(mockEvents.splice(0)).toEqual(['close-menu']);

	screen.unmount();
});

test('ShellDetail composes real controller ports into the screen view', async () => {
	const TabsShellDetail = (
		jest.requireActual('@/app/shell/detail') as {
			default: React.ComponentType;
		}
	).default;
	const screen = render(<TabsShellDetail />);
	await act(async () => {
		jest.runAllTimers();
		await Promise.resolve();
	});

	expect(mockSessionInputs.at(-1)?.activity).toBe(mockActivityController);
	expect(mockTerminalInputs.at(-1)?.source).toBe(mockTerminalSource);
	expect(mockBrowserInputs.at(-1)).toMatchObject({
		hostCommands: mockHostCommands,
		workmux: mockWorkmux,
	});
	expect(mockNotificationInputs.at(-1)).toMatchObject({
		activity: mockActivityPort,
		commandPortKey: mockWorkmux,
		context: {
			transportKey: 'transport-v1',
			targetKey: 'target-v1',
			storedConnectionId: 'stored-v1',
			channelId: 101,
			tmuxEnabled: true,
			tmuxTarget: 'tmux-v1',
		},
		route: {
			agentConnectionId: 'agent-connection-v1',
			agentSession: 'agent-session-v1',
			agentWindowId: 'agent-window-v1',
			agentEventId: 'agent-event-v1',
			agentTapToken: 'agent-token-v1',
		},
		workmux: mockWorkmux,
	});
	const scrollbackContext = mockScrollbackInputs.at(-1)?.context as
		| Record<string, unknown>
		| undefined;
	expect(mockScrollbackInputs.at(-1)?.runtimeInstanceId).toBe(null);
	expect(scrollbackContext).toMatchObject({
		activity: mockActivityPort,
		workmux: mockWorkmux,
		terminalTransport: mockTerminal.transport,
		terminalView: mockTerminal.view,
	});
	expect(mockKeyboardInputs.at(-1)).toMatchObject({
		activity: mockActivityPort,
		scrollbackInput: mockScrollback.input,
		terminalView: mockTerminal.view,
		remoteTarget: {
			targetKey: 'target-v1',
			tmuxEnabled: true,
			sessionName: 'tmux-v1',
			connectionId: 'connection-v1',
			channelId: 101,
			workmux: mockWorkmux,
			hostCommands: mockHostCommands,
		},
	});
	expect(mockXtermProps.at(-1)).toMatchObject({
		onResize: mockTerminal.onResize,
		onSelection: mockKeyboardHandle.onSelectionChanged,
		onSelectionModeChange: mockKeyboardHandle.onSelectionModeChange,
		onInitialized: mockTerminal.onInitialized,
		onInput: mockKeyboardHandle.onWebViewInput,
		onScrollbackModeChange: mockScrollback.xtermProps.onScrollbackModeChange,
		xtermOptions: { scrollback: 1000 },
	});
	expect(mockTerminalKeyboardProps.at(-1)).toMatchObject({
		marker: 'terminal-keyboard',
	});
	expect(mockCommandMenuProps.at(-1)).toMatchObject({
		open: false,
		marker: 'command-menu',
	});
	expect(mockDetectedPickerProps.at(-1)).toMatchObject(
		mockBrowserActions.detectedOpenPickerProps,
	);
	expect(mockTextEntryProps.at(-1)).toMatchObject({
		open: false,
		onClose: mockWispr.textEntryProps.onClose,
	});

	mockRouteRequest = nextRouteRequest;
	mockSessionMarkers = nextSessionMarkers;
	screen.rerender(<TabsShellDetail />);
	await act(async () => {
		await Promise.resolve();
	});
	expect(mockNotificationInputs.at(-1)).toMatchObject({
		activity: mockActivityPort,
		commandPortKey: mockWorkmux,
		context: {
			transportKey: 'transport-v2',
			targetKey: 'target-v2',
			storedConnectionId: 'stored-v2',
			channelId: 202,
			tmuxEnabled: false,
			tmuxTarget: 'tmux-v2',
		},
		route: {
			agentConnectionId: 'agent-connection-v2',
			agentSession: 'agent-session-v2',
			agentWindowId: 'agent-window-v2',
			agentEventId: 'agent-event-v2',
			agentTapToken: 'agent-token-v2',
		},
		workmux: mockWorkmux,
	});

	screen.unmount();
});
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
