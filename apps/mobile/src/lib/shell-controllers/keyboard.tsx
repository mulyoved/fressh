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
import { type HostBrowserUrlSlot } from '@/lib/host-browser-actions';
import {
	runAction,
	type ActionContext,
	type ActionId,
} from '@/lib/keyboard-actions';
import {
	getKeyboardActionTarget,
	type CommandBridgeEntry,
	type CommandMenuEntry,
	type CommandPreset,
	type KeyboardDefinition,
	type KeyboardExecutableItem,
	type MacroDef,
	type ModifierKey,
} from '@/lib/shell-config';
import { type ShellConfigState } from '@/lib/shell-config-store';
import { textEntryHistoryStore } from '@/lib/text-entry-history-store-native';
import { type TextEntryHistoryModalProps } from '../../app/shell/components/TextEntryModal';
import { type WorkmuxNavScope } from '../workmux-app-commands';
import { type ShellActivitySnapshot } from './activity-core';
import { createShellActivityKeyboardActions } from './activity-keyboard-actions';
import { createShellKeyboardResumeDismissScheduler } from './activity-retained-domain-bridge';
import {
	createReplaySafeDisposer,
	type ControllerInvalidationReason,
} from './controller-core';
import {
	applyKeyboardSelectionMode,
	createKeyboardAnimationController,
	createKeyboardClipboardAuthority,
	createKeyboardControllerAdmission,
	subscribeKeyboardVisibility,
} from './keyboard-hook-runtime';
import {
	type ShellKeyboardInputLogger,
	type ShellKeyboardInputCore,
} from './keyboard-input-contracts';
import { createShellKeyboardInputCore } from './keyboard-input-core';
import {
	type ShellKeyboardRemoteCore,
	type ShellKeyboardRemoteLogger,
	type ShellKeyboardRemoteTargetContext,
} from './keyboard-remote-contracts';
import { createShellKeyboardRemoteCore } from './keyboard-remote-core';
import {
	createShellKeyboardStateCore,
	type ShellKeyboardHistoryStore,
	type ShellKeyboardStateCore,
	type ShellKeyboardStateLogger,
} from './keyboard-state-core';
import { type ShellScrollbackInputPort } from './scrollback-contracts';
import { type ShellTerminalRuntimeView } from './terminal-hook-runtime';

export type ShellKeyboardModalCommands = {
	toggleCommandMenu(): void;
	openCommander(): void;
	openSkillSelector(): void;
	openBrowserActions(): void;
	openFeatureRequest(): void;
	openWisprTextEditor(): void;
	openConfigurator(): void;
	closeCommandMenu(): void;
};

export type ShellKeyboardBrowserCommands = {
	openDiff(): void;
	openUrlSlot(slot: HostBrowserUrlSlot): void;
	openDetected(mode: 'auto' | 'pick'): void;
	editUrlSlot(slot: HostBrowserUrlSlot): void;
};

export type ShellKeyboardControllerHandle = {
	keyboard: KeyboardDefinition | null;
	macros: readonly MacroDef[];
	modifierKeysActive: readonly ModifierKey[];
	systemKeyboardEnabled: boolean;
	selectionModeEnabled: boolean;
	flash: { name: string | null; opacity: Animated.Value };
	shellConfigState: ShellConfigState;
	terminalKeyboardProps: {
		keyboard: KeyboardDefinition | null;
		modifierKeysActive: ModifierKey[];
		onSlotPress(slot: KeyboardExecutableItem): void;
		selectionModeEnabled: boolean;
		onCopySelection(): void;
		navScope: WorkmuxNavScope;
	};
	commandMenuProps: {
		entries: CommandMenuEntry[];
		onSelect(preset: CommandPreset): void;
		onAction(actionId: ActionId): void;
		onBridge(entry: CommandBridgeEntry): void;
	};
	commanderProps: {
		onExecuteCommand(value: string): void;
		onPasteText(value: string): void;
		onSendShortcut(sequence: string): void;
	};
	textEntryProps: {
		onPaste(value: string): void;
		history: TextEntryHistoryModalProps;
	};
	configureProps: {
		onDevServer(): void;
		onReloadConfig(): void;
		onHostConfig(): void;
		onRequestFeature(): void;
		onOpenGitHubIssues(): void;
		onOpenShellConfigDocs(): void;
		configVersion: string;
		configUpdatedAt: string;
		configSource: string;
		configLastLoadedAt: string | null;
		configLastError: string | null;
	};
	onWebViewInput(input: { str: string; instanceId: string }): void;
	onSelectionChanged(text: string): void;
	onSelectionModeChange(enabled: boolean): void;
	onCommandBridgeEntry(entry: CommandBridgeEntry): void;
	invalidate(reason: ControllerInvalidationReason): void;
};

type ShellKeyboardControllerLogger = ShellKeyboardInputLogger &
	ShellKeyboardRemoteLogger &
	ShellKeyboardStateLogger;

