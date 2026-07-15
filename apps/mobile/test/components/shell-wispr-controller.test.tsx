import { beforeEach, expect, jest, test } from '@jest/globals';
import { act, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Platform } from 'react-native';
import { createShellModalArbiter } from '../../src/lib/shell-controllers/modal-arbiter';
import { type ShellActivityPort } from '../../src/lib/shell-controllers/session-contracts';
import {
	type ShellSimpleModalsHandle,
	useShellSimpleModals,
} from '../../src/lib/shell-controllers/simple-modals';
import {
	type ShellWisprControllerHandle,
	useShellWisprController,
} from '../../src/lib/shell-controllers/wispr';
import { wisprAutomationNative } from '../../src/lib/wispr-automation-native';

type ActivityHarness = ShellActivityPort & {
	publish(input: {
		focused: boolean;
		appActive: boolean;
		generation: number;
	}): void;
};

type HarnessHandle = {
	wispr: ShellWisprControllerHandle;
	modals: ShellSimpleModalsHandle;
};

const logger = {
	info: jest.fn(),
	warn: jest.fn(),
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return { promise, resolve, reject };
}

function createActivity(): ActivityHarness {
	let snapshot = {
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 0,
	};
	const listeners = new Set<() => void>();
	return {
		getSnapshot: () => snapshot,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		publish: ({ focused, appActive, generation }) => {
			snapshot = {
				focused,
				appState: appActive ? 'active' : 'background',
				appActive,
				interactive: focused && appActive,
				generation,
			};
			for (const listener of [...listeners]) listener();
		},
	};
}

function WisprHarness({
	activity,
	onHandle,
	onTextEntryOpen,
	sessionGeneration,
}: {
	activity: ShellActivityPort;
	onHandle(handle: HarnessHandle): void;
	onTextEntryOpen?(): void;
	sessionGeneration: number;
}) {
	const [arbiter] = React.useState(createShellModalArbiter);
	const modals = useShellSimpleModals(arbiter);
	const wispr = useShellWisprController({
		activity,
		logger,
		sessionGeneration,
		textEntryModal: {
			isOpen: () => modals.getSnapshot().textEntry,
			open: () => {
				onTextEntryOpen?.();
				return modals.textEntry.onOpen();
			},
			close: modals.textEntry.onClose,
		},
	});
	React.useLayoutEffect(
		() => onHandle({ wispr, modals }),
		[modals, onHandle, wispr],
	);
	return null;
}

function WorktreeConflictHarness({
	onHandle,
}: {
	onHandle(handle: ShellSimpleModalsHandle): void;
}) {
	const [arbiter] = React.useState(createShellModalArbiter);
	const modals = useShellSimpleModals(arbiter);
	React.useEffect(
		() => arbiter.register('worktree-workspace', () => false),
		[arbiter],
	);
	React.useLayoutEffect(() => onHandle(modals), [modals, onHandle]);
	return null;
}

beforeEach(() => {
	Object.defineProperty(Platform, 'OS', {
		configurable: true,
		value: 'android',
	});
	logger.info.mockClear();
	logger.warn.mockClear();
	jest.spyOn(wisprAutomationNative, 'getStatus').mockReset();
	jest.spyOn(wisprAutomationNative, 'tapWisprControl').mockReset();
	jest.spyOn(wisprAutomationNative, 'tapScreen').mockReset();
	jest.spyOn(wisprAutomationNative, 'openAccessibilitySettings').mockReset();
});

test('text entry respects a worktree workspace refusal', () => {
	const onHandle = jest.fn<(handle: ShellSimpleModalsHandle) => void>();
	render(<WorktreeConflictHarness onHandle={onHandle} />);
	const latest = () => onHandle.mock.calls.at(-1)![0];
	let accepted: boolean | undefined;
	act(() => {
		accepted = latest().textEntry.onOpen();
	});
	expect(accepted).toBe(false);
	expect(latest().getSnapshot().textEntry).toBe(false);
});

