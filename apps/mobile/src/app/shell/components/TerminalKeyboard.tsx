import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	Pressable,
	type GestureResponderEvent,
	type LayoutChangeEvent,
	Text,
	View,
} from 'react-native';
import {
	getLongPressMoveState,
	getLongPressReleaseDecision,
	getLongPressTrackedOptionIndex,
	type LongPressKeyboardBounds,
} from '@/lib/keyboard-long-press';
import { resolveLucideIcon } from '@/lib/lucide-utils';
import {
	type KeyboardExecutableItem,
	type KeyboardSlot,
} from '@/lib/shell-config';
import { useTheme } from '@/lib/theme';
import {
	getWorkmuxScopeForActionId,
	WORKMUX_NAV_SCOPE_BADGE_LABEL,
} from '@/lib/work-key-long-press-options';
import { type WorkmuxNavScope } from '@/lib/workmux-app-commands';
import { type TerminalKeyboardProps } from './keyboard-component-props';
import {
	activateTerminalKeyboardLongPressMount,
	createTerminalKeyboardLongPressMeasureCallback,
	deactivateTerminalKeyboardLongPressMount,
	type TerminalKeyboardLongPressPopupState,
} from './TerminalKeyboardLongPressController';
import { TerminalKeyboardLongPressPopup } from './TerminalKeyboardLongPressPopup';
export type { TerminalKeyboardProps } from './keyboard-component-props';

type LongPressGestureState = {
	slot: KeyboardSlot;
	keyRef: React.RefObject<View | null>;
	generation: number;
	startPageX: number;
	startPageY: number;
	currentPageX: number;
	currentPageY: number;
	movedBeyondTapSlop: boolean;
	longPressFired: boolean;
};

type KeyboardTheme = ReturnType<typeof useTheme>;

function slotHasNavScopeOptions(slot: KeyboardSlot): boolean {
	return Boolean(
		slot.longPress?.options.some(
			(option) =>
				option.type === 'action' &&
				getWorkmuxScopeForActionId(option.actionId) !== null,
		),
	);
}

