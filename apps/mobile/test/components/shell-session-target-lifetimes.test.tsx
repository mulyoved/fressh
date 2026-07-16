import { expect, jest, test } from '@jest/globals';
import { act } from '@testing-library/react-native';
import { createShellTmuxResolutionOwner } from '@/lib/shell-controllers/session-tmux-resolution';
import { createShellTransportOwner } from '@/lib/shell-controllers/session-transport-owner';
import { createShellTransportKey } from '@/lib/shell-controllers/source-keys';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

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

	owner.update(secondShell as never);

	expect(first.port.isAvailable()).toBe(false);
	await expect(first.port.sendData(new Uint8Array([1]))).rejects.toThrow(
		'Shell terminal source superseded.',
	);
	expect(firstShell.sendData).not.toHaveBeenCalled();
});
