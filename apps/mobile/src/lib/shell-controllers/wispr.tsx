import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from 'react';
import { PixelRatio, Platform } from 'react-native';
import { type TextEntryWisprControl } from '../wispr-automation';
import { wisprAutomationNative } from '../wispr-automation-native';
import { type ControllerInvalidationReason } from './controller-core';
import { createReplaySafeControllerLifecycle } from './controller-lifecycle';
import { type ShellActivityPort } from './session-contracts';
import {
	createShellWisprControllerCore,
	type ShellWisprModalPort,
	type ShellWisprSnapshot,
	type TextInputScreenBounds,
} from './wispr-core';
import { createWisprNativeControlAuthority } from './wispr-native-control-authority';

type ShellWisprLogger = {
	info(message: string, payload?: unknown): void;
	warn(message: string, error?: unknown): void;
};

const nativeControlAuthority = createWisprNativeControlAuthority();

export type UseShellWisprControllerInput = {
	activity: ShellActivityPort;
	sessionGeneration: number;
	textEntryModal: ShellWisprModalPort;
	logger: ShellWisprLogger;
};

export type ShellWisprControllerHandle = {
	snapshot: ShellWisprSnapshot;
	openTextEditor(): void;
	textEntryProps: {
		wisprMode: boolean;
		wisprControl: TextEntryWisprControl;
		onWisprSetup(): void;
		onWisprAutoStartChange(enabled: boolean): void;
		onWisprFocus(value: string, bounds?: TextInputScreenBounds): void;
		onValueChange(value: string): void;
		onClose(): void;
	};
	invalidate(reason: ControllerInvalidationReason): void;
};

function createShellWisprHookRuntime(initial: UseShellWisprControllerInput) {
	let committedInput = initial;
	let committed = false;
	let activityGeneration = initial.activity.getSnapshot().generation;
	let sessionGeneration = initial.sessionGeneration;
	const core = createShellWisprControllerCore({
		controlAuthority: nativeControlAuthority,
		native: {
			getStatus: () => wisprAutomationNative.getStatus(),
			tapControl: () => wisprAutomationNative.tapWisprControl(),
			tapScreen: (x, y) => wisprAutomationNative.tapScreen(x, y),
			openSettings: () => wisprAutomationNative.openAccessibilitySettings(),
		},
		modal: {
			isOpen: () => committedInput.textEntryModal.isOpen(),
			open: () => committedInput.textEntryModal.open(),
			close: () => committedInput.textEntryModal.close(),
		},
		now: Date.now,
		setTimeout: (task, delayMs) => setTimeout(task, delayMs),
		clearTimeout: (timer) =>
			clearTimeout(timer as ReturnType<typeof setTimeout>),
		pixelRatio: () => PixelRatio.get(),
		platformOS: Platform.OS,
		logger: {
			info: (message, payload) => committedInput.logger.info(message, payload),
			warn: (message, error) => committedInput.logger.warn(message, error),
		},
	});
	const lifecycle = createReplaySafeControllerLifecycle(core);

	return {
		core,
		commit(
			nextInput: UseShellWisprControllerInput,
			nextActivity: ReturnType<ShellActivityPort['getSnapshot']>,
		) {
			committedInput = nextInput;
			if (!committed) {
				committed = true;
				activityGeneration = nextActivity.generation;
				sessionGeneration = nextInput.sessionGeneration;
				return;
			}
			if (
				activityGeneration === nextActivity.generation &&
				sessionGeneration === nextInput.sessionGeneration
			) {
				return;
			}
			activityGeneration = nextActivity.generation;
			sessionGeneration = nextInput.sessionGeneration;
			core.invalidate(
				!nextActivity.appActive
					? 'app-inactive'
					: !nextActivity.focused
						? 'focus-lost'
						: 'source-change',
			);
		},
		setupDisposal: lifecycle.setup,
	};
}

export function useShellWisprController(
	input: UseShellWisprControllerInput,
): ShellWisprControllerHandle {
	const [runtime] = useState(() => createShellWisprHookRuntime(input));
	const snapshot = useSyncExternalStore(
		runtime.core.subscribe,
		runtime.core.getSnapshot,
		runtime.core.getSnapshot,
	);
	const activitySnapshot = useSyncExternalStore(
		input.activity.subscribe,
		input.activity.getSnapshot,
		input.activity.getSnapshot,
	);

	useLayoutEffect(
		() => runtime.commit(input, activitySnapshot),
		[activitySnapshot, input, runtime],
	);
	useEffect(() => runtime.setupDisposal(), [runtime]);
	const openTextEditor = useCallback(
		() => void runtime.core.openTextEditor(),
		[runtime],
	);

	return useMemo(
		() => ({
			snapshot,
			openTextEditor,
			textEntryProps: {
				wisprMode: snapshot.busy,
				wisprControl: snapshot.control,
				onWisprSetup: () => void runtime.core.openSettings(),
				onWisprAutoStartChange: runtime.core.setAutoStart,
				onWisprFocus: runtime.core.onTextEntryFocused,
				onValueChange: runtime.core.onTextChanged,
				onClose: runtime.core.closeTextEntry,
			},
			invalidate: runtime.core.invalidate,
		}),
		[openTextEditor, runtime, snapshot],
	);
}