function TerminalKeyboardKey({
	slot,
	span,
	keyHeight,
	theme,
	iconOnlyLabels,
	effectiveLabel,
	effectiveIconName,
	modifierActive,
	hasLongPressOptions,
	scopeBadge,
	isRepeatable,
	isSelectionCopySlot,
	onSlotPress,
	onCopySelection,
	startRepeat,
	clearRepeat,
	startLongPressGesture,
	moveLongPressGesture,
	releaseLongPressGesture,
	cancelLongPressGesture,
	runMainSlot,
}: {
	slot: KeyboardSlot;
	span: number;
	keyHeight: number;
	theme: KeyboardTheme;
	iconOnlyLabels: ReadonlySet<string>;
	effectiveLabel: string;
	effectiveIconName: string | null;
	modifierActive: boolean;
	hasLongPressOptions: boolean;
	scopeBadge: WorkmuxNavScope | null;
	isRepeatable: boolean;
	isSelectionCopySlot: boolean;
	onSlotPress: (slot: KeyboardExecutableItem) => void;
	onCopySelection: () => void;
	startRepeat: (slot: KeyboardSlot) => void;
	clearRepeat: () => void;
	startLongPressGesture: (
		slot: KeyboardSlot,
		keyRef: React.RefObject<View | null>,
		event: GestureResponderEvent,
	) => void;
	moveLongPressGesture: (event: GestureResponderEvent) => void;
	releaseLongPressGesture: (
		slot: KeyboardSlot,
		isSelectionCopySlot: boolean,
		event: GestureResponderEvent,
	) => void;
	cancelLongPressGesture: () => void;
	runMainSlot: (slot: KeyboardSlot, isSelectionCopySlot: boolean) => void;
}) {
	const keyRef = useRef<View | null>(null);
	const Icon = resolveLucideIcon(effectiveIconName);
	const showLabel = !(Icon && iconOnlyLabels.has(effectiveLabel));
	const keyStyle = [
		{
			flex: span,
			margin: 2,
			height: keyHeight,
			paddingVertical: 6,
			borderRadius: 8,
			borderWidth: 1,
			borderColor: theme.colors.border,
			alignItems: 'center' as const,
			justifyContent: 'center' as const,
		},
		modifierActive && {
			backgroundColor: theme.colors.primary,
		},
	];
	const keyContent = (
		<>
			{Icon ? <Icon color={theme.colors.textPrimary} size={18} /> : null}
			{showLabel ? (
				<Text
					numberOfLines={1}
					style={{
						color: theme.colors.textPrimary,
						fontSize: 10,
						lineHeight: 12,
						marginTop: Icon ? 2 : 0,
					}}
				>
					{effectiveLabel}
				</Text>
			) : null}
			{hasLongPressOptions ? (
				<View
					style={{
						position: 'absolute',
						top: 4,
						right: 4,
						width: 5,
						height: 5,
						borderRadius: 3,
						backgroundColor: theme.colors.textSecondary,
						opacity: 0.75,
					}}
				/>
			) : null}
			{scopeBadge ? (
				<View
					style={{
						position: 'absolute',
						top: 3,
						left: 4,
						paddingHorizontal: 3,
						borderRadius: 4,
						backgroundColor: theme.colors.primary,
					}}
				>
					<Text
						style={{
							color: theme.colors.textPrimary,
							fontSize: 8,
							lineHeight: 10,
							fontWeight: '700',
						}}
					>
						{WORKMUX_NAV_SCOPE_BADGE_LABEL[scopeBadge]}
					</Text>
				</View>
			) : null}
		</>
	);

	if (hasLongPressOptions) {
		return (
			<View
				ref={keyRef}
				accessible
				accessibilityRole="button"
				accessibilityLabel={effectiveLabel}
				onAccessibilityTap={() => runMainSlot(slot, isSelectionCopySlot)}
				onStartShouldSetResponder={() => true}
				onResponderGrant={(event) => startLongPressGesture(slot, keyRef, event)}
				onResponderMove={moveLongPressGesture}
				onResponderRelease={(event) =>
					releaseLongPressGesture(slot, isSelectionCopySlot, event)
				}
				onResponderTerminate={cancelLongPressGesture}
				onResponderTerminationRequest={() => false}
				style={keyStyle}
			>
				{keyContent}
			</View>
		);
	}

	return (
		<Pressable
			ref={keyRef}
			onPress={
				isRepeatable
					? undefined
					: isSelectionCopySlot
						? onCopySelection
						: () => onSlotPress(slot)
			}
			onPressIn={isRepeatable ? () => startRepeat(slot) : undefined}
			onPressOut={isRepeatable ? clearRepeat : undefined}
			style={keyStyle}
		>
			{keyContent}
		</Pressable>
	);
}