test('one committed hook owns modal publication and native Wispr commands across rerenders', async () => {
	const activity = createActivity();
	const onHandle = jest.fn<(handle: HarnessHandle) => void>();
	jest.spyOn(wisprAutomationNative, 'getStatus').mockResolvedValue({
		serviceEnabled: true,
		serviceConnected: true,
		wisprPackage: 'com.wisprflow.android',
	});
	const screen = render(
		<WisprHarness
			activity={activity}
			onHandle={onHandle}
			sessionGeneration={1}
		/>,
	);
	const latest = () => onHandle.mock.calls.at(-1)![0];

	act(() => latest().modals.commandMenu.onOpen());
	expect(latest().modals.getSnapshot().commandMenu).toBe(true);
	act(() => latest().wispr.openTextEditor());
	await waitFor(() => expect(latest().modals.textEntry.open).toBe(true));
	expect(latest().modals.getSnapshot().textEntry).toBe(true);
	expect(latest().modals.getSnapshot().commandMenu).toBe(false);
	expect(wisprAutomationNative.getStatus).toHaveBeenCalledTimes(1);

	act(() => latest().wispr.textEntryProps.onWisprAutoStartChange(true));
	expect(latest().wispr.snapshot.automation.phase).toBe('openingTextEntry');
	screen.rerender(
		<WisprHarness
			activity={activity}
			onHandle={onHandle}
			sessionGeneration={1}
		/>,
	);
	expect(latest().wispr.snapshot.autoStartEnabled).toBe(true);
	expect(wisprAutomationNative.getStatus).toHaveBeenCalledTimes(1);

	act(() => latest().wispr.textEntryProps.onClose());
	expect(latest().modals.getSnapshot().textEntry).toBe(false);
	await act(async () => {
		screen.unmount();
		await Promise.resolve();
	});
});

test('open text editor remains stable across snapshot publication and stays usable', async () => {
	const activity = createActivity();
	const onHandle = jest.fn<(handle: HarnessHandle) => void>();
	jest.spyOn(wisprAutomationNative, 'getStatus').mockResolvedValue({
		serviceEnabled: true,
		serviceConnected: true,
		wisprPackage: 'com.wisprflow.android',
	});
	const screen = render(
		<WisprHarness
			activity={activity}
			onHandle={onHandle}
			sessionGeneration={1}
		/>,
	);
	const latest = () => onHandle.mock.calls.at(-1)![0];
	const openTextEditor = latest().wispr.openTextEditor;

	act(() => latest().wispr.textEntryProps.onWisprAutoStartChange(true));
	expect(latest().wispr.snapshot.autoStartEnabled).toBe(true);
	expect(latest().wispr.openTextEditor).toBe(openTextEditor);

	act(() => openTextEditor());
	await waitFor(() => expect(latest().modals.textEntry.open).toBe(true));
	expect(wisprAutomationNative.getStatus).toHaveBeenCalledTimes(1);

	await act(async () => {
		screen.unmount();
		await Promise.resolve();
	});
});

test('committed session and activity generations supersede pending native status', async () => {
	const activity = createActivity();
	const onHandle = jest.fn<(handle: HarnessHandle) => void>();
	const firstStatus = deferred<{
		serviceEnabled: boolean;
		serviceConnected: boolean;
		wisprPackage: string;
	}>();
	const secondStatus = deferred<{
		serviceEnabled: boolean;
		serviceConnected: boolean;
		wisprPackage: string;
	}>();
	jest
		.spyOn(wisprAutomationNative, 'getStatus')
		.mockReturnValueOnce(firstStatus.promise)
		.mockReturnValueOnce(secondStatus.promise);
	const screen = render(
		<WisprHarness
			activity={activity}
			onHandle={onHandle}
			sessionGeneration={1}
		/>,
	);
	const latest = () => onHandle.mock.calls.at(-1)![0];

	act(() => latest().wispr.openTextEditor());
	screen.rerender(
		<WisprHarness
			activity={activity}
			onHandle={onHandle}
			sessionGeneration={2}
		/>,
	);
	await act(async () => {
		firstStatus.resolve({
			serviceEnabled: true,
			serviceConnected: true,
			wisprPackage: 'com.wisprflow.android',
		});
		await firstStatus.promise;
	});
	expect(latest().modals.getSnapshot().textEntry).toBe(false);

	act(() => latest().wispr.openTextEditor());
	act(() =>
		activity.publish({ focused: false, appActive: true, generation: 1 }),
	);
	await act(async () => {
		secondStatus.resolve({
			serviceEnabled: true,
			serviceConnected: true,
			wisprPackage: 'com.wisprflow.android',
		});
		await secondStatus.promise;
	});
	expect(latest().modals.getSnapshot().textEntry).toBe(false);
	await act(async () => {
		screen.unmount();
		await Promise.resolve();
	});
});

