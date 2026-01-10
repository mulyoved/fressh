import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
	type KeyboardDefinition,
	type KeyboardSlot,
	type ModifierKey,
} from '@/generated/keyboard-config';
import { resolveLucideIcon } from '@/lib/lucide-utils';
import { useTheme } from '@/lib/theme';

export function TerminalKeyboard({
	keyboard,
	modifierKeysActive,
	onSlotPress,
	selectionModeEnabled,
	onCopySelection,
	onPasteClipboard,
}: {
	keyboard: KeyboardDefinition | null;
	modifierKeysActive: ModifierKey[];
	onSlotPress: (slot: KeyboardSlot) => void;
	selectionModeEnabled: boolean;
	onCopySelection: () => void;
	onPasteClipboard: () => void;
}) {
	const theme = useTheme();
	const CopyIcon = resolveLucideIcon('Copy');
	const PasteIcon = resolveLucideIcon('ClipboardPaste');
	const keyMinHeight = 44;
	const repeatDelayMs = 320;
	const repeatIntervalMs = 70;
	const repeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const repeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const repeatSlotRef = useRef<KeyboardSlot | null>(null);
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

	useEffect(() => clearRepeat, [clearRepeat]);

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
	const rows = keyboard.grid.map((row, rowIndex) => (
		<View key={`row-${rowIndex}`} style={{ flexDirection: 'row' }}>
			{row.map((slot, colIndex) => {
				if (!slot) {
					return (
						<View
							key={`slot-${rowIndex}-${colIndex}`}
							style={{ flex: 1, margin: 2, minHeight: keyMinHeight }}
						/>
					);
				}

				const modifierActive =
					slot.type === 'modifier' &&
					modifierKeysActive.includes(slot.modifier);
				const Icon = resolveLucideIcon(slot.icon);
				const showLabel = !(Icon && iconOnlyLabels.has(slot.label));
				const isRepeatable =
					slot.type === 'bytes' && repeatableLabels.has(slot.label);
				const flexValue =
					typeof slot.span === 'number' && slot.span > 1 ? slot.span : 1;

				return (
					<Pressable
						key={`slot-${rowIndex}-${colIndex}`}
						onPress={isRepeatable ? undefined : () => onSlotPress(slot)}
						onPressIn={isRepeatable ? () => startRepeat(slot) : undefined}
						onPressOut={isRepeatable ? clearRepeat : undefined}
						style={[
							{
								flex: flexValue,
								margin: 2,
								minHeight: keyMinHeight,
								paddingVertical: 6,
								borderRadius: 8,
								borderWidth: 1,
								borderColor: theme.colors.border,
								alignItems: 'center',
								justifyContent: 'center',
							},
							modifierActive && {
								backgroundColor: theme.colors.primary,
							},
						]}
					>
						{Icon ? <Icon color={theme.colors.textPrimary} size={18} /> : null}
						{showLabel ? (
							<Text
								numberOfLines={1}
								style={{
									color: theme.colors.textPrimary,
									fontSize: 10,
									marginTop: Icon ? 2 : 0,
								}}
							>
								{slot.label}
							</Text>
						) : null}
					</Pressable>
				);
			})}
		</View>
	));
	/* eslint-enable @eslint-react/no-array-index-key */

	const copyToggle = (
		<Pressable
			onPress={onCopySelection}
			style={{
				flex: 1,
				margin: 2,
				minHeight: keyMinHeight,
				paddingVertical: 6,
				borderRadius: 8,
				borderWidth: 1,
				borderColor: theme.colors.border,
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			{CopyIcon ? (
				<CopyIcon color={theme.colors.textPrimary} size={18} />
			) : null}
			<Text
				numberOfLines={1}
				style={{
					color: theme.colors.textPrimary,
					fontSize: 10,
					marginTop: CopyIcon ? 2 : 0,
				}}
			>
				Copy
			</Text>
		</Pressable>
	);

	const pasteToggle = (
		<Pressable
			onPress={onPasteClipboard}
			style={{
				flex: 1,
				margin: 2,
				minHeight: keyMinHeight,
				paddingVertical: 6,
				borderRadius: 8,
				borderWidth: 1,
				borderColor: theme.colors.border,
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			{PasteIcon ? (
				<PasteIcon color={theme.colors.textPrimary} size={18} />
			) : null}
			<Text
				numberOfLines={1}
				style={{
					color: theme.colors.textPrimary,
					fontSize: 10,
					marginTop: PasteIcon ? 2 : 0,
				}}
			>
				Paste
			</Text>
		</Pressable>
	);

	const toggleRow = selectionModeEnabled ? (
		<View style={{ flexDirection: 'row' }}>
			{copyToggle}
			{pasteToggle}
		</View>
	) : null;

	return (
		<View
			style={{
				borderTopWidth: 1,
				borderColor: theme.colors.border,
				padding: 6,
			}}
		>
			{toggleRow}
			{rows}
		</View>
	);
}