export function TerminalKeyboard({
	keyboard,
	modifierKeysActive,
	onSlotPress,
	selectionModeEnabled,
	onCopySelection,
	navScope = 'active',
}: TerminalKeyboardProps) {
	const theme = useTheme();
	// Fixed key height keeps all rows visually consistent even when some keys
	// render an icon+label stack and others are label-only.
	const keyHeight = 48;
	const repeatDelayMs = 320;
	const repeatIntervalMs = 70;
	const longPressDelayMs = 500;
	const tapSlopPx = 8;
	const repeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const repeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const repeatSlotRef = useRef<KeyboardSlot | null>(null);
	const longPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const isMountedRef = useRef(true);
	const longPressGenerationRef = useRef(0);
	const longPressGestureRef = useRef<LongPressGestureState | null>(null);
	const keyboardRootRef = useRef<View | null>(null);
	const keyboardRootWindowRef = useRef({ x: 0, y: 0 });
	const keyboardBoundsRef = useRef<LongPressKeyboardBounds | null>(null);
	const keyboardWidthRef = useRef(0);
	const longPressPopupRef = useRef<TerminalKeyboardLongPressPopupState | null>(
		null,
	);
	const navScopeRef = useRef(navScope);
	navScopeRef.current = navScope;
	const [longPressPopup, setLongPressPopup] =
		useState<TerminalKeyboardLongPressPopupState | null>(null);
	const iconOnlyLabels = useMemo(
		() =>
			new Set([
				'ARROW_LEFT',
				'ARROW_RIGHT',
				'ARROW_UP',
				'ARROW_DOWN',
				'PAGE_UP',
				'PAGE_DOWN',
			]),
		[],
	);
	const repeatableLabels = useMemo(
		() => new Set(['ARROW_LEFT', 'ARROW_RIGHT', 'ARROW_UP', 'ARROW_DOWN']),
		[],
	);

	const clearRepeat = useCallback(() => {
		if (repeatTimeoutRef.current) {
			clearTimeout(repeatTimeoutRef.current);
			repeatTimeoutRef.current = null;
		}
		if (repeatIntervalRef.current) {
			clearInterval(repeatIntervalRef.current);
			repeatIntervalRef.current = null;
		}
		repeatSlotRef.current = null;
	}, []);

	const clearLongPressTimer = useCallback(() => {
		if (longPressTimeoutRef.current) {
			clearTimeout(longPressTimeoutRef.current);
			longPressTimeoutRef.current = null;
		}
	}, []);

	const startRepeat = useCallback(
		(slot: KeyboardSlot) => {
			clearRepeat();
			repeatSlotRef.current = slot;
			onSlotPress(slot);
			repeatTimeoutRef.current = setTimeout(() => {
				repeatIntervalRef.current = setInterval(() => {
					if (repeatSlotRef.current) {
						onSlotPress(repeatSlotRef.current);
					}
				}, repeatIntervalMs);
			}, repeatDelayMs);
		},
		[clearRepeat, onSlotPress, repeatDelayMs, repeatIntervalMs],
	);

	useEffect(() => {
		activateTerminalKeyboardLongPressMount({ isMountedRef });
		return () => {
			deactivateTerminalKeyboardLongPressMount({
				isMountedRef,
				longPressGenerationRef,
				longPressGestureRef,
				clearPopup: () => {
					longPressPopupRef.current = null;
				},
			});
			clearRepeat();
			clearLongPressTimer();
		};
	}, [clearLongPressTimer, clearRepeat]);

	const closeLongPressPopup = useCallback(() => {
		longPressPopupRef.current = null;
		if (isMountedRef.current) {
			setLongPressPopup(null);
		}
	}, []);

	const updateKeyboardRootMetrics = useCallback(() => {
		keyboardRootRef.current?.measureInWindow((x, y, width, height) => {
			if (!isMountedRef.current) return;
			keyboardRootWindowRef.current = { x, y };
			keyboardBoundsRef.current =
				width > 0 && height > 0 ? { left: 0, top: 0, width, height } : null;
			keyboardWidthRef.current = width;
		});
	}, []);

	const handleKeyboardLayout = useCallback(
		(_event: LayoutChangeEvent) => {
			updateKeyboardRootMetrics();
		},
		[updateKeyboardRootMetrics],
	);

	const getLocalPoint = useCallback((event: GestureResponderEvent) => {
		return {
			localX: event.nativeEvent.pageX - keyboardRootWindowRef.current.x,
			localY: event.nativeEvent.pageY - keyboardRootWindowRef.current.y,
		};
	}, []);

	const updateLongPressHighlight = useCallback(
		({ localX, localY }: { localX: number; localY: number }) => {
			setLongPressPopup((current) => {
				if (!current) return current;
				const highlightedIndex = getLongPressTrackedOptionIndex({
					layout: current.layout,
					keyboardBounds: keyboardBoundsRef.current,
					localX,
					localY,
					previousIndex: current.highlightedIndex,
				});
				if (highlightedIndex === current.highlightedIndex) {
					longPressPopupRef.current = current;
					return current;
				}
				const next = { ...current, highlightedIndex };
				longPressPopupRef.current = next;
				return next;
			});
		},
		[],
	);

	const openLongPressPopup = useCallback(
		(
			slot: KeyboardSlot,
			keyRef: React.RefObject<View | null>,
			generation: number,
		) => {
			clearRepeat();
			updateKeyboardRootMetrics();
			keyRef.current?.measureInWindow(
				createTerminalKeyboardLongPressMeasureCallback({
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
					setLongPressPopup: (nextPopup) => {
						longPressPopupRef.current = nextPopup;
						setLongPressPopup(nextPopup);
					},
				}),
			);
		},
		[clearRepeat, updateKeyboardRootMetrics],
	);

	const startLongPressGesture = useCallback(
		(
			slot: KeyboardSlot,
			keyRef: React.RefObject<View | null>,
			event: GestureResponderEvent,
		) => {
			clearLongPressTimer();
			closeLongPressPopup();
			const generation = longPressGenerationRef.current + 1;
			longPressGenerationRef.current = generation;
			longPressGestureRef.current = {
				slot,
				keyRef,
				generation,
				startPageX: event.nativeEvent.pageX,
				startPageY: event.nativeEvent.pageY,
				currentPageX: event.nativeEvent.pageX,
				currentPageY: event.nativeEvent.pageY,
				movedBeyondTapSlop: false,
				longPressFired: false,
			};
			longPressTimeoutRef.current = setTimeout(() => {
				const current = longPressGestureRef.current;
				if (
					!current ||
					current.generation !== generation ||
					current.slot !== slot ||
					current.keyRef !== keyRef
				) {
					return;
				}
				current.longPressFired = true;
				openLongPressPopup(slot, keyRef, generation);
			}, longPressDelayMs);
		},
		[
			clearLongPressTimer,
			closeLongPressPopup,
			longPressDelayMs,
			openLongPressPopup,
		],
	);

	const moveLongPressGesture = useCallback(
		(event: GestureResponderEvent) => {
			const gesture = longPressGestureRef.current;
			if (!gesture) return;
			gesture.currentPageX = event.nativeEvent.pageX;
			gesture.currentPageY = event.nativeEvent.pageY;

			if (gesture.longPressFired) {
				updateLongPressHighlight(getLocalPoint(event));
				return;
			}

			const next = getLongPressMoveState({
				longPressFired: gesture.longPressFired,
				movedBeyondTapSlop: gesture.movedBeyondTapSlop,
				startPageX: gesture.startPageX,
				startPageY: gesture.startPageY,
				currentPageX: gesture.currentPageX,
				currentPageY: gesture.currentPageY,
				tapSlopPx,
			});
			gesture.movedBeyondTapSlop = next.movedBeyondTapSlop;
		},
		[getLocalPoint, tapSlopPx, updateLongPressHighlight],
	);

	const releaseLongPressGesture = useCallback(
		(
			slot: KeyboardSlot,
			isSelectionCopySlot: boolean,
			event: GestureResponderEvent,
		) => {
			const gesture = longPressGestureRef.current;
			longPressGenerationRef.current += 1;
			longPressGestureRef.current = null;
			clearLongPressTimer();

			if (!gesture) {
				closeLongPressPopup();
				return;
			}

			const current = longPressPopupRef.current;
			const decision = getLongPressReleaseDecision({
				longPressFired: gesture.longPressFired,
				movedBeyondTapSlop: gesture.movedBeyondTapSlop,
				startPageX: gesture.startPageX,
				startPageY: gesture.startPageY,
				releasePageX: event.nativeEvent.pageX,
				releasePageY: event.nativeEvent.pageY,
				tapSlopPx,
				rootX: keyboardRootWindowRef.current.x,
				rootY: keyboardRootWindowRef.current.y,
				keyboardBounds: keyboardBoundsRef.current,
				popupLayout: current?.layout ?? null,
				highlightedIndex: current?.highlightedIndex ?? null,
			});
			closeLongPressPopup();

			if (decision.type === 'cancel') {
				return;
			}
			if (decision.type === 'option') {
				const option = current?.options[decision.optionIndex];
				if (option) onSlotPress(option);
				return;
			}
			if (isSelectionCopySlot) {
				onCopySelection();
				return;
			}
			onSlotPress(slot);
		},
		[
			clearLongPressTimer,
			closeLongPressPopup,
			onCopySelection,
			onSlotPress,
			tapSlopPx,
		],
	);

	const cancelLongPressGesture = useCallback(() => {
		longPressGenerationRef.current += 1;
		longPressGestureRef.current = null;
		clearLongPressTimer();
		closeLongPressPopup();
	}, [clearLongPressTimer, closeLongPressPopup]);

	const runMainSlot = useCallback(
		(slot: KeyboardSlot, isSelectionCopySlot: boolean) => {
			if (isSelectionCopySlot) {
				onCopySelection();
				return;
			}
			onSlotPress(slot);
		},
		[onCopySelection, onSlotPress],
	);

	if (!keyboard) {
		return (
			<View
				style={{
					borderTopWidth: 1,
					borderColor: theme.colors.border,
					padding: 12,
				}}
			>
				<Text style={{ color: theme.colors.textSecondary }}>
					No keyboard configuration. Generate code to enable shortcuts.
				</Text>
			</View>
		);
	}

	/* eslint-disable @eslint-react/no-array-index-key */
	const visibleGrid = keyboard.grid.filter((row) =>
		row.some((slot) => slot !== null),
	);
	const rows = visibleGrid.map((row, rowIndex) => {
		const cells = [];
		let col = 0;
		while (col < row.length) {
			const slot = row[col];
			const rawSpan =
				typeof slot?.span === 'number' && slot.span > 1 ? slot.span : 1;
			const span = Math.min(rawSpan, row.length - col);

			if (!slot) {
				cells.push(
					<View
						key={`slot-${rowIndex}-${col}`}
						style={{ flex: 1, margin: 2, height: keyHeight }}
					/>,
				);
				col += 1;
				continue;
			}

			const isSelectionCopySlot =
				selectionModeEnabled &&
				slot.type === 'action' &&
				slot.actionId === 'PASTE_CLIPBOARD';
			const effectiveLabel = isSelectionCopySlot ? 'Copy' : slot.label;
			const effectiveIconName = isSelectionCopySlot ? 'Copy' : slot.icon;
			const modifierActive =
				slot.type === 'modifier' && modifierKeysActive.includes(slot.modifier);
			const hasLongPressOptions = Boolean(slot.longPress?.options.length);
			const scopeBadge = slotHasNavScopeOptions(slot) ? navScope : null;
			const isRepeatable =
				!hasLongPressOptions &&
				slot.type === 'bytes' &&
				repeatableLabels.has(slot.label);

			cells.push(
				<TerminalKeyboardKey
					key={`slot-${rowIndex}-${col}`}
					slot={slot}
					span={span}
					keyHeight={keyHeight}
					theme={theme}
					iconOnlyLabels={iconOnlyLabels}
					effectiveLabel={effectiveLabel}
					effectiveIconName={effectiveIconName}
					modifierActive={modifierActive}
					hasLongPressOptions={hasLongPressOptions}
					scopeBadge={scopeBadge}
					isRepeatable={isRepeatable}
					isSelectionCopySlot={isSelectionCopySlot}
					onSlotPress={onSlotPress}
					onCopySelection={onCopySelection}
					startRepeat={startRepeat}
					clearRepeat={clearRepeat}
					startLongPressGesture={startLongPressGesture}
					moveLongPressGesture={moveLongPressGesture}
					releaseLongPressGesture={releaseLongPressGesture}
					cancelLongPressGesture={cancelLongPressGesture}
					runMainSlot={runMainSlot}
				/>,
			);

			col += span;
		}

		return (
			<View key={`row-${rowIndex}`} style={{ flexDirection: 'row' }}>
				{cells}
			</View>
		);
	});
	/* eslint-enable @eslint-react/no-array-index-key */

	return (
		<View
			ref={keyboardRootRef}
			onLayout={handleKeyboardLayout}
			style={{
				borderTopWidth: 1,
				borderColor: theme.colors.border,
				padding: 6,
				position: 'relative',
			}}
		>
			{rows}
			{longPressPopup ? (
				<TerminalKeyboardLongPressPopup
					popup={longPressPopup}
					navScope={navScope}
					theme={theme}
				/>
			) : null}
		</View>
	);
}