test('same-turn status resolution cannot open text entry after unmount', async () => {
	const activity = createActivity();
	const onHandle = jest.fn<(handle: HarnessHandle) => void>();
	const onTextEntryOpen = jest.fn();
	const status = deferred<{
		serviceEnabled: boolean;
		serviceConnected: boolean;
		wisprPackage: string;
	}>();
	jest
		.spyOn(wisprAutomationNative, 'getStatus')
		.mockReturnValue(status.promise);
	const screen = render(
		<WisprHarness
			activity={activity}
			onHandle={onHandle}
			onTextEntryOpen={onTextEntryOpen}
			sessionGeneration={1}
		/>,
	);
	const latest = () => onHandle.mock.calls.at(-1)![0];

	act(() => latest().wispr.openTextEditor());
	status.resolve({
		serviceEnabled: true,
		serviceConnected: true,
		wisprPackage: 'com.wisprflow.android',
	});
	screen.unmount();
	await act(async () => {
		await Promise.resolve();
	});

	expect(onTextEntryOpen).not.toHaveBeenCalled();
});

test('same-turn screen-prime resolution cannot start a native tap after unmount', async () => {
	const activity = createActivity();
	const onHandle = jest.fn<(handle: HarnessHandle) => void>();
	const screenPrime = deferred<string>();
	jest.spyOn(wisprAutomationNative, 'getStatus').mockResolvedValue({
		serviceEnabled: true,
		serviceConnected: true,
		wisprPackage: 'com.wisprflow.android',
	});
	jest
		.spyOn(wisprAutomationNative, 'tapScreen')
		.mockReturnValue(screenPrime.promise);
	jest
		.spyOn(wisprAutomationNative, 'tapWisprControl')
		.mockResolvedValue('tapped');
	const deferredCleanup: VoidFunction[] = [];
	const scheduleMicrotask = global.queueMicrotask;
	let holdCleanup = false;
	const queueMicrotaskSpy = jest
		.spyOn(global, 'queueMicrotask')
		.mockImplementation((task) => {
			if (holdCleanup) deferredCleanup.push(task);
			else scheduleMicrotask(task);
		});
	const screen = render(
		<WisprHarness
			activity={activity}
			onHandle={onHandle}
			sessionGeneration={1}
		/>,
	);
	const latest = () => onHandle.mock.calls.at(-1)![0];

	act(() => latest().wispr.textEntryProps.onWisprAutoStartChange(true));
	act(() => latest().wispr.openTextEditor());
	await waitFor(() =>
		expect(latest().wispr.snapshot.automation.phase).toBe('openingTextEntry'),
	);
	act(() =>
		latest().wispr.textEntryProps.onWisprFocus('', {
			x: 1,
			y: 2,
			width: 100,
			height: 40,
		}),
	);
	expect(wisprAutomationNative.tapScreen).toHaveBeenCalledTimes(1);

	holdCleanup = true;
	screenPrime.resolve('primed');
	screen.unmount();
	holdCleanup = false;
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});

	const postUnmountTapCalls = jest.mocked(wisprAutomationNative.tapWisprControl)
		.mock.calls.length;
	for (const cleanup of deferredCleanup) cleanup();
	queueMicrotaskSpy.mockRestore();
	await act(async () => {
		await Promise.resolve();
	});
	expect(postUnmountTapCalls).toBe(0);
});

