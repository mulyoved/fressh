import { type RunActionOptions } from '@/lib/keyboard-actions';
import { type KeyboardExecutableItem } from '@/lib/shell-config';
import { getWorkmuxNavScopeOverride } from '@/lib/work-key-long-press-options';

export function getKeyboardActionRunOptions(
	slot: KeyboardExecutableItem,
): RunActionOptions {
	return slot.type === 'action'
		? { workmuxNavScopeOverride: getWorkmuxNavScopeOverride(slot) }
		: {};
}
