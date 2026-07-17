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
import { type WorkKeyLongPressMode } from './keyboard-component-props';

export type TerminalKeyboardLongPressPopupState = {
	options: readonly ResolvedKeyboardLongPressOption[];
	layout: LongPressPopupLayout;
	highlightedIndex: number | null;
};

type CurrentRef<T> = {
	current: T;
};

type TerminalKeyboardLongPressGestureForOpen = {
	slot: KeyboardSlot;
	keyRef: object;
	generation: number;
	currentPageX: number;
	currentPageY: number;
	longPressFired: boolean;
};

export function activateTerminalKeyboardLongPressMount({
	isMountedRef,
}: {
	isMountedRef: CurrentRef<boolean>;
}) {
	isMountedRef.current = true;
}

export function deactivateTerminalKeyboardLongPressMount({
	isMountedRef,
	longPressGenerationRef,
	longPressGestureRef,
	clearPopup,
}: {
	isMountedRef: CurrentRef<boolean>;
	longPressGenerationRef: CurrentRef<number>;
	longPressGestureRef: CurrentRef<TerminalKeyboardLongPressGestureForOpen | null>;
	clearPopup: () => void;
}) {
	isMountedRef.current = false;
	longPressGenerationRef.current += 1;
	longPressGestureRef.current = null;
	clearPopup();
}

export function buildTerminalKeyboardLongPressPopup({
	slot,
	getNavScope,
	workKeyLongPressMode = 'workmux-scoped',
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
	workKeyLongPressMode?: WorkKeyLongPressMode;
	keyboardWidth: number;
	keyboardBounds?: LongPressKeyboardBounds | null;
	anchorX: number;
	anchorY: number;
	anchorWidth: number;
	pointerLocalX: number;
	pointerLocalY: number;
}): TerminalKeyboardLongPressPopupState | null {
	const options =
		workKeyLongPressMode === 'configured'
			? slot.longPress?.options
			: (getWorkKeyLongPressOptions(slot, getNavScope()) ??
				slot.longPress?.options);
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

export function createTerminalKeyboardLongPressMeasureCallback({
	slot,
	keyRef,
	generation,
	isMountedRef,
	longPressGenerationRef,
	longPressGestureRef,
	keyboardRootWindowRef,
	keyboardBoundsRef,
	keyboardWidthRef,
	navScopeRef,
	workKeyLongPressMode = 'workmux-scoped',
	setLongPressPopup,
}: {
	slot: KeyboardSlot;
	keyRef: object;
	generation: number;
	isMountedRef: CurrentRef<boolean>;
	longPressGenerationRef: CurrentRef<number>;
	longPressGestureRef: CurrentRef<TerminalKeyboardLongPressGestureForOpen | null>;
	keyboardRootWindowRef: CurrentRef<{ x: number; y: number }>;
	keyboardBoundsRef: CurrentRef<LongPressKeyboardBounds | null>;
	keyboardWidthRef: CurrentRef<number>;
	navScopeRef: CurrentRef<WorkmuxNavScope>;
	workKeyLongPressMode?: WorkKeyLongPressMode;
	setLongPressPopup: (popup: TerminalKeyboardLongPressPopupState) => void;
}) {
	return (x: number, y: number, width: number) => {
		if (
			!isMountedRef.current ||
			longPressGenerationRef.current !== generation
		) {
			return;
		}
		const gesture = longPressGestureRef.current;
		if (
			!gesture ||
			gesture.generation !== generation ||
			gesture.slot !== slot ||
			gesture.keyRef !== keyRef ||
			!gesture.longPressFired
		) {
			return;
		}
		const root = keyboardRootWindowRef.current;
		const nextPopup = buildTerminalKeyboardLongPressPopup({
			slot,
			getNavScope: () => navScopeRef.current,
			workKeyLongPressMode,
			keyboardWidth: keyboardWidthRef.current,
			keyboardBounds: keyboardBoundsRef.current,
			anchorX: x - root.x,
			anchorY: y - root.y,
			anchorWidth: width,
			pointerLocalX: gesture.currentPageX - root.x,
			pointerLocalY: gesture.currentPageY - root.y,
		});
		if (
			!nextPopup ||
			!isMountedRef.current ||
			longPressGenerationRef.current !== generation
		) {
			return;
		}
		setLongPressPopup(nextPopup);
	};
}
