import { type HostBrowserUrlSlot } from '@/lib/host-browser-actions';
import {
	runAction,
	type ActionContext,
	type ActionId,
	type RunActionOptions,
} from '@/lib/keyboard-actions';
import {
	getKeyboardActionTarget,
	type CommandBridgeEntry,
	type CommandPreset,
	type KeyboardExecutableItem,
} from '@/lib/shell-config';
import { type WorkmuxNavScope } from '../workmux-app-commands';
import { type ControllerInvalidationReason } from './controller-core';
import {
	applyKeyboardSelectionMode,
	createKeyboardPasteClipboardCommand,
	runKeyboardFireAndForget,
	type KeyboardClipboardAuthority,
	type KeyboardClipboardOutcome,
	type KeyboardControllerAdmission,
} from './keyboard-hook-runtime';
import { type ShellKeyboardInputCore } from './keyboard-input-contracts';
import { type ShellKeyboardRemoteCore } from './keyboard-remote-contracts';
import { type ShellKeyboardStateCore } from './keyboard-state-core';
import { type ShellActivityPort } from './session-contracts';
import { type ShellTerminalViewPort } from './terminal-contracts';

export type ShellKeyboardModalCommands = {
	toggleCommandMenu(): void;
	openCommander(): void;
	openNewWorktreeWorkspace?(): void;
	openCloseWorktreeWorkspace?(): void;
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

export type ShellKeyboardControllerAdapterPorts = {
	activity: ShellActivityPort;
	sourceKey: unknown;
	terminalView: Pick<
		ShellTerminalViewPort,
		| 'getRuntimeKey'
		| 'getRuntimeInstanceId'
		| 'isCurrentInstance'
		| 'getSelection'
		| 'setSelectionModeEnabled'
		| 'setSystemKeyboardEnabled'
	>;
	modalCommands: ShellKeyboardModalCommands;
	browserCommands: ShellKeyboardBrowserCommands;
	fitTerminalToDevice(): void | Promise<void>;
	debugConnectionInCodex(): void | Promise<void>;
	setNavScope(scope: WorkmuxNavScope): void;
	platformOS: string;
	dismissKeyboard(): void;
	clearKeyboardVisibility(): void;
	readClipboard(): Promise<string>;
	writeClipboard(text: string): Promise<void>;
};

export type ShellKeyboardControllerAdapter = {
	runAction(
		actionId: ActionId,
		options?: RunActionOptions,
	): ReturnType<typeof runAction>;
	copySelection(): Promise<KeyboardClipboardOutcome>;
	pasteClipboard(): Promise<void>;
	onAction(actionId: ActionId): void;
	onSelectionModeChange(enabled: boolean): void;
	invalidate(reason: ControllerInvalidationReason): void;
	onSlotPress(slot: KeyboardExecutableItem): void;
	onCopySelection(): void;
	onPreset(preset: CommandPreset): void;
	onBridge(entry: CommandBridgeEntry): void;
	onExecuteCommand(value: string): void;
	onPasteText(value: string): void;
	onSendShortcut(sequence: string): void;
	onTextEntryPaste(value: string): void;
	onReloadConfig(): void;
	onWebViewInput(input: { str: string; instanceId: string }): void;
	onSelectionChanged(text: string): void;
};

export function createShellKeyboardControllerAdapter(input: {
	admission: KeyboardControllerAdmission;
	stateCore: ShellKeyboardStateCore;
	inputCore: ShellKeyboardInputCore;
	remoteCore: ShellKeyboardRemoteCore;
	clipboardAuthority: KeyboardClipboardAuthority;
	getPorts(): ShellKeyboardControllerAdapterPorts;
	warn(message: string, error: unknown): void;
}): ShellKeyboardControllerAdapter {
	const admitted = () => input.admission.getGeneration() !== null;
	const copySelection = async (): Promise<KeyboardClipboardOutcome> => {
		return await input.clipboardAuthority.copy({
			isAdmitted: admitted,
			getInstanceId: () => input.getPorts().terminalView.getRuntimeInstanceId(),
			getSelection: () => input.getPorts().terminalView.getSelection(),
			isCurrentInstance: (id) =>
				input.getPorts().terminalView.isCurrentInstance(id),
			writeClipboard: (text) => input.getPorts().writeClipboard(text),
			exitSelectionState: () => input.stateCore.setSelectionModeEnabled(false),
			exitSelectionView: () =>
				input.getPorts().terminalView.setSelectionModeEnabled(false),
			warn: input.warn,
		});
	};
	const pasteClipboard = async (): Promise<void> => {
		const command = createKeyboardPasteClipboardCommand({
			captureAuthority: () => {
				const generation = input.admission.getGeneration();
				if (generation === null) return null;
				const source = input.getPorts().sourceKey;
				if (!input.admission.isCurrent(generation)) return null;
				const runtime = input.getPorts().terminalView.getRuntimeKey();
				if (!input.admission.isCurrent(generation)) return null;
				const instance = input.getPorts().terminalView.getRuntimeInstanceId();
				if (!input.admission.isCurrent(generation)) return null;
				const activityGeneration = input
					.getPorts()
					.activity.getSnapshot().generation;
				if (!input.admission.isCurrent(generation)) return null;
				return {
					generation,
					source,
					runtime,
					instance,
					activityGeneration,
				};
			},
			isCurrent: (token) => {
				if (!input.admission.isCurrent(token.generation)) return false;
				if (!Object.is(token.source, input.getPorts().sourceKey)) return false;
				if (!input.admission.isCurrent(token.generation)) return false;
				if (token.runtime !== input.getPorts().terminalView.getRuntimeKey())
					return false;
				if (!input.admission.isCurrent(token.generation)) return false;
				if (
					token.instance !==
					input.getPorts().terminalView.getRuntimeInstanceId()
				)
					return false;
				if (!input.admission.isCurrent(token.generation)) return false;
				if (
					token.instance !== null &&
					!input.getPorts().terminalView.isCurrentInstance(token.instance)
				)
					return false;
				if (!input.admission.isCurrent(token.generation)) return false;
				return (
					token.activityGeneration ===
					input.getPorts().activity.getSnapshot().generation
				);
			},
			readClipboard: () => input.getPorts().readClipboard(),
			paste: (text) => input.inputCore.pasteClipboard(text),
			warn: input.warn,
		});
		await command();
	};
	const createActionContext = (): ActionContext => {
		return {
			availableKeyboardIds: new Set(
				input.stateCore.getSnapshot().activeKeyboardIds,
			),
			selectKeyboard: (id) => input.stateCore.selectKeyboardIfExists(id),
			resolveKeyboardActionTarget: (actionId) =>
				getKeyboardActionTarget(
					input.stateCore.getSnapshot().shellConfigState.config,
					actionId,
				),
			rotateKeyboard: () => input.stateCore.rotateKeyboard(),
			openConfigurator: () => input.getPorts().modalCommands.openConfigurator(),
			sendBytes: (bytes) => {
				void input.inputCore.sendBytes(bytes);
			},
			pasteClipboard,
			copySelection,
			fitTerminalToDevice: () => input.getPorts().fitTerminalToDevice(),
			restartCodex: async () => {
				await input.remoteCore.restartCodex();
			},
			debugConnectionInCodex: () => input.getPorts().debugConnectionInCodex(),
			toggleCommandMenu: () =>
				input.getPorts().modalCommands.toggleCommandMenu(),
			openCommander: () => input.getPorts().modalCommands.openCommander(),
			openNewWorktreeWorkspace: () =>
				input.getPorts().modalCommands.openNewWorktreeWorkspace?.(),
			openCloseWorktreeWorkspace: () =>
				input.getPorts().modalCommands.openCloseWorktreeWorkspace?.(),
			openSkillSelector: () =>
				input.getPorts().modalCommands.openSkillSelector(),
			openBrowserActions: () =>
				input.getPorts().modalCommands.openBrowserActions(),
			openRepoFeatureRequest: () =>
				input.getPorts().modalCommands.openFeatureRequest(),
			openWisprTextEditor: () =>
				input.getPorts().modalCommands.openWisprTextEditor(),
			openHostDiffity: () => input.getPorts().browserCommands.openDiff(),
			openHostUrlSlot: (slot) =>
				input.getPorts().browserCommands.openUrlSlot(slot),
			openHostDetected: (mode) =>
				input.getPorts().browserCommands.openDetected(mode),
			editHostUrlSlot: (slot) =>
				input.getPorts().browserCommands.editUrlSlot(slot),
			runWorkmuxKeyboardCommand: (command) =>
				input.remoteCore.runWorkmuxCommand(command),
			setNavScope: (scope) => input.getPorts().setNavScope(scope),
		};
	};
	const runCanonicalAction = (actionId: ActionId, options?: RunActionOptions) =>
		runAction(actionId, createActionContext(), options);
	return {
		runAction: runCanonicalAction,
		copySelection,
		pasteClipboard,
		onAction: (actionId) => {
			const generation = input.admission.getGeneration();
			if (generation === null) return;
			runKeyboardFireAndForget(
				() => runCanonicalAction(actionId),
				() => input.admission.isCurrent(generation),
				input.warn,
			);
		},
		onSelectionModeChange: (enabled) => {
			const generation = input.admission.getGeneration();
			if (generation === null) return;
			const ports = input.getPorts();
			applyKeyboardSelectionMode({
				enabled,
				platformOS: ports.platformOS,
				isCurrent: () => input.admission.isCurrent(generation),
				setSelectionMode: (value) =>
					input.stateCore.setSelectionModeEnabled(value),
				setTerminalSelectionMode: (value) =>
					input.getPorts().terminalView.setSelectionModeEnabled(value),
				setTerminalSystemKeyboard: (value) =>
					input.getPorts().terminalView.setSystemKeyboardEnabled(value),
				dismissKeyboard: () => input.getPorts().dismissKeyboard(),
				clearKeyboardVisibility: () =>
					input.getPorts().clearKeyboardVisibility(),
				setSystemKeyboard: (value) =>
					input.stateCore.setSystemKeyboardEnabled(value),
				warn: input.warn,
			});
		},
		invalidate: (reason) => input.admission.invalidate(reason),
		onSlotPress: (slot) => {
			if (admitted()) void input.inputCore.handleSlotPress(slot);
		},
		onCopySelection: () => {
			if (admitted())
				void input.inputCore.handleSlotPress({
					type: 'action',
					actionId: 'COPY_SELECTION',
					label: 'Copy selection',
					icon: null,
				});
		},
		onPreset: (preset) => {
			if (admitted()) void input.inputCore.runCommandPreset(preset);
		},
		onBridge: (entry) => {
			if (admitted()) void input.remoteCore.handleCommandBridgeEntry(entry);
		},
		onExecuteCommand: (value) => {
			if (admitted()) void input.inputCore.executeCommanderCommand(value);
		},
		onPasteText: (value) => {
			if (admitted()) void input.inputCore.pasteCommanderText(value);
		},
		onSendShortcut: (sequence) => {
			if (admitted()) void input.inputCore.sendShortcut(sequence);
		},
		onTextEntryPaste: (value) => {
			if (admitted()) void input.inputCore.pasteTextEntry(value);
		},
		onReloadConfig: () => {
			if (admitted()) void input.remoteCore.reloadConfig();
		},
		onWebViewInput: (webViewInput) => {
			if (admitted()) void input.inputCore.onWebViewInput({ ...webViewInput });
		},
		onSelectionChanged: (text) => {
			if (!admitted()) return;
			let instanceId: string | null;
			try {
				instanceId = input.getPorts().terminalView.getRuntimeInstanceId();
			} catch (error) {
				input.warn('Failed to read selection change terminal instance', error);
				return;
			}
			if (!admitted()) return;
			input.clipboardAuthority.noteSelection(text, instanceId);
		},
	};
}
