/* eslint-disable @typescript-eslint/consistent-type-imports, @eslint-react/hooks-extra/no-unnecessary-use-prefix -- Hoisted Jest factories keep native dependencies local while implementing their public APIs. */
import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import {
	HerdrTerminalView,
	type HerdrTerminalViewProps,
} from '@/app/herdr/HerdrTerminalView';
import { type HerdrAgent } from '@/lib/herdr/contracts';
import { type HerdrTerminalState } from '@/lib/herdr/terminal-owner';

let mockXtermProps: {
	webViewOptions?: {
		onError?: (...args: unknown[]) => void;
		onRenderProcessGone?: (...args: unknown[]) => void;
		onContentProcessDidTerminate?: (...args: unknown[]) => void;
	};
	logger?: {
		log?: (...args: unknown[]) => void;
		warn?: (...args: unknown[]) => void;
		error?: (...args: unknown[]) => void;
	};
} | null = null;

jest.mock('@fressh/react-native-xtermjs-webview', () => {
	const { View } = jest.requireActual(
		'react-native',
	) as typeof import('react-native');
	return {
		XtermJsWebView: (props: typeof mockXtermProps) => {
			mockXtermProps = props;
			return <View testID="herdr-xterm" />;
		},
	};
});

jest.mock('expo-router', () => ({
	Stack: { Screen: () => null },
}));

jest.mock('react-native-safe-area-context', () => ({
	useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/app/shell/components/TerminalKeyboard', () => {
	const { View } = jest.requireActual(
		'react-native',
	) as typeof import('react-native');
	return { TerminalKeyboard: () => <View testID="herdr-keyboard" /> };
});

jest.mock('@/lib/theme', () => {
	const actual = jest.requireActual('@/lib/theme') as {
		darkTheme: { colors: Record<string, string> };
	};
	return { ...actual, useTheme: jest.fn(() => actual.darkTheme) };
});

const AGENT: HerdrAgent = {
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
};

function renderState(
	state: HerdrTerminalViewProps['state'],
	overrides: Partial<HerdrTerminalViewProps> = {},
) {
	const props: HerdrTerminalViewProps = {
		agent: AGENT,
		state,
		rendererGeneration: 0,
		xtermRef: { current: null },
		keyboardProps: {
			keyboard: null,
			modifierKeysActive: [],
			onSlotPress: jest.fn(),
			selectionModeEnabled: false,
			onCopySelection: jest.fn(),
		},
		onLoadStart: jest.fn(),
		onRendererFailure: jest.fn(),
		onInitialized: jest.fn(),
		onInput: jest.fn(),
		onResize: jest.fn(),
		onScrollbackBatch: jest.fn(),
		onSelectionModeChange: jest.fn(),
		onTakeOver: jest.fn(),
		onRetry: jest.fn(),
		onBack: jest.fn(),
		...overrides,
	};
	return { ...render(<HerdrTerminalView {...props} />), props };
}

test.each<{
	state: HerdrTerminalViewProps['state'];
	label: string | null;
}>([
	{ state: { phase: 'starting', generation: 1 }, label: 'Starting terminal…' },
	{ state: { phase: 'active', generation: 1 }, label: null },
	{
		state: { phase: 'releasing', generation: 1 },
		label: 'Releasing terminal…',
	},
	{ state: { phase: 'reconnecting' }, label: 'Reconnecting terminal…' },
	{
		state: { phase: 'backgrounded', generation: 1 },
		label: 'Terminal paused in background.',
	},
])(
	'renders $state.phase with xterm and the full keyboard mounted',
	({ state, label }) => {
		renderState(state);
		expect(screen.getByText('Codex')).toBeOnTheScreen();
		expect(screen.getByText('Fressh / Agents')).toBeOnTheScreen();
		expect(screen.getByTestId('herdr-xterm')).toBeOnTheScreen();
		expect(screen.getByTestId('herdr-keyboard')).toBeOnTheScreen();
		if (label) expect(screen.getByText(label)).toBeOnTheScreen();
	},
);

test('only owned elsewhere exposes explicit takeover and routes it separately', () => {
	const onTakeOver = jest.fn();
	const onRetry = jest.fn();
	renderState(
		{
			phase: 'owned-elsewhere',
			generation: 2,
			reason: 'Another controller owns this terminal.',
		},
		{ onTakeOver, onRetry },
	);

	expect(
		screen.getByText('Another controller owns this terminal.'),
	).toBeOnTheScreen();
	fireEvent.press(screen.getByRole('button', { name: 'Take Over' }));
	expect(onTakeOver).toHaveBeenCalledTimes(1);
	expect(onRetry).not.toHaveBeenCalled();
	expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeOnTheScreen();
	expect(screen.getByTestId('herdr-keyboard')).toBeOnTheScreen();
});

test('does not provide the raw general xterm bridge logger', () => {
	renderState({ phase: 'active', generation: 1 });

	expect(mockXtermProps?.logger?.log).toBeUndefined();
	expect(mockXtermProps?.logger?.warn).toBeDefined();
	expect(mockXtermProps?.logger?.error).toBeDefined();
});

test('reports every native WebView renderer failure through one bounded callback', () => {
	const onRendererFailure = jest.fn();
	renderState({ phase: 'active', generation: 1 }, { onRendererFailure });

	mockXtermProps?.webViewOptions?.onError?.({
		nativeEvent: { description: 'raw terminal document diagnostic' },
	});
	mockXtermProps?.webViewOptions?.onRenderProcessGone?.({
		nativeEvent: { didCrash: true },
	});
	mockXtermProps?.webViewOptions?.onContentProcessDidTerminate?.({
		nativeEvent: { secret: 'raw terminal document diagnostic' },
	});

	expect(onRendererFailure).toHaveBeenCalledTimes(3);
	expect(onRendererFailure.mock.calls).toEqual([[], [], []]);
});

test.each<HerdrTerminalState & { phase: 'error' }>([
	{
		phase: 'error',
		generation: 3,
		kind: 'synchronization',
		reason: 'Output lost synchronization.',
	},
	{
		phase: 'error',
		generation: 3,
		kind: 'timeout',
		reason: 'Initial frame timed out.',
	},
	{
		phase: 'error',
		generation: 3,
		kind: 'closed',
		reason: 'Terminal closed.',
	},
	{
		phase: 'error',
		generation: 3,
		kind: 'transport',
		reason: 'SSH transport failed.',
	},
])('error $kind offers non-takeover Retry and Back', (state) => {
	const onRetry = jest.fn();
	const onBack = jest.fn();
	const onTakeOver = jest.fn();
	renderState(state, { onRetry, onBack, onTakeOver });

	expect(screen.getByText(state.reason)).toBeOnTheScreen();
	fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
	fireEvent.press(screen.getByRole('button', { name: 'Back' }));
	expect(onRetry).toHaveBeenCalledTimes(1);
	expect(onBack).toHaveBeenCalledTimes(1);
	expect(onTakeOver).not.toHaveBeenCalled();
	expect(
		screen.queryByRole('button', { name: 'Take Over' }),
	).not.toBeOnTheScreen();
	expect(screen.getByTestId('herdr-keyboard')).toBeOnTheScreen();
});

/* eslint-enable @typescript-eslint/consistent-type-imports, @eslint-react/hooks-extra/no-unnecessary-use-prefix */
