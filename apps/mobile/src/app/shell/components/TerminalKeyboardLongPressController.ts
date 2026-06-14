import {
	getLongPressPopupLayout,
	getLongPressTrackedOptionIndex,
	type LongPressKeyboardBounds,
	type LongPressPopupLayout,
} from '@/lib/keyboard-long-press';
import { type KeyboardSlot } from '@/lib/shell-config';
import {
	getWorkKeyLongPressOptions,
	type ResolvedKeyboardLongPressOption,
} from '@/lib/work-key-long-press-options';
import { type WorkmuxNavScope } from '@/lib/workmux-app-commands';

export type TerminalKeyboardLongPressPopupState = {
	options: readonly ResolvedKeyboardLongPressOption[];
	layout: LongPressPopupLayout;
	highlightedIndex: number | null;
};

export function buildTerminalKeyboardLongPressPopup({
	slot,
	getNavScope,
	keyboardWidth,
	keyboardBounds,
	anchorX,
	anchorY,
	anchorWidth,
	pointerLocalX,
	pointerLocalY,
}: {
	slot: KeyboardSlot;
	getNavScope: () => WorkmuxNavScope;
	keyboardWidth: number;
	keyboardBounds?: LongPressKeyboardBounds | null;
	anchorX: number;
	anchorY: number;
	anchorWidth: number;
	pointerLocalX: number;
	pointerLocalY: number;
}): TerminalKeyboardLongPressPopupState | null {
	const options =
		getWorkKeyLongPressOptions(slot, getNavScope()) ?? slot.longPress?.options;
	if (!options?.length) return null;

	const layout = getLongPressPopupLayout({
		keyboardWidth,
		anchorX,
		anchorY,
		anchorWidth,
		optionCount: options.length,
	});

	return {
		options,
		layout,
		highlightedIndex: getLongPressTrackedOptionIndex({
			layout,
			keyboardBounds,
			localX: pointerLocalX,
			localY: pointerLocalY,
			previousIndex: null,
		}),
	};
}
