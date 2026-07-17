import { type ActionId } from '@/lib/keyboard-actions';
import {
	type CommandBridgeEntry,
	type CommandMenuEntry,
	type CommandPreset,
	type KeyboardDefinition,
	type KeyboardExecutableItem,
	type ModifierKey,
} from '@/lib/shell-config';
import { type WorkmuxNavScope } from '@/lib/workmux-app-commands';

export type WorkKeyLongPressMode = 'workmux-scoped' | 'configured';

export type TerminalKeyboardProps = {
	keyboard: KeyboardDefinition | null;
	modifierKeysActive: ModifierKey[];
	onSlotPress: (slot: KeyboardExecutableItem) => void;
	selectionModeEnabled: boolean;
	onCopySelection: () => void;
	navScope?: WorkmuxNavScope;
	workKeyLongPressMode?: WorkKeyLongPressMode;
};
export type CommandMenuModalProps = {
	open: boolean;
	entries: CommandMenuEntry[];
	bottomOffset: number;
	onClose: () => void;
	onSelect: (preset: CommandPreset) => void;
	onAction: (actionId: ActionId) => void;
	onBridge: (entry: CommandBridgeEntry) => void;
};
export type TerminalCommanderModalProps = {
	open: boolean;
	bottomOffset: number;
	onClose: () => void;
	onExecuteCommand: (value: string) => void;
	onPasteText: (value: string) => void;
	onSendShortcut: (sequence: string) => void;
};
export type ConfigureModalProps = {
	open: boolean;
	bottomOffset: number;
	onClose: () => void;
	onDevServer: () => void;
	onReloadConfig: () => void;
	onHostConfig: () => void;
	onRequestFeature: () => void;
	onOpenGitHubIssues: () => void;
	onOpenShellConfigDocs: () => void;
	configVersion: string;
	configUpdatedAt: string;
	configSource: string;
	configLastLoadedAt: string | null;
	configLastError: string | null;
};