export type UseShellKeyboardControllerInput = {
	initialShellConfigState: ShellConfigState;
	historyStore?: ShellKeyboardHistoryStore;
	activity: {
		snapshot: ShellActivitySnapshot;
		getSnapshot(): ShellActivitySnapshot;
	};
	sourceKey: unknown;
	scrollbackInput: ShellScrollbackInputPort;
	terminalView: ShellTerminalRuntimeView;
	remoteTarget: ShellKeyboardRemoteTargetContext;
	navScope: WorkmuxNavScope;
	setNavScope(scope: WorkmuxNavScope): void;
	modalCommands: ShellKeyboardModalCommands;
	browserCommands: ShellKeyboardBrowserCommands;
	fitTerminalToDevice(): void | Promise<void>;
	debugConnectionInCodex(): void | Promise<void>;
	reloadRuntimeShellConfig(): PromiseLike<ShellConfigState>;
	showAlert(title: string, message: string): void;
	invalidateShellTransport(connectionId: string, channelId: number): void;
	configureCommands: Pick<
		ShellKeyboardControllerHandle['configureProps'],
		| 'onDevServer'
		| 'onHostConfig'
		| 'onRequestFeature'
		| 'onOpenGitHubIssues'
		| 'onOpenShellConfigDocs'
	>;
	logger?: ShellKeyboardControllerLogger;
	platformOS?: string;
};