test('Strict Mode effect replay keeps the committed owner live and unmount cleanup balanced', async () => {
	const activity = createActivity();
	const onHandle = jest.fn<(handle: HarnessHandle) => void>();
	jest.spyOn(wisprAutomationNative, 'getStatus').mockResolvedValue({
		serviceEnabled: true,
		serviceConnected: true,
		wisprPackage: 'com.wisprflow.android',
	});
	jest
		.spyOn(wisprAutomationNative, 'tapWisprControl')
		.mockResolvedValue('tapped');
	const screen = render(
		<React.StrictMode>
			<WisprHarness
				activity={activity}
				onHandle={onHandle}
				sessionGeneration={1}
			/>
		</React.StrictMode>,
	);
	const latest = () => onHandle.mock.calls.at(-1)![0];

	act(() => latest().wispr.textEntryProps.onWisprAutoStartChange(true));
	act(() => latest().wispr.openTextEditor());
	await waitFor(() =>
		expect(latest().wispr.snapshot.automation.phase).toBe('openingTextEntry'),
	);
	act(() => latest().wispr.textEntryProps.onWisprFocus(''));
	await waitFor(() =>
		expect(latest().wispr.snapshot.automation.phase).toBe('recording'),
	);
	expect(wisprAutomationNative.tapWisprControl).toHaveBeenCalledTimes(1);

	await act(async () => {
		screen.unmount();
		await Promise.resolve();
		await Promise.resolve();
	});
	expect(wisprAutomationNative.tapWisprControl).toHaveBeenCalledTimes(2);
});

test('full unmount and remount serialize native start through predecessor cleanup', async () => {
	const activity = createActivity();
	const predecessorHandle = jest.fn<(handle: HarnessHandle) => void>();
	const successorHandle = jest.fn<(handle: HarnessHandle) => void>();
	const nativeTaps: ReturnType<typeof deferred<string>>[] = [];
	let nativeActive = false;
	jest.spyOn(wisprAutomationNative, 'getStatus').mockResolvedValue({
		serviceEnabled: true,
		serviceConnected: true,
		wisprPackage: 'com.wisprflow.android',
	});
	jest
		.spyOn(wisprAutomationNative, 'tapWisprControl')
		.mockImplementation(() => {
			const tap = deferred<string>();
			nativeTaps.push(tap);
			return tap.promise.then((result) => {
				nativeActive = !nativeActive;
				return result;
			});
		});

	const predecessor = render(
		<WisprHarness
			activity={activity}
			onHandle={predecessorHandle}
			sessionGeneration={1}
		/>,
	);
	const predecessorLatest = () => predecessorHandle.mock.calls.at(-1)![0];
	act(() =>
		predecessorLatest().wispr.textEntryProps.onWisprAutoStartChange(true),
	);
	act(() => predecessorLatest().wispr.openTextEditor());
	await waitFor(() =>
		expect(predecessorLatest().wispr.snapshot.automation.phase).toBe(
			'openingTextEntry',
		),
	);
	act(() => predecessorLatest().wispr.textEntryProps.onWisprFocus('old'));
	expect(nativeTaps).toHaveLength(1);
	predecessor.unmount();

	const successor = render(
		<WisprHarness
			activity={activity}
			onHandle={successorHandle}
			sessionGeneration={2}
		/>,
	);
	const successorLatest = () => successorHandle.mock.calls.at(-1)![0];
	act(() =>
		successorLatest().wispr.textEntryProps.onWisprAutoStartChange(true),
	);
	act(() => successorLatest().wispr.openTextEditor());
	await waitFor(() =>
		expect(successorLatest().wispr.snapshot.automation.phase).toBe(
			'openingTextEntry',
		),
	);
	act(() => successorLatest().wispr.textEntryProps.onWisprFocus('new'));
	expect(nativeTaps).toHaveLength(1);

	await act(async () => {
		nativeTaps[0]!.resolve('old start');
		await nativeTaps[0]!.promise;
	});
	await waitFor(() => expect(nativeTaps).toHaveLength(2));
	expect(nativeActive).toBe(true);
	await act(async () => {
		nativeTaps[1]!.resolve('old close');
		await nativeTaps[1]!.promise;
	});
	await waitFor(() => expect(nativeTaps).toHaveLength(3));
	expect(nativeActive).toBe(false);

	await act(async () => {
		nativeTaps[2]!.resolve('successor start');
		await nativeTaps[2]!.promise;
	});
	expect(nativeActive).toBe(true);
	await act(async () => {
		successor.unmount();
		await Promise.resolve();
	});
	expect(nativeTaps).toHaveLength(4);
	await act(async () => {
		nativeTaps[3]!.resolve('successor close');
		await nativeTaps[3]!.promise;
	});
	expect(nativeActive).toBe(false);
	expect(nativeTaps).toHaveLength(4);
});

