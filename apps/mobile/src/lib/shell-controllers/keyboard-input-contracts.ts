import { type ActionId, type RunActionOptions } from '@/lib/keyboard-actions';
import {
	type CommandPreset,
	type CommandStep,
	type KeyboardExecutableItem,
	type ModifierKey,
} from '@/lib/shell-config';

import { type ShellActivitySnapshot } from './activity-core';
import {
	type ControllerInvalidationReason,
	type ControllerOutcome,
} from './controller-core';
import { type ShellKeyboardStateSnapshot } from './keyboard-state-core';
import { type ShellScrollbackInputPort } from './scrollback-contracts';
import { type ShellTerminalViewPort } from './terminal-contracts';

export type KeyboardInputOutcome = ControllerOutcome<{ message: string }>;
export type KeyboardInputTimerHandle = unknown;

export type ShellKeyboardInputLogger = {
	warn(message: string, error?: unknown): void;
};

export type ShellKeyboardInputStatePort = {
	getSnapshot(): Pick<
		ShellKeyboardStateSnapshot,
		| 'shellConfigState'
		| 'keyboard'
		| 'macros'
		| 'modifierKeysActive'
		| 'selectionModeEnabled'
	>;
	applyModifiers(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>;
	setSelectionModeEnabled(enabled: boolean): void;
	recordAcceptedTextPaste(text: string): void;
	completeSlotPress(): void;
	toggleModifier(modifier: ModifierKey): void;
};

export type ShellKeyboardInputCore = {
	sendBytes(bytes: Uint8Array<ArrayBuffer>): Promise<KeyboardInputOutcome>;
	sendBytesWithModifiers(
		bytes: Uint8Array<ArrayBuffer>,
	): Promise<KeyboardInputOutcome>;
	sendTextRaw(value: string): Promise<KeyboardInputOutcome>;
	sendTextWithModifiers(value: string): Promise<KeyboardInputOutcome>;
	onWebViewInput(input: {
		str: string;
		instanceId: string;
	}): Promise<KeyboardInputOutcome>;
	pasteClipboard(value: string): Promise<KeyboardInputOutcome>;
	pasteTextEntry(value: string): Promise<KeyboardInputOutcome>;
	executeCommanderCommand(value: string): Promise<KeyboardInputOutcome>;
	pasteCommanderText(value: string): Promise<KeyboardInputOutcome>;
	sendShortcut(sequence: string): Promise<KeyboardInputOutcome>;
	runCommandSteps(steps: readonly CommandStep[]): Promise<KeyboardInputOutcome>;
	runCommandPreset(preset: CommandPreset): Promise<KeyboardInputOutcome>;
	handleSlotPress(slot: KeyboardExecutableItem): Promise<KeyboardInputOutcome>;
	invalidate(reason: ControllerInvalidationReason): void;
	dispose(): void;
};

export type CreateShellKeyboardInputCoreOptions = {
	state: ShellKeyboardInputStatePort;
	scrollbackInput: ShellScrollbackInputPort;
	terminalView: Pick<
		ShellTerminalViewPort,
		| 'getRuntimeKey'
		| 'getRuntimeInstanceId'
		| 'isCurrentInstance'
		| 'setSelectionModeEnabled'
	>;
	getActivitySnapshot(): ShellActivitySnapshot;
	getSourceKey(): unknown;
	runAction(
		actionId: ActionId,
		options?: RunActionOptions,
	): void | KeyboardInputOutcome | PromiseLike<void | KeyboardInputOutcome>;
	setTimeout(task: () => void, delayMs: number): KeyboardInputTimerHandle;
	clearTimeout(timer: KeyboardInputTimerHandle): void;
	closeCommandMenu?(): void;
	logger?: ShellKeyboardInputLogger;
};
