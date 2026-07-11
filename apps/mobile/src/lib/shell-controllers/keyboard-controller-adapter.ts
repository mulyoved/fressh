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
import { type ShellActivitySnapshot } from './activity-core';
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

export type ShellKeyboardControllerAdapterPorts = {
	activity: {
		getSnapshot(): ShellActivitySnapshot;
	};
	sourceKey: unknown;
	terminalView: Pick<
		ShellTerminalRuntimeView,
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
				const ports = input.getPorts();
				return {
					generation,
					source: ports.sourceKey,
					runtime: ports.terminalView.getRuntimeKey(),
					instance: ports.terminalView.getRuntimeInstanceId(),
					activityGeneration: ports.activity.getSnapshot().generation,
				};
			},
			isCurrent: (token) => {
				const ports = input.getPorts();
				return (
					input.admission.isCurrent(token.generation) &&
					Object.is(token.source, ports.sourceKey) &&
					token.runtime === ports.terminalView.getRuntimeKey() &&
					token.instance === ports.terminalView.getRuntimeInstanceId() &&
					(token.instance === null ||
						ports.terminalView.isCurrentInstance(token.instance)) &&
					token.activityGeneration === ports.activity.getSnapshot().generation
				);
			},
			readClipboard: () => input.getPorts().readClipboard(),
			paste: (text) => input.inputCore.pasteClipboard(text),
			warn: input.warn,
		});
		await command();
	};
	const createActionContext = (): ActionContext => {
		const ports = input.getPorts();
		return {
			availableKeyboardIds: new Set(
				input.stateCore.getSnapshot().activeKeyboardIds,
			),
			selectKeyboard: input.stateCore.selectKeyboardIfExists,
			resolveKeyboardActionTarget: (actionId) =>
				getKeyboardActionTarget(
					input.stateCore.getSnapshot().shellConfigState.config,
					actionId,
				),
			rotateKeyboard: input.stateCore.rotateKeyboard,
			openConfigurator: ports.modalCommands.openConfigurator,
			sendBytes: (bytes) => {
				void input.inputCore.sendBytes(bytes);
			},
			pasteClipboard,
			copySelection,
			fitTerminalToDevice: ports.fitTerminalToDevice,
			restartCodex: async () => {
				await input.remoteCore.restartCodex();
			},
			debugConnectionInCodex: ports.debugConnectionInCodex,
			toggleCommandMenu: ports.modalCommands.toggleCommandMenu,
			openCommander: ports.modalCommands.openCommander,
			openSkillSelector: ports.modalCommands.openSkillSelector,
			openBrowserActions: ports.modalCommands.openBrowserActions,
			openRepoFeatureRequest: ports.modalCommands.openFeatureRequest,
			openWisprTextEditor: ports.modalCommands.openWisprTextEditor,
			openHostDiffity: ports.browserCommands.openDiff,
			openHostUrlSlot: ports.browserCommands.openUrlSlot,
			openHostDetected: ports.browserCommands.openDetected,
			editHostUrlSlot: ports.browserCommands.editUrlSlot,
			runWorkmuxKeyboardCommand: input.remoteCore.runWorkmuxCommand,
			setNavScope: ports.setNavScope,
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
				setSelectionMode: input.stateCore.setSelectionModeEnabled,
				setTerminalSystemKeyboard: ports.terminalView.setSystemKeyboardEnabled,
				dismissKeyboard: ports.dismissKeyboard,
				clearKeyboardVisibility: ports.clearKeyboardVisibility,
				setSystemKeyboard: input.stateCore.setSystemKeyboardEnabled,
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
			input.clipboardAuthority.noteSelection(text, instanceId);
		},
	};
}