test('failed predecessor cleanup blocks the remounted Wispr controller', async () => {
	const activity = createActivity();
	const predecessorHandle = jest.fn<(handle: HarnessHandle) => void>();
	const successorHandle = jest.fn<(handle: HarnessHandle) => void>();
	const nativeTaps: ReturnType<typeof deferred<string>>[] = [];
	let nativeActive = false;
	jest.spyOn(wisprAutomationNative, 'getStatus').mockResolvedValue({
		serviceEnabled: true,
		serviceConnected: true,
		wisprPackage: 'com.wisprflow.android',
	});
	jest
		.spyOn(wisprAutomationNative, 'tapWisprControl')
		.mockImplementation(() => {
			const tap = deferred<string>();
			nativeTaps.push(tap);
			return tap.promise.then((result) => {
				nativeActive = !nativeActive;
				return result;
			});
		});

	const predecessor = render(
		<WisprHarness
			activity={activity}
			onHandle={predecessorHandle}
			sessionGeneration={1}
		/>,
	);
	const predecessorLatest = () => predecessorHandle.mock.calls.at(-1)![0];
	act(() =>
		predecessorLatest().wispr.textEntryProps.onWisprAutoStartChange(true),
	);
	act(() => predecessorLatest().wispr.openTextEditor());
	await waitFor(() =>
		expect(predecessorLatest().wispr.snapshot.automation.phase).toBe(
			'openingTextEntry',
		),
	);
	act(() => predecessorLatest().wispr.textEntryProps.onWisprFocus('old'));
	expect(nativeTaps).toHaveLength(1);
	predecessor.unmount();

	const successor = render(
		<WisprHarness
			activity={activity}
			onHandle={successorHandle}
			sessionGeneration={2}
		/>,
	);
	const successorLatest = () => successorHandle.mock.calls.at(-1)![0];
	act(() =>
		successorLatest().wispr.textEntryProps.onWisprAutoStartChange(true),
	);
	act(() => successorLatest().wispr.openTextEditor());
	await waitFor(() =>
		expect(successorLatest().wispr.snapshot.automation.phase).toBe(
			'openingTextEntry',
		),
	);
	act(() => successorLatest().wispr.textEntryProps.onWisprFocus('new'));
	expect(nativeTaps).toHaveLength(1);

	await act(async () => {
		nativeTaps[0]!.resolve('old start');
		await nativeTaps[0]!.promise;
	});
	await waitFor(() => expect(nativeTaps).toHaveLength(2));
	expect(nativeActive).toBe(true);
	await act(async () => {
		nativeTaps[1]!.reject(new Error('close rejected'));
		await expect(nativeTaps[1]!.promise).rejects.toThrow('close rejected');
	});

	await waitFor(() =>
		expect(successorLatest().wispr.snapshot.automation).toEqual({
			phase: 'failed',
			reason: 'tap-failed',
			message: 'Wispr unavailable because prior cleanup failed.',
		}),
	);
	expect(nativeActive).toBe(true);
	expect(nativeTaps).toHaveLength(2);
	successor.unmount();
});
