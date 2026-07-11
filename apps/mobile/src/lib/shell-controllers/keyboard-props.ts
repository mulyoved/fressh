import {
	type CommandMenuModalProps,
	type TerminalCommanderModalProps,
	type TerminalKeyboardProps,
} from '../../app/shell/components/keyboard-component-props';
import { type WorkmuxNavScope } from '../workmux-app-commands';

export type ShellTerminalKeyboardProps = Omit<
	TerminalKeyboardProps,
	'navScope'
> & {
	navScope: WorkmuxNavScope;
};
export type ShellCommandMenuProps = Pick<
	CommandMenuModalProps,
	'entries' | 'onSelect' | 'onAction' | 'onBridge'
>;
export type ShellCommanderProps = Pick<
	TerminalCommanderModalProps,
	'onExecuteCommand' | 'onPasteText' | 'onSendShortcut'
>;

export function createShellKeyboardPropBundles(input: {
	terminal: ShellTerminalKeyboardProps;
	commandMenu: ShellCommandMenuProps;
	commander: ShellCommanderProps;
}): {
	terminal: ShellTerminalKeyboardProps;
	commandMenu: ShellCommandMenuProps;
	commander: ShellCommanderProps;
} {
	return {
		terminal: createShellTerminalKeyboardProps(input.terminal),
		commandMenu: createShellCommandMenuProps(input.commandMenu),
		commander: createShellCommanderProps(input.commander),
	};
}

export const createShellTerminalKeyboardProps = (
	input: ShellTerminalKeyboardProps,
): ShellTerminalKeyboardProps => ({
	...input,
	modifierKeysActive: [...input.modifierKeysActive],
});
export const createShellCommandMenuProps = (
	input: ShellCommandMenuProps,
): ShellCommandMenuProps => ({
	...input,
	entries: [...input.entries],
});
export const createShellCommanderProps = (
	input: ShellCommanderProps,
): ShellCommanderProps => ({ ...input });
