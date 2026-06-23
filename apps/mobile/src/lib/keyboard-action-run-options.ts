import { type RunActionOptions } from '@/lib/keyboard-actions';
import { type KeyboardExecutableItem } from '@/lib/shell-config';
import { getWorkmuxNavScopeOverride } from '@/lib/work-key-long-press-options';

type KeyboardActionSlot = Extract<KeyboardExecutableItem, { type: 'action' }>;

export function getKeyboardActionRunOptions(
	slot: KeyboardExecutableItem,
): RunActionOptions {
	return slot.type === 'action'
		? { workmuxNavScopeOverride: getWorkmuxNavScopeOverride(slot) }
		: {};
}

export function runKeyboardActionSlot(
	slot: KeyboardActionSlot,
	handleAction: (actionId: string, options: RunActionOptions) => void,
): void {
	handleAction(slot.actionId, getKeyboardActionRunOptions(slot));
}
