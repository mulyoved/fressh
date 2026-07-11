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
	const authorityGeneration = useRef(0);
	const visibleRef = useRef(false);
	const lastVisibleRef = useRef(false);
	const lastInteractiveRef = useRef(deps.activity.snapshot.interactive);
	const copiedSelectionRef = useRef('');
	const selectionCopyInFlightRef = useRef('');
	const [flashName, setFlashName] = useState<string | null>(null);
	const [flashOpacity] = useState(() => new Animated.Value(0));
	const firstKeyboardRef = useRef(true);

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
	const [lifecycle] = useState(() =>
		createReplaySafeDisposer(() => {
			authorityGeneration.current += 1;
			inputCore.invalidate('unmount');
			remoteCore.invalidate('unmount');
			remoteCore.dispose();
			inputCore.dispose();
			stateCore.dispose();
		}),
	);
	const snapshot = useSyncExternalStore(
		stateCore.subscribe,
		stateCore.getSnapshot,
		stateCore.getSnapshot,
	);

	const copySelection = useCallback(async () => {
		const generation = authorityGeneration.current;
		const instanceId =
			committedDeps.current.terminalView.getRuntimeInstanceId();
		if (!instanceId) return;
		try {
			const text = await committedDeps.current.terminalView.getSelection();
			if (
				generation !== authorityGeneration.current ||
				!committedDeps.current.terminalView.isCurrentInstance(instanceId) ||
				!text ||
				text === copiedSelectionRef.current ||
				text === selectionCopyInFlightRef.current
			)
				return;
			selectionCopyInFlightRef.current = text;
			try {
				await Clipboard.setStringAsync(text);
			} finally {
				if (selectionCopyInFlightRef.current === text)
					selectionCopyInFlightRef.current = '';
			}
			if (
				generation !== authorityGeneration.current ||
				!committedDeps.current.terminalView.isCurrentInstance(instanceId)
			)
				return;
			copiedSelectionRef.current = text;
			stateCore.setSelectionModeEnabled(false);
			committedDeps.current.terminalView.setSelectionModeEnabled(false);
			if (generation === authorityGeneration.current)
				stateCore.completeSlotPress();
		} catch (error) {
			committedDeps.current.logger?.warn(
				'Failed to copy terminal selection',
				error,
			);
		}
	}, [stateCore]);

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

	useEffect(() => lifecycle.setup(), [lifecycle]);
	useEffect(() => {
		if ((deps.platformOS ?? Platform.OS) !== 'android') return;
		const show = Keyboard.addListener('keyboardDidShow', () => {
			visibleRef.current = true;
		});
		const hide = Keyboard.addListener('keyboardDidHide', () => {
			visibleRef.current = false;
		});
		return () => {
			show.remove();
			hide.remove();
		};
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
		if (firstKeyboardRef.current) {
			firstKeyboardRef.current = false;
			return;
		}
		if (!snapshot.keyboard) return;
		// eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- The effect deliberately mirrors the committed keyboard into transient animation copy.
		setFlashName(snapshot.keyboard.name);
		flashOpacity.setValue(1);
		const animation = Animated.timing(flashOpacity, {
			toValue: 0,
			duration: 800,
			delay: 400,
			useNativeDriver: true,
		});
		animation.start(({ finished }) => {
			if (finished) setFlashName(null);
		});
		return () => animation.stop();
	}, [flashOpacity, snapshot.keyboard]);

	const onAction = useCallback((actionId: ActionId) => {
		void runAction(actionId, actionContextRef.current!);
	}, []);
	const onSelectionModeChange = useCallback(
		(enabled: boolean) => {
			stateCore.setSelectionModeEnabled(enabled);
			try {
				committedDeps.current.terminalView.setSelectionModeEnabled(enabled);
			} catch (error) {
				committedDeps.current.logger?.warn(
					'Failed to change terminal selection mode',
					error,
				);
			}
		},
		[stateCore],
	);
	const invalidate = useCallback(
		(reason: ControllerInvalidationReason) => {
			authorityGeneration.current += 1;
			inputCore.invalidate(reason);
			remoteCore.invalidate(reason);
		},
		[inputCore, remoteCore],
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
			terminalKeyboardProps: {
				keyboard: snapshot.keyboard,
				modifierKeysActive: [...snapshot.modifierKeysActive],
				onSlotPress: (slot) => {
					void inputCore.handleSlotPress(slot);
				},
				selectionModeEnabled: snapshot.selectionModeEnabled,
				onCopySelection: () => {
					void copySelection();
				},
				navScope: deps.navScope,
			},
			commandMenuProps: {
				entries: [...snapshot.shellConfigState.config.commandMenus],
				onSelect: (preset) => {
					void inputCore.runCommandPreset(preset);
				},
				onAction,
				onBridge: (entry) => {
					void remoteCore.handleCommandBridgeEntry(entry);
				},
			},
			commanderProps: {
				onExecuteCommand: (value) => {
					void inputCore.executeCommanderCommand(value);
				},
				onPasteText: (value) => {
					void inputCore.pasteCommanderText(value);
				},
				onSendShortcut: (sequence) => {
					void inputCore.sendShortcut(sequence);
				},
			},
			textEntryProps: {
				onPaste: (value) => {
					void inputCore.pasteTextEntry(value);
				},
				history: {
					cycleEntries: snapshot.history.cycleEntries,
					pinnedEntries: snapshot.history.pinned,
					recentEntries: snapshot.history.recent,
					onPinText: stateCore.pinHistoryText,
					onPinEntry: stateCore.pinHistoryEntry,
					onUnpinEntry: stateCore.unpinHistoryEntry,
					onDeleteEntry: stateCore.deleteHistoryEntry,
					onClearRecent: stateCore.clearRecentHistory,
				},
			},
			configureProps: {
				...deps.configureCommands,
				onReloadConfig: () => {
					void remoteCore.reloadConfig();
				},
				configVersion: snapshot.shellConfigState.config.version,
				configUpdatedAt: snapshot.shellConfigState.config.updatedAt,
				configSource: snapshot.shellConfigState.source,
				configLastLoadedAt: snapshot.shellConfigState.lastLoadedAt,
				configLastError: snapshot.shellConfigState.lastError,
			},
			onWebViewInput: (input) => {
				void inputCore.onWebViewInput({ ...input });
			},
			onSelectionChanged: (text) => {
				if (text !== copiedSelectionRef.current)
					copiedSelectionRef.current = '';
			},
			onSelectionModeChange,
			onCommandBridgeEntry: (entry) => {
				void remoteCore.handleCommandBridgeEntry(entry);
			},
			invalidate,
		}),
		[
			copySelection,
			deps.configureCommands,
			deps.navScope,
			flashName,
			flashOpacity,
			inputCore,
			invalidate,
			onAction,
			onSelectionModeChange,
			remoteCore,
			snapshot,
			stateCore,
		],
	);
}
