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
