import * as Clipboard from 'expo-clipboard';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
import { Animated, Keyboard, Platform } from 'react-native';
import {
	type CommandBridgeEntry,
	type KeyboardDefinition,
	type MacroDef,
	type ModifierKey,
} from '@/lib/shell-config';
import { type ShellConfigState } from '@/lib/shell-config-store';
import { textEntryHistoryStore } from '@/lib/text-entry-history-store-native';
import { type CommandMenuModalProps } from '../../app/shell/components/CommandMenuModal';
import { type ConfigureModalProps } from '../../app/shell/components/ConfigureModal';
import { type TerminalCommanderModalProps } from '../../app/shell/components/TerminalCommanderModal';
import { type TerminalKeyboardProps } from '../../app/shell/components/TerminalKeyboard';
import { type TextEntryHistoryModalProps } from '../../app/shell/components/TextEntryModal';
import { type WorkmuxNavScope } from '../workmux-app-commands';
import { createShellActivityKeyboardActions } from './activity-keyboard-actions';
import { createShellKeyboardResumeDismissScheduler } from './activity-retained-domain-bridge';
import {
	createReplaySafeDisposer,
	type ControllerInvalidationReason,
} from './controller-core';
import {
	createShellKeyboardControllerAdapter,
	type ShellKeyboardControllerAdapter,
} from './keyboard-controller-adapter';
import { type UseShellKeyboardControllerInput } from './keyboard-hook-contracts';
import {
	createKeyboardActivityTransitionController,
	createKeyboardAnimationController,
	createKeyboardClipboardAuthority,
	createKeyboardControllerAdmission,
	createKeyboardTerminalRuntimeObserver,
	invalidateKeyboardControllerDomains,
	subscribeKeyboardVisibility,
	type KeyboardAnimationController,
} from './keyboard-hook-runtime';
import { type ShellKeyboardInputCore } from './keyboard-input-contracts';
import { createShellKeyboardInputCore } from './keyboard-input-core';
import {
	createShellCommanderProps,
	createShellCommandMenuProps,
	createShellTerminalKeyboardProps,
} from './keyboard-props';
import { type ShellKeyboardRemoteCore } from './keyboard-remote-contracts';
import { createShellKeyboardRemoteCore } from './keyboard-remote-core';
import {
	createShellKeyboardStateCore,
	type ShellKeyboardStateCore,
} from './keyboard-state-core';

export type {
	ShellKeyboardBrowserCommands,
	ShellKeyboardModalCommands,
} from './keyboard-controller-adapter';
export type { UseShellKeyboardControllerInput } from './keyboard-hook-contracts';

export type ShellKeyboardControllerHandle = {
	keyboard: KeyboardDefinition | null;
	macros: readonly MacroDef[];
	modifierKeysActive: readonly ModifierKey[];
	systemKeyboardEnabled: boolean;
	selectionModeEnabled: boolean;
	flash: { name: string | null; opacity: Animated.Value };
	shellConfigState: ShellConfigState;
	terminalKeyboardProps: Omit<TerminalKeyboardProps, 'navScope'> & {
		navScope: WorkmuxNavScope;
	};
	commandMenuProps: Pick<
		CommandMenuModalProps,
		'entries' | 'onSelect' | 'onAction' | 'onBridge'
	>;
	commanderProps: Pick<
		TerminalCommanderModalProps,
		'onExecuteCommand' | 'onPasteText' | 'onSendShortcut'
	>;
	textEntryProps: {
		onPaste(value: string): void;
		history: TextEntryHistoryModalProps;
	};
	configureProps: Omit<
		ConfigureModalProps,
		'open' | 'bottomOffset' | 'onClose'
	>;
	onWebViewInput(input: { str: string; instanceId: string }): void;
	onSelectionChanged(text: string): void;
	onSelectionModeChange(enabled: boolean): void;
	onCommandBridgeEntry(entry: CommandBridgeEntry): void;
	invalidate(reason: ControllerInvalidationReason): void;
};

