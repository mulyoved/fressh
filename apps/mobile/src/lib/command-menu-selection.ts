import type { ActionId } from '@/lib/keyboard-actions';
import type {
	CommandPreset,
	CommandPresetEntry,
	CommandPresetMenu,
} from '@/lib/shell-config';

export type CommandMenuSelectionResult =
	| { type: 'submenu'; menu: CommandPresetMenu }
	| { type: 'preset'; preset: CommandPreset }
	| { type: 'action'; actionId: ActionId };

export type CommandMenuSelectionDispatchHandlers = {
	onSubmenu: (menu: CommandPresetMenu) => void;
	onPreset: (preset: CommandPreset) => void;
	onClose: () => void;
	onAction: (actionId: ActionId) => void;
};

export function resolveCommandMenuSelection(
	entry: CommandPresetEntry,
): CommandMenuSelectionResult {
	switch (entry.type) {
		case 'submenu':
			return { type: 'submenu', menu: entry };
		case 'preset':
			return { type: 'preset', preset: entry };
		case 'action':
			return { type: 'action', actionId: entry.actionId };
	}
}

export function dispatchCommandMenuSelection(
	entry: CommandPresetEntry,
	handlers: CommandMenuSelectionDispatchHandlers,
) {
	const selection = resolveCommandMenuSelection(entry);
	switch (selection.type) {
		case 'submenu':
			handlers.onSubmenu(selection.menu);
			return;
		case 'preset':
			handlers.onPreset(selection.preset);
			return;
		case 'action':
			handlers.onClose();
			handlers.onAction(selection.actionId);
			return;
	}
}
