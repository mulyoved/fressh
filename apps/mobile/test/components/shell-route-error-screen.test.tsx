import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ShellRouteErrorScreen } from '@/app/shell/components/ShellRouteErrorScreen';

jest.mock('@/lib/theme', () => {
	const actual = jest.requireActual('@/lib/theme') as {
		darkTheme: { colors: Record<string, string> };
	};
	return { ...actual, useTheme: jest.fn(() => actual.darkTheme) };
});

test('renders the typed route error and invokes Back once', () => {
	const onBack = jest.fn();
	render(
		<ShellRouteErrorScreen
			error={{
				code: 'invalid-channel-id',
				message: 'This shell link has an invalid channel.',
			}}
			onBack={onBack}
		/>,
	);
	fireEvent.press(screen.getByRole('button', { name: 'Back' }));
	expect(screen.getByText('Shell link unavailable')).toBeOnTheScreen();
	expect(onBack).toHaveBeenCalledTimes(1);
});
