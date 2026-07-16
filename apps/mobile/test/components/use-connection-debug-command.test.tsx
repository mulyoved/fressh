import { beforeEach, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { runConnectionDebugCommand } from '@/lib/connection-debug-command';
import { useConnectionDebugCommand } from '@/lib/use-connection-debug-command';

jest.mock('@fressh/react-native-uniffi-russh', () => ({
	RnRussh: { connect: jest.fn() },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/lib/auto-connect', () => ({
	useAutoConnectStore: {
		getState: () => ({ isAutoConnecting: false, isReconnecting: false }),
	},
}));
jest.mock('@/lib/connection-debug-command', () => ({
	runConnectionDebugCommand: jest.fn(),
}));
jest.mock('@/lib/connection-diagnostic-recorder', () => ({
	connectionDiagnosticRecorder: {},
}));
jest.mock('@/lib/connection-utils', () => ({
	pickLatestConnection: jest.fn(),
}));
jest.mock('@/lib/diagnostic-shell-probe', () => ({
	runDiagnosticShellProbe: jest.fn(),
}));
jest.mock('@/lib/logger', () => ({
	rootLogger: { extend: () => ({}) },
}));
jest.mock('@/lib/secrets-manager', () => ({
	secretsManager: {
		connections: { query: { list: {} } },
		keys: { utils: { getPrivateKey: jest.fn() } },
	},
}));
jest.mock('@/lib/tailscale-recovery', () => ({ tailscaleRecovery: {} }));
jest.mock('@/lib/utils', () => ({
	queryClient: { fetchQuery: jest.fn() },
}));

const mockRunConnectionDebugCommand = jest.mocked(runConnectionDebugCommand);

beforeEach(() => {
	mockRunConnectionDebugCommand.mockReset();
	mockRunConnectionDebugCommand.mockResolvedValue({
		diagnostic: {} as never,
		delivery: {} as never,
	});
});

test('clipboard-only delivery disables terminal paste without a host callback', async () => {
	const closeMenu = jest.fn();
	const rendered = renderHook(() =>
		useConnectionDebugCommand({
			appActive: true,
			closeMenu,
			delivery: { type: 'clipboard-only' },
		}),
	);

	await act(async () => rendered.result.current());

	expect(mockRunConnectionDebugCommand).toHaveBeenCalledTimes(1);
	const input = mockRunConnectionDebugCommand.mock.calls[0]![0];
	expect(input.delivery).toEqual({ type: 'clipboard-only' });
	expect(input).not.toHaveProperty('pasteIntoTerminal');
});

test('terminal delivery forwards the exact paste command', async () => {
	const paste = jest.fn();
	const rendered = renderHook(() =>
		useConnectionDebugCommand({
			appActive: true,
			closeMenu: jest.fn(),
			delivery: { type: 'terminal', paste },
		}),
	);

	await act(async () => rendered.result.current());

	const input = mockRunConnectionDebugCommand.mock.calls[0]![0];
	expect(input.delivery).toEqual({ type: 'terminal', paste });
	expect(input).not.toHaveProperty('allowTerminalPaste');
});