export function useShellKeyboardController(
	deps: UseShellKeyboardControllerInput,
): ShellKeyboardControllerHandle {
	const committedDeps = useRef(deps);
	const visibleRef = useRef(false);
	const lastVisibleRef = useRef(false);
	const lastInteractiveRef = useRef(deps.activity.snapshot.interactive);
	const [clipboardAuthority] = useState(createKeyboardClipboardAuthority);
	const [flashName, setFlashName] = useState<string | null>(null);
	const [flashOpacity] = useState(() => new Animated.Value(0));
	const initialKeyboardSetupRef = useRef(false);

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
	const actionContextRef = useRef<ActionContext | null>(null);
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
				const context = actionContextRef.current;
				return context
					? runAction(actionId, context, options)
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
	const [admission] = useState(() =>
		createKeyboardControllerAdmission((reason) => {
			clipboardAuthority.invalidate();
			inputCore.invalidate(reason);
			remoteCore.invalidate(reason);
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
			isAdmitted: () => admission.getGeneration() !== null,
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
	const copySelection = useCallback(async () => {
		await clipboardAuthority.copy({
			isAdmitted: () => admission.getGeneration() !== null,
			getInstanceId: () =>
				committedDeps.current.terminalView.getRuntimeInstanceId(),
			getSelection: () => committedDeps.current.terminalView.getSelection(),
			isCurrentInstance: (id) =>
				committedDeps.current.terminalView.isCurrentInstance(id),
			writeClipboard: async (text) => {
				await Clipboard.setStringAsync(text);
			},
			exitSelectionState: () => stateCore.setSelectionModeEnabled(false),
			exitSelectionView: () =>
				committedDeps.current.terminalView.setSelectionModeEnabled(false),
			completeSlotPress: stateCore.completeSlotPress,
			warn: safeWarn,
		});
	}, [admission, clipboardAuthority, safeWarn, stateCore]);

	const actionContext = useMemo<ActionContext>(
		() => ({
			availableKeyboardIds: new Set(snapshot.activeKeyboardIds),
			selectKeyboard: stateCore.selectKeyboardIfExists,
			resolveKeyboardActionTarget: (actionId) =>
				getKeyboardActionTarget(
					stateCore.getSnapshot().shellConfigState.config,
					actionId,
				),
			rotateKeyboard: stateCore.rotateKeyboard,
			openConfigurator: () =>
				committedDeps.current.modalCommands.openConfigurator(),
			sendBytes: (bytes) => {
				void inputCore.sendBytes(bytes);
			},
			pasteClipboard: async () => {
				try {
					await inputCore.pasteClipboard(await Clipboard.getStringAsync());
				} catch (error) {
					committedDeps.current.logger?.warn(
						'Failed to paste clipboard',
						error,
					);
				}
			},
			copySelection: () => {
				void copySelection();
			},
			fitTerminalToDevice: () => committedDeps.current.fitTerminalToDevice(),
			restartCodex: async () => {
				await remoteCore.restartCodex();
			},
			debugConnectionInCodex: () =>
				committedDeps.current.debugConnectionInCodex(),
			toggleCommandMenu: () =>
				committedDeps.current.modalCommands.toggleCommandMenu(),
			openCommander: () => committedDeps.current.modalCommands.openCommander(),
			openSkillSelector: () =>
				committedDeps.current.modalCommands.openSkillSelector(),
			openBrowserActions: () =>
				committedDeps.current.modalCommands.openBrowserActions(),
			openRepoFeatureRequest: () =>
				committedDeps.current.modalCommands.openFeatureRequest(),
			openWisprTextEditor: () =>
				committedDeps.current.modalCommands.openWisprTextEditor(),
			openHostDiffity: () => committedDeps.current.browserCommands.openDiff(),
			openHostUrlSlot: (slot) =>
				committedDeps.current.browserCommands.openUrlSlot(slot),
			openHostDetected: (mode) =>
				committedDeps.current.browserCommands.openDetected(mode),
			editHostUrlSlot: (slot) =>
				committedDeps.current.browserCommands.editUrlSlot(slot),
			runWorkmuxKeyboardCommand: remoteCore.runWorkmuxCommand,
			setNavScope: (scope) => committedDeps.current.setNavScope(scope),
		}),
		[
			copySelection,
			inputCore,
			remoteCore,
			snapshot.activeKeyboardIds,
			stateCore,
		],
	);
	useLayoutEffect(() => {
		actionContextRef.current = actionContext;
		return () => {
			if (actionContextRef.current === actionContext)
				actionContextRef.current = null;
		};
	}, [actionContext]);

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
	}, [deps.platformOS]);

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
		if (!initialKeyboardSetupRef.current) {
			initialKeyboardSetupRef.current = true;
			actions.setupInitialKeyboard();
		}
		if (lastInteractiveRef.current && !deps.activity.snapshot.interactive)
			lastVisibleRef.current = visibleRef.current;
		if (!lastInteractiveRef.current && deps.activity.snapshot.interactive)
			actions.resumeFromAppState();
		lastInteractiveRef.current = deps.activity.snapshot.interactive;
		return scheduler.cancel;
	}, [
		deps.activity.snapshot.generation,
		deps.activity.snapshot.interactive,
		deps.platformOS,
		stateCore,
	]);

	useEffect(() => {
		animationController.replace(
			snapshot.keyboard?.id ?? null,
			snapshot.keyboard?.name ?? null,
		);
		return animationController.cancel;
	}, [animationController, snapshot.keyboard]);

	const onAction = useCallback(
		(actionId: ActionId) => {
			const generation = admission.getGeneration();
			const context = actionContextRef.current;
			if (generation === null || !context) return;
			void runAction(actionId, context);
		},
		[admission],
	);
	const onSelectionModeChange = useCallback(
		(enabled: boolean) => {
			const generation = admission.getGeneration();
			if (generation === null) return;
			applyKeyboardSelectionMode({
				enabled,
				platformOS: committedDeps.current.platformOS ?? Platform.OS,
				isCurrent: () => admission.isCurrent(generation),
				setSelectionMode: stateCore.setSelectionModeEnabled,
				setTerminalSystemKeyboard: (value) =>
					committedDeps.current.terminalView.setSystemKeyboardEnabled(value),
				dismissKeyboard: () => Keyboard.dismiss(),
				clearKeyboardVisibility: () => {
					visibleRef.current = false;
				},
				setSystemKeyboard: stateCore.setSystemKeyboardEnabled,
				warn: safeWarn,
			});
		},
		[admission, safeWarn, stateCore],
	);
	const invalidate = useCallback(
		(reason: ControllerInvalidationReason) => {
			admission.invalidate(reason);
		},
		[admission],
	);
	const onSlotPress = useCallback(
		(slot: KeyboardExecutableItem) => {
			if (admission.getGeneration() !== null)
				void inputCore.handleSlotPress(slot);
		},
		[admission, inputCore],
	);
	const onCopySelection = useCallback(() => {
		void copySelection();
	}, [copySelection]);
	const onPreset = useCallback(
		(preset: CommandPreset) => {
			if (admission.getGeneration() !== null)
				void inputCore.runCommandPreset(preset);
		},
		[admission, inputCore],
	);
	const onBridge = useCallback(
		(entry: CommandBridgeEntry) => {
			if (admission.getGeneration() !== null)
				void remoteCore.handleCommandBridgeEntry(entry);
		},
		[admission, remoteCore],
	);
	const onExecuteCommand = useCallback(
		(value: string) => {
			if (admission.getGeneration() !== null)
				void inputCore.executeCommanderCommand(value);
		},
		[admission, inputCore],
	);
	const onPasteText = useCallback(
		(value: string) => {
			if (admission.getGeneration() !== null)
				void inputCore.pasteCommanderText(value);
		},
		[admission, inputCore],
	);
	const onSendShortcut = useCallback(
		(sequence: string) => {
			if (admission.getGeneration() !== null)
				void inputCore.sendShortcut(sequence);
		},
		[admission, inputCore],
	);
	const onTextEntryPaste = useCallback(
		(value: string) => {
			if (admission.getGeneration() !== null)
				void inputCore.pasteTextEntry(value);
		},
		[admission, inputCore],
	);
	const onReloadConfig = useCallback(() => {
		if (admission.getGeneration() !== null) void remoteCore.reloadConfig();
	}, [admission, remoteCore]);
	const onWebViewInput = useCallback(
		(input: { str: string; instanceId: string }) => {
			if (admission.getGeneration() !== null)
				void inputCore.onWebViewInput({ ...input });
		},
		[admission, inputCore],
	);
	const onSelectionChanged = useCallback(
		(text: string) => {
			clipboardAuthority.noteSelection(text);
		},
		[clipboardAuthority],
	);

	const terminalKeyboardProps = useMemo<
		ShellKeyboardControllerHandle['terminalKeyboardProps']
	>(
		() => ({
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
		() => ({
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
		() => ({
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
