import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, jest, test } from '@jest/globals';
import { act } from '@testing-library/react-native';
import { deriveShellSessionSource } from '@/lib/shell-controllers/session-source';
import { createShellHostCommandPort } from '@/lib/shell-controllers/session-target-owner';
import { createShellTmuxResolutionOwner } from '@/lib/shell-controllers/session-tmux-resolution';
import { createShellTransportOwner } from '@/lib/shell-controllers/session-transport-owner';
import { createShellTransportKey } from '@/lib/shell-controllers/source-keys';

test('production session composes the focused lifetime owners as sole paths', () => {
	const source = readFileSync(
		join(process.cwd(), 'src/lib/shell-controllers/session.tsx'),
		'utf8',
	);
	for (const owner of [
		'deriveShellSessionSource',
		'createShellTargetOwner',
		'createShellTmuxResolutionOwner',
		'createShellTransportOwner',
	]) {
		expect(source).toContain(owner);
	}
	for (const displaced of [
		'createShellTerminalSourcePort',
		'createShellSessionWorkmuxOwner',
		'executeSideChannelCommand',
		'tmuxQueryGenerationRef',
	]) {
		expect(source).not.toContain(displaced);
	}
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

test('session source derivation preserves recovery and reconnect inputs', () => {
	expect(
		deriveShellSessionSource({
			connectionPresent: true,
			shellPresent: false,
			isAutoConnecting: false,
			isReconnecting: true,
			lastReconnectDestination: 'terminal',
			storedConnectionId: 'saved',
		}),
	).toEqual({
		connectionPresent: true,
		shellPresent: false,
		isAutoConnecting: false,
		isReconnecting: true,
		lastReconnectOutcome: { status: 'failed', destination: 'terminal' },
		storedConnectionId: 'saved',
	});
});

test.each([
	[{ success: false, output: 'remote output' }, 'remote output', undefined],
	[
		{ success: false, output: 'remote output', error: 'remote error' },
		'remote error',
		undefined,
	],
	[{ success: false, output: '' }, 'Host command failed.', 'no-detail'],
])(
	'host command owner preserves canonical failure details %#',
	async (result, message, reason) => {
		const port = createShellHostCommandPort({
			connection: {} as never,
			generation: 1,
			getGeneration: () => 1,
			key: 'target' as never,
			execute: jest.fn(async () => result),
		});
		await expect(port.run('status', 1000)).resolves.toEqual({
			status: 'failed',
			failure: { message, ...(reason ? { reason } : {}) },
			output: result.output,
		});
	},
);

test('tmux resolution ignores completions from replaced targets', async () => {
	const first = deferred<{
		useTmux: boolean;
		tmuxSessionName: string;
	} | null>();
	const second = deferred<{
		useTmux: boolean;
		tmuxSessionName: string;
	} | null>();
	const load = jest
		.fn<
			(
				id: string,
			) => Promise<{ useTmux: boolean; tmuxSessionName: string } | null>
		>()
		.mockReturnValueOnce(first.promise)
		.mockReturnValueOnce(second.promise);
	const owner = createShellTmuxResolutionOwner({
		initialTarget: 'main',
		load,
		warn: jest.fn(),
	});

	owner.resolve('first');
	owner.resolve('second');
	await act(async () =>
		second.resolve({ useTmux: true, tmuxSessionName: 'beta' }),
	);
	await act(async () =>
		first.resolve({ useTmux: true, tmuxSessionName: 'stale' }),
	);

	expect(owner.getSnapshot()).toEqual({ enabled: true, target: 'beta' });
});

test('terminal transport capabilities are generation-bound after replacement', async () => {
	const firstShell = {
		bufferStats: jest.fn(() => ({
			ringBytesCount: 10n,
			usedBytes: 8n,
			headSeq: 3n,
			tailSeq: 7n,
			droppedBytesTotal: 2n,
			chunksCount: 4n,
		})),
		currentSeq: jest.fn(() => 9n),
		readBuffer: jest.fn(),
		addListener: jest.fn(),
		removeListener: jest.fn(),
		sendData: jest.fn(async () => undefined),
		resizePty: jest.fn(async () => undefined),
	};
	const secondShell = {
		...firstShell,
		sendData: jest.fn(async () => undefined),
	};
	const owner = createShellTransportOwner({
		channelId: 7,
		connectionId: 'connection-1',
		key: createShellTransportKey('connection-1', 7),
		shell: firstShell as never,
	});
	const first = owner.getPublication();
	expect(first.port.getNativeOutputDiagnostics()).toEqual({
		currentSeq: '9',
		ringBytesCount: '10',
		usedBytes: '8',
		headSeq: '3',
		tailSeq: '7',
		droppedBytesTotal: '2',
		chunksCount: '4',
	});

	owner.update(secondShell as never);

	expect(first.port.isAvailable()).toBe(false);
	expect(first.port.getNativeOutputDiagnostics()).toBeNull();
	await expect(first.port.sendData(new Uint8Array([1]))).rejects.toThrow(
		'Shell terminal source superseded.',
	);
	expect(firstShell.sendData).not.toHaveBeenCalled();
});
