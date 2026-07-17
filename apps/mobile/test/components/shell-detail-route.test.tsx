import { expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import TabsShellDetail from '@/app/shell/detail';

const mockBack = jest.fn();
const mockUseShellActivityController = jest.fn();

jest.mock('@fressh/react-native-xtermjs-webview', () => ({
	XtermJsWebView: () => null,
}));

jest.mock('@fressh/react-native-uniffi-russh', () => ({}));

jest.mock('@/lib/auto-connect', () => ({
	useAutoConnectStore: jest.fn(),
}));

jest.mock('@/lib/secrets-manager', () => ({
	secretsManager: {},
}));

jest.mock('@/lib/ssh-store', () => ({
	useSshStore: jest.fn(),
}));

/* eslint-disable @typescript-eslint/consistent-type-imports, no-undef -- The
 * factory must keep its React type local because Jest hoists mock factories. */
jest.mock('expo-router', () => {
	const React = jest.requireActual('react') as typeof import('react');
	return {
		Stack: { Screen: () => null },
		useFocusEffect: (callback: React.EffectCallback) => {
			React.useEffect(callback, [callback]);
		},
		// eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- Matches the expo-router hook API.
		useLocalSearchParams: () => ({
			connectionId: 'connection-1',
			channelId: ['1', '2'],
		}),
		// eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- Matches the expo-router hook API.
		useRouter: () => ({ back: mockBack }),
	};
});
/* eslint-enable @typescript-eslint/consistent-type-imports, no-undef */

jest.mock('@/lib/shell-controllers/activity', () => ({
	useShellActivityController: mockUseShellActivityController,
}));

jest.mock('@/lib/theme', () => {
	const actual = jest.requireActual('@/lib/theme') as {
		darkTheme: { colors: Record<string, string> };
	};
	return { ...actual, useTheme: jest.fn(() => actual.darkTheme) };
});

test('repeated route parameters recover without mounting valid shell hooks', () => {
	jest.useFakeTimers();
	render(<TabsShellDetail />);
	act(() => {
		jest.runOnlyPendingTimers();
	});

	expect(screen.getByText('Shell link unavailable')).toBeOnTheScreen();
	fireEvent.press(screen.getByRole('button', { name: 'Back' }));
	expect(mockBack).toHaveBeenCalledTimes(1);
	expect(mockUseShellActivityController).not.toHaveBeenCalled();
	jest.useRealTimers();
});