export function useShellKeyboardController(
	deps: UseShellKeyboardControllerInput,
): ShellKeyboardControllerHandle {
	const committedDeps = useRef(deps);
	const activitySnapshot = useSyncExternalStore(
		deps.activity.subscribe,
		deps.activity.getSnapshot,
		deps.activity.getSnapshot,
	);
	const visibleRef = useRef(false);
	const lastVisibleRef = useRef(false);
	const [clipboardAuthority] = useState(createKeyboardClipboardAuthority);
	const [flashName, setFlashName] = useState<string | null>(null);
	const [flashOpacity] = useState(() => new Animated.Value(0));
	const [activityTransition] = useState(() =>
		createKeyboardActivityTransitionController(activitySnapshot.interactive),
	);

	useLayoutEffect(() => {
		committedDeps.current = deps;
	});

	const [stateCore] = useState<ShellKeyboardStateCore>(() =>
		createShellKeyboardStateCore({
			initialShellConfigState: deps.initialShellConfigState,
			historyStore: deps.historyStore ?? textEntryHistoryStore,
			initialSystemKeyboardEnabled:
				(deps.platformOS ?? Platform.OS) === 'android',
			logger: deps.logger,
		}),
	);
	const [remoteCore] = useState<ShellKeyboardRemoteCore>(() =>
		createShellKeyboardRemoteCore({
			initialTargetContext: deps.remoteTarget,
			getActivitySnapshot: () => committedDeps.current.activity.getSnapshot(),
			getNavScope: () => committedDeps.current.navScope,
			keyboardState: stateCore,
			reloadRuntimeShellConfig: () =>
				committedDeps.current.reloadRuntimeShellConfig(),
			closeCommandMenu: () =>
				committedDeps.current.modalCommands.closeCommandMenu(),
			showAlert: (title, message) =>
				committedDeps.current.showAlert(title, message),
			invalidateShellTransport: (connectionId, channelId) =>
				committedDeps.current.invalidateShellTransport(connectionId, channelId),
			logger: deps.logger,
		}),
	);
	const adapterRef = useRef<ShellKeyboardControllerAdapter | null>(null);
	const [inputCore] = useState<ShellKeyboardInputCore>(() =>
		createShellKeyboardInputCore({
			state: stateCore,
			scrollbackInput: {
				sendSegments: (segments, options) =>
					committedDeps.current.scrollbackInput.sendSegments(segments, options),
			},
			terminalView: {
				getRuntimeKey: () => committedDeps.current.terminalView.getRuntimeKey(),
				getRuntimeInstanceId: () =>
					committedDeps.current.terminalView.getRuntimeInstanceId(),
				isCurrentInstance: (id) =>
					committedDeps.current.terminalView.isCurrentInstance(id),
				setSelectionModeEnabled: (enabled) =>
					committedDeps.current.terminalView.setSelectionModeEnabled(enabled),
			},
			getActivitySnapshot: () => committedDeps.current.activity.getSnapshot(),
			getSourceKey: () => committedDeps.current.sourceKey,
			runAction: (actionId, options) => {
				const adapter = adapterRef.current;
				return adapter
					? adapter.runAction(actionId, options)
					: { status: 'unavailable' };
			},
			setTimeout: (task, delayMs) => setTimeout(task, delayMs),
			clearTimeout: (timer) =>
				clearTimeout(timer as ReturnType<typeof setTimeout>),
			closeCommandMenu: () =>
				committedDeps.current.modalCommands.closeCommandMenu(),
			logger: deps.logger,
		}),
	);
	const animationControllerRef = useRef<KeyboardAnimationController | null>(
		null,
	);
	const [admission] = useState(() =>
		createKeyboardControllerAdmission((reason) => {
			invalidateKeyboardControllerDomains(reason, [
				() => clipboardAuthority.invalidate(),
				() => animationControllerRef.current?.cancel(),
				(nextReason) => inputCore.invalidate(nextReason),
				(nextReason) => remoteCore.invalidate(nextReason),
			]);
		}),
	);
	const [terminalRuntimeObserver] = useState(() =>
		createKeyboardTerminalRuntimeObserver(() => {
			admission.invalidate('runtime-reset');
		}),
	);
	const [lifecycle] = useState(() =>
		createReplaySafeDisposer(() => {
			admission.dispose();
			clipboardAuthority.invalidate();
			inputCore.invalidate('unmount');
			remoteCore.invalidate('unmount');
			remoteCore.dispose();
			inputCore.dispose();
			stateCore.dispose();
		}),
	);
	const [animationController] = useState(() =>
		createKeyboardAnimationController({
			initialIdentity: stateCore.getSnapshot().keyboard?.id ?? null,
			getAdmissionGeneration: admission.getGeneration,
			setName: setFlashName,
			setOpacity: (value) => flashOpacity.setValue(value),
			start: (configuration, completion) => {
				const animation = Animated.timing(flashOpacity, {
					toValue: 0,
					...configuration,
				});
				animation.start(completion);
				return () => animation.stop();
			},
		}),
	);
	useLayoutEffect(() => {
		animationControllerRef.current = animationController;
		return () => {
			if (animationControllerRef.current === animationController)
				animationControllerRef.current = null;
		};
	}, [animationController]);
	const snapshot = useSyncExternalStore(
		stateCore.subscribe,
		stateCore.getSnapshot,
		stateCore.getSnapshot,
	);

	const safeWarn = useCallback((message: string, error: unknown) => {
		try {
			committedDeps.current.logger?.warn(message, error);
		} catch {
			// Diagnostics never own clipboard authority.
		}
	}, []);
	const [adapter] = useState(() =>
		createShellKeyboardControllerAdapter({
			admission,
			stateCore,
			inputCore,
			remoteCore,
			clipboardAuthority,
			getPorts: () => ({
				activity: committedDeps.current.activity,
				sourceKey: committedDeps.current.sourceKey,
				terminalView: committedDeps.current.terminalView,
				modalCommands: committedDeps.current.modalCommands,
				browserCommands: committedDeps.current.browserCommands,
				fitTerminalToDevice: committedDeps.current.fitTerminalToDevice,
				debugConnectionInCodex: committedDeps.current.debugConnectionInCodex,
				setNavScope: committedDeps.current.setNavScope,
				platformOS: committedDeps.current.platformOS ?? Platform.OS,
				dismissKeyboard: () => Keyboard.dismiss(),
				clearKeyboardVisibility: () => {
					visibleRef.current = false;
				},
				readClipboard: Clipboard.getStringAsync,
				writeClipboard: async (text) => {
					await Clipboard.setStringAsync(text);
				},
			}),
			warn: safeWarn,
		}),
	);
	useLayoutEffect(() => {
		adapterRef.current = adapter;
		return () => {
			if (adapterRef.current === adapter) adapterRef.current = null;
		};
	}, [adapter]);
	useLayoutEffect(() => {
		try {
			terminalRuntimeObserver.reconcile(committedDeps.current.terminalView);
		} catch (error) {
			safeWarn('Failed to reconcile terminal runtime identity', error);
		}
	});

	useLayoutEffect(() => {
		stateCore.setShellConfigState(deps.initialShellConfigState);
		remoteCore.setTargetContext(deps.remoteTarget);
	}, [deps.initialShellConfigState, deps.remoteTarget, remoteCore, stateCore]);

	useEffect(() => {
		const generation = admission.setup();
		return () => {
			if (generation !== null) admission.cleanup(generation);
		};
	}, [admission]);
	useEffect(() => lifecycle.setup(), [lifecycle]);
	useEffect(() => {
		try {
			return subscribeKeyboardVisibility({
				platformOS: deps.platformOS ?? Platform.OS,
				addListener: (event, listener) =>
					event === 'keyboardDidShow'
						? Keyboard.addListener('keyboardDidShow', listener)
						: Keyboard.addListener('keyboardDidHide', listener),
				onVisibility: (visible) => {
					visibleRef.current = visible;
				},
			});
		} catch (error) {
			safeWarn('Failed to subscribe to system keyboard visibility', error);
			return;
		}
	}, [deps.platformOS, safeWarn]);

	useEffect(() => {
		const scheduler = createShellKeyboardResumeDismissScheduler({
			// eslint-disable-next-line @eslint-react/web-api/no-leaked-timeout -- The scheduler owns and cancels its single replacement timer below.
			schedule: (task, delayMs) => setTimeout(task, delayMs),
			cancel: (timer) => clearTimeout(timer),
		});
		const actions = createShellActivityKeyboardActions({
			platformOS: deps.platformOS ?? Platform.OS,
			getSystemKeyboardEnabled: () =>
				stateCore.getSnapshot().systemKeyboardEnabled,
			getWasKeyboardVisible: () => lastVisibleRef.current,
			setKeyboardVisible: (visible) => {
				visibleRef.current = visible;
			},
			setXtermSystemKeyboardEnabled: (enabled) =>
				committedDeps.current.terminalView.setSystemKeyboardEnabled(enabled),
			dismissKeyboard: () => Keyboard.dismiss(),
			scheduleDelayedDismiss: scheduler.schedule,
		});
		activityTransition.reconcile(
			activitySnapshot.interactive,
			{
				setupInitialKeyboard: () => {
					try {
						actions.setupInitialKeyboard();
					} catch (error) {
						safeWarn('Failed to set up initial system keyboard', error);
					}
				},
				resumeFromAppState: () => {
					try {
						actions.resumeFromAppState();
					} catch (error) {
						safeWarn('Failed to resume system keyboard', error);
					}
				},
			},
			() => {
				lastVisibleRef.current = visibleRef.current;
			},
		);
		return scheduler.cancel;
	}, [
		activitySnapshot.generation,
		activitySnapshot.interactive,
		activityTransition,
		deps.platformOS,
		safeWarn,
		stateCore,
	]);

	useEffect(() => {
		animationController.replace(
			snapshot.keyboard?.id ?? null,
			snapshot.keyboard?.name ?? null,
		);
		return animationController.cancel;
	}, [animationController, snapshot.keyboard]);

	const {
		onAction,
		onSelectionModeChange,
		invalidate,
		onSlotPress,
		onCopySelection,
		onPreset,
		onBridge,
		onExecuteCommand,
		onPasteText,
		onSendShortcut,
		onTextEntryPaste,
		onReloadConfig,
		onWebViewInput,
		onSelectionChanged,
	} = adapter;

	const terminalKeyboardProps = useMemo<
		ShellKeyboardControllerHandle['terminalKeyboardProps']
	>(
		() =>
			createShellTerminalKeyboardProps({
				keyboard: snapshot.keyboard,
				modifierKeysActive: [...snapshot.modifierKeysActive],
				onSlotPress,
				selectionModeEnabled: snapshot.selectionModeEnabled,
				onCopySelection,
				navScope: deps.navScope,
			}),
		[
			deps.navScope,
			onCopySelection,
			onSlotPress,
			snapshot.keyboard,
			snapshot.modifierKeysActive,
			snapshot.selectionModeEnabled,
		],
	);
	const commandMenuProps = useMemo<
		ShellKeyboardControllerHandle['commandMenuProps']
	>(
		() =>
			createShellCommandMenuProps({
				entries: [...snapshot.shellConfigState.config.commandMenus],
				onSelect: onPreset,
				onAction,
				onBridge,
			}),
		[
			onAction,
			onBridge,
			onPreset,
			snapshot.shellConfigState.config.commandMenus,
		],
	);
	const commanderProps = useMemo<
		ShellKeyboardControllerHandle['commanderProps']
	>(
		() =>
			createShellCommanderProps({
				onExecuteCommand,
				onPasteText,
				onSendShortcut,
			}),
		[onExecuteCommand, onPasteText, onSendShortcut],
	);
	const historyProps = useMemo<TextEntryHistoryModalProps>(
		() => ({
			cycleEntries: snapshot.history.cycleEntries,
			pinnedEntries: snapshot.history.pinned,
			recentEntries: snapshot.history.recent,
			onPinText: stateCore.pinHistoryText,
			onPinEntry: stateCore.pinHistoryEntry,
			onUnpinEntry: stateCore.unpinHistoryEntry,
			onDeleteEntry: stateCore.deleteHistoryEntry,
			onClearRecent: stateCore.clearRecentHistory,
		}),
		[snapshot.history, stateCore],
	);
	const textEntryProps = useMemo<
		ShellKeyboardControllerHandle['textEntryProps']
	>(
		() => ({
			onPaste: onTextEntryPaste,
			history: historyProps,
		}),
		[historyProps, onTextEntryPaste],
	);
	const configureProps = useMemo<
		ShellKeyboardControllerHandle['configureProps']
	>(
		() => ({
			...deps.configureCommands,
			onReloadConfig,
			configVersion: snapshot.shellConfigState.config.version,
			configUpdatedAt: snapshot.shellConfigState.config.updatedAt,
			configSource: snapshot.shellConfigState.source,
			configLastLoadedAt: snapshot.shellConfigState.lastLoadedAt,
			configLastError: snapshot.shellConfigState.lastError,
		}),
		[deps.configureCommands, onReloadConfig, snapshot.shellConfigState],
	);

	return useMemo<ShellKeyboardControllerHandle>(
		() => ({
			keyboard: snapshot.keyboard,
			macros: snapshot.macros,
			modifierKeysActive: snapshot.modifierKeysActive,
			systemKeyboardEnabled: snapshot.systemKeyboardEnabled,
			selectionModeEnabled: snapshot.selectionModeEnabled,
			flash: { name: flashName, opacity: flashOpacity },
			shellConfigState: snapshot.shellConfigState,
			terminalKeyboardProps,
			commandMenuProps,
			commanderProps,
			textEntryProps,
			configureProps,
			onWebViewInput,
			onSelectionChanged,
			onSelectionModeChange,
			onCommandBridgeEntry: onBridge,
			invalidate,
		}),
		[
			commandMenuProps,
			commanderProps,
			configureProps,
			flashName,
			flashOpacity,
			invalidate,
			onSelectionChanged,
			onSelectionModeChange,
			onBridge,
			onWebViewInput,
			snapshot,
			terminalKeyboardProps,
			textEntryProps,
		],
	);
}
